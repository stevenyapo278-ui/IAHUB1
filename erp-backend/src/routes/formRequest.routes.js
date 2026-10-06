const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { applySla } = require('../services/slaService');
const { evaluateCondition } = require('../utils/conditions');
const { isValidEmail, validateEmailList } = require('../utils/emails');
const { MANAGER_KEY, CC_KEY, sendManagerApprovalEmail } = require('../services/hierarchicalApproval');

const router = express.Router();

// GET /api/form-requests — liste des formulaires actifs (tout utilisateur authentifié)
router.get('/', authenticate, async (req, res) => {
  try {
    const forms = await prisma.formDefinition.findMany({
      where: { isActive: true },
      select: { id: true, name: true, description: true, icon: true, iconColor: true, bgColor: true, category: true, glpiUuid: true },
      orderBy: { name: 'asc' },
    });
    return res.json(forms);
  } catch (err) {
    console.error('[formRequest] list:', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement des formulaires' });
  }
});

// GET /api/form-requests/:id — définition complète d'un formulaire (sections + questions)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const form = await prisma.formDefinition.findUnique({ where: { id: Number(req.params.id) } });
    if (!form) return res.status(404).json({ error: 'Formulaire introuvable' });
    return res.json(form);
  } catch (err) {
    console.error('[formRequest] get:', err.message);
    return res.status(500).json({ error: 'Erreur' });
  }
});

// POST /api/form-requests/:id/submit — soumettre le formulaire -> crée un Ticket
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const formId = Number(req.params.id);
    const form = await prisma.formDefinition.findUnique({ where: { id: formId } });
    if (!form) return res.status(404).json({ error: 'Formulaire introuvable' });

    const answers = req.body.answers;
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Réponses manquantes' });

    // Conditionnel « obligatoire si » : le champ devient obligatoire quand la
    // règle est satisfaite — case cochée / champ rempli (sans valeur attendue)
    // ou valeur égale à `equals` (sélecteur) ou présente dans le tableau
    // (liste multiple). Logique partagée (utils/conditions.js) — même
    // implémentation que conditionMet() dans FormRequest.jsx.
    const requiredIfMet = (q) => evaluateCondition(q.requiredIf, answers);

    // Valider les champs obligatoires
    const requiredMissing = [];
    for (const sec of form.sections) {
      for (const q of sec.questions) {
        if (!q.required && !requiredIfMet(q)) continue;
        const val = answers[q.name];
        const isEmpty = val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
        // Exception: la fréquence n'est obligatoire que si NATURE = RÉCURRENTE
        if (q.name.includes('FRÉQUENCE') && answers['NATURE DE REQUETE'] !== 'RÉCURRENTE') continue;
        if (isEmpty) requiredMissing.push(q.name);
      }
    }
    if (requiredMissing.length > 0) {
      return res.status(400).json({ error: `Champs obligatoires manquants: ${requiredMissing.join(', ')}` });
    }

    // ── Validation hiérarchique (bloc « Validation supérieure » de l'éditeur) ──
    // Quand la condition déclencheuse est vraie, le demandeur a dû renseigner
    // l'e-mail de son supérieur (+ copies) : validé AVANT toute création pour
    // ne jamais laisser un ticket sans demande de validation possible.
    const approvalCfg = (form.approval && typeof form.approval === 'object' && !Array.isArray(form.approval))
      ? form.approval : null;
    const approvalActive = !!(approvalCfg && approvalCfg.enabled
      && evaluateCondition(approvalCfg.trigger, answers));
    let managerEmail = null;
    let ccList = [];
    if (approvalActive) {
      managerEmail = String(answers[MANAGER_KEY] || '').trim();
      if (!isValidEmail(managerEmail)) {
        return res.status(400).json({ error: `Validation supérieure : adresse e-mail du supérieur hiérarchique invalide ou manquante (${MANAGER_KEY})` });
      }
      const ccCheck = validateEmailList(answers[CC_KEY]);
      if (ccCheck.invalid.length > 0) {
        return res.status(400).json({ error: `Validation supérieure : adresse(s) en copie invalide(s) : ${ccCheck.invalid.join(', ')}` });
      }
      ccList = ccCheck.list;
    }

    // ── Affectation automatique (bloc « Affectation » de l'éditeur, Paramètres) ──
    // Ces valeurs ne sont jamais saisies par le demandeur : l'administrateur les
    // configure par formulaire et elles sont appliquées à chaque soumission
    // (équipe, technicien, priorité, type, urgence, impact, lieu, source).
    const assign = (form.assignment && typeof form.assignment === 'object' && !Array.isArray(form.assignment))
      ? form.assignment : {};
    const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    const TICKET_TYPES = ['INCIDENT', 'REQUEST'];
    const URGENCY_IMPACT = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'MAJOR'];
    const SOURCES = ['Direct', 'Email', 'Formcreator', 'Helpdesk', 'Phone', 'Other'];
    const pick = (v, allowed, dflt) => (v !== undefined && v !== null && allowed.includes(String(v)) ? String(v) : dflt);
    const asId = (v) => (v !== undefined && v !== null && v !== '' && Number.isInteger(Number(v)) ? Number(v) : null);

    const priority = pick(assign.priority, PRIORITIES, 'P3');
    const type = pick(assign.type, TICKET_TYPES, 'REQUEST');
    const urgency = pick(assign.urgency, URGENCY_IMPACT, 'MEDIUM');
    const impact = pick(assign.impact, URGENCY_IMPACT, 'MEDIUM');
    const source = pick(assign.source, SOURCES, 'Formulaire');

    // Équipe : doit exister ; hérite de ses observateurs par défaut (comme POST /tickets).
    // Ressource supprimée depuis la configuration → on laisse la propriété vide
    // plutôt que de bloquer la soumission du demandeur (qui ne peut rien corriger).
    const teamIdWanted = asId(assign.teamId);
    let teamId = null;
    let observerIds = [];
    if (teamIdWanted !== null) {
      const team = await prisma.team.findUnique({
        where: { id: teamIdWanted },
        include: { defaultObservers: { select: { id: true } } },
      });
      if (team) { teamId = team.id; observerIds = (team.defaultObservers || []).map((o) => o.id); }
      else console.warn(`[formRequest] Affectation: équipe ${teamIdWanted} introuvable, ticket non affecté`);
    }

    const techIdWanted = asId(assign.assignedToId);
    let technicianId = null;
    if (techIdWanted !== null) {
      const tech = await prisma.user.findUnique({ where: { id: techIdWanted }, select: { id: true, fullName: true } });
      if (tech) technicianId = tech.id;
      else console.warn(`[formRequest] Affectation: technicien ${techIdWanted} introuvable, ticket non attribué`);
    }

    const locIdWanted = asId(assign.locationId);
    let locationId = null;
    let locationName = null;
    if (locIdWanted !== null) {
      const loc = await prisma.location.findUnique({
        where: { id: locIdWanted },
        select: { id: true, name: true, completename: true },
      });
      if (loc) { locationId = loc.id; locationName = loc.completename || loc.name; }
      else console.warn(`[formRequest] Affectation: lieu ${locIdWanted} introuvable, ticket sans lieu`);
    }

    // Construire le contenu du ticket (texte structuré)
    const lines = [`Demande via formulaire : ${form.name}`, ''];
    for (const sec of form.sections) {
      lines.push(`━━━ ${sec.name} ━━━`);
      for (const q of sec.questions) {
        const val = answers[q.name];
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
        const displayVal = Array.isArray(val) ? val.join(', ') : String(val);
        lines.push(`${q.name} : ${displayVal}`);
      }
      lines.push('');
    }
    // La validation hiérarchique n'est pas un champ du formulaire : ces réponses
    // sont injectées par FormRequest.jsx et tracées dans le contenu du ticket.
    if (approvalActive) {
      lines.push('━━━ VALIDATION SUPÉRIEURE ━━━');
      lines.push(`${MANAGER_KEY} : ${managerEmail}`);
      if (ccList.length > 0) lines.push(`${CC_KEY} : ${ccList.join(', ')}`);
      lines.push('');
    }
    const content = lines.join('\n');

    // Titre = OBJET DE LA DEMANDE ou fallback
    const title = (answers['OBJET DE LA DEMANDE'] || form.name || 'Demande').toString().toUpperCase().slice(0, 200);

    const ticket = await prisma.ticket.create({
      data: {
        title,
        content,
        status: 'NEW',
        priority,
        type,
        urgency,
        impact,
        source,
        origin: 'PORTAIL',
        category: 'Demande reporting',
        // Validation hiérarchique en attente : visible dans le Centre de
        // Validation tant que le supérieur n'a pas répondu.
        ...(approvalActive ? { approvalStatus: 'PENDING' } : {}),
        teamId,
        assignedToId: technicianId,
        locationId,
        locationName,
        createdById: req.user.sub,
        requesterId: req.user.sub,
        requesterIds: [req.user.sub],
        ...(technicianId ? { assignees: { connect: [{ id: technicianId }] } } : {}),
        ...(observerIds.length > 0 ? { observers: { connect: observerIds.map((id) => ({ id })) } } : {}),
      },
    });

    // SLA : échéances calculées à la création (comme POST /tickets)
    try { await applySla(ticket); } catch (err) { console.error('[formRequest] Calcul SLA échoué:', err.message); }

    await prisma.formSubmission.create({
      data: { formId, ticketId: ticket.id, submittedById: req.user.sub, answers },
    });

    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, type: 'CREATED', actor: req.user.email || String(req.user.sub), payload: { formId, formName: form.name } },
    }).catch(() => {});

    // ── Validation hiérarchique : enregistrement + e-mail au supérieur ───────
    // Best effort : le ticket est déjà créé ; une panne de boîte mail ne doit
    // pas faire échouer la soumission (erreur journalisée, à relancer côté admin).
    if (approvalActive) {
      try {
        const record = await prisma.ticketApproval.create({
          data: { ticketId: ticket.id, formId, managerEmail, cc: ccList, status: 'PENDING' },
        });
        const requesterName = String(answers['NOM DU DEMANDEUR'] || '').trim();
        sendManagerApprovalEmail({ ticket, approval: record, requesterName })
          .catch((err) => console.error(`[formRequest] Échec email validation supérieure (ticket ${ticket.id}):`, err.message));
      } catch (err) {
        console.error(`[formRequest] Échec enregistrement validation supérieure (ticket ${ticket.id}):`, err.message);
      }
    }

    return res.status(201).json({ ticketId: ticket.id, ticket });
  } catch (err) {
    console.error('[formRequest] submit:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la soumission : ' + err.message });
  }
});

module.exports = router;
