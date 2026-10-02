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

  // ── Accusés de remise / de lecture (MDN) ────────────────────────────────────
  test('devrait ignorer un accusé de remise Outlook (sujet FR)', () => {
    const res = checkEmailSpam([], 'Accusé de remise : Imprimante caisse 3 bloquée', 'Votre message a été remis au destinataire.', 'client@prosuma.ci');
    expect(res.isSpam).toBe(true);
    expect(res.isInformational).toBe(true);
    expect(res.isTechnicalAutomated).toBe(true);
  });

  test('devrait ignorer un accusé de lecture (corps FR)', () => {
    const res = checkEmailSpam([], 'RE: Imprimante bloquée', 'Votre message a été lu par le destinataire le 01/10/2026.', 'client@prosuma.ci');
    expect(res.isSpam).toBe(true);
    expect(res.isTechnicalAutomated).toBe(true);
  });

  test('devrait ignorer un read receipt en anglais', () => {
    const res = checkEmailSpam([], 'Read Receipt: Printer jam', 'Your message has been read by the recipient.', 'user@client.com');
    expect(res.isSpam).toBe(true);
    expect(res.isTechnicalAutomated).toBe(true);
  });

  test('devrait ignorer un rapport MIME multipart/report (MDN/NDR)', () => {
    const headers = [{ name: 'Content-Type', value: 'multipart/report; report-type=disposition-notification' }];
    const res = checkEmailSpam(headers, 'Succès de la délivrance', 'Détails du rapport', 'exchange@prosuma.ci');
    expect(res.isSpam).toBe(true);
    expect(res.isTechnicalAutomated).toBe(true);
  });

  test('NE DEVRAIT PAS bloquer un email légitime portant X-Auto-Response-Suppress', () => {
    // Outlook/Exchange tamponne ce header sur des emails normaux (absence configurée,
    // boîte déléguée) : il demande à supprimer les auto-réponses, il ne prouve rien.
    // Régression : des demandes légitimes (URGENT dépannage…) partaient en INFORMATIONAL
    // sans analyse IA ni centre de validation.
    const headers = [{ name: 'X-Auto-Response-Suppress', value: 'DR, RN, NDR, OOF' }];
    const res = checkEmailSpam(headers, 'URGENT URGENT - Dépannage imprimante Mle Layya FAKHRY', 'Bonsoir, l\'imprimante HP LASERJET PRO présente un bourrage papier depuis quelques jours.', 'hussein.fakih@prosuma.ci');
    expect(res.isSpam).toBe(false);
    expect(res.isTechnicalAutomated).toBe(false);
  });

  test('détecte toujours un accusé de remise malgré la suppression du header', () => {
    const headers = [
      { name: 'X-Auto-Response-Suppress', value: 'DR, OOF, AutoReply' },
      { name: 'Content-Type', value: 'multipart/report; report-type=disposition-notification' },
    ];
    const res = checkEmailSpam(headers, 'Accusé de remise : Imprimante caisse 3', 'Votre message a été remis.', 'exchange@prosuma.ci');
    expect(res.isSpam).toBe(true);
    expect(res.isTechnicalAutomated).toBe(true);
  });

  test('NE DEVRAIT PAS bloquer une demande de support mentionnant une remise de matériel', () => {
    const res = checkEmailSpam([], 'Remise de matériel pour le nouveau collègue', 'Bonjour, merci de préparer le poste de travail de M. Dupont avant sa prise de poste.', 'rh@entreprise.com');
    expect(res.isSpam).toBe(false);
  });
});
