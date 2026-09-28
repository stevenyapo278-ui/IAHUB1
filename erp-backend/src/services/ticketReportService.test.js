// Service de rapport de tickets par email (chatbot texte/vocal) :
// périodes en langage naturel, résolution d'équipe, périmètre RBAC partagé
// avec l'export, génération XLSX et envoi avec copie CC.
jest.mock('../prismaClient', () => ({
  team: { findFirst: jest.fn(async () => null) },
  ticket: { findMany: jest.fn(async () => []) },
}));
jest.mock('./emailSender', () => ({
  sendEmailViaSmtp: jest.fn(async () => undefined),
  getActiveEmailAccount: jest.fn(async () => ({ provider: 'SMTP', id: 1, name: 'defaut' })),
  buildEmailLayout: jest.fn(({ children }) => `<html><body>${children}</body></html>`),
}));

const prisma = require('../prismaClient');
const { sendEmailViaSmtp, getActiveEmailAccount } = require('./emailSender');
const {
  periodToRange,
  periodLabel,
  resolveReportQuery,
  resolveCcEmails,
  describeFilters,
  buildTicketsXlsxBuffer,
  previewReport,
  sendTicketReportEmail,
} = require('./ticketReportService');

const requester = { sub: 'u1', email: 'demandeur@prosuma.ci', role: 'SUPERADMIN', roles: ['SUPERADMIN'] };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('periodToRange — périodes en langage naturel', () => {
  it('today borne la journée courante', () => {
    const range = periodToRange('today');
    expect(range.dateFrom).toBe(range.dateTo);
    expect(range.dateTo).toBe(new Date().toISOString().slice(0, 10));
  });

  it('7d couvre 7 jours glissants (jour inclus + 6 précédents)', () => {
    const range = periodToRange('7d');
    const diff = (new Date(range.dateTo) - new Date(range.dateFrom)) / 86400000;
    expect(diff).toBe(6);
  });

  it('this_month va du 1er au dernier jour du mois courant', () => {
    const { dateFrom, dateTo } = periodToRange('this_month');
    expect(dateFrom.endsWith('-01')).toBe(true);
    expect(new Date(dateFrom).getMonth()).toBe(new Date().getMonth());
    expect(new Date(dateTo).getMonth()).toBe(new Date(dateTo).getMonth());
    expect(Number(dateTo.slice(8))).toBe(new Date(Number(dateTo.slice(0, 4)), Number(dateTo.slice(5, 7)), 0).getDate());
  });

  it('last_month est strictement antérieur à ce mois', () => {
    const { dateFrom, dateTo } = periodToRange('last_month');
    expect(dateTo < periodToRange('this_month').dateFrom).toBe(true);
    expect(dateFrom < dateTo).toBe(true);
  });

  it('période inconnue ou absente retourne null', () => {
    expect(periodToRange('n_importe_quoi')).toBeNull();
    expect(periodToRange(undefined)).toBeNull();
    expect(periodLabel('n_importe_quoi')).toBeNull();
  });

  it('periodLabel rend une étiquette lisible', () => {
    expect(periodLabel('today')).toBe("aujourd'hui");
    expect(periodLabel('7d')).toBe('les 7 derniers jours');
    expect(periodLabel('last_month')).toBe('le mois dernier');
  });
});

describe('resolveReportQuery — filtres → paramètres Prisma', () => {
  it('applique période, statut, priorité, catégorie et mot-clé', async () => {
    const query = await resolveReportQuery({
      period: '30d', status: 'OPEN', priority: 'P2', category: 'Réseau', search: 'incident',
    });
    expect(query.dateFrom && query.dateTo).toBeTruthy();
    expect(query.status).toBe('OPEN');
    expect(query.priority).toBe('P2');
    expect(query.category).toBe('Réseau');
    expect(query.search).toBe('incident');
  });

  it("dateFrom/dateTo explicites priment sur la période", async () => {
    const query = await resolveReportQuery({ period: 'today', dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(query.dateFrom).toBe('2026-01-01');
    expect(query.dateTo).toBe('2026-01-31');
  });

  it("résout le nom d'équipe (insensible à la casse)", async () => {
    prisma.team.findFirst.mockResolvedValueOnce({ id: 7, name: 'Système' });
    const query = await resolveReportQuery({ team: 'système' });
    expect(query.teamId).toBe(7);
    expect(query._teamName).toBe('Système');
    expect(prisma.team.findFirst).toHaveBeenCalled();
  });

  it("échoue avec code TEAM_NOT_FOUND si l'équipe n'existe pas", async () => {
    prisma.team.findFirst.mockResolvedValue(null);
    await expect(resolveReportQuery({ team: 'inexistante' })).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' });
  });

  it('sans équipe ne touche pas au modèle team', async () => {
    const query = await resolveReportQuery({});
    expect(query.teamId).toBeUndefined();
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });
});

describe('resolveCcEmails — CC explicites + membres d\'équipe', () => {
  it('ajoute les membres actifs et observateurs par défaut de l\'équipe citée', async () => {
    prisma.team.findFirst.mockResolvedValueOnce({
      name: 'Sécurité',
      members: [
        { email: 'fatou@prosuma.ci', isActive: true },
        { email: 'inactif@prosuma.ci', isActive: false },
      ],
      defaultObservers: [{ email: 'obs@prosuma.ci', isActive: true }],
    });
    const cc = await resolveCcEmails({ ccTeams: ['Sécurité'] }, 'moi@prosuma.ci');
    expect(cc).toEqual(['fatou@prosuma.ci', 'obs@prosuma.ci']);
    expect(prisma.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { name: { equals: 'Sécurité', mode: 'insensitive' } },
    }));
  });

  it('mélange adresses explicites et membres, déduplique, exclut le destinataire', async () => {
    prisma.team.findFirst.mockResolvedValueOnce({
      name: 'Sécurité',
      members: [
        { email: 'fatou@prosuma.ci', isActive: true },
        { email: 'MOI@prosuma.ci', isActive: true },
      ],
      defaultObservers: [],
    });
    const cc = await resolveCcEmails(
      { cc: ['Chef@Prosuma.ci', 'fatou@prosuma.ci'], ccTeams: ['Sécurité'] },
      'moi@prosuma.ci',
    );
    expect(cc).toEqual(['chef@prosuma.ci', 'fatou@prosuma.ci']);
  });

  it('équipe en CC introuvable → erreur TEAM_NOT_FOUND', async () => {
    prisma.team.findFirst.mockResolvedValue(null);
    await expect(resolveCcEmails({ ccTeams: ['Inexistante'] })).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' });
  });

  it('plafonne la liste à 20 adresses', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ email: `user${i}@prosuma.ci`, isActive: true }));
    prisma.team.findFirst.mockResolvedValueOnce({ name: 'Grosse', members: many, defaultObservers: [] });
    const cc = await resolveCcEmails({ ccTeams: ['Grosse'] });
    expect(cc).toHaveLength(20);
  });

  it('sans CC renvoie une liste vide sans requête team', async () => {
    const cc = await resolveCcEmails({});
    expect(cc).toEqual([]);
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });
});

describe('describeFilters — résumé affiché avant confirmation', () => {
  it('liste chaque filtre actif', () => {
    const label = describeFilters({
      dateFrom: '2026-09-01', dateTo: '2026-09-30', _teamName: 'Réseau',
      status: 'OPEN', priority: 'P1', search: 'print',
    });
    expect(label).toContain('période : du 2026-09-01 au 2026-09-30');
    expect(label).toContain('équipe : Réseau');
    expect(label).toContain('statut : OPEN');
    expect(label).toContain('priorité : P1');
    expect(label).toContain('mot-clé : « print »');
  });

  it('sans filtre renvoie la mention par défaut', () => {
    expect(describeFilters({})).toBe('tous les tickets visibles pour vous');
  });
});

describe('buildTicketsXlsxBuffer — fichier Excel généré', () => {
  it('produit un buffer XLSX valide avec les tickets fournis', async () => {
    const buffer = await buildTicketsXlsxBuffer([
      {
        id: 123, title: 'Ticket de test', status: 'OPEN', priority: 'P2', category: 'Système',
        type: 'incident', source: 'CHATBOT', createdAt: new Date(), solvedAt: null, closedAt: null,
        slaResponseDueAt: null, slaResolutionDueAt: null, slaBreachedAt: null, firstResponseAt: null,
        aiProcessed: true, approvalStatus: null,
        requester: { email: 'user@prosuma.ci', fullName: 'Jean Test', avatarUrl: null },
        assignedTo: { email: 'tech@prosuma.ci', fullName: 'Tech Test', avatarUrl: null },
        assignees: [], team: { name: 'Système' }, locationName: 'Abidjan', observers: [],
      },
    ]);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // Signature ZIP du format OOXML
    expect(buffer.slice(0, 2).toString('latin1')).toBe('PK');
  });
});

describe('previewReport — compte sans rien envoyer', () => {
  it('retourne le nombre de tickets, le résumé des filtres et les CC résolus', async () => {
    prisma.ticket.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const preview = await previewReport(requester, { period: '7d', status: 'OPEN' });
    expect(preview.count).toBe(2);
    expect(preview.filtersLabel).toContain('statut : OPEN');
    expect(preview.cc).toEqual([]);
    expect(sendEmailViaSmtp).not.toHaveBeenCalled();
    expect(prisma.ticket.findMany).toHaveBeenCalled();
  });

  it('résout les membres d\'équipe en CC pendant le preview', async () => {
    prisma.ticket.findMany.mockResolvedValueOnce([{ id: 1 }]);
    prisma.team.findFirst.mockResolvedValueOnce({
      name: 'Sécurité',
      members: [{ email: 'fatou@prosuma.ci', isActive: true }, { email: 'yapo@prosuma.ci', isActive: true }],
      defaultObservers: [],
    });
    const preview = await previewReport(requester, { ccTeams: ['Sécurité'] });
    expect(preview.cc).toEqual(['fatou@prosuma.ci', 'yapo@prosuma.ci']);
  });
});

describe('sendTicketReportEmail — envoi avec pièce jointe', () => {
  it('nenvoie rien quand aucun ticket ne correspond', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);
    const result = await sendTicketReportEmail({ user: requester, args: { period: '7d' }, cc: [] });
    expect(result.sent).toBe(false);
    expect(result.count).toBe(0);
    expect(sendEmailViaSmtp).not.toHaveBeenCalled();
  });

  it("échoue explicitement sans compte email configuré", async () => {
    prisma.ticket.findMany.mockResolvedValue([{ id: 1 }]);
    getActiveEmailAccount.mockResolvedValue(null);
    await expect(sendTicketReportEmail({ user: requester, args: {} })).rejects.toThrow(/Aucun compte email/);
    expect(sendEmailViaSmtp).not.toHaveBeenCalled();
  });

  it('envoie XLSX en pièce jointe, au demandeur, avec CC', async () => {
    getActiveEmailAccount.mockResolvedValue({ provider: 'SMTP', id: 1, name: 'defaut' });
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 42, title: 'Serveur en feu', status: 'OPEN', priority: 'P1', category: 'Système',
        type: 'incident', source: 'CHATBOT', createdAt: new Date(), solvedAt: null, closedAt: null,
        slaResponseDueAt: null, slaResolutionDueAt: null, slaBreachedAt: null, firstResponseAt: null,
        aiProcessed: false, approvalStatus: null,
        requester: { email: 'user@prosuma.ci', fullName: 'Jean', avatarUrl: null },
        assignedTo: null, assignees: [], team: { name: 'Système' }, locationName: null, observers: [],
      },
    ]);
    const result = await sendTicketReportEmail({
      user: requester,
      args: { period: 'this_month' },
      cc: ['chef@prosuma.ci'],
    });
    expect(result.sent).toBe(true);
    expect(result.count).toBe(1);
    expect(result.filename).toMatch(/^rapport_tickets_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sendEmailViaSmtp).toHaveBeenCalledTimes(1);
    const mail = sendEmailViaSmtp.mock.calls[0][0];
    expect(mail.to).toBe('demandeur@prosuma.ci');
    expect(mail.cc).toEqual(['chef@prosuma.ci']);
    expect(mail.subject).toContain('Rapport de tickets');
    expect(mail.bodyHtml).toContain('Filtres appliqués');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toMatch(/\.xlsx$/);
    expect(mail.attachments[0].contentType).toContain('spreadsheetml');
    expect(mail.attachments[0].content.length).toBeGreaterThan(1000);
    expect(getActiveEmailAccount).toHaveBeenCalled();
  });
});
