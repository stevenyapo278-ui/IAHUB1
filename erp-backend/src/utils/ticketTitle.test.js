const { formatTicketTitle, toUpperFr } = require('./ticketTitle');

describe('formatTicketTitle — titres de tickets en majuscules + lieu strict', () => {
  test('passe le titre en majuscules', () => {
    expect(formatTicketTitle('panne réseau au magasin')).toBe('PANNE RÉSEAU AU MAGASIN');
  });

  test('gère les accents (majuscules francophones)', () => {
    expect(toUpperFr('déterminé')).toBe('DÉTERMINÉ');
    expect(formatTicketTitle('imprimante en panne à yamoussoukro')).toBe('IMPRIMANTE EN PANNE À YAMOUSSOUKRO');
  });

  test('le lieu résolu en base remplace toujours le site proposé (jamais un nom d application)', () => {
    expect(formatTicketTitle('Excel : plante au démarrage', 'Supermarché Marcory'))
      .toBe('SUPERMARCHÉ MARCORY : PLANTE AU DÉMARRAGE');
  });

  test('préfixe INDÉTERMINÉ quand aucun lieu ne correspond', () => {
    expect(formatTicketTitle('plus de réseau', 'INDÉTERMINÉ')).toBe('INDÉTERMINÉ : PLUS DE RÉSEAU');
  });

  test('sans lieu fourni, conserve le format SITE : ACTION en majuscules', () => {
    expect(formatTicketTitle('cocody : plus de réseau')).toBe('COCODY : PLUS DE RÉSEAU');
  });

  test('tronque à 80 caractères maximum', () => {
    const title = formatTicketTitle('A'.repeat(200));
    expect(title.length).toBeLessThanOrEqual(80);
  });

  test('retourne une chaîne vide si aucun titre', () => {
    expect(formatTicketTitle(null)).toBe('');
    expect(formatTicketTitle('   ')).toBe('');
  });
});
