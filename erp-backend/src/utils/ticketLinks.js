// Types de liens supportés (tolérés en entrée, normalisés) 
const LINK_TYPES = ['RELATED', 'DUPLICATE_OF', 'BLOCKS', 'BLOCKED_BY'];

// Normalise le type de lien : inconnu → RELATED
function normalizeLinkType(type) {
  return LINK_TYPES.includes(type) ? type : 'RELATED';
}

// Établit les extrémités du lien dans un ordre canonique (idA < idB) pour que
// le lien (X → Y) et (Y → X) correspondent à la même contrainte d'unicité.
// Le sens originel est conservé pour l'affichage via normalizedType lorsque BLOCKS/BLOCKED_BY est inversé.
function normalizeLinkEndpoints(ticketId, targetTicketId) {
  const a = Number(ticketId);
  const b = Number(targetTicketId);
  const [idA, idB] = a < b ? [a, b] : [b, a];
  const reversed = a > b;
  return { idA, idB, reversed };
}

module.exports = { LINK_TYPES, normalizeLinkType, normalizeLinkEndpoints };