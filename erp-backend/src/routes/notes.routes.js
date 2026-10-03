const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════════
// Notes personnelles (rail flottant « Mes notes »). Strictement personnelles :
// chaque opération est scopée sur ownerId = utilisateur connecté — pas de
// permission fine, tout utilisateur authentifié gère ses propres notes.
// ═══════════════════════════════════════════════════════════════════════════════

const router = express.Router();
router.use(authenticate);

const TITLE_MAX = 120;
const CONTENT_MAX = 10000;
const MAX_NOTES = 200;

// Valide un champ fourni : absent = ignoré (non modifié), sinon chaîne bornée.
function readField(value, max, label) {
  if (value === undefined) return { skip: true };
  if (typeof value !== 'string') return { error: `${label} doit être une chaîne` };
  if (value.length > max) return { error: `${label} ne peut pas dépasser ${max} caractères` };
  return { value: label === 'Titre' ? value.trim() : value };
}

// Liste mes notes, plus récentes en premier.
router.get('/', async (req, res) => {
  try {
    const notes = await prisma.userNote.findMany({
      where: { ownerId: req.user.sub },
      orderBy: { updatedAt: 'desc' },
      take: MAX_NOTES,
      select: { id: true, title: true, content: true, createdAt: true, updatedAt: true },
    });
    return res.json(notes);
  } catch (err) {
    console.error('[notes] GET échoué:', err.message);
    return res.status(500).json({ error: 'Erreur de chargement des notes' });
  }
});

// Crée une note (titre et/ou contenu).
router.post('/', async (req, res) => {
  try {
    const title = readField(req.body?.title, TITLE_MAX, 'Titre');
    const content = readField(req.body?.content, CONTENT_MAX, 'Contenu');
    if (title.error || content.error) {
      return res.status(400).json({ error: title.error || content.error });
    }
    const count = await prisma.userNote.count({ where: { ownerId: req.user.sub } });
    if (count >= MAX_NOTES) {
      return res.status(400).json({ error: `Limite de ${MAX_NOTES} notes atteinte` });
    }
    const note = await prisma.userNote.create({
      data: {
        ownerId: req.user.sub,
        title: title.skip ? '' : title.value,
        content: content.skip ? '' : content.value,
      },
    });
    return res.status(201).json(note);
  } catch (err) {
    console.error('[notes] POST échoué:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de la note' });
  }
});

// Met à jour ma note (updateMany scopé ownerId : une note d'autrui = 404, sans fuite).
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const title = readField(req.body?.title, TITLE_MAX, 'Titre');
    const content = readField(req.body?.content, CONTENT_MAX, 'Contenu');
    if (title.error || content.error) {
      return res.status(400).json({ error: title.error || content.error });
    }
    const data = {};
    if (!title.skip) data.title = title.value;
    if (!content.skip) data.content = content.value;
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }
    const result = await prisma.userNote.updateMany({
      where: { id, ownerId: req.user.sub },
      data,
    });
    if (result.count === 0) return res.status(404).json({ error: 'Note introuvable' });
    const note = await prisma.userNote.findFirst({ where: { id, ownerId: req.user.sub } });
    return res.json(note);
  } catch (err) {
    console.error('[notes] PUT échoué:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la note' });
  }
});

// Supprime ma note (deleteMany scopé ownerId : une note d'autrui = 404).
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const result = await prisma.userNote.deleteMany({
      where: { id, ownerId: req.user.sub },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Note introuvable' });
    return res.json({ id, deleted: true });
  } catch (err) {
    console.error('[notes] DELETE échoué:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la note' });
  }
});

module.exports = router;
