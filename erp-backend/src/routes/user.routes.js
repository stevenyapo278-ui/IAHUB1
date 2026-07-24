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
  glpiId: true,
  team: { select: { id: true, name: true } },
  createdAt: true,
};

router.get('/', async (req, res) => {
  const { search, limit, page, role, teamId, all } = req.query;
  const where = {};
  if (search) {
    const searchInt = parseInt(search, 10);
    const searchConditions = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
    if (!isNaN(searchInt)) {
      searchConditions.push({ glpiId: searchInt });
    }
    where.OR = searchConditions;
  }
  if (role) where.role = role;
  if (teamId) where.teamId = teamId === 'null' ? null : Number(teamId);

  if (all === 'true') {
    const users = await prisma.user.findMany({
      where,
      take: limit ? Number(limit) : undefined,
      select: userSelect,
      orderBy: { fullName: 'asc' },
    });
    return res.json(users);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(100, Number(limit) || 25));
  const skip = (pageNum - 1) * limitNum;

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: limitNum,
      select: userSelect,
      orderBy: { fullName: 'asc' },
    }),
  ]);

  return res.json({
    users,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  });
});

// Suppression par lot d'utilisateurs sélectionnés
router.post('/bulk-delete', async (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'Aucun ID d\'utilisateur fourni' });
  }

  const targets = await prisma.user.findMany({
    where: { id: { in: userIds.map(Number) } },
    select: { id: true, role: true },
  });

  const validIdsToDelete = targets
    .filter((u) => canActOnTarget(req.user.role, u.role))
    .map((u) => u.id);

  if (validIdsToDelete.length === 0) {
    return res.status(403).json({ error: 'Aucun utilisateur sélectionné ne peut être supprimé' });
  }

  const deleted = await prisma.user.deleteMany({
    where: { id: { in: validIdsToDelete } },
  });

  return res.json({ deletedCount: deleted.count });
});

// Purge de tous les utilisateurs importés (hors Admin / SuperAdmin)
router.delete('/purge-imported', async (req, res) => {
  try {
    const deleted = await prisma.user.deleteMany({
      where: {
        glpiId: { not: null },
        role: { notIn: ADMIN_LIKE_ROLES },
      },
    });
    return res.json({ purgedCount: deleted.count });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur lors de la purge' });
  }
});

// Assignation d'équipe par lot
router.post('/bulk-assign-team', async (req, res) => {
  const { userIds, teamId } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'Aucun ID d\'utilisateur fourni' });
  }

  const teamIdValue = teamId ? Number(teamId) : null;

  const updated = await prisma.user.updateMany({
    where: { id: { in: userIds.map(Number) } },
    data: { teamId: teamIdValue },
  });

  return res.json({ updatedCount: updated.count });
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

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseUsersCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];

  let cleanText = csvText.replace(/^\uFEFF/, '').replace(/&nbsp;?/gi, ' ').trim();
  if (!cleanText) return [];

  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  let delimiter = ';';
  if (headerLine.includes(';') && !headerLine.includes('\t')) delimiter = ';';
  else if (headerLine.includes('\t')) delimiter = '\t';
  else if (headerLine.includes(',')) delimiter = ',';

  function splitRow(row) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));
    return values;
  }

  const headers = splitRow(headerLine).map((h) => h.toLowerCase().trim());

  let colIdentifiant = headers.findIndex((h) => h.includes('identifiant') || h.includes('login') || h.includes('glpi'));
  let colNom = headers.findIndex((h) => h.includes('nom') || h.includes('fullname') || h.includes('name'));
  let colEmail = headers.findIndex((h) => h.includes('courriel') || h.includes('email') || h.includes('mail'));
  let colLieu = headers.findIndex((h) => h.includes('lieu') || h.includes('location'));
  let colActif = headers.findIndex((h) => h.includes('actif') || h.includes('active') || h.includes('statut'));

  if (colIdentifiant === -1) colIdentifiant = 0;
  if (colNom === -1) colNom = 1;
  if (colEmail === -1) colEmail = 2;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    if (cols.length === 0 || cols.every((c) => !c)) continue;

    const rawIdentifiant = cols[colIdentifiant] || '';
    const rawNom = cols[colNom] || '';
    const rawEmail = (cols[colEmail] || '').replace(/&nbsp;/g, '').trim();
    const rawLieu = (colLieu !== -1 && cols[colLieu] && cols[colLieu].trim()) ? cols[colLieu].trim() : null;
    const rawActif = colActif !== -1 ? cols[colActif] : 'Oui';

    let glpiId = null;
    let username = rawIdentifiant.trim();
    const idMatch = rawIdentifiant.match(/\((\d+)\)/);
    if (idMatch) {
      glpiId = Number(idMatch[1]);
      username = rawIdentifiant.replace(/\(\d+\)/, '').trim();
    } else if (/^\d+$/.test(rawIdentifiant.trim())) {
      glpiId = Number(rawIdentifiant.trim());
    }

    let email = rawEmail;
    if (!email || email === '' || email.toLowerCase() === '&nbsp;') {
      if (username.includes('@')) {
        email = username.toLowerCase();
      } else if (username) {
        const cleanName = username.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        email = `${cleanName}@prosuma.ci`;
      }
    }
    if (email) email = email.toLowerCase().trim();

    let fullName = rawNom.trim();
    if (!fullName && email && email.includes('@')) {
      const parts = email.split('@')[0].split('.');
      fullName = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }
    if (!fullName) fullName = username || 'Utilisateur Prosuma';

    const isActive = rawActif ? !['non', 'false', '0', 'inactif'].includes(rawActif.toLowerCase().trim()) : true;

    if (!email && !glpiId) continue;

    rows.push({
      username,
      glpiId,
      fullName,
      email,
      location: rawLieu,
      isActive,
    });
  }

  return rows;
}

// Endpoint d'importation CSV d'utilisateurs
router.post('/import-csv', upload.single('file'), async (req, res) => {
  try {
    let csvText = '';
    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
    } else if (req.body?.csvText) {
      csvText = req.body.csvText;
    } else {
      return res.status(400).json({ error: 'Aucun fichier ou texte CSV fourni' });
    }

    const rows = parseUsersCsv(csvText);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Fichier CSV vide ou format de colonnes non reconnu' });
    }

    let imported = 0;
    let updated = 0;
    const errors = [];

    for (const r of rows) {
      try {
        let existing = null;
        if (r.glpiId) {
          existing = await prisma.user.findUnique({ where: { glpiId: r.glpiId } });
        }
        if (!existing && r.email) {
          existing = await prisma.user.findUnique({ where: { email: r.email } });
        }

        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              fullName: r.fullName || existing.fullName,
              glpiId: r.glpiId || existing.glpiId,
              isActive: r.isActive !== undefined ? r.isActive : existing.isActive,
            },
          });
          updated++;
        } else {
          const passwordHash = await bcrypt.hash(crypto.randomBytes(20).toString('hex'), 10);
          await prisma.user.create({
            data: {
              email: r.email,
              passwordHash,
              fullName: r.fullName,
              role: 'REQUESTER',
              glpiId: r.glpiId || null,
              isActive: r.isActive !== undefined ? r.isActive : true,
              mustChangePassword: true,
            },
          });
          imported++;
        }
      } catch (err) {
        errors.push({ email: r.email, glpiId: r.glpiId, reason: err.message });
      }
    }

    return res.json({
      imported,
      updated,
      totalProcessed: rows.length,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Erreur d'importation CSV" });
  }
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
module.exports.parseUsersCsv = parseUsersCsv;

