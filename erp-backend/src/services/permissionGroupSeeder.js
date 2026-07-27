const prisma = require('../prismaClient');

async function seedPermissionGroups() {
  try {
    const groupName = 'Équipe Hotline';
    const defaultPermissions = [
      'tickets.approve',
      'tickets.assign',
      'aiweeklyreports.manage',
      'emaildrafts.manage',
      'locations.manage',
    ];

    let group = await prisma.permissionGroup.findFirst({
      where: { name: groupName },
    });

    if (!group) {
      group = await prisma.permissionGroup.create({
        data: {
          name: groupName,
          description: 'Groupe système pour la validation et l\'approbation des tickets Hotline et rapports d\'apprentissage IA.',
          permissions: defaultPermissions,
        },
      });
      console.log(`[permissionGroupSeeder] Groupe de permissions système "${groupName}" créé avec succès.`);
    } else {
      // S'assurer que toutes les permissions par défaut y figurent
      const currentSet = new Set(group.permissions);
      let updated = false;
      for (const p of defaultPermissions) {
        if (!currentSet.has(p)) {
          currentSet.add(p);
          updated = true;
        }
      }
      if (updated) {
        group = await prisma.permissionGroup.update({
          where: { id: group.id },
          data: { permissions: Array.from(currentSet) },
        });
        console.log(`[permissionGroupSeeder] Permissions du groupe "${groupName}" mises à jour.`);
      }
    }

    // Synchroniser automatiquement les utilisateurs qui ont le rôle HOTLINE
    const hotlineUsers = await prisma.user.findMany({
      where: { role: 'HOTLINE' },
      select: { id: true },
    });

    if (hotlineUsers.length > 0) {
      await prisma.permissionGroup.update({
        where: { id: group.id },
        data: {
          members: {
            connect: hotlineUsers.map((u) => ({ id: u.id })),
          },
        },
      });
    }
  } catch (err) {
    console.error('[permissionGroupSeeder] Échec de l\'auto-seeding des groupes:', err.message);
  }
}

module.exports = { seedPermissionGroups };
