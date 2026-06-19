const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { GLPI_TECHNICIANS } = require('../src/utils/glpiMapping');

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

  // Mappe les groupes GLPI sur les équipes correspondantes
  for (const tech of GLPI_TECHNICIANS) {
    await prisma.team.update({
      where: { name: tech.team },
      data: { glpiGroupId: tech.glpiGroupId },
    });
  }

  // Crée les techniciens correspondant aux comptes GLPI
  for (const tech of GLPI_TECHNICIANS) {
    const email = `${tech.fullName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}@example.com`;
    const team = await prisma.team.findUnique({ where: { name: tech.team } });
    const existing = await prisma.user.findFirst({ where: { glpiId: tech.glpiId } });
    if (!existing) {
      const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: tech.fullName,
          role: 'TECHNICIAN',
          teamId: team?.id,
          glpiId: tech.glpiId,
        },
      });
      console.log(`Technicien créé : ${email} / ChangeMe123! (GLPI #${tech.glpiId})`);
    }
  }

  const adminEmail = 'admin@example.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        fullName: 'Administrateur',
        role: 'ADMIN',
      },
    });
    console.log(`Admin créé : ${adminEmail} / ChangeMe123!`);
  }

  const secondAdminEmail = 'admin@prosuma.ci';
  const existingSecondAdmin = await prisma.user.findUnique({ where: { email: secondAdminEmail } });
  if (!existingSecondAdmin) {
    const passwordHash = await bcrypt.hash('1234', 10);
    await prisma.user.create({
      data: {
        email: secondAdminEmail,
        passwordHash,
        fullName: 'Admin Prosuma',
        role: 'ADMIN',
      },
    });
    console.log(`Admin créé : ${secondAdminEmail} / 1234`);
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
