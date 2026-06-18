const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  teamId: true,
  isActive: true,
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
  const { fullName, role, teamId, isActive, password } = req.body;
  const data = {};
  if (fullName !== undefined) data.fullName = fullName;
  if (role !== undefined) data.role = role;
  if (teamId !== undefined) data.teamId = teamId;
  if (isActive !== undefined) data.isActive = isActive;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

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

router.delete('/:id', async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
});

module.exports = router;
