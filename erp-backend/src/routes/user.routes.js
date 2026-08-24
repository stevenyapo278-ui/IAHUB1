const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate, authorizeAdmin } = require('../middleware/auth');
const { sendTemporaryPasswordEmail } = require('../services/emailSender');
const { ADMIN_LIKE_ROLES, ROLE_DEFAULT_GROUP_NAME, canAssignRole } = require('../config/permissions');
const { sanitizeError } = require('../utils/sanitizeError');
const { auditLog } = require('../services/auditLogService');
const { emitUserUpdated } = require('../utils/socket');
const cacheStore = require('../services/cacheStore');
const { logger } = require('../utils/logger');
const { isLdapSyncConfigured, syncLdapDirectory } = require('../services/ldapDirectory');

// Après toute écriture sur les utilisateurs, on invalide les listes mises en cache (TTL 30s,
// voir app.js) — sinon l'UI continue d'afficher l'ancien rôle/statut/équipe jusqu'à expiration.
function invalidateUserCaches() {
  cacheStore.clear('GET /api/users');
  cacheStore.clear('GET /api/permission-groups');
  cacheStore.clear('GET /api/teams');
}

const MIN_PASSWORD_LENGTH = 8;

// ── Synchronisation rôle ↔ groupe (RBAC) ─────────────────────────────────
// « Le groupe suit le rôle » : quand un utilisateur reçoit un rôle associé à un groupe par défaut
// (ROLE_DEFAULT_GROUP_NAME), il y est DÉPLACÉ (set = remplacement atomique, un seul groupe par
// utilisateur — contrainte d'exclusivité).
// Inversement, une rétrogradation vers un rôle SANS groupe par défaut (REQUESTER, ADMIN) détache
// les groupes « à rôle » devenus incompatibles — sinon l'utilisateur conserverait les permissions
// de son ancien rôle (privilèges résiduels). Les groupes personnalisés créés manuellement ne sont
// jamais touchés. Best effort : erreur silencieuse, le changement de rôle reste prioritaire.
async function syncRolePermissionGroup(userId, role) {
  const groupName = ROLE_DEFAULT_GROUP_NAME[role];
  if (groupName) {
    const group = await prisma.permissionGroup.findUnique({ where: { name: groupName } });
    if (group) {
      await prisma.user.update({
        where: { id: userId },
        data: { permissionGroups: { set: [{ id: group.id }] } },
      }).catch(() => {});
      return;
    }
  }

  // Rôle sans groupe par défaut (ou groupe introuvable) : détache les autres groupes « à rôle »
  const staleNames = Object.values(ROLE_DEFAULT_GROUP_NAME).filter(Boolean).filter((n) => n !== groupName);
  if (staleNames.length === 0) return;
  const staleGroups = await prisma.permissionGroup.findMany({ where: { name: { in: staleNames } }, select: { id: true } });
  if (staleGroups.length === 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: { permissionGroups: { disconnect: staleGroups.map((g) => ({ id: g.id })) } },
  }).catch(() => {});
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
  permissionGroups: { select: { id: true, name: true } }, // permet d'afficher le groupe actuel d'un utilisateur (groupes exclusifs)
  createdAt: true,
};

router.get('/', async (req, res) => {
  const { search, limit, page, role, teamId, isActive, all } = req.query;
  const where = {};
  if (search && search.trim()) {
    const trimmed = search.trim();
    const searchConditions = [
      { fullName: { contains: trimmed, mode: 'insensitive' } },
      { email: { contains: trimmed, mode: 'insensitive' } },
      { team: { name: { contains: trimmed, mode: 'insensitive' } } },
    ];
    const matchGlpi = trimmed.match(/#?(\d+)/);
    if (matchGlpi) {
      searchConditions.push({ glpiId: parseInt(matchGlpi[1], 10) });
    }
    where.OR = searchConditions;
  }
  if (role) where.role = role;
  if (teamId) where.teamId = teamId === 'null' ? null : Number(teamId);
  if (isActive === 'true') where.isActive = true;
  else if (isActive === 'false') where.isActive = false;
  // Filtre par liste d'IDs explicite (ex: résoudre les libellés des utilisateurs déjà sélectionnés
  // dans un composant distant sans recharger toute la liste) — prioritaire sur la pagination.
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
    if (ids.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: userSelect,
        orderBy: { fullName: 'asc' },
      });
      return res.json(users);
    }
  }

  if (!page || all === 'true') {
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

  const [total, staffCount, inactiveCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { ...where, role: { in: ['SUPERADMIN', 'ADMIN', 'TECHNICIAN'] } } }),
    prisma.user.count({ where: { ...where, isActive: false } }),
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
    staffCount,
    inactiveCount,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  });
});

// Toutes les opérations ci-dessous (création, modification, suppression, purge) requièrent d'être Administrateur
router.use(authorizeAdmin);

// Synchro manuelle de l'annuaire AD — équivalent de la « vue LDAP » de GLPI.
// Crée/met à jour/désactive les comptes authProvider='ldap' depuis l'Active Directory.
router.post('/sync-ldap', async (req, res) => {
  if (!isLdapSyncConfigured()) {
    return res.status(503).json({ error: 'Synchro LDAP non configurée (LDAP_BIND_PASSWORD / LDAP_BASE_DN requis)' });
  }
  try {
    const stats = await syncLdapDirectory();
    invalidateUserCaches();
    return res.json({
      message: 'Annuaire synchronisé',
      stats,
    });
  } catch (err) {
    logger.error('[users] Échec synchro annuaire LDAP:', { error: err.message });
    return res.status(502).json({ error: `Échec de la synchronisation LDAP : ${err.message}` });
  }
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

  invalidateUserCaches();
  return res.json({ deletedCount: deleted.count });
});

// Aperçu analytique intelligent avant purge
router.get('/purge-preview', async (req, res) => {
  try {
    const nonAdminUsers = await prisma.user.findMany({
      where: {
        role: { notIn: ADMIN_LIKE_ROLES },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        glpiId: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            ticketsCreated: true,
            ticketsAssigned: true,
          },
        },
      },
    });

    const deletableOrphans = [];
    const inactivesWithTickets = [];
    const activeImported = [];

    for (const u of nonAdminUsers) {
      const ticketCount = (u._count?.ticketsCreated || 0) + (u._count?.ticketsAssigned || 0);
      if (ticketCount === 0) {
        deletableOrphans.push({ id: u.id, fullName: u.fullName, email: u.email, glpiId: u.glpiId });
      } else if (!u.isActive) {
        inactivesWithTickets.push({ id: u.id, fullName: u.fullName, email: u.email, ticketCount });
      } else {
        activeImported.push({ id: u.id, fullName: u.fullName, email: u.email, ticketCount });
      }
    }

    return res.json({
      totalNonAdmin: nonAdminUsers.length,
      deletableOrphansCount: deletableOrphans.length,
      inactivesWithTicketsCount: inactivesWithTickets.length,
      activeImportedCount: activeImported.length,
      deletableOrphans: deletableOrphans.slice(0, 10),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur lors du calcul de l\'aperçu' });
  }
});

// Purge Intelligente sécurisée
router.post('/purge-smart', async (req, res) => {
  try {
    const { mode = 'smart' } = req.body;
    let deletedCount = 0;
    let deactivatedCount = 0;

    const nonAdminUsers = await prisma.user.findMany({
      where: { role: { notIn: ADMIN_LIKE_ROLES } },
      select: {
        id: true,
        isActive: true,
        _count: {
          select: { ticketsCreated: true, ticketsAssigned: true },
        },
      },
    });

    const orphanIds = nonAdminUsers
      .filter((u) => (u._count?.ticketsCreated || 0) + (u._count?.ticketsAssigned || 0) === 0)
      .map((u) => u.id);

    const inactiveWithTicketIds = nonAdminUsers
      .filter((u) => (u._count?.ticketsCreated || 0) + (u._count?.ticketsAssigned || 0) > 0 && !u.isActive)
      .map((u) => u.id);

    if (mode === 'smart' || mode === 'deletable_only') {
      if (orphanIds.length > 0) {
        const delRes = await prisma.user.deleteMany({
          where: { id: { in: orphanIds } },
        });
        deletedCount = delRes.count;
      }
    }

    if (mode === 'smart' || mode === 'deactivate_only') {
      if (inactiveWithTicketIds.length > 0) {
        const deactRes = await prisma.user.updateMany({
          where: { id: { in: inactiveWithTicketIds } },
          data: { isActive: false },
        });
        deactivatedCount = deactRes.count;
      }
    }

    if (mode === 'full_force') {
      const allNonAdminIds = nonAdminUsers.map((u) => u.id);
      // Pour éviter d'écraser les contraintes de clés étrangères, on délie les tickets demandés
      await prisma.ticket.updateMany({
        where: { requesterId: { in: allNonAdminIds } },
        data: { requesterId: null },
      });
      await prisma.ticket.updateMany({
        where: { assignedToId: { in: allNonAdminIds } },
        data: { assignedToId: null },
      });
      const delRes = await prisma.user.deleteMany({
        where: { id: { in: allNonAdminIds } },
      });
      deletedCount = delRes.count;
    }

    invalidateUserCaches();
    return res.json({
      mode,
      deletedCount,
      deactivatedCount,
      message: `Purge exécutée : ${deletedCount} compte(s) supprimé(s), ${deactivatedCount} compte(s) désactivé(s).`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur lors de la purge intelligente' });
  }
});

// Purge legacy de tous les utilisateurs importés (hors Admin / SuperAdmin)
router.delete('/purge-imported', async (req, res) => {
  try {
    const deleted = await prisma.user.deleteMany({
      where: {
        glpiId: { not: null },
        role: { notIn: ADMIN_LIKE_ROLES },
      },
    });
    invalidateUserCaches();
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

  invalidateUserCaches();
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

    // Le groupe par défaut du rôle suit la création (HOTLINE → « Équipe Hotline », TECHNICIAN → « Techniciens »)
    await syncRolePermissionGroup(user.id, targetRole);

    invalidateUserCaches();
    auditLog('USER_CREATED', { actor: req.user, targetType: 'User', targetId: user.id, targetLabel: user.fullName || user.email, metadata: { email: user.email, role: user.role } }).catch(() => {});
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
      if (role !== undefined && role !== target.role) {
        // « Le groupe suit le rôle » + rafraîchissement instantané de la session (menus + permissions)
        await syncRolePermissionGroup(user.id, role);
        emitUserUpdated(user.id);
      }
      invalidateUserCaches();
      auditLog('USER_UPDATED', { actor: req.user, targetType: 'User', targetId: user.id, targetLabel: user.fullName || user.email, metadata: { changedFields: Object.keys(data) } }).catch(() => {});
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
    return res.status(502).json({ error: `Mot de passe réinitialisé mais échec de l'envoi de l'email : ${sanitizeError(err)}` });
  }

  auditLog('USER_PASSWORD_RESET', { actor: req.user, targetType: 'User', targetId: user.id, targetLabel: user.fullName || user.email }).catch(() => {});
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

    invalidateUserCaches();
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
  const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) }, select: { id: true, fullName: true, email: true, role: true } });
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!canActOnTarget(req.user.role, target.role)) {
    return res.status(403).json({ error: 'Vous ne pouvez pas supprimer un compte administrateur ou super-administrateur' });
  }

  try {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    invalidateUserCaches();
    auditLog('USER_DELETED', { actor: req.user, targetType: 'User', targetId: target.id, targetLabel: target.fullName || target.email }).catch(() => {});
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
});

module.exports = router;
module.exports.canAssignRole = canAssignRole;
module.exports.canActOnTarget = canActOnTarget;
module.exports.parseUsersCsv = parseUsersCsv;

