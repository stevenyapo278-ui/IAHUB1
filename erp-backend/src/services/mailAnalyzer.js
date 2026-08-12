const prisma = require('../prismaClient');
const { getBreaker } = require('../utils/circuitBreaker');
const { logger } = require('../utils/logger');

// Circuit breakers créés à la demande par nom de provider (ex: 'ai-openai', 'ai-gemini').
// On ne pré-crée plus des breakers hardcodés par type : plusieurs providers peuvent
// partager le même type (ex: deux instances OpenAI-compat distinctes).
function getBreakerForProvider(providerName) {
  return getBreaker(`ai-${providerName}`, { maxFailures: 3, resetTimeoutMs: 30000, halfOpenMaxRequests: 1 });
}

// Récupère TOUS les providers actifs avec au moins une clé active.
// Ordre : alphabétique sur le label (isDefault géré côté DB via orderBy).
// Utilisé pour le fallback automatique : on essaie le premier, si ça échoue on passe au suivant.
async function getActiveProviders() {
  const providers = await prisma.aiProvider.findMany({
    where: { isActive: true },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, isDefault: true, type: 'CHAT' }, take: 1 },
    },
    orderBy: { label: 'asc' },
  });
  // On ne retient que les providers qui ont au moins une clé configurée
  return providers.filter((p) => p.keys.length > 0);
}

// Rétrocompatibilité : retourne le premier provider actif
async function getActiveProvider() {
  const providers = await getActiveProviders();
  return providers[0] || null;
}

// Appelle l'API du provider avec le format OpenAI-compatible (NVIDIA, OpenAI, Mistral)
async function callOpenAICompat(provider, apiKey, model, prompt) {
  return getBreakerForProvider(provider.name).call(async () => {
    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });
    if (!res.ok) throw new Error(`Erreur ${provider.label} (${res.status}) : ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  });
}

// Appelle l'API Gemini
async function callGemini(provider, apiKey, prompt, modelName) {
  return getBreakerForProvider(provider.name).call(async () => {
    const base = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const model = modelName || 'gemini-1.5-flash';
    const res = await fetch(
      `${base}/models/${model}:generateContent`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Erreur Gemini (${res.status}) : ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  });
}

// Appelle l'API Anthropic
async function callAnthropic(provider, apiKey, prompt) {
  return getBreakerForProvider(provider.name).call(async () => {
    const baseUrl = provider.baseUrl || 'https://api.anthropic.com';
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Erreur Anthropic (${res.status}) : ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
  });
}

async function callProvider(provider, prompt) {
  const keys = provider.keys;
  const defaultModel = provider.models?.[0]?.name;

  let lastError;
  for (const key of keys) {
    try {
      let raw;
      switch (provider.name) {
        case 'gemini':
          raw = await callGemini(provider, key.apiKey, prompt, defaultModel);
          break;
        case 'anthropic':
          raw = await callAnthropic(provider, key.apiKey, prompt);
          break;
        default:
          // openai, nvidia, mistral → format OpenAI-compatible
          raw = await callOpenAICompat(provider, key.apiKey, defaultModel || 'meta/llama-3.1-8b-instruct', prompt);
      }
      return raw;
    } catch (err) {
      lastError = err.message;
      continue;
    }
  }
  throw new Error(lastError || `Toutes les clés ${provider.label} ont échoué`);
}

// Tente les providers dans l'ordre (défaut en premier, puis alphabétique).
// Si un provider échoue (timeout, circuit ouvert, toutes les clés KO),
// on passe automatiquement au suivant — fallback inter-providers.
// Lève une exception récapitulative seulement si TOUS les providers ont échoué.
async function callProviderWithFallback(providers, prompt) {
  if (!providers || providers.length === 0) {
    throw new Error('Aucun provider IA configuré (Paramètres → Intelligence Artificielle)');
  }

  const errors = [];
  for (const provider of providers) {
    try {
      const result = await callProvider(provider, prompt);
      if (errors.length > 0) {
        logger.warn(`[AI] Fallback utilisé : "${provider.label}" a répondu après ${errors.length} échec(s)`);
      }
      return result;
    } catch (err) {
      logger.warn(`[AI] Provider "${provider.label}" indisponible, tentative suivante : ${err.message}`);
      errors.push(`${provider.label}: ${err.message}`);
    }
  }

  throw new Error(`Tous les providers IA ont échoué :\n${errors.join('\n')}`);
}

async function getFewShotExamples(subject, body) {
  const textQuery = `${subject || ''} ${body?.substring(0, 300) || ''}`.trim();
  if (!textQuery) return '';

  try {
    const similarTickets = await prisma.$queryRawUnsafe(`
      SELECT t.title, t.content, t.category, t.priority, t."glpiLocationName", tm.name as team_name
      FROM "Ticket" t
      LEFT JOIN "Team" tm ON tm.id = t."teamId"
      WHERE t.status IN ('SOLVED', 'CLOSED') 
        AND t.category IS NOT NULL 
        AND t.priority IS NOT NULL
      ORDER BY ts_rank(to_tsvector('french', COALESCE(t.title, '') || ' ' || COALESCE(t.content, '')), plainto_tsquery('french', $1)) DESC
      LIMIT 5
    `, textQuery);

    if (similarTickets.length === 0) return '';

    let examplesText = "\nVoici des exemples de tickets réels déjà résolus et validés par nos techniciens :\n";
    for (const ticket of similarTickets) {
      examplesText += `
---
Email reçu :
Sujet : ${ticket.title}
Corps : ${ticket.content?.substring(0, 300) || ''}

Classification attendue :
{
  "summary": "${(ticket.title || '').replace(/"/g, '\\"')}",
  "category": "${ticket.category}",
  "priority": "${ticket.priority}",
  "team": "${(ticket.team_name || '').replace(/"/g, '\\"')}",
  "suggestedTitle": "${(ticket.title || '').replace(/"/g, '\\"')}",
  "location": "${(ticket.glpiLocationName || '').replace(/"/g, '\\"')}"
}
`;
    }
    examplesText += "---\nApplique la même logique pour classer l'email ci-dessous :\n";
    return examplesText;
  } catch (err) {
    console.error('[mailAnalyzer] Échec de la récupération des exemples Few-Shot :', err.message);
    return '';
  }
}

// Récupère toutes les compétences en base (noms + id)
async function getAllSkills() {
  try {
    return await prisma.skill.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  } catch (err) {
    console.error('[mailAnalyzer] Échec récupération compétences:', err.message);
    return [];
  }
}

// Récupère tous les lieux disponibles
async function getAllLocations() {
  try {
    return await prisma.glpiLocation.findMany({ select: { completename: true }, orderBy: { completename: 'asc' } });
  } catch (err) {
    console.error('[mailAnalyzer] Échec récupération lieux:', err.message);
    return [];
  }
}

// Construit la chaîne de compétences pour le prompt
function formatSkillsForPrompt(skills) {
  if (skills.length === 0) return 'Aucune compétence configurée.';
  return skills.map((s) => `- ${s.name}`).join('\n');
}

// Construit la chaîne des lieux pour le prompt
function formatLocationsForPrompt(locations) {
  if (locations.length === 0) return 'Aucun lieu configuré.';
  return locations.map((l) => `- ${l.completename}`).join('\n');
}

// Fallback : si le LLM n'a pas retourné suggestedSkill, tente une correspondance
// par mots-clés entre le texte de l'email et les noms de compétences en base.
// Score = nombre de mots de la compétence présents dans le texte (insensible à la casse, sans accents).
function guessSkillFromText(subject, body, skills) {
  if (!skills.length) return null;
  const normalize = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const text = normalize(`${subject || ''} ${body || ''}`);

  let best = null;
  let bestScore = 0;

  for (const skill of skills) {
    const words = normalize(skill.name).split(/[\s\-_/]+/).filter((w) => w.length >= 3);
    const score = words.filter((w) => text.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = skill.name;
    }
  }

  return bestScore > 0 ? best : null;
}

// Analyse un email brut via les providers IA configurés (avec fallback automatique)
// et retourne les métadonnées ITSM structurées.
async function analyzeEmail({ subject, body, from, fromName }) {
  const providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun provider IA configuré (Paramètres → Intelligence Artificielle)');

  const { getSystemSettings } = require('./systemSettings');
  const settings = await getSystemSettings();
  let fewShotExamples = '';
  if (settings?.enableFewShotTriage) {
    fewShotExamples = await getFewShotExamples(subject, body);
  }

  const skills = await getAllSkills();
  const availableSkills = formatSkillsForPrompt(skills);

  const locations = await getAllLocations();
  const availableLocations = formatLocationsForPrompt(locations);

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('analyzeEmail', {
    fromName: fromName || '',
    from,
    subject,
    body: body?.substring(0, 2000) || '',
    fewShotExamples,
    availableSkills,
    availableLocations,
  });

  const raw = await callProviderWithFallback(providers, prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Le provider IA n'a pas retourné de JSON valide : ${raw.substring(0, 200)}`);

  const result = JSON.parse(jsonMatch[0]);

  // Fallback : si le LLM n'a pas retourné suggestedSkill (ou a retourné null),
  // on tente une correspondance par mot-clé sur le texte brut de l'email.
  if (!result.suggestedSkill) {
    const guessed = guessSkillFromText(subject, body, skills);
    if (guessed) {
      result.suggestedSkill = guessed;
      console.log(`[mailAnalyzer] suggestedSkill deviné par mot-clé : "${guessed}"`);
    }
  }

  return result;
}

module.exports = { analyzeEmail, getActiveProvider, getActiveProviders, callProvider, callProviderWithFallback };


