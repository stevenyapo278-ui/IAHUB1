const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');
const { logger } = require('../utils/logger');

// Extrait un résumé par défaut (extrait de texte nettoyé) si l'IA n'est pas disponible
function extractTextExcerpt(htmlOrText, maxLen = 200) {
  if (!htmlOrText) return '';
  // Supprime les balises HTML
  const text = htmlOrText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

// Génère un résumé IA bref pour un email (1-2 phrases en français)
// Ne lève jamais d'exception : dégrade vers un extrait de texte en cas d'échec.
async function generateEmailSummary({ body, direction }) {
  const cleanBody = extractTextExcerpt(body, 1500);
  if (!cleanBody) return null;

  try {
    const providers = await getActiveProviders();
    if (providers.length === 0) {
      return extractTextExcerpt(body, 200);
    }

    const prompt = await getPrompt('summarizeEmail', { body: cleanBody });
    const raw = await callProviderWithFallback(providers, prompt);
    const summary = raw.trim().replace(/^["'"`]|["'"`)$/g, '');
    if (summary && summary.length > 5) {
      return summary.substring(0, 500);
    }
  } catch (err) {
    logger?.warn?.('[emailSummaryGenerator] Échec génération résumé IA:', err.message)
      || console.warn(`[emailSummaryGenerator] Échec génération résumé IA: ${err.message}`);
  }

  // Fallback : extrait de texte nettoyé
  return extractTextExcerpt(body, 200);
}

module.exports = { generateEmailSummary, extractTextExcerpt };
