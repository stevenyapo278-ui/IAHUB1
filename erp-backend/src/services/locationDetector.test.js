const {
  detectLocationFromSender,
  extractSignatureZone,
  isAppLikeLocation,
  normalizeLocationText,
} = require('./locationDetector');

const LOCATIONS = [
  { id: 1, name: 'SIÈGE', completename: 'SIÈGE > MONOP COCODY' },
  { id: 2, name: 'MARCORY', completename: 'SUPERMARCHÉ MARCORY' },
  { id: 3, name: 'YAMOUSSOUKRO', completename: 'AGENCE YAMOUSSOUKRO' },
];

describe('detectLocationFromSender — règle stricte signature/email vs base', () => {
  test('détecte le lieu via la signature de l expéditeur', () => {
    const sig = 'Kouassi Jean\nSupermarché Marcory\nAbidjan, Côte d Ivoire\nTél : +225 07 00 00 00 00';
    expect(detectLocationFromSender({ fromEmail: 'jean@exemple.ci', signatureText: sig, locations: LOCATIONS }))
      .toMatchObject({ locationId: 2, locationName: 'MARCORY' });
  });

  test('détecte le lieu via le domaine de l adresse email', () => {
    expect(detectLocationFromSender({ fromEmail: 'support@marcory.prosuma.ci', signatureText: '', locations: LOCATIONS }))
      .toMatchObject({ locationId: 2 });
  });

  test('insensible à la casse et aux accents', () => {
    expect(detectLocationFromSender({ fromEmail: 'a@b.ci', signatureText: 'agence yamoussoukro', locations: LOCATIONS }))
      .toMatchObject({ locationId: 3 });
  });

  test('aucune correspondance → null (le pipeline affichera INDÉTERMINÉ)', () => {
    expect(detectLocationFromSender({ fromEmail: 'inconnu@gmail.com', signatureText: 'Cordialement, Jean', locations: LOCATIONS })).toBeNull();
  });

  test('un nom d application n est jamais retenu comme lieu', () => {
    const locs = [{ id: 9, name: 'EXCEL', completename: 'EXCEL' }];
    expect(detectLocationFromSender({ fromEmail: 'user@ci', signatureText: 'problème Excel au bureau', locations: locs })).toBeNull();
    expect(isAppLikeLocation('Excel')).toBe(true);
    expect(isAppLikeLocation('GLPI')).toBe(true);
    expect(isAppLikeLocation('Supermarché Marcory')).toBe(false);
  });

  test('correspondance ambiguë (deux lieux distincts ex æquo) → null', () => {
    // Deux lieux de même longueur ("ZONE1"/"ZONE2", 5 caractères) présents tous deux
    // dans la signature : le détecteur refuse de deviner → INDÉTERMINÉ.
    const locs = [
      { id: 1, name: 'ZONE1', completename: 'ZONE1' },
      { id: 2, name: 'ZONE2', completename: 'ZONE2' },
    ];
    expect(detectLocationFromSender({ fromEmail: 'a@b.ci', signatureText: 'entre ZONE1 et ZONE2', locations: locs })).toBeNull();
  });

  test('sans lieux en base → null', () => {
    expect(detectLocationFromSender({ fromEmail: 'a@b.ci', signatureText: 'MARCORY', locations: [] })).toBeNull();
  });

  test('correspondance sur mots entiers uniquement', () => {
    expect(detectLocationFromSender({ fromEmail: 'marcory2@b.ci', signatureText: '', locations: LOCATIONS })).toBeNull();
  });
});

describe('extractSignatureZone', () => {
  test('retourne le texte retiré par le stripper de signature', () => {
    const full = 'Bonjour, plus de réseau depuis ce matin.\n\nCordialement,\nJean - Supermarché Marcory\n+225 07 00 00 00 00';
    const clean = 'Bonjour, plus de réseau depuis ce matin.';
    const zone = extractSignatureZone(full, clean);
    expect(zone).toContain('Supermarché Marcory');
  });

  test('fallback déterministe sur la fin du message si le stripper a échoué', () => {
    const full = 'Bonjour,\n\nCordialement,\nJean - Agence Yamoussoukro';
    const zone = extractSignatureZone(full, full); // stripper sans effet
    expect(zone).toContain('Yamoussoukro');
  });

  test('corps vide → chaîne vide', () => {
    expect(extractSignatureZone('', '')).toBe('');
  });
});

describe('normalizeLocationText', () => {
  test('minuscules, sans accents, ponctuation normalisée', () => {
    expect(normalizeLocationText('Siège > MONOP COCODY')).toBe('siege monop cocody');
    expect(normalizeLocationText('Supermarché Marcory')).toBe('supermarche marcory');
  });
});
