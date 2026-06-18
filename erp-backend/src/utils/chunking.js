// Découpe un texte en fragments d'environ `maxChars` caractères, en essayant de
// couper aux frontières de paragraphes/phrases pour préserver le sens.
function chunkText(text, maxChars = 1200, overlap = 150) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    if (end < normalized.length) {
      const breakPoint = normalized.lastIndexOf('\n', end);
      const sentenceBreak = normalized.lastIndexOf('. ', end);
      const candidate = Math.max(breakPoint, sentenceBreak);
      if (candidate > start + maxChars / 2) end = candidate + 1;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    start = end - overlap;
    if (start <= 0 || end >= normalized.length) start = end;
  }

  return chunks;
}

module.exports = { chunkText };
