const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { getUserPermissions } = require('../middleware/permissions');
const { sendPasswordResetLinkEmail } = require('../services/emailSender');
const { auditLog } = require('../services/auditLogService');
const { isLdapEnabled, isLdapAdminUsername, ldapEmailFor, authenticateLdap } = require('../services/ldapAuth');

const router = express.Router();

const PASSWORD_RESET_TOKEN_TTL_HOURS = 1; // court délai : ce token donne accès à la définition d'un nouveau mot de passe

// Domaine email optionnel : permet la connexion avec l'identifiant seul (ex. « styapo »)
// au lieu de l'adresse complète (ex. « styapo@prosuma.ci »). Vide = désactivé.
const AUTH_EMAIL_DOMAIN = process.env.AUTH_EMAIL_DOMAIN?.trim() || '';

function resolveLoginIdentifier(input) {
  const value = String(input).trim().toLowerCase();
  if (value.includes('@')) return value;
  return AUTH_EMAIL_DOMAIN ? `${value}@${AUTH_EMAIL_DOMAIN}` : value;
}

router.post(
  '/register',
  [
    body('email').trim().isEmail(),
    body('password').isLength({ min: 8 }).custom((v) => {
      if (!/(?=.*[a-z])/.test(v)) throw new Error('une minuscule');
      if (!/(?=.*[A-Z])/.test(v)) throw new Error('une majuscule');
      if (!/(?=.*\d)/.test(v)) throw new Error('un chiffre');
      if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(v)) throw new Error('un caractère spécial');
      return true;
    }).withMessage('Le mot de passe doit contenir au moins 8 caractères avec une majuscule, une minuscule, un chiffre et un caractère spécial.'),
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
    auditLog('USER_REGISTERED', { actor: { sub: user.id, email: user.email, role: user.role }, targetType: 'User', targetId: user.id, targetLabel: user.fullName || user.email }).catch(() => {});
  }
);

router.post(
  '/login',
  // « email » accepte aussi un simple identifiant (ex. «styapo ») quand AUTH_EMAIL_DOMAIN est défini
  [body('email').trim().notEmpty(), body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const normalizedEmail = resolveLoginIdentifier(req.body.email);
    const { password } = req.body;

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    // Pas de filtre sur authProvider ici : un compte « local » adopté par la synchro
    // annuaire (authProvider passé à 'ldap') conserve son mot de passe d'origine et
    // doit toujours pouvoir s'en servir. Les comptes créés par JIT/synchro ont un
    // hash aléatoire inviolable — le bcrypt échouera naturellement pour eux.
    if (user && user.isActive) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (valid) {
        const token = jwt.sign(
          { sub: user.id, email: user.email, role: user.role, teamId: user.teamId },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
        );

        let permissions = null;
        if (user.role !== 'SUPERADMIN') {
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
            mustChangePassword: user.mustChangePassword,
          },
        });
      }
    }

    // Fallback LDAP/Active Directory (même patron que le projet GESTION_ACCESS).
    // Si LDAP_ENABLED=true, on tente le bind AD avec « username@domaine » : si un compte local
    // a échoué (mauvais mot de passe), le mot de passe AD prime si le bind réussit.
    if (isLdapEnabled()) {
      const username = normalizedEmail.split('@')[0];
      const ldapUser = await authenticateLdap(username, password);
      if (ldapUser) {
        const isAdmin = isLdapAdminUsername(ldapUser.username);
        let account = await prisma.user.findUnique({ where: { email: ldapUser.email } });

        if (!account) {
          // Auto-provisioning : tout compte AD valide obtient un compte dans l'ERP.
          // Mot de passe aléatoire : la connexion locale est impossible pour ce compte.
          account = await prisma.user.create({
            data: {
              email: ldapUser.email,
              passwordHash: bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10),
              fullName: ldapUser.username,
              role: isAdmin ? 'ADMIN' : 'REQUESTER',
              isActive: true,
              mustChangePassword: false,
              authProvider: 'ldap',
            },
          });
        } else {
          if (!account.isActive) {
            return res.status(401).json({ error: 'Identifiants invalides' });
          }
          account = await prisma.user.update({
            where: { id: account.id },
            data: {
              authProvider: 'ldap',
              // Les usernames listés dans LDAP_ADMIN_USERNAMES reprennent le rôle ADMIN à
              // chaque connexion ; les autres conservent leur rôle actuel.
              role: isAdmin ? 'ADMIN' : account.role,
            },
          });
        }

        const token = jwt.sign(
          { sub: account.id, email: account.email, role: account.role, teamId: account.teamId },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
        );

        let permissions = null;
        if (account.role !== 'SUPERADMIN') {
          const groupCount = await prisma.permissionGroup.count({ where: { members: { some: { id: account.id } } } });
          if (groupCount > 0) {
            permissions = Array.from(await getUserPermissions(account.id));
          }
        }

        return res.json({
          token,
          user: {
            id: account.id,
            email: account.email,
            fullName: account.fullName,
            role: account.role,
            teamId: account.teamId,
            permissions,
            mustChangePassword: account.mustChangePassword,
          },
        });
      }
    }

    return res.status(401).json({ error: 'Identifiants invalides' });
    auditLog('USER_LOGIN', { actor: { sub: user.id, email: user.email, role: user.role }, targetType: 'User', targetId: user.id, targetLabel: user.fullName || user.email }).catch(() => {});
  }
);

// Déclenche l'envoi d'un lien de réinitialisation par email. Répond toujours 200 même si l'email
// n'existe pas (pas de fuite d'information sur les comptes existants).
router.post('/forgot-password', [body('email').trim().isEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const email = req.body.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.isActive) {
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000) },
    });
    try {
      await sendPasswordResetLinkEmail({ recipientEmail: user.email, recipientName: user.fullName, resetToken: token });
    } catch (err) {
      console.error(`[auth] Échec envoi lien de réinitialisation à ${user.email}:`, err.message);
    }
  }

  return res.json({ ok: true, message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
});

// Vérifie qu'un token de réinitialisation est valide (utilisé par la page ResetPassword pour
// afficher le formulaire ou un message d'erreur, avant même que l'utilisateur tape son nouveau mot de passe).
router.get('/reset-password/:token', async (req, res) => {
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: req.params.token } });
  if (!resetToken) return res.status(410).json({ error: 'Lien invalide.' });
  if (resetToken.usedAt) return res.status(410).json({ error: 'Ce lien a déjà été utilisé.' });
  if (resetToken.expiresAt < new Date()) return res.status(410).json({ error: 'Ce lien a expiré.' });
  return res.json({ ok: true });
});

router.post('/reset-password/:token', [body('password').isLength({ min: 8 }).custom((v) => {
  if (!/(?=.*[a-z])/.test(v)) throw new Error('une minuscule');
  if (!/(?=.*[A-Z])/.test(v)) throw new Error('une majuscule');
  if (!/(?=.*\d)/.test(v)) throw new Error('un chiffre');
  if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(v)) throw new Error('un caractère spécial');
  return true;
})], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: req.params.token } });
  if (!resetToken) return res.status(410).json({ error: 'Lien invalide.' });
  if (resetToken.usedAt) return res.status(410).json({ error: 'Ce lien a déjà été utilisé.' });
  if (resetToken.expiresAt < new Date()) return res.status(410).json({ error: 'Ce lien a expiré.' });

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash, mustChangePassword: false } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
  ]);

  return res.json({ ok: true });
});

// Permet à un utilisateur déjà connecté (typiquement après mustChangePassword: true) de définir
// son nouveau mot de passe en confirmant l'ancien.
router.post(
  '/change-password',
  authenticate,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 8 }).custom((v) => {
    if (!/(?=.*[a-z])/.test(v)) throw new Error('une minuscule');
    if (!/(?=.*[A-Z])/.test(v)) throw new Error('une majuscule');
    if (!/(?=.*\d)/.test(v)) throw new Error('un chiffre');
    if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(v)) throw new Error('un caractère spécial');
    return true;
  })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const valid = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });

    return res.json({ ok: true });
  }
);

// "permissions" : liste effective des clés de permission de l'utilisateur, calculée selon la même
// règle que requirePermission() — seul SUPERADMIN a accès à tout sans condition ; pour tous les
// autres rôles (ADMIN inclus), si l'utilisateur appartient à au moins un groupe de droits, ce sont
// ces permissions qui s'appliquent (null = pas de groupe, le frontend retombe alors sur les règles
// par rôle classiques pour ne jamais casser l'accès d'un compte existant sans groupe assigné).
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { id: true, email: true, fullName: true, role: true, teamId: true, isActive: true, mustChangePassword: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }

  let permissions = null;
  if (user.role !== 'SUPERADMIN') {
    const groupCount = await prisma.permissionGroup.count({ where: { members: { some: { id: user.id } } } });
    if (groupCount > 0) {
      permissions = Array.from(await getUserPermissions(user.id));
    }
  }

  return res.json({ ...user, permissions });
});

module.exports = router;
