const fs = require('fs');
const path = require('path');
const prisma = require('../prismaClient');
const { getBreaker } = require('../utils/circuitBreaker');
const { logger } = require('../utils/logger');
const { formatProviderHttpError, compactErrorMessage } = require('../utils/aiErrorFormatter');

// ═══════════════════════════════════════════════════════════════════════════
// 1. CIRCUIT BREAKERS PAR USAGE (email / chatbot / background)
// ═══════════════════════════════════════════════════════════════════════════
// Sépare les circuit breakers par provider + usage pour qu'un échec email
// ne bloque pas le chatbot, et vice-versa.
const VALID_USAGES = ['email', 'chatbot', 'background'];
function getBreakerForProvider(providerName, usage = 'email') {
  if (!VALID_USAGES.includes(usage)) usage = 'email';
  return getBreaker(`ai-${providerName}-${usage}`, { maxFailures: 5, resetTimeoutMs: 15000, halfOpenMaxRequests: 1 });
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. COOLDOWN 429 + Retry-After
// ═══════════════════════════════════════════════════════════════════════════
// Map<providerName, expireAt> — cooldown temporaire après un 429.
// Pendant le cooldown, le provider est ignoré dans le fallback.
const providerCooldowns = new Map();

function isProviderOnCooldown(providerName) {
  const expireAt = providerCooldowns.get(providerName);
  if (!expireAt) return false;
  if (Date.now() >= expireAt) {
    providerCooldowns.delete(providerName);
    return false;
  }
  return true;
}

function setProviderCooldown(providerName, retryAfterMs) {
  providerCooldowns.set(providerName, Date.now() + retryAfterMs);
  logger.warn(`[AI] Provider "${providerName}" en cooldown pendant ${Math.round(retryAfterMs / 1000)}s (429 Retry-After)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. MONITORING DES ÉCHECS IA
// ═══════════════════════════════════════════════════════════════════════════
// Compteurs en mémoire pour le dashboard / alertes.
// Réinitialisés toutes les heures.
const aiMetrics = {
  successes: {},  // { providerName: count }
  failures: {},   // { providerName: count }
  totalSuccesses: 0,
  totalFailures: 0,
  lastResetAt: Date.now(),
};

function recordAiSuccess(providerName) {
  aiMetrics.successes[providerName] = (aiMetrics.successes[providerName] || 0) + 1;
  aiMetrics.totalSuccesses++;
}

function recordAiFailure(providerName) {
  aiMetrics.failures[providerName] = (aiMetrics.failures[providerName] || 0) + 1;
  aiMetrics.totalFailures++;
}

function getAiMetrics() {
  // Auto-reset toutes les heures
  if (Date.now() - aiMetrics.lastResetAt > 3600000) {
    aiMetrics.successes = {};
    aiMetrics.failures = {};
    aiMetrics.totalSuccesses = 0;
    aiMetrics.totalFailures = 0;
    aiMetrics.lastResetAt = Date.now();
  }
  const total = aiMetrics.totalSuccesses + aiMetrics.totalFailures;
  return {
    ...aiMetrics,
    successRate: total > 0 ? Math.round((aiMetrics.totalSuccesses / total) * 100) : 100,
    total,
    cooldowns: Array.from(providerCooldowns.entries()).map(([name, exp]) => ({
      name,
      remainingSec: Math.max(0, Math.round((exp - Date.now()) / 1000)),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. PROTECTIONS 429 DANS LES APPELS HTTP
// ═══════════════════════════════════════════════════════════════════════════
function extractRetryAfter(res) {
  const header = res.headers?.get?.('retry-after') || res.headers?.['retry-after'];
  if (!header) return null;
  const seconds = parseInt(header, 10);
  return isNaN(seconds) ? null : seconds * 1000;
}

function throwHttpError(provider, status, bodyText, res) {
  const retryAfter = extractRetryAfter(res);
  const err = new Error(formatProviderHttpError({ provider, status, body: bodyText }));
  err.status = status;
  err.retryAfterMs = retryAfter;
  throw err;
}

// ═══════════════════════════════════════════════════════════════════════════
// Récupère TOUS les providers actifs avec au moins une clé active.
// ═══════════════════════════════════════════════════════════════════════════
async function getActiveProviders() {
  const providers = await prisma.aiProvider.findMany({
    where: { isActive: true, isDeleted: false },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, isDeleted: false, type: 'CHAT' }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] },
    },
    orderBy: { label: 'asc' },
  });
  return providers.filter((p) => p.keys.length > 0);
}

async function getActiveProvider() {
  const providers = await getActiveProviders();
  return providers[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// APPELS HTTP PAR PROVIDER (avec extraction Retry-After)
// ═══════════════════════════════════════════════════════════════════════════
async function callOpenAICompat(provider, apiKey, model, prompt, usage) {
  return getBreakerForProvider(provider.name, usage).call(async () => {
    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 2048 }),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      logger.debug(`[AI] Réponse d'erreur brute de ${provider.label} (${res.status}) : ${bodyText.substring(0, 2000)}`);
      throwHttpError(provider, res.status, bodyText, res);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const tokenUsage = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
    } : null;
    return { text, usage: tokenUsage };
  });
}

async function callGemini(provider, apiKey, prompt, modelName, usage) {
  return getBreakerForProvider(provider.name, usage).call(async () => {
    const base = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const model = modelName || 'gemini-1.5-flash';
    const res = await fetch(`${base}/models/${model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      logger.debug(`[AI] Réponse d'erreur brute de ${provider.label} (${res.status}) : ${bodyText.substring(0, 2000)}`);
      throwHttpError(provider, res.status, bodyText, res);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const tokenUsage = data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount || 0,
      completionTokens: data.usageMetadata.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata.totalTokenCount || 0,
    } : null;
    return { text, usage: tokenUsage };
  });
}

async function callAnthropic(provider, apiKey, prompt, modelName, usage) {
  return getBreakerForProvider(provider.name, usage).call(async () => {
    const baseUrl = provider.baseUrl || 'https://api.anthropic.com';
    const model = modelName || 'claude-3-5-haiku-20241022';
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      logger.debug(`[AI] Réponse d'erreur brute de ${provider.label} (${res.status}) : ${bodyText.substring(0, 2000)}`);
      throwHttpError(provider, res.status, bodyText, res);
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const tokenUsage = data.usage ? {
      promptTokens: data.usage.input_tokens || 0,
      completionTokens: data.usage.output_tokens || 0,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : null;
    return { text, usage: tokenUsage };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// APPEL SINGLE PROVIDER (itération clés × modèles + gestion 429)
// ═══════════════════════════════════════════════════════════════════════════
async function callProvider(provider, prompt, usage = 'email', forcedModelId = null) {
  // Ignorer le provider s'il est en cooldown 429
  if (isProviderOnCooldown(provider.name)) {
    throw new Error(`Provider "${provider.label}" en cooldown 429 — skipped`);
  }

  const keys = provider.keys;
  const models = provider.models || [];

  // Si un modèle est forcé, l'utiliser en priorité
  let modelCandidates;
  if (forcedModelId) {
    const forcedModel = models.find((m) => m.id === forcedModelId);
    modelCandidates = forcedModel ? [forcedModel.name] : (models.length > 0 ? models.map((m) => m.name) : [undefined]);
  } else {
    modelCandidates = models.length > 0 ? models.map((m) => m.name) : [undefined];
  }

  let lastError;
  for (const key of keys) {
    for (const modelCandidate of modelCandidates) {
      try {
        let result;
        switch (provider.name) {
          case 'gemini':
            result = await callGemini(provider, key.apiKey, prompt, modelCandidate, usage);
            break;
          case 'anthropic':
            result = await callAnthropic(provider, key.apiKey, prompt, modelCandidate, usage);
            break;
          default:
            result = await callOpenAICompat(provider, key.apiKey, modelCandidate || 'meta/llama-3.1-8b-instruct', prompt, usage);
        }
        recordAiSuccess(provider.name);
        // result est { text, usage } — propager les deux
        return result;
      } catch (err) {
        lastError = err.message;
        // Gérer le 429 : appliquer un cooldown au provider
        if (err.status === 429) {
          const cooldownMs = err.retryAfterMs || 30000;
          setProviderCooldown(provider.name, cooldownMs);
          throw err; // Sortir immédiatement, ne pas essayer les autres clés/modèles
        }
        logger.warn(`[AI] Échec appel ${provider.label} (modèle=${modelCandidate || 'défaut'}) : ${err.message}`);
        continue;
      }
    }
  }
  recordAiFailure(provider.name);
  throw new Error(lastError || `Toutes les clés/modèles de ${provider.label} ont échoué`);
}

// ═══════════════════════════════════════════════════════════════════════════
// DERNIÈRE USAGE IA TRACKÉE (side-effect, sans casser l'API string existante)
// ═══════════════════════════════════════════════════════════════════════════
let _lastAiUsage = null;
let _lastAiProvider = null;

function consumeLastAiUsage() {
  const result = { usage: _lastAiUsage, provider: _lastAiProvider };
  _lastAiUsage = null;
  _lastAiProvider = null;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK INTER-PROVIDERS (avec skip cooldown)
// ═══════════════════════════════════════════════════════════════════════════
async function callProviderWithFallback(providers, prompt, usage = 'email', options = {}) {
  // Vérifier le toggle global IA
  const { isAiEnabled } = require('./aiUsageTracker');
  if (!(await isAiEnabled())) {
    throw new Error('L\'intelligence artificielle est désactivée (Paramètres > Intelligence Artificielle)');
  }

  if (!providers || providers.length === 0) {
    throw new Error('Aucun provider IA configuré (Paramètres → Intelligence Artificielle)');
  }

  const { forcedModelId } = options;
  const errors = [];
  for (const provider of providers) {
    // Skip les providers en cooldown 429
    if (isProviderOnCooldown(provider.name)) {
      logger.warn(`[AI] Provider "${provider.label}" skipped (cooldown 429 actif)`);
      continue;
    }
    try {
      const result = await callProvider(provider, prompt, usage, forcedModelId);
      if (errors.length > 0) {
        logger.warn(`[AI] Fallback utilisé : "${provider.label}" a répondu après ${errors.length} échec(s)`);
      }
      // result est { text, usage } — extraire le texte pour les appelants existants
      // et stocker l'usage en side-effect pour le tracking
      const text = result.text !== undefined ? result.text : result;
      _lastAiUsage = result.usage || null;
      _lastAiProvider = provider.name;

      // Tracker les tokens de manière asynchrone (ne pas bloquer l'appelant)
      if (result.usage && result.usage.totalTokens > 0) {
        const { trackAiUsage } = require('./aiUsageTracker');
        trackAiUsage(result.usage, provider.name, usage).catch(() => {});
      }

      return text;
    } catch (err) {
      logger.warn(`[AI] Provider "${provider.label}" indisponible, tentative suivante : ${err.message}`);
      errors.push({ label: provider.label, full: compactErrorMessage(err.message, 700) });
    }
  }

  const details = errors.map((e) => `• ${e.label} : ${e.full}`).join('\n');
  const hint = 'Vérifiez les clés API et les quotas dans Paramètres → Intelligence Artificielle, puis relancez.';
  const longMessage = `Tous les providers IA ont échoué :\n${details}\n\n${hint}`;
  const shortParts = errors.map((e) => `${e.label}`).join(', ');
  const shortMessage = `Tous les providers IA ont échoué (${shortParts})`;

  const err = new Error(shortMessage);
  err.errorDetail = longMessage;
  throw err;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. RETRY INTELLIGENT RÉUTILISABLE
// ═══════════════════════════════════════════════════════════════════════════
// Backoff exponentiel + jitter. Ne retry que sur les erreurs transient
// (429, 5xx, timeout, ECONNREFUSED…).
async function callAiWithRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelay ?? 800;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err.status === 429 ||
        err.status >= 500 ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'CIRCUIT_OPEN' ||
        (err.message && (err.message.includes('timeout') || err.message.includes('ECONNREFUSED')));

      if (!isRetryable || attempt === maxRetries) throw err;

      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 300;
      logger.warn(`[AI] Retry ${attempt}/${maxRetries} dans ${Math.round(delay)}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FEW-SHOT + SKILLS + LOCATIONS + PROMPTS
// ═══════════════════════════════════════════════════════════════════════════
async function getFewShotExamples(subject, body) {
  const cleanQuery = (subject || '').replace(/[^\w\sÀ-ÿ]/gi, ' ').trim();
  if (!cleanQuery) return '';
  try {
    const similarTickets = await prisma.$queryRawUnsafe(`
      SELECT t.title, t.content, t.category, t.priority, t."locationName", tm.name as team_name
      FROM "Ticket" t LEFT JOIN "Team" tm ON tm.id = t."teamId"
      WHERE t.status IN ('SOLVED', 'CLOSED') AND t.category IS NOT NULL AND t.priority IS NOT NULL
      ORDER BY ts_rank(to_tsvector('french', COALESCE(t.title, '') || ' ' || COALESCE(t.content, '')), websearch_to_tsquery('french', $1)) DESC
      LIMIT 5
    `, cleanQuery);
    if (similarTickets.length === 0) return '';
    let examplesText = "\nVoici des exemples de tickets réels déjà résolus et validés par nos techniciens :\n";
    for (const ticket of similarTickets) {
      const cleanContent = (ticket.content || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').substring(0, 250);
      examplesText += `
---
Email reçu :\nSujet : ${ticket.title}\nCorps : ${cleanContent}\n\nClassification attendue :\n{
  "summary": "${(ticket.title || '').replace(/"/g, '\\"')}",
  "category": "${ticket.category}",
  "priority": "${ticket.priority}",
  "team": "${(ticket.team_name || '').replace(/"/g, '\\"')}",
  "suggestedTitle": "${(ticket.title || '').replace(/"/g, '\\"')}",
  "location": "${(ticket.locationName || '').replace(/"/g, '\\"')}"
}\n`;
    }
    examplesText += "---\nApplique la même logique pour classer l'email ci-dessous :\n";
    return examplesText;
  } catch (err) {
    console.error('[mailAnalyzer] Échec récupération Few-Shot:', err.message);
    return '';
  }
}

async function getAllSkills() {
  try { return await prisma.skill.findMany({ select: { name: true }, orderBy: { name: 'asc' } }); }
  catch (err) { console.error('[mailAnalyzer] Échec récupération compétences:', err.message); return []; }
}

async function getAllLocations() {
  try { return await prisma.location.findMany({ select: { completename: true }, orderBy: { completename: 'asc' } }); }
  catch (err) { console.error('[mailAnalyzer] Échec récupération lieux:', err.message); return []; }
}

async function getAllTeams() {
  try { return await prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }); }
  catch (err) { console.error('[mailAnalyzer] Échec récupération équipes:', err.message); return []; }
}

function formatSkillsForPrompt(skills) {
  return skills.length === 0 ? 'Aucune compétence configurée.' : skills.map((s) => `- ${s.name}`).join('\n');
}

function formatLocationsForPrompt(locations) {
  return locations.length === 0 ? 'Aucun lieu configuré.' : locations.map((l) => `- ${l.completename}`).join('\n');
}

const GENERIC_SKILL_STOPWORDS = new Set([
  'magasin', 'service', 'support', 'probleme', 'ticket', 'demande', 'utilisateur',
  'site', 'plus', 'pour', 'avec', 'dans', 'chez', 'tout', 'tous', 'faire', 'bien',
  'reseau', 'logiciel', 'materiel', 'erreur', 'bloque', 'panne', 'aide', 'merci'
]);

function guessSkillFromText(subject, body, skills) {
  if (!skills.length) return null;
  const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const text = normalize(`${subject || ''} ${body || ''}`);
  let best = null, bestScore = 0;
  for (const skill of skills) {
    const normSkillName = normalize(skill.name);
    if (normSkillName.length >= 4 && text.includes(normSkillName)) return skill.name;
    const words = normSkillName.split(/[\s\-_/]+/).filter((w) => w.length >= 3 && !GENERIC_SKILL_STOPWORDS.has(w));
    if (words.length === 0) continue;
    const score = words.filter((w) => text.includes(w)).length;
    if (score > bestScore && score === words.length) { bestScore = score; best = skill.name; }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSE EMAIL (point d'entrée principal pipeline)
// ═══════════════════════════════════════════════════════════════════════════
async function analyzeEmail({ subject, body, from, fromName, senderRole, senderTeams, senderSkills, signatureText }) {
  const providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun provider IA configuré (Paramètres → Intelligence Artificielle)');

  const { getSystemSettings } = require('./systemSettings');
  const settings = await getSystemSettings();
  const skills = await getAllSkills();
  const locations = await getAllLocations();
  const teams = await getAllTeams();

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('analyzeEmail', {
    fromName: fromName || '', from, subject,
    body: body?.substring(0, 8000) || '',
    senderRole: senderRole || 'inconnu',
    senderTeams: senderTeams || 'aucune',
    senderSkills: senderSkills || 'aucune',
    availableSkills: formatSkillsForPrompt(skills),
    availableLocations: formatLocationsForPrompt(locations),
    signatureText: signatureText || '(signature non détectée)',
  });

  const raw = await callProviderWithFallback(providers, prompt, 'email');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Le provider IA n'a pas retourné de JSON valide : ${raw.substring(0, 200)}`);
  const rawResult = JSON.parse(jsonMatch[0]);

  const { validateAndCleanAnalysis } = require('./emailAnalysisValidator');
  const result = await validateAndCleanAnalysis(rawResult, skills, locations, { body: body || '', enableAutoCreateSkills: !!settings?.enableAutoCreateSkills }, teams);

  if (!result.suggestedSkill) {
    const guessed = guessSkillFromText(subject, body, skills);
    if (guessed) { result.suggestedSkill = guessed; console.log(`[mailAnalyzer] suggestedSkill deviné par mot-clé : "${guessed}"`); }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSE VISION IA DES CAPTURES D'ÉCRAN ET IMAGES JOINTES
// ═══════════════════════════════════════════════════════════════════════════
async function analyzeSingleImage(provider, apiKey, modelName, imageBase64, mimeType, prompt) {
  const normMime = (mimeType || 'image/png').toLowerCase();
  const safeMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(normMime) ? normMime : 'image/png';

  switch (provider.name) {
    case 'gemini': {
      const base = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
      const model = modelName || 'gemini-1.5-flash';
      const res = await fetch(`${base}/models/${model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: safeMime, data: imageBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini vision HTTP ${res.status}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    case 'anthropic': {
      const baseUrl = provider.baseUrl || 'https://api.anthropic.com';
      const model = modelName || 'claude-3-5-sonnet-20241022';
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', source: { type: 'base64', media_type: safeMime, data: imageBase64 } }
            ]
          }]
        }),
      });
      if (!res.ok) throw new Error(`Anthropic vision HTTP ${res.status}`);
      const data = await res.json();
      return data.content?.[0]?.text || '';
    }
    default: {
      // OpenAI / OpenAI-compatible
      const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
      const model = modelName || 'gpt-4o-mini';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${safeMime};base64,${imageBase64}` } }
            ]
          }],
          temperature: 0.1,
          max_tokens: 1024,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI vision HTTP ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }
  }
}

async function analyzeImageAttachments(attachments = []) {
  if (!attachments || attachments.length === 0) return '';
  const providers = await getActiveProviders();
  if (providers.length === 0) return '';

  const results = [];
  const prompt = "Cette image est une capture d'écran ou une pièce jointe envoyée avec une demande de support informatique. Transcris et décris TOUS les éléments visibles importants : messages d'erreur, codes d'erreur, nom du logiciel/système/caisse, numéros, texte affiché. Sois très précis et concis (maximum 150 mots). Ne donne que la transcription/description.";

  for (const att of attachments) {
    if (!att.localFilepath || !fs.existsSync(att.localFilepath)) continue;
    try {
      const imageBuffer = fs.readFileSync(att.localFilepath);
      if (imageBuffer.length > 8 * 1024 * 1024) continue;
      const base64 = imageBuffer.toString('base64');
      const filename = att.filename || path.basename(att.localFilepath);

      let description = '';
      for (const provider of providers) {
        if (isProviderOnCooldown(provider.name)) continue;
        const key = provider.keys[0];
        const model = provider.models[0]?.name;
        if (!key) continue;
        try {
          description = await analyzeSingleImage(provider, key.apiKey, model, base64, att.mimeType, prompt);
          if (description && description.trim()) break;
        } catch (err) {
          logger.warn(`[AI-Vision] Échec analyse image "${filename}" par ${provider.label}: ${err.message}`);
        }
      }

      if (description && description.trim()) {
        results.push(`[Contenu extrait de la capture d'écran "${filename}"] :\n${description.trim()}`);
      }
    } catch (err) {
      logger.warn(`[AI-Vision] Erreur lecture fichier image ${att.localFilepath}: ${err.message}`);
    }
  }

  if (results.length === 0) return '';
  return `--- [ANALYSE VISION DES CAPTURES D'ÉCRAN] ---\n${results.join('\n\n')}`;
}

module.exports = {
  analyzeEmail, getActiveProvider, getActiveProviders,
  callProvider, callProviderWithFallback, callAiWithRetry,
  getAiMetrics, isProviderOnCooldown, analyzeImageAttachments,
  consumeLastAiUsage,
};
