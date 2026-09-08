const prisma = require('../prismaClient');
const { sendEmail, getEmailSignature, buildEmailLayout } = require('./emailSender');
const { getSystemSettings } = require('./systemSettings');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');

const OPEN_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
const PRIORITY_ORDER = ['P1', 'P2', 'P3', 'P4'];
const PRIORITY_LABEL = { P1: 'P1 - Critique', P2: 'P2 - Haute', P3: 'P3 - Moyenne', P4: 'P4 - Basse' };
const PRIORITY_COLORS = { P1: '#dc2626', P2: '#d97706', P3: '#2563eb', P4: '#16a34a' };
const STATUS_LABELS = {
  NEW: 'Nouveau',
  OPEN: 'En cours',
  PLANNED: 'Planifié',
  PENDING: 'En attente',
  WAITING_FOR_USER: 'En attente de réponse',
  SOLVED: 'Résolu',
  CLOSED: 'Fermé',
};
const STATUS_COLORS = {
  NEW: '#2563eb', OPEN: '#2563eb', PLANNED: '#7c3aed',
  PENDING: '#d97706', WAITING_FOR_USER: '#d97706',
  SOLVED: '#16a34a', CLOSED: '#6b7280',
};

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function requesterLabel(ticket) {
  return ticket.sourceName || ticket.requester?.fullName || ticket.sourceEmail || ticket.requester?.email || '—';
}

// Demande à l'IA un résumé en 2-3 phrases mettant en avant ce qui demande une action immédiate
// (critiques, non assignés, sans réponse depuis longtemps) — dégradation silencieuse vers null si
// aucun fournisseur IA n'est actif ou en cas d'échec, le mail reste utile sans ce résumé.
async function generateInsight(tickets) {
  if (tickets.length === 0) return null;
  const providers = await getActiveProviders();
  if (providers.length === 0) return null;

  const ticketsList = tickets
    .map((t) => `- #${t.glpiTicketId || t.id} "${t.title}" — ${PRIORITY_LABEL[t.priority] || t.priority}, ${t.status}, assigné à ${t.assignedTo?.fullName || 'personne'}, demandeur ${requesterLabel(t)}, ouvert depuis ${daysSince(t.createdAt)} j`)
    .join('\n');

  try {
    const prompt = await getPrompt('dailySummaryInsight', { ticketsList });
    const raw = await callAiWithRetry(() => callProviderWithFallback(providers, prompt, 'background'), { maxRetries: 3, baseDelay: 1000 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return parsed.insight || null;
  } catch (err) {
    console.error('[dailySummary] Échec génération du résumé IA:', err.message);
    return null;
  }
}

// Construit le HTML du récapitulatif quotidien des tickets ouverts (fonction pure, sans envoi).
// Utilise le gabarit email commun (buildEmailLayout) : bandeau, cartes de comptage par priorité,
// tableau stylisé avec statuts/priorités colorés. `insight` est le résumé en langage naturel
// généré par l'IA (cf. generateInsight), optionnel.
function buildDailySummaryHtml(tickets, signature, insight) {
  const byPriority = PRIORITY_ORDER.reduce((acc, p) => ({ ...acc, [p]: tickets.filter((t) => t.priority === p) }), {});
  const staleTickets = tickets.filter((t) => daysSince(t.lastUserReplyAt || t.updatedAt) >= 3);

  // Cartes de comptage par priorité (tableau pour compatibilité avec les clients mail, pas de flexbox)
  const countsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">
  <tr>
    ${PRIORITY_ORDER.map((p) => {
      const count = byPriority[p].length;
      const color = PRIORITY_COLORS[p] || '#666';
      return `<td width="25%" style="padding:4px">
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px 8px;text-align:center">
        <div style="font-size:22px;font-weight:bold;color:${color}">${count}</div>
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px">${PRIORITY_LABEL[p]}</div>
      </div>
    </td>`;
    }).join('')}
  </tr>
</table>`;

  const rowsHtml = tickets
    .map((t) => {
      const pColor = PRIORITY_COLORS[t.priority] || '#666';
      const sColor = STATUS_COLORS[t.status] || '#6b7280';
      return `<tr>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f2"><strong>#${t.glpiTicketId || t.id}</strong></td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f2">${t.title}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f2"><span style="color:${pColor};font-weight:600">${PRIORITY_LABEL[t.priority] || t.priority}</span></td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f2"><span style="color:${sColor};font-weight:600">${STATUS_LABELS[t.status] || t.status}</span></td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f2">${t.assignedTo?.fullName || 'Non assigné'}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f2">${requesterLabel(t)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f2">${daysSince(t.createdAt)} j</td>
</tr>`;
    })
    .join('');

  const tableHtml = `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;font-family:sans-serif">
  <thead>
    <tr style="background:#2563eb;color:#ffffff;text-align:left">
      <th style="padding:8px 10px">Ticket</th>
      <th style="padding:8px 10px">Titre</th>
      <th style="padding:8px 10px">Priorité</th>
      <th style="padding:8px 10px">Statut</th>
      <th style="padding:8px 10px">Assigné à</th>
      <th style="padding:8px 10px">Demandeur</th>
      <th style="padding:8px 10px">Âge</th>
    </tr>
  </thead>
  <tbody>${rowsHtml || '<tr><td colspan="7" style="padding:12px;color:#6b7280">Aucun ticket ouvert.</td></tr>'}</tbody>
</table>`;

  const staleNote = staleTickets.length > 0
    ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin:16px 0;color:#92400e;font-size:13px"><strong>⚠️ Attention :</strong> ${staleTickets.length} ticket(s) sans réponse du demandeur depuis 3 jours ou plus.</div>`
    : '';

  const insightHtml = insight
    ? `<div style="background:#eff6ff;border-left:4px solid #2563eb;border-radius:8px;padding:10px 14px;margin:16px 0;color:#1e3a8a;font-size:14px"><strong>En bref :</strong> ${insight}</div>`
    : '';

  return buildEmailLayout({
    headerTitle: 'Récapitulatif des tickets ouverts',
    headerSubtitle: `${tickets.length} ticket(s) ouvert(s)`,
    signature,
    children: `
<p style="margin:0 0 12px">Bonjour,</p>
<p style="margin:0 0 12px">Voici le récapitulatif des tickets ouverts au ${new Date().toLocaleDateString('fr-FR')}.</p>
${insightHtml}
${countsHtml}
${staleNote}
${tableHtml}
<p style="margin:12px 0 0;color:#6b7280;font-size:12px">Envoyé automatiquement par le système de support — aucune action requise.</p>`,
  });
}

// Envoie un récapitulatif (HTML + sujet déjà construits) à une liste d'adresses, en continuant
// vers les destinataires suivants si l'un échoue (ex: adresse invalide) — chaque échec est tracé
// mais ne doit jamais empêcher les autres destinataires de recevoir le mail.
async function sendToRecipients(recipients, subject, bodyHtml) {
  let sentCount = 0;
  for (const recipient of recipients) {
    try {
      await sendEmail({ to: recipient, subject, bodyHtml, saveAsMessage: false });
      sentCount += 1;
    } catch (err) {
      console.error(`[dailySummary] Échec envoi récapitulatif vers ${recipient}:`, err.message);
    }
  }
  return sentCount;
}

// Envoie le récapitulatif quotidien des tickets ouverts. Deux canaux indépendants, configurés
// séparément :
// 1. dailySummaryRecipients (Paramètres > Automatisation) : reçoit TOUS les tickets ouverts, tous équipes confondues.
// 2. Team.groupEmail (page Équipes) : chaque équipe ayant un email de groupe configuré reçoit
//    uniquement les tickets ouverts rattachés à CETTE équipe — permet à l'équipe Réseau de ne voir
//    que ses propres tickets, sans recevoir ceux du Développement et inversement.
// Pas de ticketId/saveAsMessage sur aucun des deux : ce mail ne concerne aucun ticket précis, ne
// doit apparaître dans le fil de conversation d'aucun ticket.
async function sendDailySummary() {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      // Exclut les tickets supprimés (corbeille) et ceux rejetés/en attente d'approbation —
      // même convention que la liste des tickets ouverts (dashboard.routes.js / ticket.routes.js).
      deletedAt: null,
      approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
    },
    include: {
      assignedTo: { select: { fullName: true } },
      requester: { select: { fullName: true, email: true } },
      team: { select: { id: true, name: true, groupEmail: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const settings = await getSystemSettings();
  const globalRecipients = settings.dailySummaryRecipients || [];
  const teamsWithEmail = [...new Map(tickets.filter((t) => t.team?.groupEmail).map((t) => [t.team.id, t.team])).values()];

  if (globalRecipients.length === 0 && teamsWithEmail.length === 0) {
    return { sent: false, reason: 'Aucun destinataire configuré (ni liste globale, ni email de groupe par équipe)' };
  }

  const signature = await getEmailSignature();
  let totalRecipients = 0;

  if (globalRecipients.length > 0) {
    const insight = await generateInsight(tickets);
    const bodyHtml = buildDailySummaryHtml(tickets, signature, insight);
    const subject = `Récapitulatif des tickets ouverts — ${new Date().toLocaleDateString('fr-FR')} (${tickets.length})`;
    totalRecipients += await sendToRecipients(globalRecipients, subject, bodyHtml);
  }

  for (const team of teamsWithEmail) {
    const teamTickets = tickets.filter((t) => t.team?.id === team.id);
    const insight = await generateInsight(teamTickets);
    const bodyHtml = buildDailySummaryHtml(teamTickets, signature, insight);
    const subject = `Récapitulatif des tickets ouverts — ${team.name} — ${new Date().toLocaleDateString('fr-FR')} (${teamTickets.length})`;
    totalRecipients += await sendToRecipients([team.groupEmail], subject, bodyHtml);
  }

  return { sent: true, ticketCount: tickets.length, recipientCount: totalRecipients };
}

// Vérifié chaque minute par server.js : si l'heure locale actuelle correspond (à la minute) à
// dailySummaryTime ET que l'envoi n'a pas déjà eu lieu aujourd'hui (dailySummaryLastSentDate),
// déclenche l'envoi puis marque la date pour ne pas renvoyer plusieurs fois dans la même minute/heure.
async function checkAndSendDailySummary() {
  const settings = await getSystemSettings();
  if (!settings.dailySummaryEnabled) return;

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // "HH:mm" en heure locale du serveur
  const today = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

  if (currentTime !== settings.dailySummaryTime) return;
  if (settings.dailySummaryLastSentDate === today) return;

  await prisma.systemSettings.update({ where: { id: 1 }, data: { dailySummaryLastSentDate: today } });
  await sendDailySummary();
}

module.exports = { sendDailySummary, checkAndSendDailySummary, buildDailySummaryHtml };
