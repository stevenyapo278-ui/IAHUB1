const prisma = require('../prismaClient');

// Permissions par défaut pour chaque groupe de rôle.
// Le seeder crée les groupes s'ils n'existent pas, et ajoute les permissions manquantes.
// Il ne retire jamais de permissions (l'admin peut personnaliser).
const DEFAULT_GROUPS = [
  {
    name: 'Administrateurs',
    description: 'Groupe par défaut pour le rôle Administrateur.',
    permissions: [
      'tickets.view', 'tickets.delete', 'tickets.bulkDelete', 'tickets.assign',
      'tickets.approve', 'tickets.timesheet', 'tickets.manage', 'problems.manage',
      'users.manage', 'teams.manage',
      'settings.ai', 'settings.email', 'settings.integrations',
      'knowledge.manage', 'inbox.sync', 'prompts.manage',
      'emaildrafts.manage', 'automation.manage', 'locations.manage',
      'assets.manage', 'aiweeklyreports.manage',
    ],
  },
  {
    name: 'Équipe Hotline',
    description: 'Groupe par défaut pour le rôle Hotline.',
    permissions: [
      'tickets.approve', 'tickets.assign', 'tickets.manage', 'problems.manage', 'teams.manage',
      'aiweeklyreports.manage', 'emaildrafts.manage', 'locations.manage',
    ],
  },
  {
    name: 'Techniciens',
    description: 'Groupe par défaut pour le rôle Technicien.',
    permissions: [
      'tickets.view', 'tickets.assign', 'tickets.approve', 'tickets.timesheet',
      'tickets.manage', 'knowledge.manage', 'inbox.sync',
      'emaildrafts.manage', 'locations.manage', 'assets.manage',
    ],
  },
  {
    name: 'Demandeurs',
    description: 'Groupe par défaut pour le rôle Demandeur.',
    permissions: ['tickets.view', 'assets.manage'],
  },
];

async function seedPermissionGroups() {
  try {
    for (const { name, description, permissions } of DEFAULT_GROUPS) {
      let group = await prisma.permissionGroup.findFirst({ where: { name } });

      if (!group) {
        group = await prisma.permissionGroup.create({
          data: { name, description, permissions },
        });
        console.log(`[permissionGroupSeeder] Groupe "${name}" créé avec ${permissions.length} permissions.`);
      } else {
        // Ajouter les permissions manquantes (jamais retirer)
        const currentSet = new Set(group.permissions);
        let updated = false;
        for (const p of permissions) {
          if (!currentSet.has(p)) {
            currentSet.add(p);
            updated = true;
          }
        }
        if (updated) {
          await prisma.permissionGroup.update({
            where: { id: group.id },
            data: { permissions: Array.from(currentSet) },
          });
          console.log(`[permissionGroupSeeder] Permissions du groupe "${name}" mises à jour.`);
        }
      }
    }

    // Synchroniser les utilisateurs sans groupe vers le groupe de leur rôle
    const roleGroupMap = [
      { role: 'ADMIN', groupName: 'Administrateurs' },
      { role: 'TECHNICIAN', groupName: 'Techniciens' },
      { role: 'HOTLINE', groupName: 'Équipe Hotline' },
      { role: 'REQUESTER', groupName: 'Demandeurs' },
    ];

    for (const { role, groupName } of roleGroupMap) {
      const group = await prisma.permissionGroup.findFirst({ where: { name: groupName } });
      if (!group) continue;
      const usersWithoutGroup = await prisma.user.findMany({
        where: { role, permissionGroups: { none: {} } },
        select: { id: true },
      });
      if (usersWithoutGroup.length > 0) {
        await prisma.permissionGroup.update({
          where: { id: group.id },
          data: { members: { connect: usersWithoutGroup.map((u) => ({ id: u.id })) } },
        });
        console.log(`[permissionGroupSeeder] ${usersWithoutGroup.length} utilisateur(s) ${role} ajouté(s) au groupe "${groupName}".`);
      }
    }
  } catch (err) {
    console.error('[permissionGroupSeeder] Échec de l\'auto-seeding des groupes:', err.message);
  }
}

module.exports = { seedPermissionGroups };
