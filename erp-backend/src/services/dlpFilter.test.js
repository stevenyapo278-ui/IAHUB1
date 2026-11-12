// Tests du filtre DLP (mesure ANSSI 4.5 — Q-4.5-02).
// Deux niveaux :
//  1. unitaires : chaque détecteur masque ce qu'il doit, et rien d'autre ;
//  2. intégration : le corps HTTP réellement envoyé au fournisseur
//     (`callProviderWithFallback` → fetch) ne contient plus les données sensibles.
// Le second niveau est la « preuve de transmission de données marquées » demandée
// par la feuille d'évaluation.

jest.mock('../prismaClient', () => ({}));
jest.mock('./aiUsageTracker', () => ({
  isAiEnabled: jest.fn(async () => true),
  trackAiUsage: jest.fn(async () => ({})),
}));

const dlp = require('./dlpFilter');
const { isAiEnabled } = require('./aiUsageTracker');

const PROVIDER = {
  name: 'openai',
  label: 'OpenAI (test)',
  baseUrl: 'https://ia.test/v1',
  keys: [{ apiKey: 'cle-de-test' }],
  models: [{ id: 1, name: 'gpt-test' }],
};

describe('dlpFilter — détecteurs', () => {
  afterEach(() => {
    delete process.env.AI_DLP_ENABLED;
    delete process.env.AI_DLP_DISABLED_TYPES;
  });

  it('masque un IBAN français', () => {
    const { text, findings } = dlp.redactText('Virement vers FR76 3000 6000 0112 3456 7890 189.');
    expect(text).toContain('[IBAN_MASQUÉ]');
    expect(text).not.toContain('FR76');
    expect(findings.IBAN).toBe(1);
  });

  it('masque un numéro de carte valide (Luhn) mais laisse un identifiant arbitraire', () => {
    const card = dlp.redactText('Carte 4111 1111 1111 1111');
    expect(card.text).toBe('Carte [CARTE_MASQUÉE]');
    expect(card.findings.CARD).toBe(1);

    // 16 chiffres qui ne passent pas Luhn : ne doit pas être masqué.
    const notACard = dlp.redactText('Réf 1234 5678 9012 3456');
    expect(notACard.text).toBe('Réf 1234 5678 9012 3456');
    expect(notACard.findings.CARD).toBeUndefined();
  });

  it('masque un NIR et un téléphone', () => {
    const nir = dlp.redactText('NIR 1 85 05 78 006 084 36');
    expect(nir.text).toBe('NIR [NIR_MASQUÉ]');

    const tel = dlp.redactText('Joignable au 06 12 34 56 78 ou +33 6 12 34 56 78');
    expect(tel.text).toBe('Joignable au [TÉLÉPHONE_MASQUÉ] ou [TÉLÉPHONE_MASQUÉ]');
    expect(tel.findings.PHONE).toBe(2);
  });

  it('masque la partie locale des e-mails mais conserve le domaine', () => {
    const { text, findings } = dlp.redactText('Écrire à jean.dupont@exemple.fr');
    expect(text).toContain('@exemple.fr');
    expect(text).not.toContain('jean.dupont');
    expect(findings.EMAIL).toBe(1);
  });

  it('masque les secrets en clair quelle que soit leur casse', () => {
    const { text, findings } = dlp.redactText('API_KEY=sk-live-abcdef123456 et password: "P@ssw0rd!"');
    expect(text).not.toContain('sk-live-abcdef123456');
    expect(text).not.toContain('P@ssw0rd');
    expect(findings.SECRET).toBe(2);
  });

  it('ne modifie pas un texte anodin (pas de faux positif sur un n° de ticket)', () => {
    const input = 'Ticket #12345 — équipe Système, statut OPEN, créé le 12/11/2026.';
    const { text, findings } = dlp.redactText(input);
    expect(text).toBe(input);
    expect(findings).toEqual({});
  });

  it('respecte AI_DLP_DISABLED_TYPES', () => {
    process.env.AI_DLP_DISABLED_TYPES = 'PHONE';
    const { text } = dlp.redactForModel('Appeler le 06 12 34 56 78');
    expect(text).toBe('Appeler le 06 12 34 56 78');
  });

  it('est activé par défaut et se désactive explicitement', () => {
    expect(dlp.isDlpEnabled({})).toBe(true);
    expect(dlp.isDlpEnabled({ AI_DLP_ENABLED: 'false' })).toBe(false);
    expect(dlp.redactForModel('06 12 34 56 78', { AI_DLP_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('redactMessages traite les contenus texte et les blocs multi-parties', () => {
    const { messages, findings } = dlp.redactMessages([
      { role: 'user', content: 'IBAN FR76 3000 6000 0112 3456 7890 189' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'téléphone 06 12 34 56 78' },
          { type: 'image_url', image_url: { url: 'https://x/y.png' } },
        ],
      },
      { role: 'assistant', tool_calls: [{ id: '1' }] },
    ]);
    expect(messages[0].content).toContain('[IBAN_MASQUÉ]');
    expect(messages[1].content[0].text).toContain('[TÉLÉPHONE_MASQUÉ]');
    expect(messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'https://x/y.png' } });
    expect(messages[2]).toEqual({ role: 'assistant', tool_calls: [{ id: '1' }] });
    expect(findings).toEqual({ IBAN: 1, PHONE: 1 });
  });
});

describe('dlpFilter — intégration au point d’envoi unique', () => {
  const originalFetch = global.fetch;
  let sentBodies;

  beforeEach(() => {
    jest.clearAllMocks();
    isAiEnabled.mockResolvedValue(true);
    sentBodies = [];
    global.fetch = jest.fn(async (url, init) => {
      sentBodies.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        text: async () => '',
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('le prompt, le system et les messages envoyés au fournisseur sont masqués', async () => {
    // Chargé après la mise en place des mocks.
    const { callProviderWithFallback } = require('./mailAnalyzer');

    const prompt =
      'Client : jean.dupont@exemple.fr — IBAN FR76 3000 6000 0112 3456 7890 189 — carte 4111 1111 1111 1111';
    const system = 'Contexte interne : NIR 1 85 05 78 006 084 36, joignable au 06 12 34 56 78';
    const messages = [{ role: 'user', content: 'token=sk-secret-abcdef123456' }];

    const result = await callProviderWithFallback([PROVIDER], prompt, 'chatbot', {
      system,
      messages,
      source: 'dlp-test',
    });

    expect(result).toBe('ok');
    expect(sentBodies).toHaveLength(1);

    const body = sentBodies[0].body;
    // body.messages = [system, ...messages]
    const systemSent = body.messages[0].content;
    const messagesSent = JSON.stringify(body.messages);

    expect(systemSent).toContain('[NIR_MASQUÉ]');
    expect(systemSent).toContain('[TÉLÉPHONE_MASQUÉ]');
    expect(systemSent).not.toContain('1 85 05 78 006 084 36');

    expect(messagesSent).not.toContain('sk-secret-abcdef123456');
    expect(messagesSent).toContain('[SECRET_MASQUÉ]');

    // Le prompt legacy est ignoré quand `messages` est fourni : on vérifie
    // néanmoins qu'aucune donnée brute ne subsiste nulle part dans le corps.
    const rawBody = JSON.stringify(body);
    expect(rawBody).not.toContain('FR76');
    expect(rawBody).not.toContain('4111 1111 1111 1111');
    expect(rawBody).not.toContain('jean.dupont@exemple.fr');
  });

  it('le prompt legacy (sans messages) est masqué avant envoi', async () => {
    const { callProviderWithFallback } = require('./mailAnalyzer');

    await callProviderWithFallback(
      [PROVIDER],
      'IBAN FR76 3000 6000 0112 3456 7890 189 / 06 12 34 56 78',
      'email',
      { source: 'dlp-test-legacy' }
    );

    const rawBody = JSON.stringify(sentBodies[0].body);
    expect(rawBody).toContain('[IBAN_MASQUÉ]');
    expect(rawBody).toContain('[TÉLÉPHONE_MASQUÉ]');
    expect(rawBody).not.toContain('FR76');
    expect(rawBody).not.toContain('06 12 34 56 78');
  });

  it('fail-closed : si le filtre casse, aucun appel réseau n’est émis', async () => {
    const { callProviderWithFallback } = require('./mailAnalyzer');
    const spy = jest.spyOn(dlp, 'redactForModel').mockImplementation(() => {
      throw new Error('détecteur indisponible');
    });

    await expect(
      callProviderWithFallback([PROVIDER], 'IBAN FR76 3000 6000 0112 3456 7890 189', 'email', {
        source: 'dlp-test-fail',
      })
    ).rejects.toThrow(/filtre DLP/i);

    expect(sentBodies).toHaveLength(0);
    spy.mockRestore();
  });

  it('AI_DLP_FAIL_OPEN=true laisse passer l’envoi non filtré (dérogation tracée)', async () => {
    const { callProviderWithFallback } = require('./mailAnalyzer');
    const spy = jest.spyOn(dlp, 'redactForModel').mockImplementation(() => {
      throw new Error('détecteur indisponible');
    });
    process.env.AI_DLP_FAIL_OPEN = 'true';

    try {
      await callProviderWithFallback([PROVIDER], 'IBAN FR76 3000 6000 0112 3456 7890 189', 'email', {
        source: 'dlp-test-open',
      });
    } finally {
      spy.mockRestore();
      delete process.env.AI_DLP_FAIL_OPEN;
    }

    expect(sentBodies).toHaveLength(1);
    expect(JSON.stringify(sentBodies[0].body)).toContain('FR76');
  });
});
