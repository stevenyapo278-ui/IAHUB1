const {
  searchTeams,
  detectIntentRegex,
  extractSearchParamsRegex,
  resolveCanonicalTeamName,
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
