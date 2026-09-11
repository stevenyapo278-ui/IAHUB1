const prisma = require('../prismaClient');
const { getSystemSettings, resolveFrontendUrl } = require('./systemSettings');
const { sendEmail, getEmailSignature, buildEmailLayout } = require('./emailSender');

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const STATUS_LABELS = {
  NEW: 'Nouveau', OPEN: 'En cours', PLANNED: 'Planifié', PENDING: 'En attente',
  WAITING_FOR_USER: 'En attente demandeur', SOLVED: 'Résolu', CLOSED: 'Fermé',
};
const PRIORITY_COLORS = { P1: '#ef4444', P2: '#f97316', P3: '#eab308', P3: '#eab308', P4: '#3b82f6' };

async function sendObserverSummary() {
  const settings = await getSystemSettings();
  if (!settings.observerSummaryEnabled) return null;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (settings.observerSummaryLastSentDate === today) return null;

  // Vérifier le jour et l'heure
  const currentDay = now.getDay(); // 0-6
  if (currentDay !== settings.observerSummaryDay) return null;

  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (currentTime !== settings.observerSummaryTime) return null;

  // Trouver tous les tickets ouverts avec des observateurs
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'] },
      deletedAt: null,
      observers: { some: {} },
    },
    include: {
      observers: { select: { id: true, email: true, fullName: true } },
      assignedTo: { select: { id: true, fullName: true } },
      team: { select: { id: true, name: true } },
      requester: { select: { id: true, fullName: true } },
    },
    orderBy: [
      { priority: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  if (!tickets.length) return null;

  // Grouper par observateur
  const observerTickets = new Map();
  for (const ticket of tickets) {
    for (const obs of ticket.observers) {
      if (!obs.email) continue;
      if (!observerTickets.has(obs.id)) {
        observerTickets.set(obs.id, { email: obs.email, name: obs.fullName, tickets: [] });
      }
      observerTickets.get(obs.id).tickets.push(ticket);
    }
  }

  const signature = await getEmailSignature();
  const frontendUrl = resolveFrontendUrl(settings);
  let totalSent = 0;

  for (const [, observer] of observerTickets) {
    const ticketCount = observer.tickets.length;
    const subject = `Récapitulatif — ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} ouvert${ticketCount > 1 ? 's' : ''} vous concernent`;

    const ticketRows = observer.tickets.map((t) => {
      const priorityColor = PRIORITY_COLORS[t.priority] || '#6b7280';
      const statusLabel = STATUS_LABELS[t.status] || t.status;
      const assigned = t.assignedTo?.fullName || 'Non assigné';
      const age = Math.ceil((now - new Date(t.createdAt)) / (1000 * 60 * 60 * 24));
      const link = `${frontendUrl}/tickets/${t.id}`;
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 12px;font-weight:700;color:#1a1a2e;">
            <a href="${link}" style="color:#0067ff;text-decoration:none;">#${t.id}</a>
          </td>
          <td style="padding:10px 12px;color:#1a1a2e;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${t.title || ''}
          </td>
          <td style="padding:10px 12px;text-align:center;">
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${priorityColor};">
              ${t.priority}
            </span>
          </td>
          <td style="padding:10px 12px;font-size:12px;color:#4a4a6a;">
            ${statusLabel}
          </td>
          <td style="padding:10px 12px;font-size:12px;color:#4a4a6a;">
            ${assigned}
          </td>
          <td style="padding:10px 12px;font-size:12px;color:#4a4a6a;text-align:center;">
            ${age}j
          </td>
        </tr>
      `;
    }).join('');

    const bodyHtml = buildEmailLayout(`
      <p style="margin:0 0 16px;font-size:14px;color:#1a1a2e;">
        Bonjour <strong>${observer.name || ''}</strong>,
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#4a4a6a;">
        Voici le récapitulatif des <strong>${ticketCount} ticket${ticketCount > 1 ? 's' : ''} ouvert${ticketCount > 1 ? 's' : ''}</strong> dont vous êtes observateur.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">#</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Titre</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Priorité</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Statut</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Assigné à</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Âge</th>
          </tr>
        </thead>
        <tbody>
          ${ticketRows}
        </tbody>
      </table>
      <a href="${frontendUrl}/portal" style="display:inline-block;padding:12px 24px;background:#0067ff;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Accéder au portail
      </a>
      ${signature || ''}
    `, `Récapitulatif tickets ouverts`);

    try {
      await sendEmail({ to: observer.email, subject, bodyHtml, saveAsMessage: false });
      totalSent++;
    } catch (err) {
      console.error(`[observerSummary] Échec envoi vers ${observer.email}:`, err.message);
    }
  }

  // Marquer comme envoyé aujourd'hui
  await prisma.systemSettings.update({
    where: { id: 1 },
    data: { observerSummaryLastSentDate: today },
  });

  console.log(`[observerSummary] Récapitulatif envoyé à ${totalSent} observateur${totalSent > 1 ? 's' : ''}`);
  return { sent: totalSent };
}

module.exports = { sendObserverSummary };
