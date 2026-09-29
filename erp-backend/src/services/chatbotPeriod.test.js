const { parsePeriodFromText, normalizePeriod, describePeriod } = require('./chatbotService');

describe('parsePeriodFromText — fenêtres en nombre de jours', () => {
  it.each([
    ['et les 10 derniers jours ?', '10d'],
    ['sur les 45 derniers jours', '45d'],
    ['bilan sur les 7 derniers jours', '7d'],
    ['combien de tickets sur 10 jours ?', '10d'],
    ['les 10 jours', '10d'],
  ])('%s → %s', (text, expected) => {
    expect(parsePeriodFromText(text)).toBe(expected);
  });

  it('garde les périodes nommées existantes', () => {
    expect(parsePeriodFromText('combien de tickets ce mois-ci ?')).toBe('this_month');
    expect(parsePeriodFromText('depuis hier')).toBe('yesterday');
    expect(parsePeriodFromText('les 7 derniers jours')).toBe('7d');
    expect(parsePeriodFromText('3 semaines')).toBe('21d');
    expect(parsePeriodFromText('aucune période citée')).toBeNull();
  });
});

describe('normalizePeriod — ce que le modèle envoie doit produire la bonne fenêtre', () => {
  it.each([
    ['10d', '10d'],
    ['10 jours', '10d'],
    ['10 DERNIERS JOURS', '10d'],
    ['45d', '45d'],
    ['this_month', 'this_month'],
    ['7d', '7d'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePeriod(input)).toBe(expected);
  });

  it('traduit les valeurs vides en null (tout l\'historique) sans basculer sur une fenêtre hasardeuse', () => {
    expect(normalizePeriod(null)).toBeNull();
    expect(normalizePeriod(undefined)).toBeNull();
    expect(normalizePeriod('')).toBeNull();
    expect(normalizePeriod('all')).toBeNull();
    expect(normalizePeriod('null')).toBeNull();
  });
});

describe('describePeriod — libellé repris tel quel par le modèle', () => {
  it('annonce la fenêtre en jours + le range exact pour une période Nd', () => {
    const label = describePeriod('10d');
    expect(label).toMatch(/^10 derniers jours \(du \d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}\)$/);
  });

  it('nomme les périodes calendaires au lieu de renvoyer la clé brute', () => {
    expect(describePeriod('this_month')).toMatch(/^ce mois-ci \(du /);
    expect(describePeriod('yesterday')).toMatch(/^hier \(du /);
    expect(describePeriod(null)).toBe("tout l'historique");
    expect(describePeriod('all')).toBe("tout l'historique");
  });

  it('la fenêtre de 10 jours démarre bien 10 jours en arrière (pas 7)', () => {
    const label = describePeriod('10d');
    const [start] = label.match(/\d{2}\/\d{2}\/\d{4}/);
    const [j, m, a] = start.split('/').map(Number);
    const startDate = new Date(a, m - 1, j);
    const days = Math.round((Date.now() - startDate.getTime()) / 86400000);
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });
});
