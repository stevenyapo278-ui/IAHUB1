const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { getUserPermissions } = require('../middleware/permissions');

const router = express.Router();

router.post(
  '/register',
  [
    body('email').trim().isEmail(),
    body('password').isLength({ min: 8 }),
    body('fullName').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const email = req.body.email.trim().toLowerCase();
    const { password, fullName, role, teamId } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: role || 'REQUESTER',
        teamId: teamId || null,
      },
    });

    return res.status(201).json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    });
  }
);

router.post(
  '/login',
  [body('email').trim().isEmail(), body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, teamId: user.teamId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    let permissions = null;
    if (user.role !== 'ADMIN') {
      const groupCount = await prisma.permissionGroup.count({ where: { members: { some: { id: user.id } } } });
      if (groupCount > 0) {
        permissions = Array.from(await getUserPermissions(user.id));
      }
    }

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        teamId: user.teamId,
        permissions,
      },
    });
  }
);

// "permissions" : liste effective des clés de permission de l'utilisateur, calculée selon la même
// règle que requirePermission() — ADMIN a accès à tout (toutes les clés renvoyées), sinon seules
// les permissions des groupes auxquels il appartient (ou aucune s'il n'est dans aucun groupe et
// que le frontend doit alors se baser sur req.user.role pour les permissions par défaut du rôle).
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { id: true, email: true, fullName: true, role: true, teamId: true, isActive: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }

  let permissions = null; // null = pas de groupe, le frontend retombe sur les règles par rôle
  if (user.role !== 'ADMIN') {
    const groupCount = await prisma.permissionGroup.count({ where: { members: { some: { id: user.id } } } });
    if (groupCount > 0) {
      permissions = Array.from(await getUserPermissions(user.id));
    }
  }

  return res.json({ ...user, permissions });
});

module.exports = router;
