const prisma = require('../prismaClient');

// Récupère le premier provider actif avec au moins une clé active
// Priorité : provider marqué isDefault, sinon le premier trouvé
async function getActiveProvider() {
  const providers = await prisma.aiProvider.findMany({
    where: { isActive: true },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, isDefault: true, type: 'CHAT' }, take: 1 },
    },
    orderBy: { label: 'asc' },
  });

  for (const p of providers) {
    if (p.keys.length > 0) return p;
  }
  return null;
}

// Appelle l'API du provider avec le format OpenAI-compatible (NVIDIA, OpenAI, Mistral)
async function callOpenAICompat(provider, apiKey, model, prompt) {
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
}

// Appelle l'API Gemini
async function callGemini(provider, apiKey, prompt) {
  const base = provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  const res = await fetch(
    `${base}/models/gemini-flash-lite-latest:generateContent`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!res.ok) throw new Error(`Erreur Gemini (${res.status}) : ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Appelle l'API Anthropic
async function callAnthropic(provider, apiKey, prompt) {
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
          raw = await callGemini(provider, key.apiKey, prompt);
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

async function getFewShotExamples(subject, body) {
  const textQuery = `${subject || ''} ${body?.substring(0, 300) || ''}`.trim();
  if (!textQuery) return '';

  try {
    const similarTickets = await prisma.$queryRawUnsafe(`
      SELECT t.title, t.content, t.category, t.priority, tm.name as team_name
      FROM "Ticket" t
      LEFT JOIN "Team" tm ON tm.id = t."teamId"
      WHERE t.status IN ('SOLVED', 'CLOSED') 
        AND t.category IS NOT NULL 
        AND t.priority IS NOT NULL
      ORDER BY ts_rank(to_tsvector('french', COALESCE(t.title, '') || ' ' || COALESCE(t.content, '')), plainto_tsquery('french', $1)) DESC
      LIMIT 3
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
  "team": "${(ticket.team_name || '').replace(/"/g, '\\"')}"
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

// Construit la chaîne de compétences pour le prompt
function formatSkillsForPrompt(skills) {
  if (skills.length === 0) return 'Aucune compétence configurée.';
  return skills.map((s) => `- ${s.name}`).join('\n');
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

// Analyse un email brut via le provider IA actif et retourne les métadonnées ITSM structurées
async function analyzeEmail({ subject, body, from, fromName }) {
  const provider = await getActiveProvider();
  if (!provider) throw new Error('Aucun provider IA configuré (Settings → Intelligence Artificielle)');

  const { getSystemSettings } = require('./systemSettings');
  const settings = await getSystemSettings();
  let fewShotExamples = '';
  if (settings?.enableFewShotTriage) {
    fewShotExamples = await getFewShotExamples(subject, body);
  }

  // Injecter la liste des compétences disponibles pour guider l'IA dans l'assignation
  const skills = await getAllSkills();
  const availableSkills = formatSkillsForPrompt(skills);

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('analyzeEmail', {
    fromName: fromName || '',
    from,
    subject,
    body: body?.substring(0, 2000) || '',
    fewShotExamples,
    availableSkills,
  });

  const raw = await callProvider(provider, prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`${provider.label} n'a pas retourné de JSON valide : ${raw.substring(0, 200)}`);

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

module.exports = { analyzeEmail, getActiveProvider, callProvider };


