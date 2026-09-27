const {
  searchTeams,
  detectIntentRegex,
  extractSearchParamsRegex,
  resolveCanonicalTeamName,
  buildSearchQuery,
} = require('./chatbotService');

describe('Chatbot Team & Person Fixes', () => {
  it('détecte l\'intent search_teams sur "regarde la liste des equipe stp"', () => {
    const res = detectIntentRegex('regarde la liste des equipe stp');
    expect(res.intent).toBe('search_teams');
  });

  it('détecte l\'intent search_teams sur "quelles sont les équipes ?"', () => {
    const res = detectIntentRegex('quelles sont les équipes ?');
    expect(res.intent).toBe('search_teams');
  });

  it('extraie teamName depuis "tickets de l\'equipe securité"', () => {
    const params = extractSearchParamsRegex('tickets de l\'equipe securité');
    expect(params.teamName).toBe('securité');
  });

  it('extraie teamName depuis "tickets assignés a mon équipe"', () => {
    const params = extractSearchParamsRegex('tickets assignés a mon équipe');
    expect(params.teamName).toBe('mon équipe');
  });

  it('extraie personName et intent sur "steven yapo a t il des tickets ?"', () => {
    const intentRes = detectIntentRegex('steven yapo a t il des tickets ?');
    expect(intentRes.intent).toBe('search_tickets');
    const params = extractSearchParamsRegex('steven yapo a t il des tickets ?');
    expect(params.personName).toBe('steven yapo');
  });

  it('extraie personName sur "y a-t-il des tickets pour Steven Yapo ?"', () => {
    const params = extractSearchParamsRegex('y a-t-il des tickets pour Steven Yapo ?');
    expect(params.personName).toBe('Steven Yapo');
  });

  it('searchTeams s\'exécute et renvoie un tableau', async () => {
    const teams = await searchTeams('', 10);
    expect(Array.isArray(teams)).toBe(true);
  });
});

describe('Ouvreurs de phrase jamais pris pour une personne', () => {
  it('"parle moi des tickets du système" ne produit AUCUN personName', () => {
    const params = extractSearchParamsRegex('parle moi des tickets du système');
    expect(params?.personName).toBeUndefined();
  });

  it('"répartition des tickets ouverts par équipe" ne produit AUCUN personName', () => {
    const params = extractSearchParamsRegex('répartition des tickets ouverts par équipe');
    expect(params?.personName).toBeUndefined();
  });

  it('"liste des tickets du système" ne produit AUCUN personName', () => {
    const params = extractSearchParamsRegex('liste des tickets du système');
    expect(params?.personName).toBeUndefined();
  });

  it('"combien de tickets en cours" ne produit AUCUN personName', () => {
    const params = extractSearchParamsRegex('combien de tickets en cours');
    expect(params?.personName).toBeUndefined();
  });

  it('un vrai prénom en minuscules reste détecté ("steven yapo a t il des tickets ?")', () => {
    const params = extractSearchParamsRegex('steven yapo a t il des tickets ?');
    expect(params?.personName).toBe('steven yapo');
  });

  it('"Jean Pierre a-t-il des tickets ?" reste détecté (pas de faux négatif)', () => {
    const params = extractSearchParamsRegex('Jean Pierre a-t-il des tickets ?');
    expect(params?.personName).toBe('Jean Pierre');
  });
});

describe('Filtre équipe + mot-clé dans buildSearchQuery', () => {
  it('équipe seule → OR contient le filtre équipe', () => {
    const where = buildSearchQuery({ teamName: 'Système' }, { sub: 1, role: 'ADMIN' });
    expect(where.OR).toBeDefined();
    expect(JSON.stringify(where.OR)).toContain('Système');
    expect(where.AND).toBeUndefined();
  });

  it('équipe + mot-clé → mot-clé en OR (globale) ET équipe conservée dans AND', () => {
    const where = buildSearchQuery({ teamName: 'Système', keyword: 'sauvegarde' }, { sub: 1, role: 'ADMIN' });
    const hasKeywordInOr = where.OR.some((c) => c.title && c.title.contains === 'sauvegarde');
    expect(hasKeywordInOr).toBe(true);
    expect(where.AND).toBeDefined();
    expect(JSON.stringify(where.AND)).toContain('Système');
  });

  it('équipe + mot-clé pour un REQUESTER → équipe conservée, rôle non appliqué au mot-clé', () => {
    const where = buildSearchQuery({ teamName: 'Réseau', keyword: 'vpn' }, { sub: 999, role: 'REQUESTER' });
    expect(where.AND).toBeDefined();
    expect(JSON.stringify(where.AND)).toContain('Réseau');
    // La recherche mot-clé reste globale : pas de scope rôle dans l'OR
    const hasRoleFilter = JSON.stringify(where.OR).includes('999');
    expect(hasRoleFilter).toBe(false);
  });

  it('mot-clé seul reste globale (AND absent) — régression fix sauvegarde #73', () => {
    const where = buildSearchQuery({ keyword: 'sauvegarde' }, { sub: 999, role: 'REQUESTER' });
    expect(where.OR).toBeDefined();
    expect(where.AND).toBeUndefined();
  });
});
