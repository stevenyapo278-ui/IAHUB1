const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  schedulerHealth: {
    findUnique: (...args) => mockFindUnique(...args),
    upsert: (...args) => mockUpsert(...args),
    update: (...args) => mockUpdate(...args),
  },
  user: { findMany: (...args) => mockFindMany(...args) },
}));
jest.mock('./emailSender', () => ({ sendEmail: jest.fn() }));

const { sendEmail } = require('./emailSender');
const { recordSchedulerResult, withHealthTracking } = require('./schedulerHealth');

describe('recordSchedulerResult — succès', () => {
  beforeEach(() => jest.clearAllMocks());

  it('réinitialise consecutiveFailures à 0 après un succès suivant des échecs', async () => {
    mockFindUnique.mockResolvedValue({ name: 'test', consecutiveFailures: 2 });
    await recordSchedulerResult('test', null);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ consecutiveFailures: 0, alertSentAt: null }),
    }));
  });

  it("crée l'entrée si elle n'existe pas encore, sans déclencher d'alerte", async () => {
    mockFindUnique.mockResolvedValue(null);
    await recordSchedulerResult('nouvelle tâche', null);
    expect(mockUpsert).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('recordSchedulerResult — échecs', () => {
  beforeEach(() => jest.clearAllMocks());

  it("n'alerte pas avant d'atteindre le seuil de 3 échecs consécutifs", async () => {
    mockFindUnique.mockResolvedValue({ name: 'test', consecutiveFailures: 1, alertSentAt: null });
    mockFindMany.mockResolvedValue([{ email: 'admin@test.com' }]);
    await recordSchedulerResult('test', new Error('Panne'));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('alerte les admins dès que le seuil de 3 échecs consécutifs est atteint', async () => {
    mockFindUnique.mockResolvedValue({ name: 'test', consecutiveFailures: 2, alertSentAt: null });
    mockFindMany.mockResolvedValue([{ email: 'admin@test.com', fullName: 'Admin' }]);
    await recordSchedulerResult('test', new Error('Panne GLPI'));
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@test.com' }));
    expect(sendEmail.mock.calls[0][0].bodyHtml).toContain('Panne GLPI');
  });

  it("ne ré-alerte pas si le cooldown de 6h n'est pas écoulé", async () => {
    const recentAlert = new Date(Date.now() - 60 * 1000); // il y a 1 minute
    mockFindUnique.mockResolvedValue({ name: 'test', consecutiveFailures: 5, alertSentAt: recentAlert });
    mockFindMany.mockResolvedValue([{ email: 'admin@test.com' }]);
    await recordSchedulerResult('test', new Error('Panne persistante'));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('ré-alerte une fois le cooldown de 6h écoulé', async () => {
    const oldAlert = new Date(Date.now() - 7 * 60 * 60 * 1000); // il y a 7h
    mockFindUnique.mockResolvedValue({ name: 'test', consecutiveFailures: 5, alertSentAt: oldAlert });
    mockFindMany.mockResolvedValue([{ email: 'admin@test.com' }]);
    await recordSchedulerResult('test', new Error('Toujours en panne'));
    expect(sendEmail).toHaveBeenCalled();
  });

  it("n'envoie aucun email si aucun admin actif n'existe", async () => {
    mockFindUnique.mockResolvedValue({ name: 'test', consecutiveFailures: 2, alertSentAt: null });
    mockFindMany.mockResolvedValue([]);
    await recordSchedulerResult('test', new Error('Panne'));
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('withHealthTracking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enregistre un succès et retourne le résultat de la fonction enveloppée', async () => {
    mockFindUnique.mockResolvedValue(null);
    const fn = jest.fn().mockResolvedValue('résultat');
    const wrapped = withHealthTracking('tâche test', fn);
    const result = await wrapped();
    expect(result).toBe('résultat');
    expect(mockUpsert).toHaveBeenCalled();
  });

  it("enregistre l'échec et relance l'erreur d'origine", async () => {
    mockFindUnique.mockResolvedValue({ name: 'tâche test', consecutiveFailures: 0, alertSentAt: null });
    mockFindMany.mockResolvedValue([]);
    const fn = jest.fn().mockRejectedValue(new Error('Échec interne'));
    const wrapped = withHealthTracking('tâche test', fn);
    await expect(wrapped()).rejects.toThrow('Échec interne');
    expect(mockUpsert).toHaveBeenCalled();
  });
});
