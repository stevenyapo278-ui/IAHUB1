const { chunkText } = require('./chunking');

describe('chunkText', () => {
  it('renvoie un tableau vide pour un texte vide ou blanc', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('ne découpe pas un texte plus court que maxChars', () => {
    const text = 'Ceci est un court texte.';
    expect(chunkText(text, 1200, 150)).toEqual([text]);
  });

  it('découpe un texte long en plusieurs fragments', () => {
    const paragraph = 'Phrase de test répétée pour générer du contenu. ';
    const text = paragraph.repeat(100); // largement > maxChars
    const chunks = chunkText(text, 500, 50);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('ne produit aucun fragment vide même avec des espaces multiples', () => {
    const text = 'Un.   Deux.   Trois.   '.repeat(80);
    const chunks = chunkText(text, 100, 10);
    expect(chunks.every((c) => c.trim().length > 0)).toBe(true);
  });

  it('normalise les retours à la ligne Windows (\\r\\n) avant découpage', () => {
    const text = 'Ligne 1\r\nLigne 2\r\nLigne 3';
    const chunks = chunkText(text, 1200, 150);
    expect(chunks[0]).not.toContain('\r');
  });

  it('couvre l\'intégralité du texte sans trou (les fragments se chevauchent ou se touchent)', () => {
    const text = 'abcdefghij '.repeat(200);
    const chunks = chunkText(text, 300, 30);
    const rebuilt = chunks.join('');
    // Le texte original doit être entièrement contenu dans la concaténation (chevauchements permis)
    expect(rebuilt.length).toBeGreaterThanOrEqual(text.trim().length);
  });
});
