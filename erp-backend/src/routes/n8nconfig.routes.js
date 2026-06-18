const express = require('express');
const prisma = require('../prismaClient');

const router = express.Router();

// Vérifie le secret partagé utilisé par n8n pour récupérer la configuration (clés API, comptes email)
function authenticateN8n(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Secret webhook invalide' });
  }
  next();
}

router.use(authenticateN8n);

// Retourne la clé API active par défaut pour un fournisseur IA (ex: gemini, nvidia, openai)
router.get('/ai-key/:providerName', async (req, res) => {
  const provider = await prisma.aiProvider.findUnique({
    where: { name: req.params.providerName },
    include: {
      models: true,
      keys: { where: { isActive: true }, include: { model: true } },
    },
  });

  if (!provider || !provider.isActive) {
    return res.status(404).json({ error: 'Fournisseur introuvable ou inactif' });
  }

  const key = provider.keys.find((k) => k.isDefault) || provider.keys[0];
  if (!key) return res.status(404).json({ error: 'Aucune clé API configurée pour ce fournisseur' });

  const model = provider.models.find((m) => m.isDefault) || provider.models.find((m) => m.id === key.modelId);

  return res.json({
    provider: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: key.apiKey,
    model: model?.name || null,
  });
});

// Retourne le compte email par défaut (Outlook/Gmail/IMAP) utilisé pour l'envoi/réception
router.get('/email-account', async (req, res) => {
  const account = await prisma.emailAccount.findFirst({
    where: { isDefault: true, isActive: true },
  });

  if (!account) return res.status(404).json({ error: 'Aucun compte email par défaut configuré' });

  return res.json(account);
});

// Enregistre l'email d'origine (expéditeur, sujet) ayant déclenché la création d'un ticket GLPI
router.post('/ticket-source', async (req, res) => {
  const { glpiTicketId, sourceEmail, sourceName, sourceSubject } = req.body;
  if (!glpiTicketId || !sourceEmail) {
    return res.status(400).json({ error: 'glpiTicketId et sourceEmail sont requis' });
  }

  const ticket = await prisma.ticket.findUnique({ where: { glpiTicketId: Number(glpiTicketId) } });
  if (!ticket) return res.status(404).json({ error: 'Ticket introuvable pour ce glpiTicketId' });

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { sourceEmail, sourceName: sourceName || null, sourceSubject: sourceSubject || null },
  });

  return res.json(updated);
});

module.exports = router;
