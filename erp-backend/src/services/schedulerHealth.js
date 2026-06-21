const prisma = require('../prismaClient');
const { sendEmail } = require('./emailSender');

const FAILURE_THRESHOLD = 3; // nombre d'échecs consécutifs avant alerte — évite d'alerter sur un échec isolé/transitoire
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // ne renvoie pas l'alerte plus d'une fois toutes les 6h tant que la panne persiste, sinon spam à chaque cycle

// Envoie un email aux admins actifs quand une tâche automatique dépasse le seuil d'échecs
// consécutifs — pas de saveAsMessage/ticketId, cette alerte ne concerne aucun ticket précis.
async function alertAdmins(name, error, consecutiveFailures) {
  const admins = await prisma.user.findMany({
    where: { isActive: true, role: 'ADMIN' },
    select: { email: true, fullName: true },
  });
  if (admins.length === 0) return;

  const subject = `[Alerte] Tâche automatique en échec : ${name}`;
  const bodyHtml = `
<p>Bonjour,</p>
<p>La tâche automatique <strong>${name}</strong> a échoué <strong>${consecutiveFailures} fois consécutives</strong>.</p>
<p>Dernière erreur :</p>
<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding:8px 16px;color:#444">${error}</blockquote>
<p>Cette tâche ne sera retentée qu'au prochain cycle planifié. Si la panne persiste, vérifiez la configuration concernée (GLPI, compte email, fournisseur IA) dans Paramètres.</p>
`.trim();

  for (const admin of admins) {
    try {
      await sendEmail({ to: admin.email, subject, bodyHtml, saveAsMessage: false });
    } catch (err) {
      console.error(`[schedulerHealth] Échec envoi alerte panne vers ${admin.email}:`, err.message);
    }
  }
}

// Enregistre le résultat d'une exécution de tâche planifiée et déclenche une alerte email aux
// admins si le nombre d'échecs consécutifs dépasse FAILURE_THRESHOLD — avec un cooldown pour ne
// pas spammer à chaque cycle tant que la panne n'est pas corrigée.
async function recordSchedulerResult(name, error) {
  const existing = await prisma.schedulerHealth.findUnique({ where: { name } });

  if (!error) {
    if (existing && existing.consecutiveFailures > 0) {
      await prisma.schedulerHealth.update({
        where: { name },
        data: { consecutiveFailures: 0, lastSuccessAt: new Date(), alertSentAt: null },
      });
    } else {
      await prisma.schedulerHealth.upsert({
        where: { name },
        update: { lastSuccessAt: new Date() },
        create: { name, lastSuccessAt: new Date() },
      });
    }
    return;
  }

  const consecutiveFailures = (existing?.consecutiveFailures || 0) + 1;
  const errorMessage = error.message || String(error);

  await prisma.schedulerHealth.upsert({
    where: { name },
    update: { consecutiveFailures, lastError: errorMessage, lastFailureAt: new Date() },
    create: { name, consecutiveFailures, lastError: errorMessage, lastFailureAt: new Date() },
  });

  const cooldownPassed = !existing?.alertSentAt || (Date.now() - new Date(existing.alertSentAt).getTime()) > ALERT_COOLDOWN_MS;
  if (consecutiveFailures >= FAILURE_THRESHOLD && cooldownPassed) {
    await alertAdmins(name, errorMessage, consecutiveFailures);
    await prisma.schedulerHealth.update({ where: { name }, data: { alertSentAt: new Date() } });
  }
}

// Enveloppe une tâche planifiée pour suivre automatiquement son état de santé — à utiliser à la
// place d'un simple .catch(console.error) sur les tâches déjà existantes dans server.js.
function withHealthTracking(name, fn) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      await recordSchedulerResult(name, null);
      return result;
    } catch (err) {
      await recordSchedulerResult(name, err);
      throw err;
    }
  };
}

module.exports = { recordSchedulerResult, withHealthTracking };
