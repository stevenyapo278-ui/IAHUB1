// Service de génération du rapport hebdomadaire d'apprentissage IA :
// dédoublonnage de fenêtre, seuils configurables, matchValue exploitable,
// protection des domaines internes et génération automatique planifiée.
jest.mock('../prismaClient', () => {
  const prisma = {
    aiWeeklyPatternReport: { findFirst: jest.fn(), create: jest.fn() },
    ticketFieldCorrection: { findMany: jest.fn() },
    ticket: { findMany: jest.fn() },
    emailAccount: { findMany: jest.fn() },
  };
  return prisma;
});
jest.mock('./systemSettings', () => ({ getSystemSettings: jest.fn() }));

const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');
const { generateWeeklyReport, maybeGenerateWeeklyReport } = require('./aiWeeklyReportScheduler');

function makeCorrection(overrides = {}) {
  return {
    fieldName: 'category',
    oldValue: 'Autre',
    newValue: 'VPN',
    ticket: { title: 'Impossible de se connecter au VPN depuis le bureau', content: '', category: 'Autre', priority: 'low' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getSystemSettings.mockResolvedValue({});
  prisma.aiWeeklyPatternReport.findFirst.mockResolvedValue(null);
  prisma.ticketFieldCorrection.findMany.mockResolvedValue([]);
  prisma.ticket.findMany.mockResolvedValue([]);
  prisma.emailAccount.findMany.mockResolvedValue([]);
  prisma.aiWeeklyPatternReport.create.mockImplementation(async ({ data }) => ({ id: 42, ...data }));
});

describe('generateWeeklyReport — dédoublonnage & fenêtre', () => {
  it('n\'en crée pas si un rapport PENDING/APPROVED récent couvre la fenêtre', async () => {
    prisma.aiWeeklyPatternReport.findFirst.mockResolvedValue({ id: 7, status: 'PENDING' });

    const res = await generateWeeklyReport();

    expect(res).toEqual({ created: false, reason: 'duplicate', report: { id: 7, status: 'PENDING' } });
    expect(prisma.ticketFieldCorrection.findMany).not.toHaveBeenCalled();
    expect(prisma.aiWeeklyPatternReport.create).not.toHaveBeenCalled();
  });

  it('ne bloque pas quand le dernier rapport est REJECTED', async () => {
    prisma.aiWeeklyPatternReport.findFirst.mockResolvedValue(null); // REJECTED exclu du where
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([makeCorrection(), makeCorrection(), makeCorrection()]);

    const res = await generateWeeklyReport();

    expect(res.created).toBe(true);
    expect(prisma.aiWeeklyPatternReport.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['PENDING', 'APPROVED'] } }),
    }));
  });

  it('retourne empty quand aucune correction ni rejet sur la fenêtre', async () => {
    const res = await generateWeeklyReport();
    expect(res).toEqual({ created: false, reason: 'empty' });
    expect(prisma.aiWeeklyPatternReport.create).not.toHaveBeenCalled();
  });
});

describe('generateWeeklyReport — règles proposées', () => {
  it('applique le seuil d\'occurrences configuré (3 par défaut)', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyMinOccurrences: 3 });
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([makeCorrection(), makeCorrection()]);

    const res = await generateWeeklyReport();

    expect(res.created).toBe(true);
    expect(res.report.proposedRules).toEqual([]); // 2 < 3 → aucune règle
  });

  it('propose une règle avec confiance et échantillon quand le seuil est atteint', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyMinOccurrences: 3 });
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([makeCorrection(), makeCorrection(), makeCorrection()]);

    const res = await generateWeeklyReport();
    const [rule] = res.report.proposedRules;

    expect(rule).toMatchObject({
      fieldName: 'category',
      suggestedValue: 'VPN',
      category: 'VPN',
      occurrenceCount: 3,
      confidence: 0.9, // 0.6 + 3*0.1
      matchType: 'contains',
      matchField: 'subject_or_body',
    });
    expect(rule.matchValue).toBe('Impossible de se connecter au VPN depuis le bureau');
    expect(rule.sampleTitles).toHaveLength(3); // une entrée par correction, plafonné à 3
    expect(res.report.status).toBe('PENDING');
    expect(res.report.totalCorrections).toBe(3);
  });

  it('limite les échantillons de titres à 3 même avec plus de corrections', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyMinOccurrences: 1 });
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([
      makeCorrection({ ticket: { title: 'Titre 1' } }),
      makeCorrection({ ticket: { title: 'Titre 2' } }),
      makeCorrection({ ticket: { title: 'Titre 3' } }),
      makeCorrection({ ticket: { title: 'Titre 4' } }),
      makeCorrection({ ticket: { title: 'Titre 5' } }),
    ]);

    const res = await generateWeeklyReport();
    const rule = res.report.proposedRules[0];

    expect(rule.sampleTitles).toEqual(['Titre 1', 'Titre 2', 'Titre 3']);
    expect(rule.occurrenceCount).toBe(5); // le comptage reste complet
  });

  it('ne fabrique jamais de matchValue sans titre exploitable', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyMinOccurrences: 1 });
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([
      makeCorrection({ ticket: { title: '   ' } }),
      makeCorrection({ ticket: null }),
    ]);

    const res = await generateWeeklyReport();

    expect(res.created).toBe(true);
    expect(res.report.proposedRules).toEqual([]);
  });

  it('mappe priority → ticketPriority et limite les échantillons à 3', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyMinOccurrences: 1 });
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([
      makeCorrection({ fieldName: 'priority', oldValue: 'low', newValue: 'high' }),
      makeCorrection({ fieldName: 'priority', oldValue: 'low', newValue: 'high', ticket: { title: 'Deuxième' } }),
      makeCorrection({ fieldName: 'priority', oldValue: 'low', newValue: 'high', ticket: { title: 'Troisième' } }),
      makeCorrection({ fieldName: 'priority', oldValue: 'low', newValue: 'high', ticket: { title: 'Quatrième' } }),
    ]);

    const res = await generateWeeklyReport();
    const rule = res.report.proposedRules[0];

    expect(rule.ticketPriority).toBe('high');
    expect(rule.category).toBeNull();
    expect(rule.sampleTitles).toHaveLength(3);
  });

  it('applique le filtre de confiance configurable', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyMinOccurrences: 1, aiWeeklyConfidenceThreshold: 0.95 });
    prisma.ticketFieldCorrection.findMany.mockResolvedValue([makeCorrection()]); // confiance 0.7

    const res = await generateWeeklyReport();

    expect(res.report.proposedRules).toEqual([]); // 0.7 < 0.95
  });
});

describe('generateWeeklyReport — anti-spam par domaine', () => {
  function rejections(n, domain) {
    return Array.from({ length: n }, (_, i) => ({
      id: i,
      title: `Rejet ${i}`,
      content: '',
      approvalNote: 'Hors périmètre',
      category: null,
      priority: 'low',
      sourceEmail: `contact@${domain}`,
    }));
  }

  it('propose une règle domain equals au-dessus du seuil (domaines externes)', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyDomainThreshold: 5 });
    prisma.ticket.findMany.mockResolvedValue(rejections(5, 'spam-exemple.net'));

    const res = await generateWeeklyReport();
    const rule = res.report.proposedRules.find((r) => r.matchField === 'domain');

    expect(rule).toMatchObject({
      matchType: 'equals',
      matchValue: 'spam-exemple.net',
      isSpam: true,
      occurrenceCount: 5,
    });
    expect(rule.label).toContain('spam-exemple.net');
  });

  it('n\'ignore jamais un domaine interne (boîte de l\'organisation)', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyDomainThreshold: 5 });
    prisma.emailAccount.findMany.mockResolvedValue([{ emailAddress: 'support@prosuma.ci', username: null }]);
    prisma.ticket.findMany.mockResolvedValue(rejections(6, 'prosuma.ci'));

    const res = await generateWeeklyReport();

    expect(res.report.proposedRules.filter((r) => r.matchField === 'domain')).toEqual([]);
  });

  it('n\'applique pas la règle domaine sous le seuil configurable', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyDomainThreshold: 5 });
    prisma.ticket.findMany.mockResolvedValue(rejections(3, 'spam-exemple.net')); // 3 < 5

    const res = await generateWeeklyReport();

    expect(res.report.proposedRules.filter((r) => r.matchField === 'domain')).toEqual([]);
  });

  it('propose aussi une règle par titre de rejet (matchValue = titre tronqué)', async () => {
    prisma.ticket.findMany.mockResolvedValue([{
      id: 1,
      title: 'A'.repeat(200),
      content: '',
      approvalNote: 'Spam manifeste',
      category: null,
      priority: 'low',
      sourceEmail: 'x@y.z',
    }]);

    const res = await generateWeeklyReport();
    const spamRule = res.report.proposedRules.find((r) => r.isSpam && r.matchField === 'subject_or_body');

    expect(spamRule).toBeTruthy();
    expect(spamRule.matchValue).toHaveLength(120); // tronqué à MATCH_SAMPLE_LEN
    expect(spamRule.reason).toBe('Spam manifeste');
  });
});

describe('maybeGenerateWeeklyReport — génération automatique', () => {
  function nowSettings(overrides = {}) {
    const now = new Date();
    return {
      aiWeeklyAutoEnabled: true,
      aiWeeklyDay: now.getDay(),
      aiWeeklyHour: now.getHours(),
      ...overrides,
    };
  }

  it('ne fait rien quand la génération auto est désactivée', async () => {
    getSystemSettings.mockResolvedValue({ aiWeeklyAutoEnabled: false });

    const res = await maybeGenerateWeeklyReport();

    expect(res).toBeNull();
    expect(prisma.ticketFieldCorrection.findMany).not.toHaveBeenCalled();
  });

  it('ne fait rien si on n\'est pas au jour configuré', async () => {
    getSystemSettings.mockResolvedValue(nowSettings({ aiWeeklyDay: (new Date().getDay() + 1) % 7 }));

    const res = await maybeGenerateWeeklyReport();

    expect(res).toBeNull();
    expect(prisma.ticketFieldCorrection.findMany).not.toHaveBeenCalled();
  });

  it('ne fait rien si on n\'est pas à l\'heure configurée', async () => {
    getSystemSettings.mockResolvedValue(nowSettings({ aiWeeklyHour: (new Date().getHours() + 1) % 24 }));

    const res = await maybeGenerateWeeklyReport();

    expect(res).toBeNull();
    expect(prisma.ticketFieldCorrection.findMany).not.toHaveBeenCalled();
  });

  it('génère quand actif et jour/heure atteints (le dedup du service couvre les ticks multiples)', async () => {
    getSystemSettings.mockResolvedValue(nowSettings());

    const res = await maybeGenerateWeeklyReport();

    expect(res).toEqual({ created: false, reason: 'empty' });
    expect(prisma.ticketFieldCorrection.findMany).toHaveBeenCalled();
  });

  it('remonte le doublon quand un rapport de la fenêtre existe déjà', async () => {
    getSystemSettings.mockResolvedValue(nowSettings());
    prisma.aiWeeklyPatternReport.findFirst.mockResolvedValue({ id: 9, status: 'PENDING' });

    const res = await maybeGenerateWeeklyReport();

    expect(res.reason).toBe('duplicate');
    expect(prisma.aiWeeklyPatternReport.create).not.toHaveBeenCalled();
  });
});
