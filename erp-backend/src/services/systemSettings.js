const prisma = require('../prismaClient');

// Lit toujours en base (pas de cache) : ces réglages changent rarement, mais doivent être
// appliqués immédiatement dès qu'un admin bascule un toggle dans Paramètres > Automatisation.
async function getSystemSettings() {
  const settings = await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return settings;
}

module.exports = { getSystemSettings };
