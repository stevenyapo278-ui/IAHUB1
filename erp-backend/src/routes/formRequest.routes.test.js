// POST /api/form-requests/:id/submit — soumission du formulaire de demande de
// reporting -> Ticket. Vérifie les valeurs par défaut, l'application du bloc
// d'affectation configuré dans Paramètres (jamais saisi par le demandeur) et
// les rejets. Prisma + SLA mockés ; authenticate est appelé avec un vrai JWT
// (utilisateur mocké en DB).

jest.mock('../prismaClient', () => ({
  formDefinition: { findUnique: jest.fn() },
  ticket: { create: jest.fn() },
  formSubmission: { create: jest.fn() },
  ticketEvent: { create: jest.fn() },
  ticketApproval: { create: jest.fn() },
  user: { findUnique: jest.fn() },
  team: { findUnique: jest.fn() },
  location: { findUnique: jest.fn() },
}));
jest.mock('../services/slaService', () => ({ applySla: jest.fn() }));
// Le service d'e-mail n'est pas chargé : on ne teste ici que son déclenchement.
jest.mock('../services/hierarchicalApproval', () => ({
  MANAGER_KEY: 'VALIDATION - E-MAIL DU SUPERIEUR HIERARCHIQUE',
  CC_KEY: 'VALIDATION - COPIE (CC)',
  sendManagerApprovalEmail: jest.fn().mockResolvedValue(undefined),
}));

const jwt = require('jsonwebtoken');
const router = require('./formRequest.routes');
const prisma = require('../prismaClient');
const { applySla } = require('../services/slaService');
const { sendManagerApprovalEmail, MANAGER_KEY, CC_KEY } = require('../services/hierarchicalApproval');

const TOKEN = jwt.sign({ sub: 1, role: 'SUPERADMIN' }, process.env.JWT_SECRET);
const AUTH_USER = {
  id: 1, email: 'super@prosuma.ci', fullName: 'Super Admin',
  role: 'SUPERADMIN', roles: [], teamId: null, isActive: true,
};

const SIMPLE_FORM = {
  id: 1, name: 'FORMULAIRE DE DEMANDE DE REPORTING CYRUS',
  sections: [{
    name: 'DEMANDEUR', order: 1, uuid: 's1',
    questions: [{ name: 'OBJET DE LA DEMANDE', fieldtype: 'text', required: true, uuid: 'q1' }],
  }],
};

// Même formulaire, avec le bloc d'affectation configuré côté Paramètres
// (aucune question spéciale : le demandeur ne voit que des champs classiques).
const ASSIGNED_FORM = {
  id: 2, name: 'F-REPORTING',
  assignment: {
    teamId: 1, assignedToId: 2, priority: 'P1', type: 'INCIDENT',
    urgency: 'HIGH', locationId: 3, source: 'Phone',
  },
  sections: [{
    name: 'DEMANDEUR', order: 1, uuid: 's1',
    questions: [{ name: 'OBJET DE LA DEMANDE', fieldtype: 'text', required: true, uuid: 'q1' }],
  }],
};

// Formulaire avec conditions « obligatoire si » (case cochée / liste multiple)
const CONDITIONAL_FORM = {
  id: 3, name: 'F-COND',
  sections: [{
    name: 'DEMANDEUR', order: 1, uuid: 's1',
    questions: [
      { name: 'OBJET DE LA DEMANDE', fieldtype: 'text', required: true, uuid: 'q0' },
      { name: 'VALIDATION DIRECTEUR', fieldtype: 'checkboxes', required: false, uuid: 'q1' },
      { name: 'MOTIF', fieldtype: 'text', required: false, requiredIf: { question: 'VALIDATION DIRECTEUR' }, uuid: 'q2' },
      { name: 'STATUT ARTICLE', fieldtype: 'multiselect', required: false, uuid: 'q3' },
      { name: 'COMMENTAIRE', fieldtype: 'text', required: false, requiredIf: { question: 'STATUT ARTICLE', equals: 'AC ACTIF' }, uuid: 'q4' },
    ],
  }],
};

// Formulaire avec validation hiérarchique conditionnelle (bloc « Validation
// supérieure » de l'éditeur) : case cochée → e-mail du supérieur exigé.
const APPROVAL_FORM = {
  id: 4, name: 'F-APPROVAL',
  approval: { enabled: true, trigger: { question: 'VALIDATION DIRECTEUR' } },
  sections: [{
    name: 'DEMANDEUR', order: 1, uuid: 's1',
    questions: [
      { name: 'OBJET DE LA DEMANDE', fieldtype: 'text', required: true, uuid: 'q0' },
      { name: 'VALIDATION DIRECTEUR', fieldtype: 'checkboxes', required: false, uuid: 'q1' },
    ],
  }],
};

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

const call = async (method, path, req) => {
  const route = findRoute(method, path);
  expect(route).toBeTruthy();
  const res = makeRes();
  req.method = method.toUpperCase();
  req.headers = { authorization: `Bearer ${TOKEN}` };
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

const ticketData = () => prisma.ticket.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.ticket.create.mockResolvedValue({ id: 42 });
  prisma.formSubmission.create.mockResolvedValue({ id: 1 });
  prisma.ticketEvent.create.mockResolvedValue({ id: 1 });
  applySla.mockResolvedValue(undefined);
  prisma.user.findUnique.mockImplementation(async ({ where, select }) => {
    if (select && select.isActive) return AUTH_USER;
    if (where.id === 999) return null;
    return { id: where.id, fullName: `Tech ${where.id}` };
  });
});

describe('POST /:id/submit — basique', () => {
  it('formulaire introuvable → 404', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue(null);
    const res = await call('post', '/:id/submit', { params: { id: '77' }, body: { answers: {} } });
    expect(res.statusCode).toBe(404);
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('champ obligatoire manquant → 400', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue(SIMPLE_FORM);
    const res = await call('post', '/:id/submit', { params: { id: '1' }, body: { answers: {} } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('obligatoires manquants');
    expect(res.body.error).toContain('OBJET DE LA DEMANDE');
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('soumission simple → ticket avec valeurs par défaut + SLA', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue(SIMPLE_FORM);
    const answers = { 'OBJET DE LA DEMANDE': 'État des ventes' };
    const res = await call('post', '/:id/submit', { params: { id: '1' }, body: { answers } });

    expect(res.statusCode).toBe(201);
    expect(res.body.ticketId).toBe(42);
    expect(ticketData()).toMatchObject({
      title: 'ÉTAT DES VENTES',
      status: 'NEW',
      priority: 'P3',
      type: 'REQUEST',
      urgency: 'MEDIUM',
      impact: 'MEDIUM',
      source: 'Formulaire',
      origin: 'PORTAIL',
      category: 'Demande reporting',
      teamId: null,
      assignedToId: null,
      locationId: null,
      requesterIds: [1],
    });
    expect(ticketData().assignees).toBeUndefined();
    expect(ticketData().observers).toBeUndefined();
    expect(applySla).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
    expect(prisma.formSubmission.create).toHaveBeenCalledWith({
      data: { formId: 1, ticketId: 42, submittedById: 1, answers },
    });
  });
});

describe('POST /:id/submit — affectation configurée dans Paramètres', () => {
  const answers = { 'OBJET DE LA DEMANDE': 'État des ventes' };

  function mockAssigned() {
    prisma.formDefinition.findUnique.mockResolvedValue(ASSIGNED_FORM);
    prisma.team.findUnique.mockResolvedValue({ id: 1, name: 'Niveau 1', defaultObservers: [{ id: 9 }] });
    prisma.location.findUnique.mockResolvedValue({ id: 3, name: 'Siège', completename: 'Siège > Accueil' });
  }

  it('applique équipe/technicien/priorité/type/urgence/lieu/source sur le ticket', async () => {
    mockAssigned();
    const res = await call('post', '/:id/submit', { params: { id: '2' }, body: { answers } });

    expect(res.statusCode).toBe(201);
    expect(ticketData()).toMatchObject({
      priority: 'P1',
      type: 'INCIDENT',
      urgency: 'HIGH',
      impact: 'MEDIUM',
      source: 'Phone',
      teamId: 1,
      assignedToId: 2,
      locationId: 3,
      locationName: 'Siège > Accueil',
      assignees: { connect: [{ id: 2 }] },
      observers: { connect: [{ id: 9 }] },
    });
    expect(prisma.team.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 } }));
  });

  it("le corps du ticket ne contient que les réponses du demandeur (pas l'affectation)", async () => {
    mockAssigned();
    await call('post', '/:id/submit', { params: { id: '2' }, body: { answers } });
    const { content, teamId, assignedToId } = ticketData();
    expect(content).toContain('OBJET DE LA DEMANDE : État des ventes');
    expect(content).not.toContain('Niveau 1');
    expect(content).not.toContain('Tech 2');
    expect(teamId).toBe(1);
    expect(assignedToId).toBe(2);
  });

  it('sans affectation configurée → défauts conservés (aucune requête ressource)', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue(SIMPLE_FORM);
    const res = await call('post', '/:id/submit', { params: { id: '1' }, body: { answers } });
    expect(res.statusCode).toBe(201);
    expect(ticketData()).toMatchObject({
      priority: 'P3', type: 'REQUEST', source: 'Formulaire', teamId: null, assignedToId: null,
    });
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
    expect(prisma.location.findUnique).not.toHaveBeenCalled();
  });

  it('ressource supprimée depuis la configuration → ticket créé sans elle (non bloquant)', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue(ASSIGNED_FORM);
    prisma.team.findUnique.mockResolvedValue(null);
    prisma.location.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockImplementation(async ({ where, select }) => {
      if (select && select.isActive) return AUTH_USER;
      return null; // technicien supprimé
    });
    const res = await call('post', '/:id/submit', { params: { id: '2' }, body: { answers } });
    expect(res.statusCode).toBe(201);
    expect(ticketData()).toMatchObject({
      priority: 'P1', teamId: null, assignedToId: null, locationId: null, locationName: null,
    });
    expect(ticketData().assignees).toBeUndefined();
    expect(ticketData().observers).toBeUndefined();
  });

  it('valeur d’affectation invalide en base → défaut appliqué (plutôt que de bloquer)', async () => {
    prisma.formDefinition.findUnique.mockResolvedValue({
      ...ASSIGNED_FORM, assignment: { priority: 'P9', teamId: 'abc' },
    });
    const res = await call('post', '/:id/submit', { params: { id: '2' }, body: { answers } });
    expect(res.statusCode).toBe(201);
    expect(ticketData()).toMatchObject({ priority: 'P3', type: 'REQUEST', teamId: null });
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /:id/submit — conditionnel « obligatoire si »', () => {
  const base = { 'OBJET DE LA DEMANDE': 'Demande' };

  beforeEach(() => {
    prisma.formDefinition.findUnique.mockResolvedValue(CONDITIONAL_FORM);
  });

  it('case décochée (jamais touchée) → le champ conditionnel reste facultatif', async () => {
    const res = await call('post', '/:id/submit', { params: { id: '3' }, body: { answers: base } });
    expect(res.statusCode).toBe(201);
  });

  it('case cochée → champ conditionnel exigé (400 avec son intitulé)', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '3' },
      body: { answers: { ...base, 'VALIDATION DIRECTEUR': 'OUI' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Champs obligatoires manquants');
    expect(res.body.error).toContain('MOTIF');
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('case cochée + champ rempli → soumission acceptée', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '3' },
      body: { answers: { ...base, 'VALIDATION DIRECTEUR': 'OUI', 'MOTIF': 'Budget validé' } },
    });
    expect(res.statusCode).toBe(201);
    expect(ticketData().content).toContain('MOTIF : Budget validé');
  });

  it('liste multiple contenant la valeur attendue → champ exigé', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '3' },
      body: { answers: { ...base, 'STATUT ARTICLE': ['NA NON ACTIF', 'AC ACTIF'] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('COMMENTAIRE');
  });

  it('liste multiple sans la valeur attendue → champ facultatif', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '3' },
      body: { answers: { ...base, 'STATUT ARTICLE': ['NA NON ACTIF'] } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('case vidée (\'\') → règle non satisfaite', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '3' },
      body: { answers: { ...base, 'VALIDATION DIRECTEUR': '' } },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /:id/submit — validation supérieure conditionnelle', () => {
  const base = { 'OBJET DE LA DEMANDE': 'Demande', 'VALIDATION DIRECTEUR': 'OUI' };

  beforeEach(() => {
    prisma.formDefinition.findUnique.mockResolvedValue(APPROVAL_FORM);
    prisma.ticketApproval.create.mockResolvedValue({
      id: 1, token: 'tok-123', ticketId: 42, managerEmail: 'boss@x.ci', cc: [], status: 'PENDING',
    });
  });

  it('déclencheur non atteint → aucun ticketApproval, ticket sans approvalStatus', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '4' },
      body: { answers: { 'OBJET DE LA DEMANDE': 'Demande', 'VALIDATION DIRECTEUR': '' } },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.ticketApproval.create).not.toHaveBeenCalled();
    expect(ticketData().approvalStatus).toBeUndefined();
    expect(sendManagerApprovalEmail).not.toHaveBeenCalled();
  });

  it('déclencheur atteint sans e-mail supérieur → 400, aucun ticket créé', async () => {
    const res = await call('post', '/:id/submit', { params: { id: '4' }, body: { answers: base } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('supérieur hiérarchique');
    expect(prisma.ticket.create).not.toHaveBeenCalled();
    expect(prisma.ticketApproval.create).not.toHaveBeenCalled();
  });

  it('e-mail supérieur invalide → 400', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '4' },
      body: { answers: { ...base, [MANAGER_KEY]: 'pas-un-email' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('invalide');
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('copie invalide → 400 avec l\'adresse fautive', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '4' },
      body: { answers: { ...base, [MANAGER_KEY]: 'boss@x.ci', [CC_KEY]: 'a@x.ci, invalid' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('copie invalide');
    expect(res.body.error).toContain('invalid');
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('déclencheur atteint + e-mails valides → ticket PENDING + TicketApproval + e-mail envoyé', async () => {
    const answers = { ...base, [MANAGER_KEY]: 'boss@x.ci', [CC_KEY]: 'a@x.ci, b@y.ci' };
    const res = await call('post', '/:id/submit', { params: { id: '4' }, body: { answers } });

    expect(res.statusCode).toBe(201);
    expect(ticketData().approvalStatus).toBe('PENDING');
    expect(ticketData().content).toContain('━━━ VALIDATION SUPÉRIEURE ━━━');
    expect(ticketData().content).toContain(`${MANAGER_KEY} : boss@x.ci`);
    expect(ticketData().content).toContain(`${CC_KEY} : a@x.ci, b@y.ci`);
    expect(prisma.ticketApproval.create).toHaveBeenCalledWith({
      data: { ticketId: 42, formId: 4, managerEmail: 'boss@x.ci', cc: ['a@x.ci', 'b@y.ci'], status: 'PENDING' },
    });
    expect(sendManagerApprovalEmail).toHaveBeenCalledWith({
      ticket: expect.objectContaining({ id: 42 }),
      approval: expect.objectContaining({ token: 'tok-123' }),
      requesterName: '',
    });
  });

  it('e-mail supérieur seul (sans copie) → TicketApproval avec cc vide', async () => {
    const res = await call('post', '/:id/submit', {
      params: { id: '4' },
      body: { answers: { ...base, [MANAGER_KEY]: 'boss@x.ci' } },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.ticketApproval.create.mock.calls[0][0].data.cc).toEqual([]);
    expect(sendManagerApprovalEmail).toHaveBeenCalled();
  });
});
