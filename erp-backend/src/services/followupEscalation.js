// Garde-fou anti-boucle infinie : au-delà de ce nombre de tours de conversation IA sur le même
// fil sans résolution, on escalade systématiquement vers un humain, quelle que soit la confiance.
const MAX_AI_EXCHANGES_PER_TICKET = 3;

// Seuil dédié à la génération de réponse de suivi, distinct de CONFIDENCE_THRESHOLD_FOR_CLOSE/_REOPEN
// (intentAnalyzer.js) qui gouvernent les transitions de statut, pas la rédaction d'une réponse.
const CONFIDENCE_THRESHOLD_FOR_FOLLOWUP_REPLY = 0.5;

const INTENTS_HANDLED_ELSEWHERE = ['RESOLVED', 'REOPEN', 'NEW_ISSUE_IN_THREAD'];
const INTENTS_NEEDING_REPLY = ['QUESTION', 'STILL_PRESENT', 'NEW_INFO'];

// Fenêtre au-delà de laquelle une réponse du support est considérée comme « déjà partie depuis
// longtemps » : en dessous, on ne régénère pas de brouillon sur un mail d'information pure.
const RECENT_REPLY_WINDOW_MINUTES = 30;

// Décide de l'action à prendre sur un email de suivi déjà traité par analyzeIntent/applyIntentActions.
// Le seuil de tours (aiExchangeCount) prime toujours sur la confiance : c'est le garde-fou anti-boucle,
// non négociable même si l'IA reste confiante à chaque tour.
// `minutesSinceLastOutbound` (null = aucune réponse sortante) sert à éviter de se répéter :
// si le support vient de répondre et que le client envoie une simple information (pas de question),
// il n'y a rien à renvoyer.
function decideFollowupAction({ intent, confidence, aiExchangeCount, minutesSinceLastOutbound }) {
  if (INTENTS_HANDLED_ELSEWHERE.includes(intent)) {
    return { action: 'NONE' };
  }

  if (
    intent === 'NEW_INFO' &&
    minutesSinceLastOutbound != null &&
    minutesSinceLastOutbound <= RECENT_REPLY_WINDOW_MINUTES
  ) {
    return { action: 'NONE', reason: 'ALREADY_ANSWERED' };
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

module.exports = {
  decideFollowupAction,
  MAX_AI_EXCHANGES_PER_TICKET,
  CONFIDENCE_THRESHOLD_FOR_FOLLOWUP_REPLY,
  RECENT_REPLY_WINDOW_MINUTES,
};
