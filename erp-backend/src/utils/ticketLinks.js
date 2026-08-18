// Types de liens supportés (tolérés en entrée, normalisés)
// PARENT / CHILD : lien hiérarchique (sous-ticket). La direction compte :
// le lien est stocké avec (idA < idB) mais le type est exprimé du point de
// vue de idA — PARENT = idA est le parent, CHILD = idA est l'enfant.
const LINK_TYPES = ['RELATED', 'DUPLICATE_OF', 'BLOCKS', 'BLOCKED_BY', 'PARENT', 'CHILD'];

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

// Pour un lien PARENT/CHILD entre le ticket courant (ticketId) et la cible (target),
// détermine le type canonique à stocker : PARENT signifie que idA est le parent,
// CHILD que idA est l'enfant. La direction demandée (qui est le parent) est préservée.
function normalizeParentChildType(ticketId, targetTicketId, requestedType) {
  const { reversed } = normalizeLinkEndpoints(ticketId, targetTicketId);
  if (!reversed) return requestedType === 'CHILD' ? 'CHILD' : 'PARENT';
  // idA = target : on inverse le type pour que la direction reste correcte
  return requestedType === 'CHILD' ? 'PARENT' : 'CHILD';
}

// Renvoie l'id du parent d'un ticket (ou null) en explorant les deux sens du lien.
async function resolveParentTicketId(prisma, ticketId) {
  const [asParentA, asParentB] = await Promise.all([
    prisma.ticketLink.findFirst({ where: { ticketAId: ticketId, type: 'CHILD' } }),
    prisma.ticketLink.findFirst({ where: { ticketBId: ticketId, type: 'PARENT' } }),
  ]);
  if (asParentA) return asParentA.ticketBId; // idA (ce ticket) est enfant → parent = idB
  if (asParentB) return asParentB.ticketAId; // idB (ce ticket) est enfant → parent = idA
  return null;
}

// Renvoie la liste des ids des enfants directs d'un ticket (ou []).
async function resolveChildrenIds(prisma, ticketId) {
  const [childrenA, childrenB] = await Promise.all([
    prisma.ticketLink.findMany({ where: { ticketAId: ticketId, type: 'PARENT' } }),
    prisma.ticketLink.findMany({ where: { ticketBId: ticketId, type: 'CHILD' } }),
  ]);
  return [
    ...childrenA.map((l) => l.ticketBId),
    ...childrenB.map((l) => l.ticketAId),
  ];
}

module.exports = { LINK_TYPES, normalizeLinkType, normalizeLinkEndpoints, normalizeParentChildType, resolveParentTicketId, resolveChildrenIds };
