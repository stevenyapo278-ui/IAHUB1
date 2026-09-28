const ExcelJS = require('exceljs');
const prisma = require('../prismaClient');
const { buildTicketWhereClause } = require('./ticketQueryService');
const { sendEmail, getActiveEmailAccount, buildEmailLayout } = require('./emailSender');

// Colonnes du rapport — identiques à GET /tickets/export (même perimetre, même rendu).
const REPORT_SELECT = {
  id: true, title: true, status: true, priority: true, category: true, type: true,
  source: true, requesterId: true, assignedToId: true, teamId: true,
  locationName: true,
  createdAt: true, solvedAt: true, closedAt: true,
  slaResponseDueAt: true, slaResolutionDueAt: true, slaBreachedAt: true, firstResponseAt: true,
  aiProcessed: true, approvalStatus: true,
  requester: { select: { email: true, fullName: true, avatarUrl: true } },
  assignedTo: { select: { email: true, fullName: true, avatarUrl: true } },
  assignees: { select: { id: true, email: true, fullName: true, avatarUrl: true } },
  team: { select: { name: true } },
  observers: { select: { id: true, fullName: true, avatarUrl: true } },
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Périodes en langage naturel → bornes de date ─────────────────────────────
// period: today | yesterday | 7d | 30d | 90d | this_month | last_month
// Retourne { dateFrom, dateTo } (YYYY-MM-DD) ou null si période inconnue/absente.
function periodToRange(period) {
  if (!period) return null;
  const now = new Date();
  const p = String(period).toLowerCase().trim();
  const day = (offset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return isoDate(d);
  };
  switch (p) {
    case 'today':
      return { dateFrom: day(0), dateTo: day(0) };
    case 'yesterday':
      return { dateFrom: day(-1), dateTo: day(-1) };
    case '7d': case '7_days': case 'last_7d':
      return { dateFrom: day(-6), dateTo: day(0) };
    case '30d': case '30_days': case 'last_30d':
      return { dateFrom: day(-29), dateTo: day(0) };
    case '90d': case '90_days': case 'last_90d':
      return { dateFrom: day(-89), dateTo: day(0) };
    case 'this_month': case 'ce_mois': case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { dateFrom: isoDate(from), dateTo: isoDate(to) };
    }
    case 'last_month': case 'mois_dernier': case 'previous_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: isoDate(from), dateTo: isoDate(to) };
    }
    default:
      return null;
  }
}

// Étiquette lisible de la période (pour le résumé de confirmation).
function periodLabel(period) {
  if (!period) return null;
  const range = periodToRange(period);
  if (!range) return null;
  const p = String(period).toLowerCase();
  if (p === 'today') return "aujourd'hui";
  if (p === 'yesterday') return 'hier';
  if (p === 'this_month' || p === 'ce_mois' || p === 'month') return 'ce mois';
  if (p === 'last_month' || p === 'mois_dernier' || p === 'previous_month') return 'le mois dernier';
  if (/^(\d+)d$/.test(p)) return `les ${p.match(/^(\d+)d$/)[1]} derniers jours`;
  return `${range.dateFrom} → ${range.dateTo}`;
}

// ── Args de l'outil LLM → paramètres de filtre Prisma ────────────────────────
async function resolveReportQuery(args = {}) {
  const query = {};

  const range = periodToRange(args.period) || null;
  if (range) {
    query.dateFrom = range.dateFrom;
    query.dateTo = range.dateTo;
  }
  if (args.dateFrom) query.dateFrom = args.dateFrom;
  if (args.dateTo) query.dateTo = args.dateTo;

  if (args.status) query.status = args.status;
  if (args.priority) query.priority = args.priority;
  if (args.category) query.category = args.category;
  if (args.search || args.query) query.search = args.search || args.query;

  if (args.team) {
    const name = String(args.team).trim();
    let team = await prisma.team.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!team) {
      team = await prisma.team.findFirst({
        where: { name: { contains: name, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
    }
    if (!team) {
      const err = new Error(`Équipe « ${name} » introuvable`);
      err.code = 'TEAM_NOT_FOUND';
      throw err;
    }
    query.teamId = team.id;
    query._teamName = team.name;
  }

  return query;
}

// ── Adresses en copie : explicites + membres des équipes citées ─────────────
// args.cc : adresses littérales · args.ccTeams : noms d'équipes dont on prend
// tous les membres actifs + observateurs par défaut. Le destinataire est exclu,
// la liste est dédupliquée et plafonnée à 20 adresses.
async function resolveCcEmails(args = {}, recipientEmail = null) {
  const emails = [];
  const push = (e) => {
    const v = String(e || '').trim().toLowerCase();
    if (/^\S+@\S+\.\S+$/.test(v)) emails.push(v);
  };

  (Array.isArray(args.cc) ? args.cc : [args.cc]).forEach(push);

  const teamNames = (Array.isArray(args.ccTeams) ? args.ccTeams : (args.ccTeam ? [args.ccTeam] : []))
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const name of teamNames) {
    const team = await prisma.team.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: {
        name: true,
        members: { select: { email: true, isActive: true } },
        defaultObservers: { select: { email: true, isActive: true } },
      },
    });
    if (!team) {
      const err = new Error(`Équipe « ${name} » introuvable`);
      err.code = 'TEAM_NOT_FOUND';
      throw err;
    }
    [...team.members, ...team.defaultObservers].forEach((u) => {
      if (u.isActive) push(u.email);
    });
  }

  const rcpt = recipientEmail ? String(recipientEmail).trim().toLowerCase() : null;
  return [...new Set(emails)].filter((e) => e !== rcpt).slice(0, 20);
}

// ── Récupération des tickets (même périmètre RBAC que GET /export) ───────────
async function fetchReportTickets(user, query) {
  const where = buildTicketWhereClause(user, query);
  return prisma.ticket.findMany({
    where,
    take: 10000,
    orderBy: { createdAt: 'desc' },
    select: REPORT_SELECT,
  });
}

// ── Résumé lisible des filtres (affiché avant confirmation) ──────────────────
function describeFilters(query) {
  const parts = [];
  if (query.dateFrom || query.dateTo) {
    parts.push(`période : du ${query.dateFrom || '…'} au ${query.dateTo || '…'}`);
  }
  if (query._teamName || query.teamId) parts.push(`équipe : ${query._teamName || `#${query.teamId}`}`);
  if (query.category) parts.push(`catégorie : « ${query.category} »`);
  if (query.status) parts.push(`statut : ${query.status}`);
  if (query.priority) parts.push(`priorité : ${query.priority}`);
  if (query.search) parts.push(`mot-clé : « ${query.search} »`);
  return parts.length > 0 ? parts.join(' · ') : 'tous les tickets visibles pour vous';
}

// ── Génération XLSX (mêmes colonnes que l'export serveur) ────────────────────
async function buildTicketsXlsxBuffer(tickets) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tickets');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Titre', key: 'title', width: 45 },
    { header: 'Statut', key: 'status', width: 16 },
    { header: 'Priorité', key: 'priority', width: 10 },
    { header: 'Catégorie', key: 'category', width: 22 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Source', key: 'source', width: 12 },
    { header: 'Demandeur', key: 'requester', width: 28 },
    { header: 'Technicien', key: 'technician', width: 28 },
    { header: 'Équipe', key: 'team', width: 20 },
    { header: 'Lieu', key: 'location', width: 18 },
    { header: 'Créé le', key: 'createdAt', width: 18 },
    { header: 'Résolu le', key: 'solvedAt', width: 18 },
    { header: 'Fermé le', key: 'closedAt', width: 18 },
    { header: 'SLA réponse due', key: 'slaResponseDueAt', width: 18 },
    { header: 'SLA résolution due', key: 'slaResolutionDueAt', width: 18 },
    { header: 'SLA dépassé le', key: 'slaBreachedAt', width: 18 },
    { header: 'Première réponse', key: 'firstResponseAt', width: 18 },
    { header: 'IA', key: 'aiProcessed', width: 6 },
    { header: 'Approbation', key: 'approvalStatus', width: 14 },
  ];
  for (const col of ['createdAt', 'solvedAt', 'closedAt', 'slaResponseDueAt', 'slaResolutionDueAt', 'slaBreachedAt', 'firstResponseAt']) {
    sheet.getColumn(col).numFmt = 'dd/mm/yyyy hh:mm';
  }
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'T1' };

  for (const t of tickets) {
    sheet.addRow({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category || '',
      type: t.type,
      source: t.source || '',
      requester: t.requester?.fullName ? `${t.requester.fullName} (${t.requester.email})` : (t.requester?.email || ''),
      technician: t.assignedTo?.fullName ? `${t.assignedTo.fullName} (${t.assignedTo.email})` : (t.assignedTo?.email || ''),
      team: t.team?.name || '',
      location: t.locationName || '',
      createdAt: t.createdAt,
      solvedAt: t.solvedAt,
      closedAt: t.closedAt,
      slaResponseDueAt: t.slaResponseDueAt,
      slaResolutionDueAt: t.slaResolutionDueAt,
      slaBreachedAt: t.slaBreachedAt,
      firstResponseAt: t.firstResponseAt,
      aiProcessed: t.aiProcessed ? 'oui' : 'non',
      approvalStatus: t.approvalStatus,
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── Aperçu (avant confirmation) : compte les tickets sans rien envoyer ───────
async function previewReport(user, args = {}) {
  const query = await resolveReportQuery(args);
  const tickets = await fetchReportTickets(user, query);
  return {
    count: tickets.length,
    filtersLabel: describeFilters(query),
    cc: await resolveCcEmails(args, user?.email),
    query,
  };
}

// ── Envoi : fetch → XLSX → email avec pièce jointe ───────────────────────────
async function sendTicketReportEmail({ user, args = {}, cc }) {
  const query = await resolveReportQuery(args);
  const tickets = await fetchReportTickets(user, query);
  if (tickets.length === 0) {
    return { count: 0, sent: false, filtersLabel: describeFilters(query), cc: [] };
  }

  const account = await getActiveEmailAccount();
  if (!account) throw new Error('Aucun compte email configuré pour l\'envoi (Outlook/M365 ou SMTP)');
  if (!user?.email) throw new Error('Adresse email de l\'expéditeur introuvable');

  // Copie : adresses explicites (param cc) + membres des équipes citées (ccTeams)
  const ccList = await resolveCcEmails(cc && cc.length > 0 ? { ...args, cc } : args, user.email);

  const day = new Date().toISOString().slice(0, 10);
  const filename = `rapport_tickets_${day}.xlsx`;
  const buffer = await buildTicketsXlsxBuffer(tickets);
  const filtersLabel = describeFilters(query);
  const subject = `Rapport de tickets — ${tickets.length} ticket(s) — ${day}`;

  const html = buildEmailLayout({
    headerTitle: 'Rapport de tickets',
    headerSubtitle: `${tickets.length} ticket(s) · généré le ${day}`,
    children: `
      <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 12px">
        Bonjour, voici le rapport de tickets demandé depuis l'assistant IA.
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 4px"><strong>Filtres appliqués :</strong></p>
      <p style="color:#374151;font-size:13px;margin:0 0 16px">${filtersLabel}</p>
      <p style="color:#6b7280;font-size:13px;margin:0">
        Le fichier <strong>${filename}</strong> est en pièce jointe (format XLSX).
      </p>`,
  });

  // sendEmail route selon le provider du compte actif (API Graph pour OUTLOOK, SMTP sinon) :
  // partir de sendEmailViaSmtp échouait systématiquement sur un compte Outlook (aucun hôte
  // SMTP → nodemailer retombe sur localhost:587 → ECONNREFUSED).
  await sendEmail({
    to: user.email,
    cc: ccList,
    subject,
    bodyHtml: html,
    attachments: [{ filename, content: buffer, contentType: XLSX_MIME }],
    saveAsMessage: false,
  });

  console.log(`[ticketReport] Rapport envoyé à ${user.email}${ccList.length ? ` (cc: ${ccList.join(', ')})` : ''} — ${tickets.length} ticket(s)`);
  return { count: tickets.length, sent: true, filename, subject, filtersLabel, cc: ccList };
}

module.exports = {
  periodToRange,
  periodLabel,
  resolveReportQuery,
  resolveCcEmails,
  fetchReportTickets,
  describeFilters,
  buildTicketsXlsxBuffer,
  previewReport,
  sendTicketReportEmail,
};
