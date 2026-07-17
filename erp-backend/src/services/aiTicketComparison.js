const prisma = require('../prismaClient');
const { getGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');

/* ── Récupération des tickets des deux instances ──────────────────────── */

async function fetchTicketsFromInstance(instanceName, limit = 20) {
  const config = await getGlpiConfig(instanceName);
  if (!config) return { instance: instanceName, tickets: [], error: 'Non configuré' };

  const sessionToken = await glpiInitSession(config);
  try {
    // Utilise GET /Ticket (API REST standard) avec expand_dropdowns=true
    // pour obtenir les champs avec leurs vrais noms (name, status, priority, etc.)
    // et résoudre les IDs des listes déroulantes (catégorie, etc.)
    const ticketRes = await fetch(`${config.baseUrl}/Ticket?expand_dropdowns=true&range=0-${limit - 1}`, {
      headers: {
        'App-Token': config.appToken,
        'Session-Token': sessionToken,
        'Content-Type': 'application/json',
      },
    });

    if (!ticketRes.ok) throw new Error(`HTTP ${ticketRes.status}`);

    const tickets = await ticketRes.json();
    const ticketList = Array.isArray(tickets) ? tickets : [];

    // Enrichir chaque ticket avec l'assignation et le nombre de suivis
    const headers = { 'App-Token': config.appToken, 'Session-Token': sessionToken };
    const enriched = await Promise.all(ticketList.map(async (t) => {
      let assignedTo = null;
      let followupCount = 0;
      let category = null;

      // Récupérer la catégorie (expand_dropdowns la met dans un champ séparé)
      if (t.itilcategories_id && typeof t.itilcategories_id === 'object') {
        category = t.itilcategories_id.name || t.itilcategories_id.completename || String(t.itilcategories_id);
      } else if (t.itilcategories) {
        category = typeof t.itilcategories === 'string' ? t.itilcategories : t.itilcategories.name || t.itilcategories.completename;
      } else if (t.itilcategories_id) {
        category = String(t.itilcategories_id);
      }

      // Technicien assigné (type=2) via sous-requête parallélisée
      try {
        const usersRes = await fetch(`${config.baseUrl}/Ticket/${t.id}/Ticket_User`, { headers });
        if (usersRes.ok) {
          const users = await usersRes.json();
          const tech = (Array.isArray(users) ? users : []).find((u) => u.type === 2);

          if (tech) {
            if (tech.users_id && typeof tech.users_id === 'object') {
              assignedTo = tech.users_id.name || tech.users_id.realname || `User#${tech.users_id.id}`;
            } else {
              const userRes = await fetch(`${config.baseUrl}/User/${tech.users_id}`, { headers });
              if (userRes.ok) {
                const u = await userRes.json();
                assignedTo = u.realname || u.name || `User#${tech.users_id}`;
              }
            }
          }
        }
      } catch { /* best-effort */ }

      // Nombre de suivis via Content-Range
      try {
        const fuRes = await fetch(`${config.baseUrl}/Ticket/${t.id}/ITILFollowup?range=0-0`, { headers });
        if (fuRes.ok) {
          const contentRange = fuRes.headers.get('content-range');
          followupCount = contentRange ? parseInt(contentRange.split('/')[1], 10) : 0;
        }
      } catch { /* best-effort */ }

      return {
        id: t.id,
        name: t.name || '',
        status: t.status,
        priority: t.priority,
        category,
        type: t.type,
        date: t.date_creation || t.date,
        assignedTo,
        followupCount,
      };
    }));

    return { instance: instanceName, tickets: enriched, error: null };
  } catch (err) {
    return { instance: instanceName, tickets: [], error: err.message };
  } finally {
    await glpiKillSession(config, sessionToken);
  }
}

/* ── Appel IA via le provider configuré (avec fallback multi-clés) ────── */

async function callAI(prompt, maxTokens = 2048) {
  const providers = await prisma.aiProvider.findMany({
    where: { isActive: true },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, isDefault: true, type: 'CHAT' }, take: 1 },
    },
    orderBy: { label: 'asc' },
  });

  const activeProviders = providers.filter((p) => p.keys.length > 0);
  if (activeProviders.length === 0) throw new Error('Aucun provider IA actif configuré');

  let lastError = null;
  for (const provider of activeProviders) {
    const model = provider.models[0]?.name;
    const baseUrl = provider.baseUrl || (
      provider.name === 'openai' ? 'https://api.openai.com/v1' :
      provider.name === 'mistral' ? 'https://api.mistral.ai/v1' :
      provider.name === 'anthropic' ? 'https://api.anthropic.com' :
      provider.name === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' :
      provider.name === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' :
      null
    );
    if (!baseUrl) continue;

    for (const key of provider.keys) {
      try {
        return await makeAIRequest(provider.name, baseUrl, key.apiKey, model, prompt, maxTokens);
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }
  }

  throw new Error(lastError || 'Tous les providers IA ont échoué');
}

async function makeAIRequest(providerName, baseUrl, apiKey, model, prompt, maxTokens) {
  if (providerName === 'anthropic') {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  if (providerName === 'gemini') {
    // Liste de modèles de secours quand le modèle configuré n'est plus disponible
    const fallbackModels = [
      model,                                           // Modèle configuré (d'abord)
      'gemini-flash-lite-latest',                       // Fallback 1 : flash léger
      'gemini-1.5-flash',                               // Fallback 2 : 1.5 flash
      'gemini-2.0-flash',                               // Fallback 3 : 2.0 flash (nouveau)
    ].filter(Boolean);

    let lastErr = null;
    for (const m of fallbackModels) {
      try {
        const res = await fetch(`${baseUrl}/models/${m}:generateContent`, {
          method: 'POST',
          signal: AbortSignal.timeout(60000),
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
          }),
        });
        if (!res.ok) {
          lastErr = `Gemini ${res.status}: ${await res.text()}`;
          continue; // Essayer le prochain modèle de secours
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (e) {
        lastErr = e.message;
        continue;
      }
    }
    throw new Error(lastErr || 'Tous les modèles Gemini ont échoué');
  }

  // OpenAI-compatible (OpenAI, Mistral, NVIDIA, etc.)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`${providerName} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/* ── Analyse principale ────────────────────────────────────────────────── */

async function analyzeTicketDifferences({ limit = 20 } = {}) {
  // 1. Récupérer les tickets des deux instances (indépendamment)
  let prodResult = { instance: 'glpi', tickets: [], error: null };
  let devResult = { instance: 'glpi_dev', tickets: [], error: null };
  try { prodResult = await fetchTicketsFromInstance('glpi', limit); } catch (e) { prodResult.error = e.message; }
  try { devResult = await fetchTicketsFromInstance('glpi_dev', limit); } catch (e) { devResult.error = e.message; }

  // 2. Récupérer les stats ERP pour contexte
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const erpTickets = await prisma.ticket.count({
    where: {
      OR: [
        { glpiTicketId: { not: null, gt: 0 } },
        { sourceEmail: { not: null } },
      ],
    },
  });
  const erpTicketsLast30 = await prisma.ticket.count({
    where: {
      createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      OR: [
        { glpiTicketId: { not: null, gt: 0 } },
        { sourceEmail: { not: null } },
      ],
    },
  });

  // 3. Construire le prompt pour l'IA
  const prodTickets = prodResult.tickets;
  const devTickets = devResult.tickets;
  const activeInstance = settings?.activeGlpiInstance || 'glpi';

  const prodTicketsText = prodTickets.map((t) =>
    `  #${t.id} "${t.name}" | Priorité: ${t.priority} | Statut: ${t.status} | Assigné: ${t.assignedTo || 'N/A'} | Suivis: ${t.followupCount}`
  ).join('\n');

  const devTicketsText = devTickets.map((t) =>
    `  #${t.id} "${t.name}" | Priorité: ${t.priority} | Statut: ${t.status} | Assigné: ${t.assignedTo || 'N/A'} | Suivis: ${t.followupCount}`
  ).join('\n');

  const prompt = `Tu es un consultant expert en ITIL et en qualité de données ITSM. Tu analyses les tickets de deux instances GLPI d'une même entreprise pour détecter des problèmes et proposer des améliorations.

## Contexte
- Instance active actuelle : ${activeInstance === 'glpi' ? 'PRODUCTION' : 'DÉVELOPPEMENT'}
- Tickets ERP totaux : ${erpTickets} (dont ${erpTicketsLast30} dans les 30 derniers jours)
- La plateforme écoute les emails SOS et crée des tickets automatiquement via l'IA

## Tickets GLPI PRODUCTION (${prodTickets.length} tickets)
${prodTicketsText || '  (Aucun ticket ou instance non configurée)'}

## Tickets GLPI DÉVELOPPEMENT (${devTickets.length} tickets)
${devTicketsText || '  (Aucun ticket ou instance non configurée)'}

## Analyse à réaliser

Analyse les différences entre les deux instances et retourne UNIQUEMENT un objet JSON valide (sans markdown, sans texte autour) avec cette structure exacte :

\`\`\`json
{
  "qualiteNoms": {
    "note": 0-10,
    "analyse": "Analyse de la qualité des noms/titres des tickets",
    "problemes": ["Problème 1", "Problème 2"],
    "recommandations": ["Recommandation 1", "Recommandation 2"]
  },
  "assignations": {
    "note": 0-10,
    "analyse": "Analyse de la répartition des assignations",
    "problemes": ["Problème 1"],
    "recommandations": ["Recommandation 1"]
  },
  "categoriesPriorites": {
    "note": 0-10,
    "analyse": "Analyse de l'utilisation des catégories et priorités",
    "problemes": ["Problème 1"],
    "recommandations": ["Recommandation 1"]
  },
  "ecartsProdDev": {
    "note": 0-10,
    "analyse": "Analyse des écarts entre PROD et DEV (volume, contenu, maturité)",
    "problemes": ["Problème 1"],
    "recommandations": ["Recommandation 1"]
  },
  "ameliorationsCode": [
    {
      "categorie": "ex: Configuration GLPI, Règles métier, Interface utilisateur, Performance...",
      "description": "Description concise de l'amélioration",
      "impact": "HAUT/MOYEN/BAS",
      "effort": "FAIBLE/MOYEN/FORT",
      "fichiers": ["fichier1.js", "fichier2.jsx"],
      "details": "Explication technique détaillée de ce qu'il faudrait modifier dans le code"
    }
  ],
  "synthese": "Résumé global en 2-3 phrases"
}
\`\`\`

Sois très concret et précis dans tes recommandations d'amélioration du code. Propose des noms de fichiers et des modifications spécifiques quand c'est pertinent.`;

  // 4. Appel IA
  let raw;
  try {
    raw = await callAI(prompt, 4096);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      prodTickets,
      devTickets,
      erp: { total: erpTickets, last30: erpTicketsLast30 },
    };
  }

  // 5. Parser le JSON de la réponse
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      success: false,
      error: `L'IA n'a pas retourné de JSON valide. Réponse brute: ${raw.substring(0, 500)}`,
      prodTickets,
      devTickets,
      erp: { total: erpTickets, last30: erpTicketsLast30 },
    };
  }

  let analysis;
  try {
    analysis = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return {
      success: false,
      error: `Erreur de parsing JSON: ${err.message}`,
      raw: raw.substring(0, 1000),
      prodTickets,
      devTickets,
      erp: { total: erpTickets, last30: erpTicketsLast30 },
    };
  }

  return {
    success: true,
    analysis,
    prodTickets,
    devTickets,
    erp: { total: erpTickets, last30: erpTicketsLast30 },
  };
}

module.exports = { analyzeTicketDifferences };
