// Garde-fou anti-boucle infinie : au-delà de ce nombre de tours de conversation IA sur le même
// fil sans résolution, on escalade systématiquement vers un humain, quelle que soit la confiance.
const MAX_AI_EXCHANGES_PER_TICKET = 3;

// Seuil dédié à la génération de réponse de suivi, distinct de CONFIDENCE_THRESHOLD_FOR_CLOSE/_REOPEN
// (intentAnalyzer.js) qui gouvernent les transitions de statut, pas la rédaction d'une réponse.
const CONFIDENCE_THRESHOLD_FOR_FOLLOWUP_REPLY = 0.5;

const INTENTS_HANDLED_ELSEWHERE = ['RESOLVED', 'REOPEN', 'NEW_ISSUE_IN_THREAD'];
const INTENTS_NEEDING_REPLY = ['QUESTION', 'STILL_PRESENT', 'NEW_INFO'];

// Décide de l'action à prendre sur un email de suivi déjà traité par analyzeIntent/applyIntentActions.
// Le seuil de tours (aiExchangeCount) prime toujours sur la confiance : c'est le garde-fou anti-boucle,
// non négociable même si l'IA reste confiante à chaque tour.
function decideFollowupAction({ intent, confidence, aiExchangeCount }) {
  if (INTENTS_HANDLED_ELSEWHERE.includes(intent)) {
    return { action: 'NONE' };
  }

  if (aiExchangeCount >= MAX_AI_EXCHANGES_PER_TICKET) {
    return { action: 'ESCALATE', reason: 'MAX_EXCHANGES_REACHED' };
  }

  if (INTENTS_NEEDING_REPLY.includes(intent)) {
    return {
      action: 'GENERATE_DRAFT',
      lowConfidenceIntent: confidence < CONFIDENCE_THRESHOLD_FOR_FOLLOWUP_REPLY,
    };
  }

  return { action: 'NONE' };
}

module.exports = { decideFollowupAction, MAX_AI_EXCHANGES_PER_TICKET, CONFIDENCE_THRESHOLD_FOR_FOLLOWUP_REPLY };
