jest.mock('../prismaClient', () => ({}));
jest.mock('./emailSender', () => ({ sendEmail: jest.fn() }));

const { detectDecision } = require('./draftReplyApproval');

describe('detectDecision', () => {
  it('détecte une approbation en français', () => {
    expect(detectDecision("J'approuve")).toBe('APPROVED');
    expect(detectDecision('Approuvé, merci')).toBe('APPROVED');
    expect(detectDecision('approuve\n\nLe reste du message cité...')).toBe('APPROVED');
  });

  it('détecte une approbation via le mot-clé court "ok"', () => {
    expect(detectDecision('Ok')).toBe('APPROVED');
  });

  it('détecte un rejet en français', () => {
    expect(detectDecision('Je rejette')).toBe('REJECTED');
    expect(detectDecision('Rejeté, à refaire')).toBe('REJECTED');
  });

  it('détecte un rejet via "non"', () => {
    expect(detectDecision('Non, ne pas envoyer')).toBe('REJECTED');
  });

  it('détecte les mots-clés anglais', () => {
    expect(detectDecision('approve')).toBe('APPROVED');
    expect(detectDecision('reject')).toBe('REJECTED');
  });

  it("retourne null quand aucun mot-clé n'est reconnu", () => {
    expect(detectDecision('Pouvez-vous préciser le ticket concerné ?')).toBeNull();
  });

  it('ignore les mots-clés présents seulement dans le texte cité (pas sur la première ligne)', () => {
    const body = "Bonjour,\n\nLe brouillon dit \"j'approuve\" mais je ne suis pas sûr.";
    expect(detectDecision(body)).toBeNull();
  });

  it('est insensible à la casse', () => {
    expect(detectDecision('APPROUVE')).toBe('APPROVED');
    expect(detectDecision('REJETTE')).toBe('REJECTED');
  });

  it('priorise le rejet si les deux mots-clés apparaissent sur la première ligne', () => {
    // Cas limite : un message confus contenant les deux indices — le rejet est vérifié en premier
    expect(detectDecision('non, je rejette et approuve pas')).toBe('REJECTED');
  });
});
