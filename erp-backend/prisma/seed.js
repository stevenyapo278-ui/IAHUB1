const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { PERMISSION_KEYS } = require('../src/config/permissions');

// Liste exacte des permissions que le rôle TECHNICIAN possédait déjà avant l'introduction du
// système de groupes (cf. fallbackRoles de chaque requirePermission() dans les routes) — ce groupe
// par défaut doit reproduire fidèlement l'accès historique, ni plus (pas de prompts.manage ni
// automation.manage, qui étaient ADMIN-only) ni moins (pas de perte au déploiement).
const TECHNICIAN_DEFAULT_PERMISSIONS = [
  'tickets.create',
  'tickets.assign',
  'tickets.approve',
  'knowledge.manage',
  'inbox.sync',
  'dashboard.view',
  'glpi.manage',
  'emaildrafts.manage',
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
      baseUrl: 'https://generativelanguage.googleapis.com',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    },
    {
      name: 'nvidia',
      label: 'NVIDIA NIM (Nemotron)',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      models: ['nvidia/llama-3.1-nemotron-70b-instruct'],
    },
    {
      name: 'mistral',
      label: 'Mistral AI',
      baseUrl: 'https://api.mistral.ai/v1',
      models: ['mistral-large-latest', 'mistral-small-latest'],
    },
  ];

  for (const p of providers) {
    const provider = await prisma.aiProvider.upsert({
      where: { name: p.name },
      update: {},
      create: { name: p.name, label: p.label, baseUrl: p.baseUrl },
    });

    for (let i = 0; i < p.models.length; i++) {
      const modelName = p.models[i];
      await prisma.aiModel.upsert({
        where: { providerId_name: { providerId: provider.id, name: modelName } },
        update: {},
        create: { providerId: provider.id, name: modelName, isDefault: i === 0 },
      });
    }
  }

  // Groupe de droits par défaut pour les techniciens : créé une seule fois (jamais ré-écrasé après
  // sa création, pour laisser l'admin retirer des permissions sans que le seed les remette à chaque
  // démarrage), avec TOUTES les permissions — équivalent exact de ce que le rôle TECHNICIAN donnait
  // déjà par défaut avant l'introduction du système de groupes de droits. Tout TECHNICIAN existant
  // sans groupe est automatiquement ajouté ici, pour ne perdre aucun accès au déploiement.
  let techniciansGroup = await prisma.permissionGroup.findUnique({ where: { name: 'Techniciens' } });
  if (!techniciansGroup) {
    techniciansGroup = await prisma.permissionGroup.create({
      data: {
        name: 'Techniciens',
        description: 'Groupe par défaut couvrant toutes les permissions historiquement accordées au rôle Technicien.',
        permissions: TECHNICIAN_DEFAULT_PERMISSIONS,
      },
    });
    console.log('Groupe de droits "Techniciens" créé avec toutes les permissions.');
  }

  const techniciansWithoutGroup = await prisma.user.findMany({
    where: { role: 'TECHNICIAN', permissionGroups: { none: {} } },
    select: { id: true },
  });
  if (techniciansWithoutGroup.length > 0) {
    await prisma.permissionGroup.update({
      where: { id: techniciansGroup.id },
      data: { members: { connect: techniciansWithoutGroup.map((u) => ({ id: u.id })) } },
    });
    console.log(`${techniciansWithoutGroup.length} technicien(s) ajouté(s) au groupe "Techniciens".`);
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
