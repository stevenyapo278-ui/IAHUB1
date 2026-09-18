const {
  searchTeams,
  detectIntentRegex,
  extractSearchParamsRegex,
  resolveCanonicalTeamName,
} = require('./chatbotService');

describe('Chatbot Team Fixes', () => {
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

  it('searchTeams s\'exécute et renvoie un tableau', async () => {
    const teams = await searchTeams('', 10);
    expect(Array.isArray(teams)).toBe(true);
  });
});
