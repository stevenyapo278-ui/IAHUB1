// POST /tickets/:id/approve — le SLA ne démarre qu'à l'approbation :
// approveTicket doit recalculer les échéances (à partir d'approvedAt) après le passage
// en APPROVED, sinon le chrono partirait de la création du ticket.
jest.mock('../prismaClient', () => ({
  ticket: { findUnique: jest.fn(), update: jest.fn() },
  aiEmailDraft: { findMany: jest.fn(async () => []) },
  ticketMessage: { findFirst: jest.fn(async () => null) },
}));
jest.mock('./ticketEvent', () => ({ logEvent: jest.fn(async () => ({ id: 1 })) }));
jest.mock('./auditLogService', () => ({ auditLog: jest.fn(async () => {}) }));
jest.mock('../utils/socket', () => ({ emitTicketUpdated: jest.fn() }));
jest.mock('./senderReputation', () => ({ recordDecision: jest.fn(async () => {}) }));
jest.mock('./emailSender', () => ({
  sendApprovalNotificationEmail: jest.fn(async () => {}),
  sendTicketCreationNotification: jest.fn(async () => {}),
  sendAiDraftEmail: jest.fn(async () => {}),
}));
jest.mock('./slaService', () => ({ applySla: jest.fn(async (ticket) => ticket) }));

const prisma = require('../prismaClient');
const { applySla } = require('./slaService');
const { logEvent } = require('./ticketEvent');
const { approveTicket } = require('./ticketApproval');

const APPROVED_AT = new Date('2026-10-07T10:00:00Z');

beforeEach(() => jest.clearAllMocks());

describe('approveTicket — approbation et démarrage du SLA', () => {
  it('passe le ticket en APPROVED, journalise et démarre le SLA depuis approvedAt', async () => {
    const existing = { id: 1, title: 'Ticket PENDING', sourceEmail: null, status: 'NEW' };
    const updated = { ...existing, approvalStatus: 'APPROVED', approvedAt: APPROVED_AT, approvedById: 5 };
    prisma.ticket.findUnique = jest.fn(async () => existing);
    prisma.ticket.update = jest.fn(async () => updated);

    const result = await approveTicket(1, { approvedById: 5, approvedByEmail: 'admin@prosuma.ci' });

    expect(prisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ approvalStatus: 'APPROVED', approvedAt: expect.any(Date) }),
    }));
    expect(applySla).toHaveBeenCalledWith(updated);
    expect(logEvent).toHaveBeenCalledWith(1, 'APPROVED', 'admin@prosuma.ci', {});
    expect(result.approvalStatus).toBe('APPROVED');
  });

  it('ne touche pas au SLA si le ticket n’existe pas', async () => {
    prisma.ticket.findUnique = jest.fn(async () => null);

    await expect(approveTicket(404, { approvedById: 5 })).rejects.toMatchObject({ status: 404 });
    expect(applySla).not.toHaveBeenCalled();
  });
});
