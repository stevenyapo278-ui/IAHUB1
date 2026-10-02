// Verifie que le registre de templates d'emails (emailTemplateRegistry.js) reste un
// miroir fidele des gabarits reels codes en dur dans emailSender.js, et que les
// echantillons d'apercu se rendent pour toutes les cles.
const fs = require('fs');
const path = require('path');
const { EMAIL_TEMPLATE_REGISTRY, renderTemplate } = require('./emailTemplateRegistry');
const { buildTemplateSample, sampleTemplateCtx } = require('./emailTemplateSamples');

const senderSource = fs.readFileSync(path.join(__dirname, 'emailSender.js'), 'utf8');
const KEYS = Object.keys(EMAIL_TEMPLATE_REGISTRY);
const SAMPLE_OPTS = { signature: '<div>SIGNATURE</div>', frontendUrl: 'http://localhost:3000' };

describe('renderTemplate', () => {
  it('remplace les placeholders connus', () => {
    expect(renderTemplate('Ticket #{ticketId} — {subject}', { ticketId: 42, subject: 'Panne' }))
      .toBe('Ticket #42 — Panne');
  });

  it('laisse intacts les placeholders inconnus et supporte un ctx vide', () => {
    expect(renderTemplate('Bonjour {toName}, # {unknown}', {})).toBe('Bonjour {toName}, # {unknown}');
    expect(renderTemplate(null)).toBe(null);
  });
});

describe('Registre des templates — structure', () => {
  it.each(KEYS)('%s a label, categorie, description, toggleKey et placeholders', (key) => {
    const meta = EMAIL_TEMPLATE_REGISTRY[key];
    expect(meta.label).toBeTruthy();
    expect(meta.category).toBeTruthy();
    expect(meta.description).toBeTruthy();
    expect(meta.toggleKey).toMatch(/^email[A-Za-z]+Enabled$|^needsHumanReviewNotificationEnabled$/);
    expect(Array.isArray(meta.placeholders)).toBe(true);
    expect(meta.placeholders.length).toBeGreaterThan(0);
    expect(new Set(meta.placeholders).size).toBe(meta.placeholders.length);
    expect(meta.placeholders.every((p) => /^\{\w+\}$/.test(p))).toBe(true);
  });

  it("les cles dynamiques (defaut null) proposent des exemples de sujet", () => {
    for (const key of KEYS) {
      const meta = EMAIL_TEMPLATE_REGISTRY[key];
      if (meta.defaultSubject === null) {
        expect(Array.isArray(meta.subjectExamples)).toBe(true);
        expect(meta.subjectExamples.length).toBeGreaterThan(0);
        expect(meta.subjectExamples.every((s) => typeof s === 'string' && s.includes('#'))).toBe(true);
      }
    }
  });
});

describe('Echantillons d\'apercu', () => {
  it.each(KEYS)('%s rend un sujet et un HTML non vides', async (key) => {
    const sample = await buildTemplateSample(key, SAMPLE_OPTS);
    expect(sample).not.toBeNull();
    expect(typeof sample.subject).toBe('string');
    expect(sample.subject.trim()).not.toBe('');
    expect(sample.html).toContain('role="presentation"');
    expect(sample.html).toContain('SIGNATURE');
  });

  it.each(KEYS)('%s : chaque placeholder liste est fourni par le ctx d\'echantillon', (key) => {
    const ctx = sampleTemplateCtx(key);
    for (const placeholder of EMAIL_TEMPLATE_REGISTRY[key].placeholders) {
      const name = placeholder.slice(1, -1);
      expect(Object.keys(ctx)).toContain(name);
    }
  });

  it.each(KEYS)('%s : les defauts rendus ne laissent aucun placeholder non resolu', async (key) => {
    const meta = EMAIL_TEMPLATE_REGISTRY[key];
    const ctx = sampleTemplateCtx(key);
    for (const field of ['defaultSubject', 'defaultMessage']) {
      if (meta[field]) {
        expect(renderTemplate(meta[field], ctx)).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe('Derive registre <-> builders (emailSender.js)', () => {
  // defaultMessage du registre rendu avec le ctx d'echantillon doit produire exactement
  // le meme HTML que le builder sans surcharge (le fallback inline du builder).
  const withMessage = KEYS.filter((k) => EMAIL_TEMPLATE_REGISTRY[k].defaultMessage);
  it.each(withMessage)('%s : defaultMessage miroir du fallback inline du builder', async (key) => {
    const meta = EMAIL_TEMPLATE_REGISTRY[key];
    const withoutOverride = await buildTemplateSample(key, SAMPLE_OPTS);
    const withOverride = await buildTemplateSample(key, {
      ...SAMPLE_OPTS,
      override: { message: meta.defaultMessage },
    });
    expect(withOverride.html).toBe(withoutOverride.html);
  });

  // Le sujet par defaut du registre est un miroir du sujet codé en dur dans le send* :
  // chaque fragment statique (entre placeholders) doit exister dans le source d'emailSender.
  const withSubject = KEYS.filter((k) => EMAIL_TEMPLATE_REGISTRY[k].defaultSubject);
  it.each(withSubject)('%s : fragments du defaultSubject presents dans emailSender.js', (key) => {
    const fragments = EMAIL_TEMPLATE_REGISTRY[key].defaultSubject
      .split(/\{\w+\}/)
      .map((f) => f.trim())
      .filter((f) => f.length >= 5);
    expect(fragments.length).toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(senderSource).toContain(fragment);
    }
  });
});
