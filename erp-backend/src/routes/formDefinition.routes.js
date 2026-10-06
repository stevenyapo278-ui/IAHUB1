const express = require('express');
const crypto = require('crypto');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// ── Formulaires de demande (demandes de reporting) ──────────────────────────
// Administration des FormDefinition (sections + champs) depuis Paramètres >
// Modèles de tickets. Lecture pour tout authentifié, écriture sous permission
// tickets.assign (même garde-fou que les modèles de tickets). Le seed GLPI
// n'importe que les formulaires manquants : les éditions locales survivent
// donc aux ré-imports.

const router = express.Router();
router.use(authenticate);

// Types de champs rendus par FormRequest.jsx (FieldRenderer). L'affectation du
// ticket (équipe, technicien, priorité…) n'est PAS un champ de formulaire : elle
// se configure dans le bloc « Affectation » de l'éditeur (colonne assignment) et
// n'est jamais visible par le demandeur.
const FIELD_TYPES = [
  'text', 'textarea', 'actor', 'select', 'multiselect', 'checkboxes', 'date',
];

// Clés et valeurs autorisées du bloc d'affectation (mêmes listes que POST /tickets)
const ASSIGN_KEYS = ['teamId', 'assignedToId', 'priority', 'type', 'urgency', 'impact', 'locationId', 'source'];
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const TICKET_TYPES = ['INCIDENT', 'REQUEST'];
const URGENCY_IMPACT = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'MAJOR'];
const SOURCES = ['Direct', 'Email', 'Formcreator', 'Helpdesk', 'Phone', 'Other'];

function counts(form) {
  const sections = Array.isArray(form.sections) ? form.sections : [];
  return {
    sectionCount: sections.length,
    fieldCount: sections.reduce((n, s) => n + (Array.isArray(s?.questions) ? s.questions.length : 0), 0),
  };
}

// null si valide, sinon message d'erreur (affiché tel quel en 400)
function validateSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return 'sections doit être un tableau non vide';
  // Tous les intitulés du formulaire : une condition « obligatoire si » vise un
  // autre champ du même formulaire (les réponses sont clés par intitulé).
  const allNames = sections.flatMap((s) => (Array.isArray(s?.questions) ? s.questions : [])
    .map((q) => String(q?.name || '').trim()));
  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i];
    if (!sec || typeof sec !== 'object') return `Section ${i + 1} invalide`;
    if (!String(sec.name || '').trim()) return `Section ${i + 1} : nom requis`;
    if (!Array.isArray(sec.questions)) return `Section « ${sec.name} » : liste de champs invalide`;
    for (let j = 0; j < sec.questions.length; j += 1) {
      const q = sec.questions[j];
      if (!q || typeof q !== 'object') return `Champ ${j + 1} de « ${sec.name} » invalide`;
      if (!String(q.name || '').trim()) return `Champ ${j + 1} de « ${sec.name} » : intitulé requis`;
      if (!FIELD_TYPES.includes(q.fieldtype)) return `Champ « ${q.name} » : type « ${q.fieldtype} » inconnu (${FIELD_TYPES.join(', ')})`;
      // Conditionnel : « obligatoire si » (case cochée / champ rempli / valeur égale)
      const rule = q.requiredIf;
      if (rule !== undefined && rule !== null) {
        if (typeof rule !== 'object' || Array.isArray(rule)) return `Champ « ${q.name} » : condition invalide (objet attendu)`;
        const src = String(rule.question || '').trim();
        if (!src) return `Champ « ${q.name} » : condition « obligatoire si » sans champ source`;
        if (src === String(q.name || '').trim()) return `Champ « ${q.name} » : la condition ne peut pas viser le champ lui-même`;
        if (!allNames.includes(src)) return `Champ « ${q.name} » : champ source « ${src} » introuvable dans le formulaire`;
        if (rule.equals !== undefined && rule.equals !== null && rule.equals !== ''
          && !['string', 'number', 'boolean'].includes(typeof rule.equals)) {
          return `Champ « ${q.name} » : valeur attendue invalide`;
        }
      }
    }
  }
  return null;
}

// Complète ce qui manque sans toucher aux clés conservées (showRule,
// defaultValues, width…). row renuméroté = l'ordre affiché par FormRequest
// (tri row/col) devient exactement l'ordre du tableau envoyé.
function normalizeSections(sections) {
  return sections.map((sec, i) => ({
    ...sec,
    name: String(sec.name).trim(),
    order: Number.isFinite(sec.order) ? sec.order : i + 1,
    uuid: sec.uuid || crypto.randomUUID(),
    questions: sec.questions.map((q, j) => ({
      ...q,
      name: String(q.name).trim(),
      fieldtype: q.fieldtype,
      required: !!q.required,
      values: q.values ?? null,
      description: q.description || '',
      // Conditionnel : { question, equals? } normalisé, null si absent/vidé
      requiredIf: (q.requiredIf && q.requiredIf.question) ? {
        question: String(q.requiredIf.question).trim(),
        ...(q.requiredIf.equals !== undefined && q.requiredIf.equals !== null && q.requiredIf.equals !== ''
          ? { equals: q.requiredIf.equals } : {}),
      } : null,
      row: j + 1,
      col: Number.isFinite(q.col) ? q.col : 1,
      uuid: q.uuid || crypto.randomUUID(),
    })),
  }));
}

// ── Validation hiérarchique (bloc « Validation supérieure » de l'éditeur) ────
// { enabled, trigger: { question, equals? } } : « quand cet élément est coché
// ou choisi, la demande doit être validée par le supérieur du demandeur ».
// { value } si valide (null = validation désactivée), { error } sinon (400).
function validateApproval(raw, sections) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Validation invalide (objet attendu)' };
  if (raw.enabled === false || raw.enabled === undefined) return { value: null };
  const trigger = raw.trigger;
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
    return { error: 'Validation : déclencheur requis (« quand … »)' };
  }
  const src = String(trigger.question || '').trim();
  if (!src) return { error: 'Validation : déclencheur sans champ source' };
  const allNames = (Array.isArray(sections) ? sections : [])
    .flatMap((s) => (Array.isArray(s?.questions) ? s.questions : []))
    .map((q) => String(q?.name || '').trim());
  if (!allNames.includes(src)) {
    return { error: `Validation : champ source « ${src} » introuvable dans le formulaire` };
  }
  if (trigger.equals !== undefined && trigger.equals !== null && trigger.equals !== ''
    && !['string', 'number', 'boolean'].includes(typeof trigger.equals)) {
    return { error: 'Validation : valeur du déclencheur invalide' };
  }
  const hasEquals = trigger.equals !== undefined && trigger.equals !== null && trigger.equals !== '';
  return {
    value: {
      enabled: true,
      trigger: { question: src, ...(hasEquals ? { equals: trigger.equals } : {}) },
    },
  };
}

// Liste complète (actifs + inactifs) avec compteurs, pour l'éditeur
router.get('/', async (req, res) => {
  const forms = await prisma.formDefinition.findMany({ orderBy: { name: 'asc' } });
  return res.json(forms.map((f) => ({ ...f, ...counts(f) })));
});

// Valide et normalise le bloc d'affectation reçu en POST/PATCH.
// { value } si valide (null = aucune affectation), { error } sinon (400).
async function validateAssignment(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Affectation invalide (objet attendu)' };
  for (const key of Object.keys(raw)) {
    if (!ASSIGN_KEYS.includes(key)) return { error: `Affectation : clé inconnue « ${key} »` };
  }
  const value = {};
  const enums = [
    ['priority', PRIORITIES, 'Priorité'],
    ['type', TICKET_TYPES, 'Type'],
    ['urgency', URGENCY_IMPACT, 'Urgence'],
    ['impact', URGENCY_IMPACT, 'Impact'],
    ['source', SOURCES, 'Source'],
  ];
  for (const [key, allowed, label] of enums) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') continue;
    if (!allowed.includes(String(v))) return { error: `Affectation : ${label} invalide (${allowed.join(', ')})` };
    value[key] = String(v);
  }
  const refs = [
    ['teamId', prisma.team, 'équipe'],
    ['assignedToId', prisma.user, 'technicien'],
    ['locationId', prisma.location, 'lieu'],
  ];
  for (const [key, model, label] of refs) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') continue;
    const id = Number(v);
    if (!Number.isInteger(id)) return { error: `Affectation : ${label} invalide (${v})` };
    const found = await model.findUnique({ where: { id }, select: { id: true } });
    if (!found) return { error: `Affectation : ${label} introuvable (${v})` };
    value[key] = found.id;
  }
  return { value: Object.keys(value).length > 0 ? value : null };
}

// Création d'un formulaire vierge (une section de départ)
router.post('/', requirePermission('tickets.assign'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom du formulaire requis' });
  const sections = req.body?.sections !== undefined ? req.body.sections : [{
    name: 'Section 1', order: 1, uuid: crypto.randomUUID(), questions: [],
  }];
  const err = validateSections(sections);
  if (err) return res.status(400).json({ error: err });
  const assign = await validateAssignment(req.body?.assignment);
  if (assign.error) return res.status(400).json({ error: assign.error });
  const appr = validateApproval(req.body?.approval, sections);
  if (appr.error) return res.status(400).json({ error: appr.error });

  const form = await prisma.formDefinition.create({
    data: {
      name,
      description: req.body?.description || null,
      category: req.body?.category || 'Demande reporting',
      icon: req.body?.icon || null,
      iconColor: req.body?.iconColor || null,
      bgColor: req.body?.bgColor || null,
      isActive: req.body?.isActive !== undefined ? !!req.body.isActive : true,
      sections: normalizeSections(sections),
      assignment: assign.value,
      approval: appr.value,
    },
  });
  return res.status(201).json({ ...form, ...counts(form) });
});

// Mise à jour partielle (nom, description, catégorie, actif, sections/champs)
router.patch('/:id', requirePermission('tickets.assign'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.formDefinition.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Formulaire introuvable' });

  const { name, description, category, icon, iconColor, bgColor, isActive, sections, assignment, approval } = req.body || {};
  const data = {};
  if (name !== undefined) {
    const v = String(name).trim();
    if (!v) return res.status(400).json({ error: 'Nom du formulaire requis' });
    data.name = v;
  }
  if (description !== undefined) data.description = description || null;
  if (category !== undefined) data.category = category || null;
  if (icon !== undefined) data.icon = icon || null;
  if (iconColor !== undefined) data.iconColor = iconColor || null;
  if (bgColor !== undefined) data.bgColor = bgColor || null;
  if (isActive !== undefined) data.isActive = !!isActive;
  if (sections !== undefined) {
    const err = validateSections(sections);
    if (err) return res.status(400).json({ error: err });
    data.sections = normalizeSections(sections);
  }
  if (assignment !== undefined) {
    const assign = await validateAssignment(assignment);
    if (assign.error) return res.status(400).json({ error: assign.error });
    data.assignment = assign.value;
  }
  if (approval !== undefined) {
    // Le déclencheur vise un intitulé : valider contre les sections envoyées
    // ou, à défaut, celles déjà en base (PATCH du seul bloc de validation).
    const appr = validateApproval(approval, sections !== undefined ? sections : existing.sections);
    if (appr.error) return res.status(400).json({ error: appr.error });
    data.approval = appr.value;
  }

  const form = await prisma.formDefinition.update({ where: { id }, data });
  return res.json({ ...form, ...counts(form) });
});

module.exports = router;
