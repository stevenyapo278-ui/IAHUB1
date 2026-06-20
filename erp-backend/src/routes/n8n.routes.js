const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);

// List workflows
router.get('/', async (req, res) => {
  const workflows = await prisma.n8nWorkflow.findMany({ orderBy: { name: 'asc' } });
  return res.json(workflows);
});

// Create workflow (ADMIN only)
router.post('/', requirePermission('automation.manage', ['ADMIN']), [body('name').notEmpty(), body('webhookUrl').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, webhookUrl, description, isActive } = req.body;

  const workflow = await prisma.n8nWorkflow.create({
    data: {
      name,
      webhookUrl,
      description: description || null,
      isActive: isActive !== undefined ? isActive : true,
    },
  });

  return res.status(201).json(workflow);
});

// Update workflow (ADMIN only)
router.patch('/:id', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  const { name, webhookUrl, description, isActive } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (webhookUrl !== undefined) data.webhookUrl = webhookUrl;
  if (description !== undefined) data.description = description;
  if (isActive !== undefined) data.isActive = isActive;

  try {
    const workflow = await prisma.n8nWorkflow.update({ where: { id: Number(req.params.id) }, data });
    return res.json(workflow);
  } catch (err) {
    return res.status(404).json({ error: 'Workflow introuvable' });
  }
});

// Delete workflow (ADMIN only)
router.delete('/:id', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    await prisma.n8nWorkflow.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Workflow introuvable' });
  }
});

// Trigger workflow webhook (ADMIN/TECHNICIAN)
router.post('/:id/trigger', requirePermission('automation.manage', ['ADMIN', 'TECHNICIAN']), async (req, res) => {
  const id = Number(req.params.id);
  const workflow = await prisma.n8nWorkflow.findUnique({ where: { id } });
  if (!workflow) return res.status(404).json({ error: 'Workflow introuvable' });
  if (!workflow.isActive) return res.status(400).json({ error: 'Workflow désactivé' });

  try {
    const response = await fetch(workflow.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggeredBy: req.user.sub,
        triggeredAt: new Date().toISOString(),
        payload: req.body.payload || {},
      }),
    });

    const status = response.ok ? 'success' : 'error';
    await prisma.n8nWorkflow.update({
      where: { id },
      data: { lastRunAt: new Date(), lastStatus: status },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Le workflow a répondu avec le statut ${response.status}` });
    }

    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    return res.json({ success: true, result });
  } catch (err) {
    await prisma.n8nWorkflow.update({
      where: { id },
      data: { lastRunAt: new Date(), lastStatus: 'error' },
    });
    return res.status(502).json({ error: 'Impossible de joindre le webhook n8n' });
  }
});

module.exports = router;
