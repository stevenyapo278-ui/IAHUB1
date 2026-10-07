// Service de validation hiérarchique : e-mail au supérieur (lien + copies CC)
// et décision (approuver / refuser) appliquée au ticket + à TicketApproval.

jest.mock('../prismaClient', () => ({
  ticket: { update: jest.fn() },
  ticketApproval: { update: jest.fn() },
  followup: { create: jest.fn() },
}));
jest.mock('./emailSender', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  buildEmailLayout: jest.fn(({ headerTitle, children }) => `<layout>${headerTitle}${children}</layout>`),
  buildActionLink: jest.fn((url, label) => `<a href="${url}">${label}</a>`),
}));
jest.mock('./systemSettings', () => ({
  getSystemSettings: jest.fn().mockResolvedValue({}),
  resolveFrontendUrl: jest.fn(() => 'https://hub.example'),
}));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/socket', () => ({ emitTicketUpdated: jest.fn() }));
jest.mock('./slaService', () => ({ applySla: jest.fn(async (ticket) => ticket) }));

const prisma = require('../prismaClient');
const { sendEmail } = require('./emailSender');
const { logEvent } = require('./ticketEvent');
const { emitTicketUpdated } = require('../utils/socket');
const { applySla } = require('./slaService');
const { MANAGER_KEY, CC_KEY, sendManagerApprovalEmail, decideApproval } = require('./hierarchicalApproval');

const TICKET = { id: 42, title: 'DEMANDE CYRUS', content: '<p>Corps du ticket</p>', priority: 'P3' };
const RECORD = {
  id: 7, token: 'tok-abc', ticketId: 42, formId: 4,
  managerEmail: 'boss@x.ci', cc: ['copie@x.ci'], status: 'PENDING',
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.ticket.update.mockResolvedValue({
    id: 42, status: 'NEW', approvalStatus: 'APPROVED',
    requester: { email: 'dem@x.ci', fullName: 'Aimee' },
  });
  prisma.ticketApproval.update.mockResolvedValue({ id: 7 });
  prisma.followup.create.mockResolvedValue({ id: 1 });
});

describe('sendManagerApprovalEmail', () => {
  it('lien de décision + destinataire + copiés + saveAsMessage false', async () => {
    await sendManagerApprovalEmail({ ticket: TICKET, approval: RECORD, requesterName: 'Aimee Toho' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('boss@x.ci');
    expect(arg.cc).toEqual(['copie@x.ci']);
    expect(arg.saveAsMessage).toBe(false);
    expect(arg.subject).toContain('#42');
    expect(arg.subject).toContain('VALIDATION REQUISE');
    expect(arg.bodyHtml).toContain('https://hub.example/approvals/tok-abc');
    expect(arg.bodyHtml).toContain('Aimee Toho');
    expect(arg.bodyHtml).toContain('copie@x.ci');
  });

  it('échec d\'envoi SMTP → propagé (le soumitteur le journalise en best effort)', async () => {
    sendEmail.mockRejectedValueOnce(new Error('Aucun compte email configuré'));
    await expect(sendManagerApprovalEmail({ ticket: TICKET, approval: RECORD, requesterName: '' }))
      .rejects.toThrow('Aucun compte email configuré');
  });
});

describe('decideApproval — approbation', () => {
  it('ticket APPROVED + enregistrement mis à jour + suivi public + notification demandeur', async () => {
    const record = { ...RECORD, ticket: { requester: { email: 'dem@x.ci', fullName: 'Aimee' } } };
    await decideApproval({ record, decision: 'APPROVED', comment: 'Validé', actorEmail: 'boss@x.ci' });

    expect(prisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42 },
      data: expect.objectContaining({
        approvalStatus: 'APPROVED', approvedById: null, approvalNote: 'Validé',
      }),
    }));
    expect(prisma.ticketApproval.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 },
      data: expect.objectContaining({ status: 'APPROVED', decidedBy: 'boss@x.ci', decisionComment: 'Validé' }),
    }));
    expect(prisma.followup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ticketId: 42, authorId: null,
        content: expect.stringContaining('Validation hiérarchique accordée par boss@x.ci'),
      }),
    }));
    expect(logEvent).toHaveBeenCalledWith(42, 'APPROVED', 'boss@x.ci', expect.objectContaining({ via: 'validation-hierarchique' }));
    expect(emitTicketUpdated).toHaveBeenCalled();
    // Le SLA démarre à l'approbation : les échéances sont recalculées ici
    expect(applySla).toHaveBeenCalledWith(expect.objectContaining({ id: 42, approvalStatus: 'APPROVED' }));
    // Notification : au demandeur, copie = supérieur + personnes en copie
    const mail = sendEmail.mock.calls[sendEmail.mock.calls.length - 1][0];
    expect(mail.to).toBe('dem@x.ci');
    expect(mail.cc).toEqual(['boss@x.ci', 'copie@x.ci']);
    expect(mail.subject).toContain('validée');
  });

  it('sans commentaire → approuvé quand même (commentaire facultatif à l\'approbation)', async () => {
    const record = { ...RECORD, ticket: {} };
    await decideApproval({ record, decision: 'APPROVED', comment: '  ', actorEmail: 'boss@x.ci' });
    expect(prisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ approvalStatus: 'APPROVED', approvalNote: null }),
    }));
    expect(prisma.ticketApproval.update).toHaveBeenCalled();
  });
});

describe('decideApproval — refus', () => {
  it('ticket REJECTED + clôture + suivi avec motif', async () => {
    const record = { ...RECORD, ticket: { requester: { email: 'dem@x.ci', fullName: 'Aimee' } } };
    await decideApproval({ record, decision: 'REJECTED', comment: 'Hors périmètre', actorEmail: 'boss@x.ci' });

    expect(prisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        approvalStatus: 'REJECTED', status: 'CLOSED', approvalNote: 'Hors périmètre',
      }),
    }));
    expect(prisma.followup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: expect.stringContaining('refusée par boss@x.ci : Hors périmètre'),
      }),
    }));
    expect(logEvent).toHaveBeenCalledWith(42, 'REJECTED', 'boss@x.ci', expect.anything());
    const mail = sendEmail.mock.calls[sendEmail.mock.calls.length - 1][0];
    expect(mail.subject).toContain('refusée');
  });

  it('refus sans motif → 400 (règle du Centre de Validation)', async () => {
    const record = { ...RECORD, ticket: {} };
    await expect(decideApproval({ record, decision: 'REJECTED', comment: '', actorEmail: 'boss@x.ci' }))
      .rejects.toMatchObject({ status: 400 });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('clés de réponses', () => {
  it('les clés injectées côté front sont stables', () => {
    expect(MANAGER_KEY).toBe('VALIDATION - E-MAIL DU SUPERIEUR HIERARCHIQUE');
    expect(CC_KEY).toBe('VALIDATION - COPIE (CC)');
  });
});
