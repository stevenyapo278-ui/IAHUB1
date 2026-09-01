const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { PERMISSION_KEYS } = require('../src/config/permissions');

// ── Permissions par défaut pour chaque rôle ─────────────────────────────────
// Chaque rôle a un groupe de permissions dédié qui reproduit fidèlement l'accès
// historique (avant l'introduction des groupes). Les groupes ne sont créés qu'une
// seule fois — jamais écrasés après création, pour laisser l'admin personnaliser.

const ADMIN_DEFAULT_PERMISSIONS = [
  'tickets.view',
  'tickets.delete',
  'tickets.bulkDelete',
  'tickets.assign',
  'tickets.approve',
  'tickets.timesheet',
  'tickets.manage',
  'users.manage',
  'teams.manage',
  'settings.ai',
  'settings.email',
  'settings.integrations',
  'knowledge.manage',
  'inbox.sync',
  'prompts.manage',
  'emaildrafts.manage',
  'automation.manage',
  'locations.manage',
  'assets.manage',
  'aiweeklyreports.manage',
];

const TECHNICIAN_DEFAULT_PERMISSIONS = [
  'tickets.view',
  'tickets.assign',
  'tickets.approve',
  'tickets.timesheet',
  'tickets.manage',
  'knowledge.manage',
  'inbox.sync',
  'emaildrafts.manage',
  'locations.manage',
  'assets.manage',
];

const HOTLINE_DEFAULT_PERMISSIONS = [
  'tickets.approve',
  'tickets.assign',
  'tickets.manage',
  'teams.manage',
  'aiweeklyreports.manage',
  'emaildrafts.manage',
  'locations.manage',
];

const REQUESTER_DEFAULT_PERMISSIONS = [
  'tickets.view',
  'assets.manage',
];

const prisma = new PrismaClient();

async function main() {
  const teams = ['Réseau', 'Système', 'Sécurité', 'Applicatif', 'Logiciel', 'Matériel', 'Téléphonie'];
  for (const name of teams) {
    await prisma.team.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Le mapping statique des techniciens GLPI (GLPI_TECHNICIANS) n'existe plus dans
  // src/utils/glpiMapping.js — les techniciens sont désormais créés/synchronisés via
  // glpiTicketCreator.js (syncTeamsFromGlpi/syncCategoriesFromGlpi, appelé au démarrage du serveur),
  // pas par le seed. Voir server.js.

  // Sur une base neuve, un seul compte SUPERADMIN par défaut est créé — c'est lui qui crée ensuite
  // tous les autres comptes (ADMIN, TECHNICIAN, ...) et leur attribue des droits via les groupes de
  // permissions. Cohérent avec ce que fait la migration 20260622100001 sur une base déjà peuplée
  // (promotion automatique des ADMIN existants), pour qu'il existe toujours au moins un SUPERADMIN.
  const superAdminEmail = 'superadmin@prosuma.ci';
  const existingSuperAdmin = await prisma.user.findUnique({ where: { email: superAdminEmail } });
  if (!existingSuperAdmin) {
    const passwordHash = await bcrypt.hash('12345678', 10);
    await prisma.user.create({
      data: {
        email: superAdminEmail,
        passwordHash,
        fullName: 'Super Admin Prosuma',
        role: 'SUPERADMIN',
      },
    });
    console.log(`Super-admin créé : ${superAdminEmail} / 12345678`);
  }

  const providers = [
    {
      name: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini', 'o3'],
    },
    {
      name: 'anthropic',
      label: 'Anthropic (Claude)',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
    },
    {
      name: 'gemini',
      label: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    },
    {
      name: 'nvidia',
      label: 'NVIDIA NIM (Nemotron)',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      models: ['nvidia/llama-3.3-nemotron-super-49b-v1.5'],
    },
    {
      name: 'mistral',
      label: 'Mistral AI',
      baseUrl: 'https://api.mistral.ai/v1',
      models: ['mistral-large-latest', 'mistral-small-latest'],
    },
  ];

  // Les fournisseurs et modèles par défaut ne sont créés qu'une seule fois s'ils n'existent pas du tout en base.
  // Si un admin supprime un fournisseur ou un modèle (isDeleted: true), le seed ne le recrée PAS lors des redéploiements Dokploy.
  for (const p of providers) {
    let provider = await prisma.aiProvider.findUnique({
      where: { name: p.name },
    });

    if (!provider) {
      provider = await prisma.aiProvider.create({
        data: { name: p.name, label: p.label, baseUrl: p.baseUrl },
      });
    }

    for (let i = 0; i < p.models.length; i++) {
      const modelName = p.models[i];
      const existingModel = await prisma.aiModel.findUnique({
        where: { providerId_name: { providerId: provider.id, name: modelName } },
      });

      if (!existingModel) {
        await prisma.aiModel.create({
          data: { providerId: provider.id, name: modelName, isDefault: i === 0 },
        });
      }
    }
  }

  // Catégories de tickets par défaut (mode autonome : la plateforme fonctionne sans GLPI).
  // Upsert par nom — idempotent. Si GLPI est connecté plus tard, syncCategoriesFromGlpi lie ces
  // catégories aux ITILCategory GLPI par nom (glpiCategoryId prend la valeur GLPI).
  const defaultCategories = ['Logiciel', 'Matériel', 'Réseau', 'Téléphonie', 'Système'];
  for (const name of defaultCategories) {
    await prisma.ticketCategory.upsert({
      where: { name },
      update: {},
      create: { name, isCustom: true },
    });
  }

  // ── Groupes de permissions par défaut ──────────────────────────────────────
  // Chaque rôle (hors SUPERADMIN) a un groupe de permissions dédié. Les groupes ne
  // sont créés qu'une seule fois (idempotent) et jamais écrasés après création.
  // Tout utilisateur existant sans groupe est automatiquement ajouté au groupe de son rôle.

  const defaultGroups = [
    { name: 'Administrateurs', description: 'Groupe par défaut pour le rôle Administrateur. Accès complet à la gestion utilisateur, équipe, paramètres.', permissions: ADMIN_DEFAULT_PERMISSIONS },
    { name: 'Techniciens', description: 'Groupe par défaut pour le rôle Technicien. Gestion de tickets, knowledge base, inbox, supervision.', permissions: TECHNICIAN_DEFAULT_PERMISSIONS },
    { name: 'Équipe Hotline', description: 'Groupe par défaut pour le rôle Hotline. Validation de tickets, rapports IA, gestion des lieux.', permissions: HOTLINE_DEFAULT_PERMISSIONS },
    { name: 'Demandeurs', description: 'Groupe par défaut pour le rôle Demandeur. Création de tickets et consultation de l\'inventaire.', permissions: REQUESTER_DEFAULT_PERMISSIONS },
  ];

  for (const { name, description, permissions } of defaultGroups) {
    let group = await prisma.permissionGroup.findUnique({ where: { name } });
    if (!group) {
      group = await prisma.permissionGroup.create({
        data: { name, description, permissions },
      });
      console.log(`Groupe de droits "${name}" créé avec ${permissions.length} permissions.`);
    }
  }

  // Auto-assigner les utilisateurs sans groupe à leur groupe de rôle
  const roleGroupMap = [
    { role: 'ADMIN', groupName: 'Administrateurs' },
    { role: 'TECHNICIAN', groupName: 'Techniciens' },
    { role: 'HOTLINE', groupName: 'Équipe Hotline' },
    { role: 'REQUESTER', groupName: 'Demandeurs' },
  ];

  for (const { role, groupName } of roleGroupMap) {
    const group = await prisma.permissionGroup.findUnique({ where: { name: groupName } });
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
      console.log(`${usersWithoutGroup.length} utilisateur(s) ${role} ajouté(s) au groupe "${groupName}".`);
    }
  }

  console.log('Seed terminé.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
