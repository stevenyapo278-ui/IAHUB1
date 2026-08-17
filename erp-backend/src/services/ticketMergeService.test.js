jest.mock('../prismaClient', () => ({}));

const { mergeTickets } = require('./ticketMergeService');

function makeTx() {
  const calls = { followup: [], message: [], attachment: [], events: [], deletes: [], connects: [] };
  const tx = {
    ticket: {
      findUnique: jest.fn(async ({ where }) => {
        if (where.id === 1) return { id: 1, title: 'Cible', observers: [{ id: 10 }] };
        if (where.id === 2) return { id: 2, title: 'Source A' };
        if (where.id === 3) return { id: 3, title: 'Source B', observers: [{ id: 11 }, { id: 10 }] };
        return null;
      }),
      update: jest.fn(async ({ data }) => {
        calls.connects.push(data.observers?.connect?.length || 0);
        return {};
      }),
      delete: jest.fn(async ({ where }) => { calls.deletes.push(where.id); return {}; }),
    },
    followup: { updateMany: jest.fn(async ({ where }) => { calls.followup.push(where.ticketId); return { count: 2 }; }) },
    ticketMessage: { updateMany: jest.fn(async ({ where }) => { calls.message.push(where.ticketId); return { count: 1 }; }) },
    ticketAttachment: { updateMany: jest.fn(async ({ where }) => { calls.attachment.push(where.ticketId); return { count: 3 }; }) },
    ticketEvent: { create: jest.fn(async ({ data }) => { calls.events.push(data); return {}; }) },
  };
  return { tx, calls };
}

describe('mergeTickets — fusion de tickets sources dans une cible', () => {
  it('déplace followups, messages et pièces jointes vers la cible puis supprime les sources', async () => {
    const { tx, calls } = makeTx();

    await mergeTickets(1, [2, 3], 'admin@prosuma.ci', tx);

    expect(tx.followup.updateMany.mock.calls).toContainEqual([{ where: { ticketId: 2 }, data: { ticketId: 1 } }]);
    expect(tx.followup.updateMany.mock.calls).toContainEqual([{ where: { ticketId: 3 }, data: { ticketId: 1 } }]);
    expect(calls.message).toEqual([2, 3]);
    expect(calls.attachment).toEqual([2, 3]);
    expect(calls.deletes).toEqual([2, 3]);
  });

  it('journalise MERGED_FROM sur la cible et MERGED_INTO sur chaque source', async () => {
    const { tx, calls } = makeTx();

    await mergeTickets(1, [2], 'admin@prosuma.ci', tx);

    const types = calls.events.map((e) => e.type);
    expect(types).toEqual(['MERGED_FROM', 'MERGED_INTO']);
    expect(calls.events[0].payload.sourceTicketId).toBe(2);
    expect(calls.events[0].payload.sourceTitle).toBe('Source A');
    expect(calls.events[1].payload.targetTicketId).toBe(1);
    expect(calls.events[1].actor).toBe('admin@prosuma.ci');
  });

  it('transfère les observateurs de la source sans dupliquer ceux déjà présents sur la cible', async () => {
    const { tx, calls } = makeTx();

    await mergeTickets(1, [3], 'SYSTEM', tx);

    // Source B a {11, 10} ; la cible a déjà {10} → seul 11 doit être connecté
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { observers: { connect: [{ id: 11 }] } },
    });
    expect(calls.connects).toEqual([1]);
  });

  it('retourne les compteurs agrégés (total déplacé, détails par catégorie)', async () => {
    const { tx } = makeTx();

    const result = await mergeTickets(1, [2, 3], 'SYSTEM', tx);

    expect(result).toEqual({
      merged: 2,
      movedItems: 12,
      followups: [2, 2],
      messages: [1, 1],
      attachments: [3, 3],
    });
  });

  it('ne connecte aucun observateur quand la source n\'en a pas', async () => {
    const { tx, calls } = makeTx();

    await mergeTickets(1, [2], 'SYSTEM', tx);

    expect(tx.ticket.update).not.toHaveBeenCalled();
    expect(calls.connects).toEqual([]);
  });
});