/**
 * Matrice déterministe ITSM (ITIL v4) pour convertir l'Impact et l'Urgence en Priorité (P1-P4).
 * Évite de laisser le modèle LLM attribuer la priorité de façon arbitraire.
 */

const VALID_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/**
 * Calcule la priorité P1-P4 en fonction de l'impact, de l'urgence et du type de demande.
 * @param {string} impact - 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
 * @param {string} urgency - 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
 * @param {string} [requestType] - 'INCIDENT' | 'SERVICE_REQUEST' | 'INFORMATION' | 'ACCESS_REQUEST'
 * @returns {string} 'P1' | 'P2' | 'P3' | 'P4'
 */
function calculatePriority(impact = 'MEDIUM', urgency = 'MEDIUM', requestType = 'INCIDENT') {
  const imp = (impact || 'MEDIUM').toUpperCase().trim();
  const urg = (urgency || 'MEDIUM').toUpperCase().trim();
  const reqType = (requestType || 'INCIDENT').toUpperCase().trim();

  // Si demande purement d'information, la priorité est P4 par défaut
  if (reqType === 'INFORMATION') {
    return 'P4';
  }

  // Matrice de décision
  if (imp === 'CRITICAL' && (urg === 'CRITICAL' || urg === 'HIGH')) {
    return 'P1';
  }

  if (
    (imp === 'CRITICAL' && urg === 'MEDIUM') ||
    (imp === 'HIGH' && (urg === 'HIGH' || urg === 'CRITICAL'))
  ) {
    return 'P2';
  }

  if (imp === 'LOW' && urg === 'LOW') {
    return 'P4';
  }

  // P3 par défaut pour les pannes individuelles et demandes standard
  return 'P3';
}

module.exports = { calculatePriority, VALID_LEVELS };
