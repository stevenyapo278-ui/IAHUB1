jest.mock('../prismaClient', () => ({
  emailAccount: { findFirst: jest.fn() },
  ticket: { findUnique: jest.fn() },
  ticketMessage: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock('../utils/graphClient', () => ({ graphFetch: jest.fn() }));
jest.mock('./systemSettings', () => ({
  getSystemSettings: jest.fn().mockResolvedValue({ emailApprovalEnabled: true, signatureLogoUrl: null }),
  resolveFrontendUrl: jest.fn(() => 'http://localhost:3000'),
}));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./emailSummaryGenerator', () => ({ generateEmailSummary: jest.fn().mockResolvedValue(null) }));
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn(), verify: jest.fn() })) }));

const prisma = require('../prismaClient');
const nodemailer = require('nodemailer');
const { graphFetch } = require('../utils/graphClient');
const { buildAcknowledgementHtml, buildKnownIncidentNotificationHtml, sendAiDraftEmail } = require('./emailSender');

describe('buildAcknowledgementHtml', () => {
  it('utilise le message par défaut quand customMessage est vide', () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', glpiTicketId: 1, originalSubject: 'Test' });
    expect(html).toContain('Nous avons bien reçu votre demande de support');
  });

  it('remplace les placeholders {ticketId}, {subject} et {toName} dans le message personnalisé', () => {
    const html = buildAcknowledgementHtml({
      toName: 'Jean',
      glpiTicketId: 42,
      originalSubject: 'Imprimante',
      customMessage: 'Merci {toName}, votre ticket {ticketId} sur "{subject}" est pris en charge.',
    });
    expect(html).toContain('Merci Jean, votre ticket 42 sur "Imprimante" est pris en charge.');
  });

  it("n'affiche plus de ligne de délai estimé (supprimée explicitement)", () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', glpiTicketId: 1, originalSubject: 'Test' });
    expect(html).not.toMatch(/délai estimé/i);
  });

  it('insère la signature fournie telle quelle', () => {
    const html = buildAcknowledgementHtml({
      toName: 'Jean',
      glpiTicketId: 1,
      originalSubject: 'Test',
      signature: '<div>Ma signature perso</div>',
    });
    expect(html).toContain('Ma signature perso');
  });

  it('retombe sur la signature par défaut si aucune signature fournie', () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', glpiTicketId: 1, originalSubject: 'Test' });
    expect(html).toContain('Cordialement');
  });

  it('masque le bloc numéro de ticket quand withTicketBlock est false', () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', glpiTicketId: 1, originalSubject: 'Test', withTicketBlock: false });
    expect(html).not.toContain('Numéro de ticket');
    expect(html).not.toContain('Suivre mon ticket');
    expect(html).toContain('Accusé de réception');
  });

  it('masque le bloc ticket quand aucun identifiant n\'est fourni', () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', originalSubject: 'Test' });
    expect(html).not.toContain('Numéro de ticket');
    expect(html).toContain('Accusé de réception');
  });
});

describe('isWithinBusinessHours', () => {
  const { isWithinBusinessHours } = require('./emailSender');

  // Mardi 13:10 UTC = 13:10 à Abidjan (UTC+0) → dans les horaires 8h-17h lun-ven
  const mardiApresMidi = new Date('2026-09-29T13:10:00Z');
  // Mardi 18:30 UTC = 18:30 à Abidjan → hors horaires
  const mardiSoir = new Date('2026-09-29T18:30:00Z');
  // Dimanche 10:00 UTC = dimanche à Abidjan → hors horaires
  const dimanche = new Date('2026-09-27T10:00:00Z');

  it('considère un jour ouvré dans la plage comme dans les horaires', () => {
    expect(isWithinBusinessHours(mardiApresMidi, { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00' })).toBe(true);
  });

  it('considère le soir comme hors horaires', () => {
    expect(isWithinBusinessHours(mardiSoir, { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00' })).toBe(false);
  });

  it('considère le week-end comme hors horaires', () => {
    expect(isWithinBusinessHours(dimanche, { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00' })).toBe(false);
  });

  it('accepte une plage incluant le dimanche quand configurée', () => {
    expect(isWithinBusinessHours(dimanche, { days: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '17:00' })).toBe(true);
  });

  it('considère une config invalide comme dans les horaires (fallback sûr)', () => {
    expect(isWithinBusinessHours(mardiSoir, { days: 'nonsense', startTime: 'x', endTime: 'y' })).toBe(true);
  });
});

describe('pickAcknowledgementMessage', () => {
  const { pickAcknowledgementMessage, DEFAULT_ACKNOWLEDGEMENT_OFF_HOURS_MESSAGE } = require('./emailSender');

  // Mardi 18:30 UTC = hors horaires 8h-17h lun-ven (Abidjan) ; mardi 13:10 = dans les horaires
  const dansHoraires = new Date('2026-09-29T13:10:00Z');
  const horsHoraires = new Date('2026-09-29T18:30:00Z');
  // Forme identique à un enregistrement SystemSettings réel
  const base = { acknowledgementBusinessDays: [1, 2, 3, 4, 5], acknowledgementBusinessStartTime: '08:00', acknowledgementBusinessEndTime: '17:00' };

  it('prend le message standard pendant les horaires', () => {
    const { message, offHours } = pickAcknowledgementMessage({ acknowledgementMessage: 'MSG_JOUR', acknowledgementOffHoursMessage: 'MSG_SOIR', ...base }, dansHoraires);
    expect(message).toBe('MSG_JOUR');
    expect(offHours).toBe(false);
  });

  it('prend la variante hors horaires en dehors de la plage', () => {
    const { message, offHours } = pickAcknowledgementMessage({ acknowledgementMessage: 'MSG_JOUR', acknowledgementOffHoursMessage: 'MSG_SOIR', ...base }, horsHoraires);
    expect(message).toBe('MSG_SOIR');
    expect(offHours).toBe(true);
  });

  it('retombe sur le défaut hors horaires si la variante est vide', () => {
    const { message } = pickAcknowledgementMessage({ acknowledgementMessage: 'MSG_JOUR', ...base }, horsHoraires);
    expect(message).toBe(DEFAULT_ACKNOWLEDGEMENT_OFF_HOURS_MESSAGE);
  });

  it('ignore la variante horaire quand acknowledgementBusinessHoursEnabled est false', () => {
    const { message, offHours } = pickAcknowledgementMessage({ acknowledgementMessage: 'MSG_JOUR', acknowledgementOffHoursMessage: 'MSG_SOIR', acknowledgementBusinessHoursEnabled: false, ...base }, horsHoraires);
    expect(message).toBe('MSG_JOUR');
    expect(offHours).toBe(false);
  });
});

describe('buildKnownIncidentNotificationHtml', () => {
  it('mentionne le nombre de sites impactés', () => {
    const html = buildKnownIncidentNotificationHtml({
      toName: 'Jean',
      glpiTicketId: 1,
      originalSubject: 'Panne réseau',
      isMajor: false,
      impactedCount: 3,
    });
    expect(html).toContain('3');
  });

  it('ajoute la mention "incident majeur" uniquement si isMajor est vrai', () => {
    const minor = buildKnownIncidentNotificationHtml({
      toName: 'Jean', glpiTicketId: 1, originalSubject: 'Panne', isMajor: false, impactedCount: 1,
    });
    const major = buildKnownIncidentNotificationHtml({
      toName: 'Jean', glpiTicketId: 1, originalSubject: 'Panne', isMajor: true, impactedCount: 5,
    });
    expect(minor).not.toMatch(/incident majeur/i);
    expect(major).toMatch(/incident majeur/i);
  });
});

describe('sendAiDraftEmail — envoi unifié des brouillons IA', () => {
  // Prépare le chemin Outlook réel de sendEmail (createReply/PATCH/send) sur des mocks Graph
  const setupOutlook = () => {
    prisma.emailAccount.findFirst.mockResolvedValue({ provider: 'OUTLOOK', emailAddress: 'support@prosuma.ci', refreshToken: 'r' });
    prisma.ticket.findUnique.mockResolvedValue({ status: 'APPROVED' });
    prisma.ticketMessage.create.mockResolvedValue({});
    graphFetch.mockImplementation(async (_account, p) => {
      if (String(p).includes('/createReply')) return { id: 'draft-1' };
      return { internetMessageId: '<sent@prosuma.ci>' };
    });
  };
  const findGraphCall = (path) => graphFetch.mock.calls.find(([_, p]) => String(p) === path);
  const parseBody = (call) => JSON.parse(call[2].body);

  beforeEach(() => {
    jest.clearAllMocks();
    setupOutlook();
  });

  it('résout #EN_ATTENTE dans le sujet, enveloppe le contenu brut avec la signature, garde les CC du brouillon', async () => {
    prisma.ticketMessage.findFirst.mockResolvedValue(null);
    await sendAiDraftEmail({
      ticketId: 42,
      draft: { ticketId: 42, subject: '[Ticket #EN_ATTENTE] Re: Panne', proposedContent: '<p>Bonjour, voici la réponse.</p>', ccRecipients: ['copie@ex.com'] },
      to: 'demandeur@ex.com',
    });
    const newMsg = findGraphCall('/me/messages');
    expect(newMsg).toBeTruthy(); // pas de threading → nouveau message
    const body = parseBody(newMsg);
    expect(body.subject).toBe('[Ticket #42] Re: Panne');
    expect(body.body.content).toContain('Bonjour, voici la réponse.');
    expect(body.body.content).toContain('Ticket #42'); // sous-titre du bandeau
    expect(body.ccRecipients.map((r) => r.emailAddress.address)).toEqual(['copie@ex.com']);
  });

  it('ne ré-enveloppe PAS un brouillon legacy contenant déjà le gabarit + signature', async () => {
    prisma.ticketMessage.findFirst.mockResolvedValue(null);
    const legacyHtml = '<table><tr><td style="background:#2563eb">Réponse à votre demande</td></tr><tr><td>Corps</td></tr><tr><td>Cordialement,<br>Support IT</td></tr></table>';
    await sendAiDraftEmail({
      ticketId: 7,
      draft: { ticketId: 7, subject: 'S', proposedContent: legacyHtml, ccRecipients: [] },
      to: 'a@b.c',
    });
    const newMsg = findGraphCall('/me/messages');
    expect(parseBody(newMsg).body.content).toBe(legacyHtml);
  });

  it('met en CC les personnes de la demande d\'ORIGINE (1er entrant) même si le dernier message du fil n\'en a pas', async () => {
    prisma.ticketMessage.findFirst
      .mockResolvedValueOnce({ outlookMessageId: 'AAQk-Graph-Id', ccRecipients: [], recipients: ['groupe-hotline@prosuma.ci'], conversationId: 'conv-9', internetMessageId: '<original@ex.com>' })
      .mockResolvedValueOnce({ ccRecipients: ['chef@ex.com', 'boss2@ex.com'], recipients: ['groupe-hotline@prosuma.ci'], internetMessageId: '<original@ex.com>' });
    await sendAiDraftEmail({
      ticketId: 42,
      draft: { ticketId: 42, subject: 'S', proposedContent: '<p>Corps</p>', ccRecipients: [] },
      to: 'demandeur@ex.com',
    });
    expect(findGraphCall('/me/messages/AAQk-Graph-Id/createReply')).toBeTruthy();
    const patch = findGraphCall('/me/messages/draft-1');
    const body = parseBody(patch);
    expect(body.ccRecipients.map((r) => r.emailAddress.address)).toEqual(['chef@ex.com', 'boss2@ex.com']);
    // La boîte de diffusion du message d'origine est remise en To (sémantique « Répondre à tous »)
    expect(body.toRecipients.map((r) => r.emailAddress.address).sort()).toEqual(['demandeur@ex.com', 'groupe-hotline@prosuma.ci']);
    // Le message OUTBOUND archivé porte bien le header In-Reply-To RFC
    const saved = prisma.ticketMessage.create.mock.calls[0][0].data;
    expect(saved.direction).toBe('OUTBOUND');
    expect(saved.inReplyTo).toBe('<original@ex.com>');
  });

  it('respecte un ccRecipients explicite vide, sans hériter des CC du brouillon, mais garde la liste To d\'origine (groupe)', async () => {
    prisma.ticketMessage.findFirst
      .mockResolvedValueOnce({ outlookMessageId: null, ccRecipients: [], recipients: [], conversationId: null, internetMessageId: null })
      .mockResolvedValueOnce({ ccRecipients: ['chef@ex.com'], recipients: ['groupe@prosuma.ci'], internetMessageId: null });
    await sendAiDraftEmail({
      ticketId: 42,
      draft: { ticketId: 42, subject: 'S', proposedContent: '<p>Corps</p>', ccRecipients: ['x@y.z'] },
      to: 'demandeur@ex.com',
      cc: [],
    });
    const newMsg = findGraphCall('/me/messages');
    const body = parseBody(newMsg);
    // CC explicite vide respecté (pas de x@y.z), mais la fusion avec la demande d'origine s'applique
    expect(body.ccRecipients.map((r) => r.emailAddress.address)).toEqual(['chef@ex.com']);
    expect(JSON.stringify(body)).not.toContain('x@y.z');
    // Le groupe du message d'origine est en To
    expect(body.toRecipients.map((r) => r.emailAddress.address)).toContain('groupe@prosuma.ci');
  });

  it('exclut la boîte support elle-même de la liste To (demande adressée directement à la boîte)', async () => {
    prisma.ticketMessage.findFirst.mockResolvedValue(null);
    await sendAiDraftEmail({
      ticketId: 42,
      draft: { ticketId: 42, subject: 'S', proposedContent: '<p>Corps</p>', ccRecipients: [] },
      to: 'demandeur@ex.com',
    });
    // setupOutlook() déclare support@prosuma.ci comme boîte d'envoi ; simule un To d'origine
    // contenant la boîte elle-même + le groupe → la boîte doit disparaître, pas le groupe.
    prisma.ticketMessage.findFirst.mockResolvedValue(null);
    const { sendEmail } = require('./emailSender');
    // Envoi direct via sendEmail pour tester le filtre To indépendamment du repli DB
    await sendEmail({ ticketId: 42, to: ['demandeur@ex.com', 'support@prosuma.ci'], cc: [], subject: 'T', bodyHtml: '<p>x</p>' });
    const newMsg = findGraphCall('/me/messages');
    const body = parseBody(newMsg);
    expect(body.toRecipients.map((r) => r.emailAddress.address)).toEqual(['demandeur@ex.com']);
  });
});

describe('sendEmail — routage par provider + pièces jointes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    graphFetch.mockImplementation(async (_account, p) => {
      if (String(p).includes('/createReply')) return { id: 'draft-1' };
      return { id: 'draft-2', internetMessageId: '<sent@prosuma.ci>' };
    });
  });

  const setupOutlookAccount = () => {
    prisma.emailAccount.findFirst.mockResolvedValue({ provider: 'OUTLOOK', emailAddress: 'support@prosuma.ci', refreshToken: 'r' });
  };

  // Compte actif IMAP_SMTP : les deux recherches OUTLOOK ne retournent rien, la 3e oui.
  const setupSmtpAccount = (overrides = {}) => {
    prisma.emailAccount.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        provider: 'IMAP_SMTP',
        label: 'SMTP Pro',
        emailAddress: 'smtp@prosuma.ci',
        smtpHost: 'mail.prosuma.ci',
        smtpPort: 587,
        username: 'smtp@prosuma.ci',
        password: 'secret',
        useTls: true,
        ...overrides,
      });
  };

  it('joint le fichier à la création Graph (fileAttachment base64) pour un compte Outlook', async () => {
    setupOutlookAccount();
    const { sendEmail } = require('./emailSender');
    const buffer = Buffer.from('PK\u0003\u0004contenu-xlsx');
    await sendEmail({
      to: 'demandeur@prosuma.ci',
      subject: 'Rapport de tickets',
      bodyHtml: '<p>rapport</p>',
      saveAsMessage: false,
      attachments: [{ filename: 'rapport_tickets.xlsx', content: buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
    });
    const call = graphFetch.mock.calls.find(([_, p]) => String(p) === '/me/messages');
    expect(call).toBeTruthy();
    const body = JSON.parse(call[2].body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'rapport_tickets.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBytes: buffer.toString('base64'),
    });
    // Jamais de tentative SMTP pour un compte Outlook
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('utilise nodemailer (SMTP) pour un compte IMAP_SMTP et transmet les pièces jointes', async () => {
    setupSmtpAccount();
    const sendMail = jest.fn().mockResolvedValue({ accepted: ['demandeur@prosuma.ci'] });
    nodemailer.createTransport.mockReturnValue({ sendMail });
    const { sendEmail } = require('./emailSender');
    const buffer = Buffer.from('xlsx');
    await sendEmail({
      to: 'demandeur@prosuma.ci',
      subject: 'Rapport de tickets',
      bodyHtml: '<p>rapport</p>',
      saveAsMessage: false,
      attachments: [{ filename: 'rapport.xlsx', content: buffer, contentType: 'application/octet-stream' }],
    });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'mail.prosuma.ci',
      port: 587,
    }));
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('demandeur@prosuma.ci');
    expect(mail.attachments).toEqual([{ filename: 'rapport.xlsx', content: buffer, contentType: 'application/octet-stream' }]);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("refuse un compte sans hôte SMTP au lieu de retomber sur localhost:587", async () => {
    const { sendEmailViaSmtp } = require('./emailSender');
    await expect(sendEmailViaSmtp({
      to: 'a@b.c',
      subject: 'S',
      bodyHtml: '<p>x</p>',
      account: { label: 'Boîte principale', emailAddress: 'support@prosuma.ci' },
    })).rejects.toThrow(/n'a pas d'hôte SMTP configuré/);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it("contextualise l'erreur de connexion SMTP en français avec hôte:port", async () => {
    const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:587'), { code: 'ESOCKET' });
    nodemailer.createTransport.mockReturnValue({ sendMail: jest.fn().mockRejectedValue(connErr) });
    const { sendEmailViaSmtp } = require('./emailSender');
    await expect(sendEmailViaSmtp({
      to: 'a@b.c',
      subject: 'S',
      bodyHtml: '<p>x</p>',
      account: { label: 'SMTP Pro', emailAddress: 'smtp@prosuma.ci', smtpHost: 'mail.prosuma.ci', smtpPort: 587 },
    })).rejects.toThrow(/Échec de connexion au serveur SMTP mail\.prosuma\.ci:587/);
  });
});
