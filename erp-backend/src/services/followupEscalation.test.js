const { decideFollowupAction, MAX_AI_EXCHANGES_PER_TICKET, CONFIDENCE_THRESHOLD_FOR_FOLLOWUP_REPLY } = require('./followupEscalation');

describe('decideFollowupAction', () => {
  it.each(['RESOLVED', 'REOPEN', 'NEW_ISSUE_IN_THREAD'])(
    "ne fait rien pour l'intent %s, déjà traité par applyIntentActions",
    (intent) => {
      expect(decideFollowupAction({ intent, confidence: 0.9, aiExchangeCount: 0 })).toEqual({ action: 'NONE' });
    }
  );

  it('ne fait rien pour UNKNOWN (pas de réponse de suivi pour un message non interprétable)', () => {
    expect(decideFollowupAction({ intent: 'UNKNOWN', confidence: 0, aiExchangeCount: 0 })).toEqual({ action: 'NONE' });
  });

  it.each(['QUESTION', 'STILL_PRESENT', 'NEW_INFO'])(
    'génère un brouillon pour %s sous le seuil de tours, confiance haute',
    (intent) => {
      expect(decideFollowupAction({ intent, confidence: 0.9, aiExchangeCount: 0 })).toEqual({
        action: 'GENERATE_DRAFT',
        lowConfidenceIntent: false,
      });
    }
  );

  it('signale lowConfidenceIntent quand la confiance est sous le seuil dédié, sans bloquer la génération', () => {
    expect(decideFollowupAction({ intent: 'QUESTION', confidence: 0.2, aiExchangeCount: 0 })).toEqual({
      action: 'GENERATE_DRAFT',
      lowConfidenceIntent: true,
    });
  });

  it(`escalade dès que aiExchangeCount atteint ${MAX_AI_EXCHANGES_PER_TICKET}, même avec confiance haute`, () => {
    expect(decideFollowupAction({ intent: 'QUESTION', confidence: 0.95, aiExchangeCount: MAX_AI_EXCHANGES_PER_TICKET })).toEqual({
      action: 'ESCALATE',
      reason: 'MAX_EXCHANGES_REACHED',
    });
  });

  it('escalade au-delà du seuil de tours, peu importe la confiance', () => {
    expect(decideFollowupAction({ intent: 'STILL_PRESENT', confidence: 1, aiExchangeCount: MAX_AI_EXCHANGES_PER_TICKET + 5 })).toEqual({
      action: 'ESCALATE',
      reason: 'MAX_EXCHANGES_REACHED',
    });
  });

  it('le seuil de tours prime sur les intents normalement ignorés si jamais combinés (defense in depth)', () => {
    // RESOLVED/REOPEN/NEW_ISSUE_IN_THREAD sont court-circuités avant le test du seuil — vérifie l'ordre des règles.
    expect(decideFollowupAction({ intent: 'RESOLVED', confidence: 0.1, aiExchangeCount: 10 })).toEqual({ action: 'NONE' });
  });

  it('ne signale pas lowConfidenceIntent juste sous le seuil de tours avec confiance correcte', () => {
    expect(decideFollowupAction({
      intent: 'NEW_INFO',
      confidence: CONFIDENCE_THRESHOLD_FOR_FOLLOWUP_REPLY,
      aiExchangeCount: MAX_AI_EXCHANGES_PER_TICKET - 1,
    })).toEqual({ action: 'GENERATE_DRAFT', lowConfidenceIntent: false });
  });
});
