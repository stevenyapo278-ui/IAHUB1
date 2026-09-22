const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

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

    // Valider les champs obligatoires
    const requiredMissing = [];
    for (const sec of form.sections) {
      for (const q of sec.questions) {
        if (!q.required) continue;
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
    const content = lines.join('\n');

    // Titre = OBJET DE LA DEMANDE ou fallback
    const title = (answers['OBJET DE LA DEMANDE'] || form.name || 'Demande').toString().toUpperCase().slice(0, 200);

    const ticket = await prisma.ticket.create({
      data: {
        title,
        content,
        status: 'NEW',
        priority: 'P3',
        type: 'REQUEST',
        source: 'Formulaire',
        origin: 'PORTAIL',
        category: 'Demande reporting',
        createdById: req.user.sub,
        requesterId: req.user.sub,
        requesterIds: [req.user.sub],
      },
    });

    await prisma.formSubmission.create({
      data: { formId, ticketId: ticket.id, submittedById: req.user.sub, answers },
    });

    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, type: 'CREATED', actor: req.user.email || String(req.user.sub), payload: { formId, formName: form.name } },
    }).catch(() => {});

    return res.status(201).json({ ticketId: ticket.id, ticket });
  } catch (err) {
    console.error('[formRequest] submit:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la soumission : ' + err.message });
  }
});

module.exports = router;
