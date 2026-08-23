const { validateAndCleanAnalysis } = require('./emailAnalysisValidator');

describe('emailAnalysisValidator', () => {
  const availableSkills = [{ name: 'PORT USB' }, { name: 'VPN' }];
  const availableLocations = [{ completename: 'Siège > MONOP COCODY' }, { completename: 'CENTRALE D ACHATS' }];

  test('devrait calculer la priorité et valider les entités BDD pour une analyse valide', () => {
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

    const cleaned = validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.ticketDecision).toBe('CREATE');
    expect(cleaned.priority).toBe('P2'); // HIGH x HIGH -> P2
    expect(cleaned.suggestedSkill).toBe('VPN');
    expect(cleaned.location).toBe('Siège > MONOP COCODY');
  });

  test('devrait basculer ticketDecision à DO_NOT_CREATE si l\'email est de l\'information ou un spam', () => {
    const raw = {
      ticketDecision: 'CREATE',
      isInformational: true,
      emailType: 'INFORMATION',
      confidence: 0.99,
    };

    const cleaned = validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.ticketDecision).toBe('DO_NOT_CREATE');
    expect(cleaned.decisionReason).toBe('INFORMATION');
  });

  test('devrait basculer ticketDecision à NEEDS_REVIEW si la confiance est < 0.70', () => {
    const raw = {
      ticketDecision: 'CREATE',
      decisionReason: 'INCIDENT',
      emailType: 'HUMAN_REQUEST',
      confidence: 0.50, // Faible confiance
    };

    const cleaned = validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.ticketDecision).toBe('NEEDS_REVIEW');
    expect(cleaned.decisionReason).toBe('AMBIGUOUS');
  });

  test('devrait effacer la compétence ou le lieu si non présent en BDD', () => {
    const raw = {
      ticketDecision: 'CREATE',
      suggestedSkill: 'COMPETENCE_INEXISTANTE',
      location: 'LIEU_INEXISTANT',
      confidence: 0.9,
    };

    const cleaned = validateAndCleanAnalysis(raw, availableSkills, availableLocations);

    expect(cleaned.suggestedSkill).toBeNull();
    expect(cleaned.location).toBeNull();
  });
});
