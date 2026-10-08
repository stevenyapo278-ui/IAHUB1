const mockUserFindUnique = jest.fn();

jest.mock('../prismaClient', () => ({
  user: { findUnique: (...args) => mockUserFindUnique(...args) },
}));

const { resolveSenderIdentity, senderPromptVars } = require('./senderIdentity');

describe('resolveSenderIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue(null);
  });

  it("retourne une identité inconnue sans expéditeur, sans lever d'exception", async () => {
    const identity = await resolveSenderIdentity({});
    expect(identity).toEqual(expect.objectContaining({ known: false, isRequester: false, role: null }));
  });

  it("détient le rôle et les équipes d'un expéditeur ayant un compte plateforme", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 7,
      fullName: 'Karim Touré',
      role: 'TECHNICIAN',
      team: { name: 'Réseau' },
      skills: [{ skill: { name: 'Switch' } }],
    });

    const identity = await resolveSenderIdentity({ fromEmail: '  Karim@Prosuma.CI ', fromName: 'K. Touré' });

    expect(mockUserFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: 'karim@prosuma.ci' },
    }));
    expect(identity).toEqual(expect.objectContaining({
      userId: 7,
      fullName: 'Karim Touré',
      role: 'TECHNICIAN',
      teams: 'Réseau',
      skills: 'Switch',
      known: true,
    }));
  });

  it("marque l'expéditeur comme demandeur quand il correspond à requesterId", async () => {
    mockUserFindUnique.mockResolvedValue({ id: 7, fullName: 'Karim', role: 'REQUESTER', team: null, skills: [] });

    const identity = await resolveSenderIdentity({
      fromEmail: 'karim@prosuma.ci',
      ticket: { requesterId: 7, requesterIds: [], sourceEmail: 'autre@client.ci' },
    });

    expect(identity.isRequester).toBe(true);
  });

  it("marque l'expéditeur comme demandeur quand il correspond à sourceEmail (ticket créé par email)", async () => {
    const identity = await resolveSenderIdentity({
      fromEmail: 'client@ci.ci',
      ticket: { requesterId: null, sourceEmail: 'CLIENT@ci.ci' },
    });

    expect(identity.isRequester).toBe(true);
    expect(identity.known).toBe(false);
  });

  it("ne marque pas comme demandeur un technicien qui répond sur le ticket d'un autre", async () => {
    mockUserFindUnique.mockResolvedValue({ id: 9, fullName: 'Tech', role: 'TECHNICIAN', team: null, skills: [] });

    const identity = await resolveSenderIdentity({
      fromEmail: 'tech@prosuma.ci',
      ticket: { requesterId: 3, requesterIds: [3], sourceEmail: 'client@ci.ci' },
    });

    expect(identity.isRequester).toBe(false);
  });

  it("dégrade en identité inconnue si la base est indisponible", async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const identity = await resolveSenderIdentity({ fromEmail: 'x@y.ci' });
    expect(identity.known).toBe(false);
  });
});

describe('senderPromptVars', () => {
  it('mappe les rôles Prisma en libellés français lisibles', () => {
    expect(senderPromptVars({ known: true, role: 'TECHNICIAN', fullName: 'Karim', teams: 'Réseau', isRequester: false }))
      .toEqual(expect.objectContaining({
        senderName: 'Karim',
        senderRole: 'technicien',
        senderIsRequester: 'non',
        senderTeams: 'Réseau',
      }));
    expect(senderPromptVars({ known: true, role: 'REQUESTER', isRequester: true }).senderRole).toBe('demandeur');
  });

  it("dégrade proprement sans expéditeur identifié", () => {
    expect(senderPromptVars(null)).toEqual({
      senderName: 'Inconnu',
      senderRole: 'inconnu (aucun compte plateforme)',
      senderIsRequester: 'non',
      senderTeams: 'aucune',
    });
  });
});
