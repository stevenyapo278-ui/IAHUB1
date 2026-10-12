const { detectNewEntityReference, normalizeEntityRef } = require('./chatbotService');

// État laissé par une recherche sur le SITE « ENTREPOT CAVA » (cas concret du bug) :
// le message suivant matche le pronom « ce » et aurait fait ré-injecter ces tickets.
const PREVIOUS_STATE = {
  lastMessage: 'liste les tickets du site Entrepot Cava',
  lastPerson: null,
  lastLocation: 'ENTREPOT CAVA',
  lastTicketIds: [42, 57],
  lastToolData:
    '{"total":2,"tickets":[{"id":42,"title":"Panne de caisse","demandeur":"Jean Kouassi","lieu":"ENTREPOT CAVA"},{"id":57,"title":"Badge cassé","demandeur":"Marie Diabaté","lieu":"ENTREPOT CAVA"}]}',
};

describe('detectNewEntityReference — garde anti-contamination du contexte', () => {
  it('laisse passer une question sans entité nouvelle (follow-up réel)', () => {
    expect(detectNewEntityReference('et le statut de ceux-ci ?', PREVIOUS_STATE)).toBeNull();
    expect(detectNewEntityReference('et combien sont ouverts ?', PREVIOUS_STATE)).toBeNull();
    expect(detectNewEntityReference(' peux-tu détailler ?', PREVIOUS_STATE)).toBeNull();
  });

  it('détecte le cas bug : nouveau COMPTE après une recherche sur un site', () => {
    const msg = 'as-tu une demande qui concerne ce compte ? Diomande Moussa / mkdiomande';
    expect(detectNewEntityReference(msg, PREVIOUS_STATE)).toBe('Diomande Moussa');
  });

  it('détecte le login seul quand la question porte sur un compte', () => {
    const msg = 'y a-t-il une demande pour ce compte ? mkdiomande';
    expect(detectNewEntityReference(msg, PREVIOUS_STATE)).toBe('mkdiomande');
  });

  it('détecte une adresse email nouvelle', () => {
    const msg = 'as-tu une demande qui concerne mkdiomande@prosuma.ci ?';
    expect(detectNewEntityReference(msg, PREVIOUS_STATE)).toBe('mkdiomande@prosuma.ci');
  });

  it('ne signale PAS une entité déjà présente dans le contexte précédent', () => {
    // Même personne que celle des résultats injectés → follow-up légitime
    const state = {
      ...PREVIOUS_STATE,
      lastPerson: 'Jean Kouassi',
      lastToolData: '{"tickets":[{"id":42,"demandeur":"Jean Kouassi","lieu":"ENTREPOT CAVA"}]}',
    };
    expect(detectNewEntityReference('et ses tickets ouverts ?', state)).toBeNull();
    expect(
      detectNewEntityReference('qu\'en est-il de Jean Kouassi ?', state)
    ).toBeNull();
  });

  it('ignore la majuscule d\'ouverture de phrase (pas un nom propre)', () => {
    expect(detectNewEntityReference('As-tu une demande qui concerne ce compte ?', PREVIOUS_STATE)).toBeNull();
  });

  it('ne confond pas le nom tronqué par « compte ? » avec un login', () => {
    // « compte ? Diomande … » : le séparateur s'arrête avant la majuscule,
    // seul « Diomande Moussa » doit être proposé comme réfrent.
    const msg = 'as-tu une demande qui concerne ce compte ? Diomande Moussa';
    expect(detectNewEntityReference(msg, PREVIOUS_STATE)).toBe('Diomande Moussa');
  });

  it('revient à null sans état précédent (aucun contexte à contaminer)', () => {
    expect(detectNewEntityReference('as-tu une demande qui concerne ce compte ?', null)).toBeNull();
    expect(detectNewEntityReference('as-tu une demande ?', {})).toBeNull();
  });

  it('la normalisation compare sans accent ni ponctuation', () => {
    expect(normalizeEntityRef('ENTREPOT CAVA')).toBe('entrepot cava');
    expect(normalizeEntityRef('Diomande-Moussa,')).toBe('diomande moussa');
  });
});
