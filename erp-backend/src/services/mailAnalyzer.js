const prisma = require('../prismaClient');

// Récupère le premier provider actif avec au moins une clé active
// Priorité : provider marqué isDefault, sinon le premier trouvé
async function getActiveProvider() {
  const providers = await prisma.aiProvider.findMany({
    where: { isActive: true },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, isDefault: true }, take: 1 },
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
    `${base}/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// Analyse un email brut via le provider IA actif et retourne les métadonnées ITSM structurées
async function analyzeEmail({ subject, body, from, fromName }) {
  const provider = await getActiveProvider();
  if (!provider) throw new Error('Aucun provider IA configuré (Settings → Intelligence Artificielle)');

  const prompt = `Tu es un agent ITSM expert. Analyse cet email de support informatique et retourne UNIQUEMENT un objet JSON valide (sans markdown, sans explication).

Email reçu :
De : ${fromName || ''} <${from}>
Sujet : ${subject}
Corps : ${body?.substring(0, 2000) || ''}

Retourne ce JSON :
{
  "summary": "résumé du problème en 1-2 phrases",
  "category": "Logiciel|Matériel|Réseau|Téléphonie|Système",
  "priority": "P1|P2|P3|P4",
  "team": "nom de l'équipe concernée",
  "confidence": 0.0-1.0,
  "suggestedTitle": "titre court pour le ticket (max 80 caractères)",
  "isSpam": false,
  "language": "fr|en|autre"
}

Règles de priorité :
- P1 : service totalement indisponible, impact critique sur la production
- P2 : dégradation majeure, plusieurs utilisateurs impactés
- P3 : problème limité à un utilisateur, contournement possible
- P4 : demande d'information, amélioration, question générale`;

  const raw = await callProvider(provider, prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`${provider.label} n'a pas retourné de JSON valide : ${raw.substring(0, 200)}`);

  return JSON.parse(jsonMatch[0]);
}

module.exports = { analyzeEmail };
