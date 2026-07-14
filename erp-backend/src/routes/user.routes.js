const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate, authorizeAdmin } = require('../middleware/auth');
const { sendTemporaryPasswordEmail } = require('../services/emailSender');
const { ADMIN_LIKE_ROLES } = require('../config/permissions');

const MIN_PASSWORD_LENGTH = 8;

// Matrice de rôles assignables : SUPERADMIN peut tout assigner ; ADMIN ne peut assigner que
// TECHNICIAN/REQUESTER (jamais ADMIN ni SUPERADMIN, y compris en éditant un compte déjà à ce niveau)
// — sinon un ADMIN pourrait se créer des pairs ou des supérieurs sans validation d'un SUPERADMIN.
const ASSIGNABLE_ROLES_BY_ACTOR = {
  SUPERADMIN: ['SUPERADMIN', 'ADMIN', 'TECHNICIAN', 'REQUESTER'],
  ADMIN: ['TECHNICIAN', 'REQUESTER'],
};

function canAssignRole(actorRole, targetRole) {
  return (ASSIGNABLE_ROLES_BY_ACTOR[actorRole] || []).includes(targetRole);
}

// Un ADMIN ne doit pas pouvoir modifier/supprimer/réinitialiser un compte ADMIN ou SUPERADMIN
// existant, même sans toucher au champ role — sinon il pourrait par ex. désactiver ou supprimer un
// SUPERADMIN. SUPERADMIN n'a aucune restriction de cible.
function canActOnTarget(actorRole, targetRole) {
  if (actorRole === 'SUPERADMIN') return true;
  return !ADMIN_LIKE_ROLES.includes(targetRole);
}

const router = express.Router();
router.use(authenticate);
router.use(authorizeAdmin);

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
  const { search, limit } = req.query;
  const where = {};
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } }
    ];
  }
  const users = await prisma.user.findMany({
    where,
    take: limit ? Number(limit) : undefined,
    select: userSelect,
    orderBy: { fullName: 'asc' },
  });
  return res.json(users);
});

router.post(
  '/',
  [
    body('email').trim().isEmail().withMessage('Email invalide'),
    body('password').isLength({ min: MIN_PASSWORD_LENGTH }).withMessage(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`),
    body('fullName').trim().notEmpty().withMessage('Le nom complet est requis'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, fullName, role, teamId } = req.body;
    const targetRole = role || 'REQUESTER';

    if (!canAssignRole(req.user.role, targetRole)) {
      return res.status(403).json({ error: `Vous ne pouvez pas créer un compte avec le rôle ${targetRole}` });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: targetRole,
        teamId: teamId || null,
      },
      select: userSelect,
    });

    return res.status(201).json(user);
  }
);

router.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: Number(req.params.id) },
    select: userSelect,
  });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  return res.json(user);
});

router.patch(
  '/:id',
  [
    body('email').optional().trim().isEmail().withMessage('Email invalide'),
    body('fullName').optional().trim().notEmpty().withMessage('Le nom complet ne peut pas être vide'),
    body('password').optional().isLength({ min: MIN_PASSWORD_LENGTH }).withMessage(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`),
    body('teamId').optional({ values: 'null' }).customSanitizer(value => value === null ? null : Number(value)).isInt({ min: 1 }).withMessage('teamId doit être un entier positif ou null'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, fullName, role, teamId, isActive, receiveDraftAlerts, password } = req.body;

    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) }, select: { role: true } });
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (!canActOnTarget(req.user.role, target.role)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas modifier un compte administrateur ou super-administrateur' });
    }
    if (role !== undefined && !canAssignRole(req.user.role, role)) {
      return res.status(403).json({ error: `Vous ne pouvez pas attribuer le rôle ${role}` });
    }

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
  }
);

// Réinitialise le mot de passe d'un utilisateur : génère un mot de passe temporaire, le hash et
// l'enregistre, force mustChangePassword (l'utilisateur devra le changer dès sa prochaine
// connexion), puis envoie le mot de passe temporaire par email.
router.post('/:id/reset-password', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!canActOnTarget(req.user.role, user.role)) {
    return res.status(403).json({ error: 'Vous ne pouvez pas réinitialiser le mot de passe d\'un compte administrateur ou super-administrateur' });
  }

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
  const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) }, select: { role: true } });
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!canActOnTarget(req.user.role, target.role)) {
    return res.status(403).json({ error: 'Vous ne pouvez pas supprimer un compte administrateur ou super-administrateur' });
  }

  try {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
});

module.exports = router;
module.exports.canAssignRole = canAssignRole;
module.exports.canActOnTarget = canActOnTarget;
