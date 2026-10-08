const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');
const { senderPromptVars } = require('./senderIdentity');
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
// Contexte optionnel : ticketTitle + identité de l'expéditeur (sender) permettent un résumé
// contextualisé (« Le technicien X signale… ») au lieu d'un résumé hors-sol.
// Ne lève jamais d'exception : dégrade vers un extrait de texte en cas d'échec.
async function generateEmailSummary({ body, direction, ticketTitle = '', sender = null }) {
  const cleanBody = extractTextExcerpt(body, 1500);
  if (!cleanBody) return null;

  try {
    const providers = await getActiveProviders();
    if (providers.length === 0) {
      return extractTextExcerpt(body, 200);
    }

    // Bloc de contexte : uniquement les lignes réellement disponibles (ticket, expéditeur
    // identifié) — un mail sortant envoyé par le support n'a pas d'expéditeur à résoudre.
    const ctx = [`- Sens : ${direction === 'OUTBOUND' ? 'réponse envoyée par le support' : 'email reçu sur la boîte de support'}`];
    if (ticketTitle) ctx.push(`- Ticket : ${ticketTitle}`);
    if (sender) {
      const vars = senderPromptVars(sender);
      ctx.push(`- Expéditeur : ${vars.senderName} (${vars.senderRole})`);
      ctx.push(`- Expéditeur = demandeur du ticket : ${vars.senderIsRequester}`);
    }

    const prompt = await getPrompt('summarizeEmail', {
      body: cleanBody,
      contextBlock: ctx.join('\n'),
    });
    const raw = await callAiWithRetry(() => callProviderWithFallback(providers, prompt, 'background'), { maxRetries: 2, baseDelay: 800 });
    const summary = raw.trim()
      .replace(/^["'`\u201c\u201d]+/, '')
      .replace(/["'`\u201c\u201d]+$/, '');
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
