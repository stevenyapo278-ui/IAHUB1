const prisma = require('../prismaClient');
const { sendEmail, getEmailSignature } = require('./emailSender');
const { getSystemSettings } = require('./systemSettings');
const { getActiveProvider, callProvider } = require('./mailAnalyzer');
const { getPrompt } = require('./promptTemplates');

const OPEN_STATUSES = ['NEW', 'OPEN', 'PENDING', 'WAITING_FOR_USER'];
const PRIORITY_ORDER = ['P1', 'P2', 'P3', 'P4'];
const PRIORITY_LABEL = { P1: 'P1 - Critique', P2: 'P2 - Haute', P3: 'P3 - Moyenne', P4: 'P4 - Basse' };

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
  const provider = await getActiveProvider();
  if (!provider) return null;

  const ticketsList = tickets
    .map((t) => `- #${t.glpiTicketId || t.id} "${t.title}" — ${PRIORITY_LABEL[t.priority] || t.priority}, ${t.status}, assigné à ${t.assignedTo?.fullName || 'personne'}, demandeur ${requesterLabel(t)}, ouvert depuis ${daysSince(t.createdAt)} j`)
    .join('\n');

  try {
    const prompt = await getPrompt('dailySummaryInsight', { ticketsList });
    const raw = await callProvider(provider, prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return parsed.insight || null;
  } catch (err) {
    console.error('[dailySummary] Échec génération du résumé IA:', err.message);
    return null;
  }
}

// Construit le HTML du récapitulatif quotidien des tickets ouverts (fonction pure, sans envoi).
// `insight` est le résumé en langage naturel généré par l'IA (cf. generateInsight), optionnel.
function buildDailySummaryHtml(tickets, signature, insight) {
  const byPriority = PRIORITY_ORDER.reduce((acc, p) => ({ ...acc, [p]: tickets.filter((t) => t.priority === p) }), {});
  const staleTickets = tickets.filter((t) => daysSince(t.lastUserReplyAt || t.updatedAt) >= 3);

  const countsHtml = PRIORITY_ORDER
    .map((p) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${PRIORITY_LABEL[p]}</td><td><strong>${byPriority[p].length}</strong></td></tr>`)
    .join('');

  const rowsHtml = tickets
    .map((t) => `
<tr>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">#${t.glpiTicketId || t.id}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.title}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${PRIORITY_LABEL[t.priority] || t.priority}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.status}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.assignedTo?.fullName || 'Non assigné'}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${requesterLabel(t)}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${daysSince(t.createdAt)} j</td>
</tr>`)
    .join('');

  const staleNote = staleTickets.length > 0
    ? `<p style="color:#b00">⚠️ ${staleTickets.length} ticket(s) sans réponse du demandeur depuis 3 jours ou plus.</p>`
    : '';

  const insightHtml = insight
    ? `<div style="background:#f4f4f4;border-left:3px solid #333;padding:10px 14px;margin:16px 0"><strong>En bref :</strong> ${insight}</div>`
    : '';

  return `
<p>Bonjour,</p>
<p>Voici le récapitulatif des tickets ouverts au ${new Date().toLocaleDateString('fr-FR')}.</p>
${insightHtml}
<table style="border-collapse:collapse;margin:16px 0">${countsHtml}</table>
${staleNote}
<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:13px">
  <thead>
    <tr style="background:#f4f4f4;text-align:left">
      <th style="padding:6px 10px">Ticket</th>
      <th style="padding:6px 10px">Titre</th>
      <th style="padding:6px 10px">Priorité</th>
      <th style="padding:6px 10px">Statut</th>
      <th style="padding:6px 10px">Assigné à</th>
      <th style="padding:6px 10px">Demandeur</th>
      <th style="padding:6px 10px">Âge</th>
    </tr>
  </thead>
  <tbody>${rowsHtml || '<tr><td colspan="7" style="padding:10px">Aucun ticket ouvert.</td></tr>'}</tbody>
</table>
${signature}
`.trim();
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
    where: { status: { in: OPEN_STATUSES } },
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
