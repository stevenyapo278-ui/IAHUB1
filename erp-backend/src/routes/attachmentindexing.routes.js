const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { auditLog } = require('../services/auditLogService');
const {
  getAttachmentIndexingStats,
  backfillAttachmentIndex,
} = require('../services/attachmentIndexer');
const { getActiveProviders } = require('../services/mailAnalyzer');

// Pilotage de l'extraction / indexation RAG des pièces jointes (Paramètres > Automatisation).
// Monté sans cache de réponse : les compteurs doivent refléter immédiatement un rattrapage
// lancé depuis l'interface.
const router = express.Router();
router.use(authenticate);

// GET /api/attachment-indexing — interrupteur + compteurs par statut d'extraction
router.get('/', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  const stats = await getAttachmentIndexingStats();
  let visionAvailable = false;
  try {
    visionAvailable = (await getActiveProviders()).length > 0;
  } catch { /* base IA indisponible : on n'empêche pas l'affichage des compteurs */ }
  return res.json({ ...stats, visionAvailable });
});

// POST /api/attachment-indexing/backfill — traite tout de suite un lot de PJ en attente
// (même logique que le job périodique, sans attendre les 10 minutes).
router.post('/backfill', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  const requested = Number.parseInt(req.body?.batchSize, 10);
  const batchSize = [5, 10, 25].includes(requested) ? requested : 10;

  const result = await backfillAttachmentIndex({ batchSize });
  auditLog('ATTACHMENT_INDEX_BACKFILL', {
    actor: req.user,
    targetType: 'TicketAttachment',
    targetId: null,
    targetLabel: 'Rattrapage indexation pièces jointes',
    metadata: result,
  }).catch(() => {});

  const stats = await getAttachmentIndexingStats();
  return res.json({ result, stats });
});

// PATCH /api/attachment-indexing — suspend / reprend l'extraction
// (le job périodique et les indexations à la réception de mail ou à l'upload suivent).
router.patch(
  '/',
  requirePermission('automation.manage', ['ADMIN']),
  [body('enabled').isBoolean()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await prisma.systemSettings.upsert({
      where: { id: 1 },
      update: { attachmentIndexEnabled: req.body.enabled },
      create: { id: 1, attachmentIndexEnabled: req.body.enabled },
    });

    auditLog('ATTACHMENT_INDEX_TOGGLED', {
      actor: req.user,
      targetType: 'SystemSettings',
      targetId: 1,
      targetLabel: req.body.enabled ? 'Indexation des pièces jointes activée' : 'Indexation des pièces jointes suspendue',
      metadata: { enabled: req.body.enabled },
    }).catch(() => {});

    return res.json(await getAttachmentIndexingStats());
  }
);

module.exports = router;
