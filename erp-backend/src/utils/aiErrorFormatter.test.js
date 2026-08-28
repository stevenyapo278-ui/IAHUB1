const { formatProviderHttpError, formatDuration, compactErrorMessage } = require('./aiErrorFormatter');

// Reproduit le corps d'erreur réellement renvoyé par Gemini (exemple du ticket utilisateur)
const GEMINI_QUOTA_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 20, model: gemini-omni-1.1-flash\nPlease retry in 10h20m22.849996029s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.Help',
        links: [{ description: 'Learn more about Gemini API quotas', url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }],
      },
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_requests_per_model_per_day',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel',
            quotaDimensions: { location: 'global', model: 'gemini-omni-1.1-flash' },
            quotaValue: '20',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37222s' },
    ],
  },
});

describe('formatDuration', () => {
  it('formate les secondes en durée lisible (10h 20m)', () => {
    expect(formatDuration(37222)).toBe('10h 20m');
  });

  it('formate les durées avec jours', () => {
    expect(formatDuration(90061)).toBe('1j 1h 1m');
  });

  it('gère les valeurs invalides', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration('abc')).toBeNull();
  });
});

describe('formatProviderHttpError', () => {
  it("produit un message compact et lisible pour une erreur de quota Gemini", () => {
    const result = formatProviderHttpError({
      provider: { label: 'Google Gemini' },
      status: 429,
      body: GEMINI_QUOTA_BODY,
    });

    // Le gros JSON brut ne doit plus apparaître
    expect(result).not.toContain('type.googleapis.com');
    expect(result).not.toContain('retryDelay');

    // Les infos utiles sont présentes
    expect(result).toContain('[Google Gemini]');
    expect(result).toContain('Quota ou limite de débit atteint');
    expect(result).toContain('HTTP 429');
    expect(result).toContain('generate_requests_per_model_per_day');
    expect(result).toContain('gemini-omni-1.1-flash');
    expect(result).toContain('10h 20m');
  });

  it('catégorise une erreur 401 comme une authentification invalide', () => {
    const body = JSON.stringify({ error: { code: 401, message: 'Invalid API key', status: 'UNAUTHENTICATED' } });
    const result = formatProviderHttpError({ provider: { label: 'OpenAI' }, status: 401, body });
    expect(result).toContain('Authentification invalide');
    expect(result).toContain('Invalid API key');
  });

  it('reste lisible quand la réponse body n\'est pas du JSON', () => {
    const result = formatProviderHttpError({ label: 'Mistral', status: 503, body: 'Service Temporarily Unavailable' });
    expect(result).toContain('[Mistral]');
    expect(result).toContain('Service indisponible');
    expect(result).toContain('Service Temporarily Unavailable');
  });

  it('gère un body vide', () => {
    const result = formatProviderHttpError({ label: 'NVIDIA', status: 204, body: '' });
    expect(result).toContain('[NVIDIA]');
    expect(result).toContain('HTTP 204');
  });

  it('tronque les messages très longs', () => {
    const result = formatProviderHttpError({ label: 'OpenAI', status: 400, body: 'x'.repeat(5000) });
    expect(result.length).toBeLessThan(400);
    expect(result).toContain('…');
  });
});

describe('compactErrorMessage', () => {
  it('extrait le message court d\'un JSON embarqué dans un long message', () => {
    const long = `Un préfixe inutile puis le corps : ${JSON.stringify({
      error: { message: 'Quota dépassé pour le modèle flash' },
    })} et encore du texte` + 'x'.repeat(2000);
    const result = compactErrorMessage(long, 300);
    expect(result).toContain('Quota dépassé pour le modèle flash');
    expect(result.length).toBeLessThanOrEqual(300);
  });

  it('laisse tel quel un message déjà court', () => {
    const msg = 'Erreur de timeout';
    expect(compactErrorMessage(msg)).toBe(msg);
  });
});