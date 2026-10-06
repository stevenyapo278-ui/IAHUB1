// Routes /api/form-definitions : administration des formulaires de demande
// (demandes de reporting) depuis Paramètres > Modèles de tickets. Prisma est
// mocké, les handlers sont appelés avec des req/res factices (auth posée au
// niveau routeur).

jest.mock('../prismaClient', () => ({
  formDefinition: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  permissionGroup: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  team: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  location: { findUnique: jest.fn() },
}));

const router = require('./formDefinition.routes');
const prisma = require('../prismaClient');

function findRoute(method, path) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
}

// Dispatch complet des couches de la route (requirePermission + handler)
const call = async (method, path, req) => {
  const route = findRoute(method, path);
  expect(route).toBeTruthy();
  const res = makeRes();
  req.method = method.toUpperCase();
  req.originalUrl = `${path}?${JSON.stringify({ params: req.params || {}, query: req.query || {} })}`;
  const stack = route.route.stack.map((l) => l.handle);
  let responded = false;
  const origJson = res.json.bind(res);
  res.json = (payload) => { responded = true; origJson(payload); return res; };
  for (let i = 0; i < stack.length && !responded; i += 1) {
    const fn = stack[i];
    if (fn.length >= 3) {
      await new Promise((resolve, reject) => {
        const onNext = (err) => (err ? reject(err) : resolve());
        const jsonBefore = res.json;
        res.json = (payload) => { responded = true; jsonBefore(payload); resolve(); return res; };
        try { fn(req, res, onNext); } catch (e) { reject(e); }
      });
    } else {
      await fn(req, res);
    }
  }
  return res;
};

const superadmin = { user: { sub: 1, role: 'SUPERADMIN' } };
const sections = [
  {
    name: ' Demandeur ',
    questions: [
      { name: 'NOM DU DEMANDEUR', fieldtype: 'actor', required: true },
      { name: 'OBJECTIF', fieldtype: 'texte-inconnu', required: false },
    ],
  },
];

beforeEach(() => jest.clearAllMocks());

describe('protection routeur', () => {
  it('authenticate en couche routeur', () => {
    const layers = router.stack.filter((l) => !l.route);
    expect(layers).toHaveLength(1);
    expect(layers[0].handle.name).toContain('authenticate');
  });
});

describe('GET /', () => {
  it('liste les formulaires avec compteurs de sections et de champs', async () => {
    prisma.formDefinition.findMany.mockResolvedValue([
      {
        id: 1, name: 'Reporting', isActive: true,
        sections: [{ name: 'A', questions: [{}, {}] }, { name: 'B', questions: [] }],
      },
    ]);
    const res = await call('get', '/', { ...superadmin });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ sectionCount: 2, fieldCount: 2 });
    expect(prisma.formDefinition.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });
});

describe('POST /', () => {
  it('crée un formulaire vierge avec une section par défaut', async () => {
    prisma.formDefinition.create.mockImplementation(async ({ data }) => ({ id: 9, ...data }));
    const res = await call('post', '/', { ...superadmin, body: { name: 'Nouveau reporting' } });
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Nouveau reporting');
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0].uuid).toBeTruthy();
    expect(res.body.sectionCount).toBe(1);
  });

  it('nom absent → 400', async () => {
    const res = await call('post', '/', { ...superadmin, body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Nom');
    expect(prisma.formDefinition.create).not.toHaveBeenCalled();
  });

  it('sections invalides → 400 avec le motif', async () => {
    const res = await call('post', '/', { ...superadmin, body: { name: 'X', sections: [{ name: '', questions: [] }] } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('nom requis');
    expect(prisma.formDefinition.create).not.toHaveBeenCalled();
  });

  it("type spécial ('team') rejeté : l'affectation n'est plus un champ de formulaire", async () => {
    const res = await call('post', '/', {
      ...superadmin,
      body: {
        name: 'X',
        sections: [{
          name: 'Affectation',
          questions: [{ name: 'ÉQUIPE', fieldtype: 'team' }],
        }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('type « team » inconnu');
    expect(prisma.formDefinition.create).not.toHaveBeenCalled();
  });

  it('bloc assignment valide (équipe, technicien, priorité) → enregistré', async () => {
    prisma.formDefinition.create.mockImplementation(async ({ data }) => ({ id: 10, ...data }));
    prisma.team.findUnique.mockResolvedValue({ id: 1 });
    prisma.user.findUnique.mockResolvedValue({ id: 2 });
    const res = await call('post', '/', {
      ...superadmin,
      body: {
        name: 'X',
        assignment: { teamId: 1, assignedToId: 2, priority: 'P1', type: 'INCIDENT', urgency: 'HIGH', locationId: null },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.formDefinition.create.mock.calls[0][0].data.assignment).toEqual({
      teamId: 1, assignedToId: 2, priority: 'P1', type: 'INCIDENT', urgency: 'HIGH',
    });
  });
});

describe('PATCH /:id', () => {
  it('formulaire introuvable → 404', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue(null);
    const res = await call('patch', '/:id', { ...superadmin, params: { id: '77' }, body: {} });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Formulaire introuvable' });
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('champ de type inconnu → 400 (whitelist FieldRenderer)', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', { ...superadmin, params: { id: '1' }, body: { sections } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('type « texte-inconnu » inconnu');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('sections valides → normalisées (trim, required booléen, uuid) puis enregistrées', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    const valid = [{ name: ' Demandeur ', questions: [{ name: ' NOM ', fieldtype: 'select', values: '["A","B"]' }] }];
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' }, body: { sections: valid, isActive: false },
    });
    expect(res.statusCode).toBe(200);
    const sent = prisma.formDefinition.update.mock.calls[0][0].data;
    expect(sent.isActive).toBe(false);
    expect(sent.sections[0].name).toBe('Demandeur');
    expect(sent.sections[0].questions[0]).toMatchObject({
      name: 'NOM', fieldtype: 'select', required: false, values: '["A","B"]',
    });
    expect(sent.sections[0].uuid).toBeTruthy();
    expect(res.body.sectionCount).toBe(1);
    expect(res.body.fieldCount).toBe(1);
  });

  it('nom vidé → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', { ...superadmin, params: { id: '1' }, body: { name: '  ' } });
    expect(res.statusCode).toBe(400);
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('requiredIf valide (case cochée) → accepté et normalisé', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    const valid = [{
      name: 'Demandeur',
      questions: [
        { name: 'VALIDATION DIRECTEUR', fieldtype: 'checkboxes' },
        { name: 'MOTIF', fieldtype: 'text', requiredIf: { question: ' VALIDATION DIRECTEUR ', equals: '' } },
      ],
    }];
    const res = await call('patch', '/:id', { ...superadmin, params: { id: '1' }, body: { sections: valid } });
    expect(res.statusCode).toBe(200);
    const q = prisma.formDefinition.update.mock.calls[0][0].data.sections[0].questions[1];
    expect(q.requiredIf).toEqual({ question: 'VALIDATION DIRECTEUR' });
  });

  it('requiredIf : champ source introuvable → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: {
        sections: [{ name: 'A', questions: [
          { name: 'MOTIF', fieldtype: 'text', requiredIf: { question: 'INEXISTANT' } },
        ] }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('introuvable');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('requiredIf : auto-référence → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: {
        sections: [{ name: 'A', questions: [
          { name: 'MOTIF', fieldtype: 'text', requiredIf: { question: 'MOTIF' } },
        ] }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('lui-même');
  });

  it('requiredIf sans champ source → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: {
        sections: [{ name: 'A', questions: [
          { name: 'MOTIF', fieldtype: 'text', requiredIf: {} },
        ] }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('sans champ source');
  });

  it('assignment : priorité invalide → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' }, body: { assignment: { priority: 'P9' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Priorité invalide');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('assignment : clé inconnue → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' }, body: { assignment: { slaId: 4 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('clé inconnue');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('assignment : équipe introuvable → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.team.findUnique.mockResolvedValue(null);
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' }, body: { assignment: { teamId: 999 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('équipe introuvable');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('assignment : technicien et lieu validés puis stockés', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    prisma.user.findUnique.mockResolvedValue({ id: 7 });
    prisma.location.findUnique.mockResolvedValue({ id: 3 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' }, body: { assignment: { assignedToId: 7, locationId: 3, source: 'Phone' } },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.formDefinition.update.mock.calls[0][0].data.assignment).toEqual({
      assignedToId: 7, locationId: 3, source: 'Phone',
    });
    expect(res.body).toMatchObject({ sectionCount: 0, fieldCount: 0 });
  });

  it('assignment vidée (null) → effacée', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    const res = await call('patch', '/:id', { ...superadmin, params: { id: '1' }, body: { assignment: null } });
    expect(res.statusCode).toBe(200);
    expect(prisma.formDefinition.update.mock.calls[0][0].data.assignment).toBeNull();
  });

  it('utilisateur sans permission tickets.assign → 403', async () => {
    prisma.formDefinition.findMany.mockResolvedValue([]);
    const res = await call('patch', '/:id', {
      user: { sub: 2, role: 'HOTLINE' }, params: { id: '1' }, body: { isActive: false },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Accès refusé' });
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /:id — validation supérieure (approval)', () => {
  const approvalSections = [{
    name: 'Demandeur',
    questions: [
      { name: 'VALIDATION DIRECTEUR', fieldtype: 'checkboxes' },
      { name: 'OBJET', fieldtype: 'text' },
    ],
  }];

  it('déclencheur valide (case cochée, sans valeur) → stocké normalisé', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: {
        sections: approvalSections,
        approval: { enabled: true, trigger: { question: ' VALIDATION DIRECTEUR ', equals: '' } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.formDefinition.update.mock.calls[0][0].data.approval).toEqual({
      enabled: true, trigger: { question: 'VALIDATION DIRECTEUR' },
    });
  });

  it('déclencheur avec valeur attendue → equals conservé', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: {
        sections: approvalSections,
        approval: { enabled: true, trigger: { question: 'OBJET', equals: 'URGENT' } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.formDefinition.update.mock.calls[0][0].data.approval.trigger).toEqual({
      question: 'OBJET', equals: 'URGENT',
    });
  });

  it('champ source introuvable → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: { sections: approvalSections, approval: { enabled: true, trigger: { question: 'INEXISTANT' } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('introuvable');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('sans déclencheur → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: { sections: approvalSections, approval: { enabled: true } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('déclencheur');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('valeur du déclencheur non scalaire → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: { sections: approvalSections, approval: { enabled: true, trigger: { question: 'OBJET', equals: { a: 1 } } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('valeur du déclencheur');
    expect(prisma.formDefinition.update).not.toHaveBeenCalled();
  });

  it('désactivée (enabled: false) → null enregistré', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1 });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' }, body: { approval: { enabled: false } },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.formDefinition.update.mock.calls[0][0].data.approval).toBeNull();
  });

  it('PATCH sans sections : déclencheur validé contre les sections en base', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({ id: 1, sections: approvalSections });
    prisma.formDefinition.update.mockImplementation(async ({ data }) => ({ id: 1, name: 'X', isActive: true, ...data }));
    const res = await call('patch', '/:id', {
      ...superadmin, params: { id: '1' },
      body: { approval: { enabled: true, trigger: { question: 'VALIDATION DIRECTEUR' } } },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.formDefinition.update.mock.calls[0][0].data.approval).toEqual({
      enabled: true, trigger: { question: 'VALIDATION DIRECTEUR' },
    });
  });
});
