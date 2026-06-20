const { getActiveProvider, callProvider } = require('./mailAnalyzer');

// Extrait le corps utile d'un email (message réellement rédigé par l'expéditeur) en retirant
// la signature, les coordonnées, et les disclaimers répétés à chaque message du fil — pour que
// toutes les analyses IA en aval (intention, filtrage des images, résumé) travaillent sur le
// contenu réel plutôt que sur un mélange corps+signature qui peut fausser leur jugement.
async function stripSignature(rawBody) {
  if (!rawBody || rawBody.trim().length === 0) return rawBody;

  const provider = await getActiveProvider();
  if (!provider) return rawBody; // pas d'IA disponible : on retombe sur le texte brut tel quel

  const { getPrompt } = require('./promptTemplates');
  const prompt = await getPrompt('stripSignature', { rawBody: rawBody.substring(0, 2000) });

  try {
    const raw = await callProvider(provider, prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    const cleaned = (parsed.body || '').trim();
    // Garde-fou : si l'IA renvoie un texte vide ou anormalement plus long que l'original, on ignore son résultat.
    if (!cleaned || cleaned.length > rawBody.length) return rawBody;
    return cleaned;
  } catch {
    return rawBody;
  }
}

module.exports = { stripSignature };
