const { checkEmailSpam } = require('./emailSpamFilter');

describe('emailSpamFilter', () => {
  test('devrait bloquer les notes d\'information dans le sujet', () => {
    const res = checkEmailSpam([], "Note d'information : Travaux bâtiment A samedi", "Chers tous, des travaux auront lieu...", "direction@entreprise.com");
    expect(res.isSpam).toBe(true);
    expect(res.isInformational).toBe(true);
  });

  test('devrait bloquer les communiqués et avis de maintenance', () => {
    const res1 = checkEmailSpam([], "Communiqué RH : Nouveaux horaires", "Bonjour à tous", "rh@entreprise.com");
    expect(res1.isSpam).toBe(true);

    const res2 = checkEmailSpam([], "Avis de maintenance : Serveur SAP indisponible ce soir", "Information de maintenance", "it@entreprise.com");
    expect(res2.isSpam).toBe(true);
  });

  test('devrait bloquer les e-mails avec en-tête List-Unsubscribe ou List-ID', () => {
    const headers = [{ name: 'List-Unsubscribe', value: '<mailto:unsubscribe@domain.com>' }];
    const res = checkEmailSpam(headers, "Mise à jour mensuelle", "Voici la newsletter du mois", "contact@domain.com");
    expect(res.isSpam).toBe(true);
    expect(res.isInformational).toBe(true);
  });

  test('devrait bloquer les adresses de diffusion globale', () => {
    const res = checkEmailSpam([], "Procédure de sécurité", "Veuillez trouver ci-joint...", "diffusion@prosuma.ci");
    expect(res.isSpam).toBe(true);
  });

  test('devrait bloquer les phrases d\'information générale dans le corps', () => {
    const res = checkEmailSpam([], "Informations diverses", "Ceci est un message d'information adressé à tous les collaborateurs. Aucune action n'est requise de votre part.", "communication@entreprise.com");
    expect(res.isSpam).toBe(true);
    expect(res.isInformational).toBe(true);
  });

  test('NE DEVRAIT PAS bloquer une vraie demande de support informatique', () => {
    const res = checkEmailSpam([], "Imprimante caisse N°2 bloquée", "Bonjour, l'imprimante thermique de la caisse 2 ne s'allume plus depuis ce matin. Pouvez-vous intervenir ?", "superu.vallon@entreprise.com");
    expect(res.isSpam).toBe(false);
  });

  test('NE DEVRAIT PAS bloquer une demande d\'ouverture de droits', () => {
    const res = checkEmailSpam([], "Demande de création de compte pour nouvel arrivant", "Merci de créer un compte AD pour Jean Dupont à partir de lundi.", "manager@entreprise.com");
    expect(res.isSpam).toBe(false);
  });
});
