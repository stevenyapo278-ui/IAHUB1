const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const { authenticate, authorize } = require('../middleware/auth');
const { sendTemporaryPasswordEmail } = require('../services/emailSender');

const MIN_PASSWORD_LENGTH = 8;

const router = express.Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

// Génère un mot de passe temporaire lisible (évite les caractères ambigus 0/O/1/l/I) mais
// suffisamment fort, respectant le minimum de 8 caractères imposé partout ailleurs.
function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars[crypto.randomInt(chars.length)];
  return pwd;
}

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  teamId: true,
  isActive: true,
  receiveDraftAlerts: true,
  team: { select: { id: true, name: true } },
  createdAt: true,
};

router.get('/', async (req, res) => {
  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: { fullName: 'asc' },
  });
  return res.json(users);
});

router.post('/', async (req, res) => {
  const { email, password, fullName, role, teamId } = req.body;

  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'Email, mot de passe et nom complet sont requis' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      role: role || 'REQUESTER',
      teamId: teamId || null,
    },
    select: userSelect,
  });

  return res.status(201).json(user);
});

router.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: Number(req.params.id) },
    select: userSelect,
  });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  return res.json(user);
});

router.patch('/:id', async (req, res) => {
  const { email, fullName, role, teamId, isActive, receiveDraftAlerts, password } = req.body;
  const data = {};
  if (email !== undefined) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== Number(req.params.id)) {
      return res.status(409).json({ error: 'Un autre utilisateur utilise déjà cet email' });
    }
    data.email = email;
  }
  if (fullName !== undefined) data.fullName = fullName;
  if (role !== undefined) data.role = role;
  if (teamId !== undefined) data.teamId = teamId;
  if (isActive !== undefined) data.isActive = isActive;
  if (receiveDraftAlerts !== undefined) data.receiveDraftAlerts = receiveDraftAlerts;
  if (password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` });
    }
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  try {
    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data,
      select: userSelect,
    });
    return res.json(user);
  } catch (err) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
});

// Réinitialise le mot de passe d'un utilisateur : génère un mot de passe temporaire, le hash et
// l'enregistre, force mustChangePassword (l'utilisateur devra le changer dès sa prochaine
// connexion), puis envoie le mot de passe temporaire par email.
router.post('/:id/reset-password', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: true },
  });

  try {
    await sendTemporaryPasswordEmail({ recipientEmail: user.email, recipientName: user.fullName, temporaryPassword });
  } catch (err) {
    return res.status(502).json({ error: `Mot de passe réinitialisé mais échec de l'envoi de l'email : ${err.message}` });
  }

  return res.json({ ok: true, message: `Nouveau mot de passe envoyé à ${user.email}` });
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
});

module.exports = router;
