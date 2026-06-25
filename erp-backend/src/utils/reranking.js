const prisma = require('../prismaClient');

const DEFAULT_RERANK_MODEL = {
  nvidia: 'nvidia/llama-nemotron-rerank-1b-v2',
  cohere: 'rerank-multilingual-v3.0',
};

// Lists all active providers with active keys and a configured RERANK model (or fallback default).
async function listRerankCandidates() {
  const providers = await prisma.aiProvider.findMany({
    where: { isActive: true },
    include: {
      keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
      models: { where: { isActive: true, type: 'RERANK' }, orderBy: { isDefault: 'desc' } },
    },
    orderBy: { label: 'asc' },
  });

  const candidates = [];
  for (const provider of providers) {
    if (provider.keys.length === 0) continue;

    const key = provider.keys[0];
    const models = provider.models.length > 0
      ? provider.models.map((m) => m.name)
      : (DEFAULT_RERANK_MODEL[provider.name] ? [DEFAULT_RERANK_MODEL[provider.name]] : []);

    for (const model of models) {
      candidates.push({
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: key.apiKey,
        model,
      });
    }
  }
  return candidates;
}

// Executes rerank step on search passages if a reranker is active.
async function rerank(query, passages) {
  if (!passages || passages.length === 0) return [];

  const candidates = await listRerankCandidates();
  if (candidates.length === 0) {
    console.log('[Reranking] Aucun reranker actif configuré. Ignoré.');
    return passages;
  }

  const config = candidates[0];
  console.log(`[Reranking] Re-ranking de ${passages.length} fragments via ${config.providerName}/${config.model}...`);

  try {
    if (config.providerName === 'nvidia') {
      const baseUrl = 'https://ai.api.nvidia.com/v1';
      // Format NVIDIA NIM Reranking
      const res = await fetch(`${baseUrl}/retrieval/${config.model}/reranking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          query: { text: query },
          passages: passages.map((p) => ({ text: p.content })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Erreur API NVIDIA (${res.status}): ${errText}`);
      }

      const data = await res.json();
      
      const scored = passages.map((p, idx) => {
        const ranking = data.rankings?.find((r) => r.index === idx);
        return {
          ...p,
          rerank_score: ranking ? ranking.logit : -999,
          // Remplacer combined_score par le score de rerank normalisé pour l'affichage UI
          combined_score: ranking ? Math.max(0, Math.min(1, (ranking.logit + 10) / 20)) : p.combined_score,
        };
      });

      return scored.sort((a, b) => b.rerank_score - a.rerank_score);
    }

    if (config.providerName === 'cohere') {
      const baseUrl = config.baseUrl || 'https://api.cohere.ai/v1';
      const res = await fetch(`${baseUrl}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          query,
          documents: passages.map((p) => p.content),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Erreur API Cohere (${res.status}): ${errText}`);
      }

      const data = await res.json();

      const scored = passages.map((p, idx) => {
        const result = data.results?.find((r) => r.index === idx);
        const score = result ? result.relevance_score : 0;
        return {
          ...p,
          rerank_score: score,
          combined_score: score,
        };
      });

      return scored.sort((a, b) => b.rerank_score - a.rerank_score);
    }

    console.log(`[Reranking] Fournisseur ${config.providerName} non géré pour le reranking. Ignoré.`);
    return passages;
  } catch (err) {
    console.error(`[Reranking] Échec rerank via ${config.providerName}/${config.model}:`, err.message);
    // Fallback sur l'ordre initial en cas de problème de réseau ou d'API
    return passages;
  }
}

module.exports = { listRerankCandidates, rerank };
