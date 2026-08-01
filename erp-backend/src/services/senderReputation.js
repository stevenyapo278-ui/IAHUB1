const prisma = require('../prismaClient');

// Boucle de rétroaction sur la légitimité des suggestions IA de création de tickets.
// Aucune allow-list ni notion "d'expéditeur connu" préétablie : la réputation d'un
// expéditeur est apprise exclusivement des décisions humaines (approbations/rejets).
// Un expéditeur passe en LOW_TRUST dès que :
//   - il cumule au moins MIN_REJECTIONS rejets, ET
//   - son taux de rejet est >= REJECTION_RATE_THRESHOLD
// Ses tickets suivants sont alors marqués `lowTrustSender` (badge "à risque" dans l'UI)
// et le rapport hebdomadaire propose une règle anti-spam par domaine si le seuil le justifie.

const MIN_REJECTIONS = 3;
const REJECTION_RATE_THRESHOLD = 0.5;

const STATUS_NORMAL = 'NORMAL';
const STATUS_LOW_TRUST = 'LOW_TRUST';

function extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

// Fonction pure (testable sans DB) : décide du statut à partir des compteurs.
function computeReputation({ ticketsTotal, ticketsRejected }) {
  if (!ticketsTotal || ticketsTotal <= 0) return STATUS_NORMAL;
  if (ticketsRejected >= MIN_REJECTIONS && ticketsRejected / ticketsTotal >= REJECTION_RATE_THRESHOLD) {
    return STATUS_LOW_TRUST;
  }
  return STATUS_NORMAL;
}

// Enregistre une décision humaine (APPROVED | REJECTED) pour un expéditeur
// et met à jour sa réputation. Ne fait rien si l'email est absent ou invalide.
async function recordDecision({ email, decision }) {
  if (!email || !email.includes('@')) return null;

  const cleanEmail = email.toLowerCase().trim();
  const domain = extractDomain(cleanEmail);

  const previous = await prisma.senderReputation.findUnique({ where: { email: cleanEmail } });

  const isRejected = decision === 'REJECTED';
  const ticketsTotal = (previous?.ticketsTotal || 0) + 1;
  const ticketsApproved = (previous?.ticketsApproved || 0) + (isRejected ? 0 : 1);
  const ticketsRejected = (previous?.ticketsRejected || 0) + (isRejected ? 1 : 0);
  const status = computeReputation({ ticketsTotal, ticketsRejected });
  const now = new Date();

  return prisma.senderReputation.upsert({
    where: { email: cleanEmail },
    update: {
      domain,
      ticketsTotal,
      ticketsApproved,
      ticketsRejected,
      status,
      // Ne renseigne degradedAt qu'au moment de la bascule, jamais après (on garde la date du premier signalement)
      ...(status === STATUS_LOW_TRUST && previous?.status !== STATUS_LOW_TRUST ? { degradedAt: now } : {}),
      lastDecisionAt: now,
    },
    create: {
      email: cleanEmail,
      domain: domain || 'inconnu',
      ticketsTotal,
      ticketsApproved,
      ticketsRejected,
      status,
      ...(status === STATUS_LOW_TRUST ? { degradedAt: now } : {}),
      lastDecisionAt: now,
    },
  });
}

// Vérifie si un expéditeur est actuellement dégradé (statut LOW_TRUST).
async function isLowTrustSender(email) {
  if (!email || !email.includes('@')) return false;
  const rep = await prisma.senderReputation.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { status: true },
  });
  return rep?.status === STATUS_LOW_TRUST;
}

// Retourne les statistiques de réputation d'un expéditeur (pour affichage ou debug).
async function getSenderReputation(email) {
  if (!email || !email.includes('@')) return null;
  return prisma.senderReputation.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
}

module.exports = {
  MIN_REJECTIONS,
  REJECTION_RATE_THRESHOLD,
  STATUS_NORMAL,
  STATUS_LOW_TRUST,
  extractDomain,
  computeReputation,
  recordDecision,
  isLowTrustSender,
  getSenderReputation,
};
