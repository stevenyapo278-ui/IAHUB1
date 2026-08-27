const { calculatePriority } = require('./emailPriorityMatrix');

const TICKET_DECISIONS = ['CREATE', 'DO_NOT_CREATE', 'NEEDS_REVIEW'];
const DECISION_REASONS = ['INCIDENT', 'SERVICE_REQUEST', 'INFORMATION', 'SPAM', 'AUTOMATED', 'DUPLICATE', 'AMBIGUOUS'];
const EMAIL_TYPES = ['HUMAN_REQUEST', 'AUTOMATED_REPLY', 'OUT_OF_OFFICE', 'BOUNCE', 'NEWSLETTER', 'SYSTEM_NOTIFICATION', 'INFORMATION', 'SPAM'];
const REQUEST_TYPES = ['INCIDENT', 'SERVICE_REQUEST', 'INFORMATION', 'ACCESS_REQUEST'];
const IMPACT_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const URGENCY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const CONFIDENCE_THRESHOLD_CREATE = 0.70;

/**
 * Valide et normalise le résultat de l'analyse IA de l'email.
 * Applique les règles de sécurité, le calcul déterministe de la priorité et la vérification des entités BDD.
 *
 * @param {Object} rawAnalysis - Objet JSON retourné par le LLM
 * @param {Array<Object>} [availableSkills] - Liste des compétences BDD [{ name: string }]
 * @param {Array<Object>} [availableLocations] - Liste des lieux BDD [{ completename: string }]
 * @param {Object} [options] - Options supplémentaires (ex: { body: string })
 * @returns {Object} Analyse nettoyée, validée et sécurisée
 */
function validateAndCleanAnalysis(rawAnalysis = {}, availableSkills = [], availableLocations = [], options = {}) {
  const analysis = { ...rawAnalysis };
  const rawBody = options.body || '';

  // 1. Normalisation de la confiance avec pénalités déterministes
  let confidence = parseFloat(analysis.confidence);
  if (isNaN(confidence) || confidence < 0) confidence = 0.5;
  if (confidence > 1.0) confidence = 1.0;

  // Verification de la preuve (evidence) : si le LLM n'a fourni aucune preuve ou si la preuve est absente du texte
  if (!Array.isArray(analysis.evidence)) {
    analysis.evidence = typeof analysis.evidence === 'string' ? [analysis.evidence] : [];
  }

  if (rawBody && analysis.evidence.length > 0) {
    const normBody = rawBody.toLowerCase().replace(/\s+/g, ' ');
    const validEvidenceCount = analysis.evidence.filter((quote) => {
      const normQuote = (quote || '').toLowerCase().trim();
      return normQuote.length >= 5 && normBody.includes(normQuote);
    }).length;

    if (validEvidenceCount === 0 && analysis.evidence.length > 0) {
      // Pénalité pour citation hallucinée non présente dans l'e-mail
      confidence = Math.max(0.3, confidence - 0.25);
      console.log(`[emailAnalysisValidator] Pénalité de confiance appliquée (citation non retrouvée dans le corps): nouvelle confiance = ${confidence}`);
    }
  }

  analysis.confidence = confidence;

  // 2. Normalisation du type d'email et du type de demande
  let emailType = (analysis.emailType || '').toUpperCase().trim();
  if (!EMAIL_TYPES.includes(emailType)) {
    emailType = analysis.isSpam ? 'SPAM' : (analysis.isInformational ? 'INFORMATION' : 'HUMAN_REQUEST');
  }
  analysis.emailType = emailType;

  let requestType = (analysis.requestType || '').toUpperCase().trim();
  if (!REQUEST_TYPES.includes(requestType)) {
    requestType = emailType === 'INFORMATION' ? 'INFORMATION' : 'INCIDENT';
  }
  analysis.requestType = requestType;

  // 3. Normalisation de ticketDecision et decisionReason
  let ticketDecision = (analysis.ticketDecision || '').toUpperCase().trim();
  if (!TICKET_DECISIONS.includes(ticketDecision)) {
    if (analysis.isSpam || analysis.isInformational === true || analysis.requiresAction === false || emailType !== 'HUMAN_REQUEST') {
      ticketDecision = 'DO_NOT_CREATE';
    } else if (confidence < CONFIDENCE_THRESHOLD_CREATE) {
      ticketDecision = 'NEEDS_REVIEW';
    } else {
      ticketDecision = 'CREATE';
    }
  }

  let decisionReason = (analysis.decisionReason || '').toUpperCase().trim();
  if (!DECISION_REASONS.includes(decisionReason)) {
    if (ticketDecision === 'DO_NOT_CREATE') {
      decisionReason = analysis.isSpam ? 'SPAM' : 'INFORMATION';
    } else if (ticketDecision === 'NEEDS_REVIEW') {
      decisionReason = 'AMBIGUOUS';
    } else {
      decisionReason = requestType === 'SERVICE_REQUEST' ? 'SERVICE_REQUEST' : 'INCIDENT';
    }
  }

  // Si l'e-mail est un spam, un message automatique ou informatif, forcer ticketDecision = DO_NOT_CREATE
  if (
    analysis.isSpam ||
    analysis.isInformational === true ||
    analysis.requiresAction === false ||
    ['AUTOMATED_REPLY', 'OUT_OF_OFFICE', 'BOUNCE', 'NEWSLETTER', 'SYSTEM_NOTIFICATION', 'INFORMATION', 'SPAM'].includes(emailType)
  ) {
    ticketDecision = 'DO_NOT_CREATE';
    if (!['SPAM', 'INFORMATION', 'AUTOMATED'].includes(decisionReason)) {
      decisionReason = analysis.isSpam ? 'SPAM' : 'INFORMATION';
    }
  }

  // Garde-fou de confiance : Si l'IA veut créer un ticket mais que la confiance est < 0.70, basculer en NEEDS_REVIEW
  if (ticketDecision === 'CREATE' && confidence < CONFIDENCE_THRESHOLD_CREATE) {
    ticketDecision = 'NEEDS_REVIEW';
    decisionReason = 'AMBIGUOUS';
  }

  analysis.ticketDecision = ticketDecision;
  analysis.decisionReason = decisionReason;

  // 4. Calcul déterministe de la priorité via la matrice Impact x Urgence
  let impact = (analysis.impact || 'MEDIUM').toUpperCase().trim();
  if (!IMPACT_LEVELS.includes(impact)) impact = 'MEDIUM';
  analysis.impact = impact;

  let urgency = (analysis.urgency || 'MEDIUM').toUpperCase().trim();
  if (!URGENCY_LEVELS.includes(urgency)) urgency = 'MEDIUM';
  analysis.urgency = urgency;

  // Priorité calculée par le code (et non laissée au libre arbitre du LLM)
  analysis.priority = calculatePriority(impact, urgency, requestType);

  // 5. Validation des entités suggérées avec la base de données
  if (analysis.suggestedSkill && availableSkills.length > 0) {
    const normSkill = String(analysis.suggestedSkill).trim().toLowerCase();
    const matchSkill = availableSkills.find((s) => s.name?.toLowerCase().trim() === normSkill);
    analysis.suggestedSkill = matchSkill ? matchSkill.name : null;
  } else if (!analysis.suggestedSkill) {
    analysis.suggestedSkill = null;
  }

  if (analysis.location && availableLocations.length > 0) {
    const normLoc = String(analysis.location).trim().toLowerCase();
    const matchLoc = availableLocations.find((l) => (l.completename || l.name || '').toLowerCase().trim() === normLoc);
    if (matchLoc) {
      analysis.location = matchLoc.completename || matchLoc.name;
    } else {
      // Lieu inventé par l'IA inexistant dans la base → marquer NON DÉTERMINÉ
      analysis.location = null;
      if (analysis.suggestedTitle && analysis.suggestedTitle.includes(' : ')) {
        const action = analysis.suggestedTitle.substring(analysis.suggestedTitle.indexOf(' : ') + 3).trim();
        analysis.suggestedTitle = `NON DÉTERMINÉ : ${action}`.substring(0, 80);
      }
    }
  } else if (!analysis.location) {
    analysis.location = null;
  }

  analysis.suggestedTitle = (analysis.suggestedTitle || '').substring(0, 80);

  return analysis;
}

/**
 * Valide et sécurise l'analyse de l'intention sur une réponse d'e-mail (fil de ticket).
 * Empêche les faux-positifs de clôture dus aux répondeurs automatiques ou disclaimers.
 *
 * @param {Object} rawIntent - Résultat JSON du LLM (analyzeIntent)
 * @param {Object} [headers={}] - En-têtes MIME de l'e-mail
 * @param {string} [bodyText=''] - Corps brut du message de réponse
 * @returns {Object} Intention sécurisée
 */
function validateAndCleanIntent(rawIntent = {}, headers = {}, bodyText = '') {
  const result = { ...rawIntent };

  // Detection déterministe des répondeurs automatiques via en-têtes MIME
  const isMimeAuto =
    (headers['auto-submitted'] && headers['auto-submitted'] !== 'no') ||
    (headers['precedence'] && ['bulk', 'junk', 'list', 'auto_reply'].includes(headers['precedence'].toLowerCase())) ||
    !!headers['x-autoreply'] ||
    !!headers['x-autorespond'];

  if (isMimeAuto) {
    result.isAutoReply = true;
    result.intent = 'UNKNOWN';
    result.confidence = 0.9;
    result.evidence = '';
    return result;
  }

  // Normalisation du champ intent
  const ALLOWED_INTENTS = ['RESOLVED', 'STILL_PRESENT', 'NEW_INFO', 'QUESTION', 'REOPEN', 'NEW_ISSUE_IN_THREAD', 'UNKNOWN'];
  let intent = (result.intent || 'UNKNOWN').toUpperCase().trim();
  if (!ALLOWED_INTENTS.includes(intent)) intent = 'UNKNOWN';
  result.intent = intent;

  // Si l'IA conclut à RESOLVED, valider déterministement que la citation (evidence) est présente dans le corps
  if (result.intent === 'RESOLVED') {
    const quote = (result.evidence || '').trim();
    if (!quote || quote.length < 4) {
      console.log('[emailAnalysisValidator] RESOLVED invalidé : aucune citation (evidence) fournie');
      result.intent = 'UNKNOWN';
      result.confidence = 0.4;
    } else if (bodyText) {
      const normBody = bodyText.toLowerCase().replace(/\s+/g, ' ');
      const normQuote = quote.toLowerCase().replace(/\s+/g, ' ');
      if (!normBody.includes(normQuote)) {
        console.log('[emailAnalysisValidator] RESOLVED invalidé : citation introuvable dans le message');
        result.intent = 'UNKNOWN';
        result.confidence = 0.4;
      }
    }
  }

  return result;
}

module.exports = {
  validateAndCleanAnalysis,
  validateAndCleanIntent,
  CONFIDENCE_THRESHOLD_CREATE,
  TICKET_DECISIONS,
  DECISION_REASONS,
  EMAIL_TYPES,
  REQUEST_TYPES,
};
