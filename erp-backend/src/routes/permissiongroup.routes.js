const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate, authorizeAdmin } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { PERMISSION_KEYS, GROUP_NAME_TO_ROLE, canAssignRole } = require('../config/permissions');
const { auditLog } = require('../services/auditLogService');
const { emitUserUpdated } = require('../utils/socket');

const router = express.Router();
router.use(authenticate);
router.use(authorizeAdmin);
// Au-delà de la simple consultation/assignation (réservée à tout ADMIN ci-dessus), la création, la
// modification et la suppression des groupes eux-mêmes (et de leurs permissions) sont réservées au
// SUPERADMIN — un ADMIN ne fait qu'assigner des utilisateurs à des groupes déjà définis, il ne
// décide pas du contenu de ces groupes.

function invalidKeys(permissions) {
  return (permissions || []).filter((p) => !PERMISSION_KEYS.includes(p));
}

router.get('/', async (req, res) => {
  const groups = await prisma.permissionGroup.findMany({
    include: {
      members: { select: { id: true, fullName: true, email: true, role: true } },
      _count: { select: { members: true } },
    },
    orderBy: { name: 'asc' },
  });
  return res.json(groups);
});

router.get('/:id', async (req, res) => {
  const group = await prisma.permissionGroup.findUnique({
    where: { id: Number(req.params.id) },
    include: { members: { select: { id: true, fullName: true, email: true, role: true } } },
  });
  if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
  return res.json(group);
});

router.post('/', requireSuperAdmin, [body('name').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description, permissions } = req.body;

  const bad = invalidKeys(permissions);
  if (bad.length > 0) return res.status(400).json({ error: `Permission(s) inconnue(s) : ${bad.join(', ')}` });

  const existing = await prisma.permissionGroup.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'Un groupe avec ce nom existe déjà' });

  const group = await prisma.permissionGroup.create({
    data: { name, description: description || null, permissions: permissions || [] },
  });
  return res.status(201).json(group);
  auditLog('PERMISSION_GROUP_CREATED', { actor: req.user, targetType: 'PermissionGroup', targetId: group.id, targetLabel: group.name }).catch(() => {});
});

router.patch('/:id', requireSuperAdmin, async (req, res) => {
  const { name, description, permissions } = req.body;

  if (permissions !== undefined) {
    const bad = invalidKeys(permissions);
    if (bad.length > 0) return res.status(400).json({ error: `Permission(s) inconnue(s) : ${bad.join(', ')}` });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (permissions !== undefined) data.permissions = permissions;

  try {
    const group = await prisma.permissionGroup.update({ where: { id: Number(req.params.id) }, data });
    return res.json(group);
    auditLog('PERMISSION_GROUP_UPDATED', { actor: req.user, targetType: 'PermissionGroup', targetId: group.id, targetLabel: group.name, metadata: { changedFields: Object.keys(data) } }).catch(() => {});
  } catch (err) {
    return res.status(404).json({ error: 'Groupe introuvable' });
  }
});

router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const group = await prisma.permissionGroup.findUnique({ where: { id: Number(req.params.id) }, select: { id: true, name: true } });
    await prisma.permissionGroup.delete({ where: { id: Number(req.params.id) } });
    auditLog('PERMISSION_GROUP_DELETED', { actor: req.user, targetType: 'PermissionGroup', targetId: group.id, targetLabel: group.name }).catch(() => {});
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Groupe introuvable' });
  }
});

// Assigne un ou plusieurs utilisateurs au groupe — body: { userIds: number[] }
// Règle métier : un utilisateur n'appartient qu'à UN SEUL groupe de permissions (contrainte
// @@unique([userId]) en base). L'assignation est donc un MOUVEMENT : l'utilisateur quitte
// automatiquement son groupe précédent, atomiquement.
// Règle RBAC « le rôle suit le groupe » : si le groupe receveur est associé à un rôle de travail
// (GROUP_NAME_TO_ROLE), le rôle des utilisateurs est mis à jour dans le même mouvement — ainsi la
// vue Utilisateurs et la vue Groupes de droits ne peuvent plus diverger. Un rôle réservé à un acteur
// supérieur (ex. ADMIN assigné par un ADMIN) est ignoré : le groupe bouge, le rôle reste.
router.post('/:id/assign', [body('userIds').isArray({ min: 1 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const userIds = req.body.userIds.map(Number).filter((n) => !Number.isNaN(n));
  if (userIds.length === 0) return res.status(400).json({ error: 'Aucun identifiant valide fourni' });

  try {
    const groupId = Number(req.params.id);

    const group = await prisma.$transaction(async (tx) => {
      const target = await tx.permissionGroup.findUnique({ where: { id: groupId }, select: { id: true, name: true } });
      if (!target) throw Object.assign(new Error('Groupe introuvable'), { status: 404 });

      const roleForGroup = GROUP_NAME_TO_ROLE[target.name];

      // Un utilisateur n'appartient qu'à UN SEUL groupe (contrainte @@unique([userId]) en base).
      // L'assignation est donc un MOUVEMENT atomique : `set` remplace son groupe actuel par celui-ci,
      // et le rôle suit si le groupe est associé à un rôle de travail.
      for (const uid of userIds) {
        const current = await tx.user.findUnique({ where: { id: uid }, select: { role: true } });
        const syncRole = roleForGroup && current && current.role !== roleForGroup && canAssignRole(req.user.role, roleForGroup);
        await tx.user.update({
          where: { id: uid },
          data: {
            permissionGroups: { set: [{ id: groupId }] },
            ...(syncRole ? { role: roleForGroup } : {}),
          },
          select: { id: true },
        });
      }

      return tx.permissionGroup.findUnique({
        where: { id: groupId },
        include: { members: { select: { id: true, fullName: true, email: true, role: true } } },
      });
    });

    auditLog('PERMISSION_GROUP_ASSIGNED', { actor: req.user, targetType: 'PermissionGroup', targetId: group.id, targetLabel: group.name, metadata: { userIds } }).catch(() => {});
    for (const uid of userIds) emitUserUpdated(uid); // permissions + rôle instantanés côté utilisateur concerné
    return res.json(group);
  } catch (err) {
    return res.status(err.status || 404).json({ error: err.message || 'Groupe introuvable' });
  }
});

// Retire un ou plusieurs utilisateurs du groupe — body: { userIds: number[] }
router.post('/:id/unassign', [body('userIds').isArray({ min: 1 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const userIds = req.body.userIds.map(Number).filter((n) => !Number.isNaN(n));
  if (userIds.length === 0) return res.status(400).json({ error: 'Aucun identifiant valide fourni' });

  try {
    const group = await prisma.permissionGroup.update({
      where: { id: Number(req.params.id) },
      data: { members: { disconnect: userIds.map((id) => ({ id })) } },
      include: { members: { select: { id: true, fullName: true, email: true, role: true } } },
    });
    for (const uid of userIds) emitUserUpdated(uid); // permissions instantanées côté utilisateur concerné
    return res.json(group);
  } catch (err) {
    return res.status(404).json({ error: 'Groupe introuvable' });
  }
});

module.exports = router;
