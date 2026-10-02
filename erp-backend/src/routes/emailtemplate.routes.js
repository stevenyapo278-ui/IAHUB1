const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { EMAIL_TEMPLATE_REGISTRY } = require('../services/emailTemplateRegistry');
const { getTemplateOverrides } = require('../services/emailTemplates');
const { buildTemplateSample } = require('../services/emailTemplateSamples');
const { getEmailSignature } = require('../services/emailSender');
const { getSystemSettings, resolveFrontendUrl } = require('../services/systemSettings');

// ═══════════════════════════════════════════════════════════════════════════════
// Templates d'emails de notification — consultation et édition du contenu
// (Paramètres > Notifications > « Contenu des emails »).
// GET : liste fusionnée défauts (registre) + surcharges (table EmailTemplate) avec
// un aperçu rendu sur des données d'échantillon. PUT/DELETE : écrire / réinitialiser
// une surcharge (permission automation.manage, la même que l'onglet Notifications).
// ═══════════════════════════════════════════════════════════════════════════════

const router = express.Router();
router.use(authenticate);

const SUBJECT_MAX = 300;
const MESSAGE_MAX = 20000;

// Liste complète : métadonnées + surcharge courante + aperçu (sujet + HTML rendu).
router.get('/', async (req, res) => {
  try {
    const [overrides, settings, signature] = await Promise.all([
      getTemplateOverrides(),
      getSystemSettings(),
      getEmailSignature(),
    ]);
    const frontendUrl = resolveFrontendUrl(settings);
    const items = [];
    for (const [key, meta] of Object.entries(EMAIL_TEMPLATE_REGISTRY)) {
      const override = overrides[key] || null;
      const sample = await buildTemplateSample(key, { override, signature, frontendUrl, recipientName: 'Test' });
      items.push({
        key,
        label: meta.label,
        category: meta.category,
        description: meta.description,
        toggleKey: meta.toggleKey,
        placeholders: meta.placeholders,
        defaultSubject: meta.defaultSubject,
        defaultMessage: meta.defaultMessage,
        subjectExamples: meta.subjectExamples || [],
        isCustom: Boolean(override && (override.subject || override.message)),
        subject: override?.subject || '',
        message: override?.message || '',
        previewSubject: sample?.subject || '',
        previewHtml: sample?.html || '',
      });
    }
    res.json(items);
  } catch (err) {
    console.error('[emailtemplates] GET échoué:', err.message);
    res.status(500).json({ error: 'Erreur de chargement des templates' });
  }
});

// Enregistre (ou vide) la surcharge d'une clé. subject/message vides → le champ repasse
// au défaut ; les deux vides → la ligne est supprimée (retour complet au défaut).
router.put('/:key', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const { key } = req.params;
    if (!EMAIL_TEMPLATE_REGISTRY[key]) {
      return res.status(404).json({ error: 'Template inconnu' });
    }
    const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (subject.length > SUBJECT_MAX) {
      return res.status(400).json({ error: `L'objet ne peut pas dépasser ${SUBJECT_MAX} caractères` });
    }
    if (message.length > MESSAGE_MAX) {
      return res.status(400).json({ error: `Le message ne peut pas dépasser ${MESSAGE_MAX} caractères` });
    }
    if (!subject && !message) {
      await prisma.emailTemplate.deleteMany({ where: { key } });
      return res.json({ key, subject: null, message: null, isCustom: false });
    }
    const row = await prisma.emailTemplate.upsert({
      where: { key },
      create: { key, subject: subject || null, message: message || null },
      update: { subject: subject || null, message: message || null },
    });
    return res.json({ key: row.key, subject: row.subject, message: row.message, isCustom: true });
  } catch (err) {
    console.error('[emailtemplates] PUT échoué:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'enregistrement du template' });
  }
});

// Supprime la surcharge : l'email repart du gabarit par défaut.
router.delete('/:key', requirePermission('automation.manage', ['ADMIN']), async (req, res) => {
  try {
    const { key } = req.params;
    if (!EMAIL_TEMPLATE_REGISTRY[key]) {
      return res.status(404).json({ error: 'Template inconnu' });
    }
    await prisma.emailTemplate.deleteMany({ where: { key } });
    return res.json({ key, reset: true });
  } catch (err) {
    console.error('[emailtemplates] DELETE échoué:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la réinitialisation du template' });
  }
});

module.exports = router;
