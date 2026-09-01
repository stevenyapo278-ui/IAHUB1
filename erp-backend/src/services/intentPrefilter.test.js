const { prefilterReply } = require('./intentPrefilter');

describe('prefilterReply — pré-filtre zéro-coût avant appel LLM', () => {
  describe('signaux substantifs → analyse LLM requise (skip=false)', () => {
    it('détecte un signal de résolution implicite (« ça remarche »)', () => {
      expect(prefilterReply({ body: 'bonjour, finalement ça remarche, merci !' })).toEqual({ skip: false });
    });

    it('détecte un signal de résolution avec accents (« problème réglé »)', () => {
      expect(prefilterReply({ body: 'Le problème est réglé de mon côté.' })).toEqual({ skip: false });
    });

    it('détecte un signal de résolution (ticket accès : « je suis connecté »)', () => {
      expect(prefilterReply({ body: 'Depuis ce matin je suis connecté sans souci.' })).toEqual({ skip: false });
    });

    it('détecte une persistance du problème (« toujours en panne »)', () => {
      expect(prefilterReply({ body: 'c est toujours en panne, pouvez vous m aider ?' })).toEqual({ skip: false });
    });

    it('détecte une question posée au support', () => {
      expect(prefilterReply({ body: 'Pouvez-vous me dire quand le correctif sera livré ?' })).toEqual({ skip: false });
    });

    it('un long message sans signal reste analysé par le LLM', () => {
      const longBody = 'Je voulais simplement faire le point sur le ticket d un point de vue général, ' +
        'sans rien confirmer ni infirmer sur le problème initial décrit dans le ticket, juste pour ' +
        'tenir informé de la situation globale actuelle.';
      expect(longBody.length).toBeGreaterThan(120);
      expect(prefilterReply({ body: longBody })).toEqual({ skip: false });
    });
  });

  describe('messages triviaux → skip sans LLM', () => {
    it('ignore un accusé court sans lien (« c est noté, merci »)', () => {
      expect(prefilterReply({ body: 'C\'est noté, merci.' })).toEqual({ skip: true, intent: 'UNKNOWN', isAutoReply: false });
    });

    it('ignore un corps vide même avec un sujet', () => {
      expect(prefilterReply({ body: '', subject: 'Re: Ticket #12' }))
        .toEqual({ skip: true, intent: 'UNKNOWN', isAutoReply: false });
    });
  });

  describe('acknowledgments courts → analyse LLM requise (skip=false)', () => {
    it('« ok » seul déclenche le LLM (résolution implicite possible)', () => {
      expect(prefilterReply({ body: 'OK' })).toEqual({ skip: false });
    });

    it('« merci beaucoup » déclenche le LLM', () => {
      expect(prefilterReply({ body: 'Merci beaucoup pour votre aide.' })).toEqual({ skip: false });
    });

    it('« c est okay merci » déclenche le LLM', () => {
      expect(prefilterReply({ body: 'C\'est okay merci' })).toEqual({ skip: false });
    });

    it('« ok merci » déclenche le LLM', () => {
      expect(prefilterReply({ body: 'Ok merci' })).toEqual({ skip: false });
    });

    it('« super » déclenche le LLM', () => {
      expect(prefilterReply({ body: 'Super' })).toEqual({ skip: false });
    });

    it('« parfait » déclenche le LLM', () => {
      expect(prefilterReply({ body: 'Parfait' })).toEqual({ skip: false });
    });

    it('« nickel » déclenche le LLM', () => {
      expect(prefilterReply({ body: 'Nickel' })).toEqual({ skip: false });
    });

    it('« c est bon » déclenche le LLM', () => {
      expect(prefilterReply({ body: 'C\'est bon' })).toEqual({ skip: false });
    });
  });

  describe('réponses automatiques → skip isAutoReply', () => {
    it('ignore un out-of-office', () => {
      expect(prefilterReply({ body: 'Je suis actuellement en congés, je traiterai votre demande à mon retour. Ce message est généré automatiquement.' }))
        .toEqual({ skip: true, intent: 'UNKNOWN', isAutoReply: true });
    });

    it('ignore un accusé de réception générique', () => {
      expect(prefilterReply({ body: 'Votre email a bien été reçu. Ceci est un message automatique, merci de ne pas répondre.' }))
        .toEqual({ skip: true, intent: 'UNKNOWN', isAutoReply: true });
    });
  });

  describe('cas limites', () => {
    it('un signal de résolution PRIME sur un marqueur auto (aucun skip, le LLM tranche)', () => {
      expect(prefilterReply({ body: '[Message généré automatiquement] Tout fonctionne désormais.' })).toEqual({ skip: false });
    });

    it('« not ok » déclenche le LLM (signal de continuation, pas de résolution)', () => {
      expect(prefilterReply({ body: 'C\'est not ok' })).toEqual({ skip: false });
    });

    it('« pas ok » déclenche le LLM (signal de continuation)', () => {
      expect(prefilterReply({ body: 'C\'est pas ok' })).toEqual({ skip: false });
    });

    it('corps vide = skip trivial (sujet seul sans signal)', () => {
      expect(prefilterReply({ body: '', subject: 'Re: [Ticket #12] Problème VPN' }))
        .toEqual({ skip: true, intent: 'UNKNOWN', isAutoReply: false });
    });

    it('un vague « merci » avec accents déclenche le LLM (merci beaucoup matche)', () => {
      expect(prefilterReply({ body: 'MERCÍ Beaucoup !' })).toEqual({ skip: false });
    });
  });
});