const prisma = require('../prismaClient');
const { EMAIL_TEMPLATE_REGISTRY, renderTemplate } = require('./emailTemplateRegistry');

// ═══════════════════════════════════════════════════════════════════════════════
// Surcharges éditables des emails de notification (table EmailTemplate).
// Aucune ligne / aucun champ → emailSender.js utilise le gabarit codé en dur (défaut).
// Toutes les lectures sont best-effort : une erreur DB ne doit JAMAIS bloquer un envoi.
// ═══════════════════════════════════════════════════════════════════════════════

// Toutes les surcharges, indexées par clé : { key: { subject, message } }.
async function getTemplateOverrides() {
  try {
    const rows = await prisma.emailTemplate.findMany();
    const map = {};
    for (const row of rows) map[row.key] = row;
    return map;
  } catch (err) {
    console.error('[emailTemplates] Lecture des surcharges impossible:', err.message);
    return {};
  }
}

// Surcharges d'une clé précise (ou null).
async function getTemplateOverride(key) {
  try {
    return await prisma.emailTemplate.findUnique({ where: { key } });
  } catch (err) {
    console.error('[emailTemplates] Lecture de la surcharge "%s" impossible:', key, err.message);
    return null;
  }
}

// Résolution pour un envoi : renvoie subject/message SURCHARGÉS (rendus avec le ctx de
// l'envoi) ou null quand il n'y a pas de surcharge sur le champ — emailSender retombe
// alors sur son gabarit codé en dur (identique au comportement avant cette fonction).
async function resolveTemplate(key, ctx = {}) {
  const override = await getTemplateOverride(key);
  if (!override) return { subject: null, message: null };
  return {
    subject: override.subject ? renderTemplate(override.subject, ctx) : null,
    message: override.message ? renderTemplate(override.message, ctx) : null,
  };
}

module.exports = { getTemplateOverrides, getTemplateOverride, resolveTemplate };
