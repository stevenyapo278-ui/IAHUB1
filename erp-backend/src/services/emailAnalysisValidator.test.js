const { validateAndCleanAnalysis, validateAndCleanIntent } = require('./emailAnalysisValidator');
describe('emailAnalysisValidator', () => {
  const availableSkills = [{ name: 'PORT USB' }, { name: 'VPN' }];
  const availableLocations = [{ completename: 'Siège > MONOP COCODY' }, { completename: 'CENTRALE D ACHATS' }];

  test('devrait calculer la priorité et valider les entités BDD pour une analyse valide', async () => {
    const raw = {
      ticketDecision: 'CREATE',
      decisionReason: 'INCIDENT',
      emailType: 'HUMAN_REQUEST',
      requestType: 'INCIDENT',
      summary: 'Problème VPN',
      impact: 'HIGH',
      urgency: 'HIGH',
      suggestedSkill: 'VPN',
      location: 'Siège > MONOP COCODY',
      confidence: 0.95,
    };

    const cleaned = await validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.ticketDecision).toBe('CREATE');
    expect(cleaned.priority).toBe('P2'); // HIGH x HIGH -> P2
    expect(cleaned.suggestedSkill).toBe('VPN');
    expect(cleaned.location).toBe('Siège > MONOP COCODY');
  });

  test('devrait basculer ticketDecision à DO_NOT_CREATE si l\'email est de l\'information ou un spam', async () => {
    const raw = {
      ticketDecision: 'CREATE',
      isInformational: true,
      emailType: 'INFORMATION',
      confidence: 0.99,
    };

    const cleaned = await validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.ticketDecision).toBe('DO_NOT_CREATE');
    expect(cleaned.decisionReason).toBe('INFORMATION');
  });

  test('devrait basculer ticketDecision à NEEDS_REVIEW si la confiance est < 0.70', async () => {
    const raw = {
      ticketDecision: 'CREATE',
      decisionReason: 'INCIDENT',
      emailType: 'HUMAN_REQUEST',
      confidence: 0.50, // Faible confiance
    };

    const cleaned = await validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.ticketDecision).toBe('NEEDS_REVIEW');
    expect(cleaned.decisionReason).toBe('AMBIGUOUS');
  });

  test('devrait effacer la compétence ou le lieu si non présent en BDD', async () => {
    const raw = {
      ticketDecision: 'CREATE',
      suggestedSkill: 'COMPETENCE_INEXISTANTE',
      location: 'LIEU_INEXISTANT',
      confidence: 0.9,
    };

    const cleaned = await validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.suggestedSkill).toBeNull();
    expect(cleaned.location).toBeNull();
  });
});

describe('validateAndCleanIntent — NEW_ISSUE_IN_THREAD', () => {
  test('garde l\'intention quand un résumé exploitable est fourni (et le tronque à 300)', () => {
    const cleaned = validateAndCleanIntent({
      intent: 'NEW_ISSUE_IN_THREAD',
      confidence: 0.9,
      newIssueSummary: `  ${'a'.repeat(400)}  `,
    });

    expect(cleaned.intent).toBe('NEW_ISSUE_IN_THREAD');
    expect(cleaned.newIssueSummary).toHaveLength(300);
  });

  test('rétrograde en NEW_INFO quand aucun résumé n\'est fourni (aucune suggestion posée)', () => {
    const cleaned = validateAndCleanIntent({
      intent: 'NEW_ISSUE_IN_THREAD',
      confidence: 0.9,
      newIssueSummary: '   ',
    });

    expect(cleaned.intent).toBe('NEW_INFO');
    expect(cleaned.newIssueSummary).toBeNull();
  });
});
