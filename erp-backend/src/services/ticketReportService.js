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

// ── Statuts en langage naturel → filtre réel ─────────────────────────────────
// « tickets ouverts » = le groupe Ouverts (badge « Ouverts » du dashboard, filtre
// « Ouverts (actifs) » de l'ERP), PAS le statut exact OPEN qui ne couvre que les
// tickets en cours de traitement. Sans cette conversion, un rapport « ouverts »
// excluait silencieusement NEW, PLANNED, PENDING et WAITING_FOR_USER.
const STATUS_ALIASES = {
  OPEN: 'OPEN_GROUP',
  OUVERT: 'OPEN_GROUP',
  OUVERTS: 'OPEN_GROUP',
  'TICKETS_OUVERTS': 'OPEN_GROUP',
};

const KNOWN_STATUS_VALUES = new Set([
  'NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED',
  'OPEN_GROUP', 'PENDING_GROUP', 'CLOSED_GROUP', 'NOT_CLOSED', 'SOLVED_GROUP',
  ...Object.keys(STATUS_ALIASES),
]);

function normalizeReportStatus(status) {
  if (!status) return status;
  const key = String(status).trim().toUpperCase().replace(/\s+/g, '_');
  if (!KNOWN_STATUS_VALUES.has(key)) return status;
  return STATUS_ALIASES[key] || key;
}

// Étiquettes lisibles des statuts/groupes pour le résumé affiché avant confirmation.
const STATUS_FILTER_LABELS = {
  OPEN_GROUP: 'Ouverts (NEW, OPEN, PLANNED, PENDING, WAITING_FOR_USER)',
  PENDING_GROUP: 'En attente (PENDING, WAITING_FOR_USER)',
  PENDING: 'En attente (PENDING, WAITING_FOR_USER)',
  CLOSED_GROUP: 'Clôturés / résolus (SOLVED, CLOSED)',
  NOT_CLOSED: 'Tous sauf clôturés',
  SOLVED_GROUP: 'Résolu (SOLVED)',
};

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

  if (args.status) query.status = normalizeReportStatus(args.status);
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

// ── Destinataire du rapport ──────────────────────────────────────────────────
// Par défaut : l'utilisateur qui demande le rapport. args.to permet de l'adresser
// à quelqu'un d'autre (« envoie-le à steven.yapo@prosuma.ci »).
const EMAIL_RE = /^\S+@\S+\.\S+$/;

function resolveRecipient(user, args = {}, explicitTo = null) {
  const raw = explicitTo || args.to;
  if (!raw) return user?.email || null;
  const value = String(raw).trim();
  if (!EMAIL_RE.test(value)) {
    const err = new Error(`Adresse email du destinataire invalide : « ${value} »`);
    err.code = 'INVALID_RECIPIENT';
    throw err;
  }
  return value;
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
  if (query.status) parts.push(`statut : ${STATUS_FILTER_LABELS[query.status] || query.status}`);
  if (query.priority) parts.push(`priorité : ${query.priority}`);
  if (query.search) parts.push(`mot-clé : « ${query.search} »`);
  return parts.length > 0 ? parts.join(' · ') : 'tous les tickets visibles pour vous';
}

// ── Valeurs en français dans les extractions ─────────────────────────────────
// Les codes techniques (OPEN, INCIDENT, NOT_REQUIRED…) sont lisibles par la
// machine mais pas par un export envoyé à un utilisateur : on traduit dans le
// CSV comme dans le XLSX. Libellés alignés sur erp-frontend/src/constants/tickets.js.
const EXPORT_STATUS_LABELS = {
  NEW: 'Nouveau',
  OPEN: 'En cours',
  PLANNED: 'Planifié',
  PENDING: 'En attente',
  WAITING_FOR_USER: 'En attente demandeur',
  SOLVED: 'Résolu',
  CLOSED: 'Fermé',
};
const EXPORT_TYPE_LABELS = { INCIDENT: 'Incident', REQUEST: 'Demande' };
// source est une chaîne libre : on ne traduit que les valeurs connues
const EXPORT_SOURCE_LABELS = { Phone: 'Téléphone', Other: 'Autre' };
const EXPORT_APPROVAL_LABELS = {
  NOT_REQUIRED: 'Non requise',
  PENDING: 'En attente Hotline',
  APPROVED: 'Approuvé',
  REJECTED: 'Rejeté',
  SUPERSEDED: 'Remplacé',
};

// Libellé français d'une valeur technique (vide si absent, sinon valeur brute)
function frLabel(map, value) {
  if (value === null || value === undefined || value === '') return '';
  return map[value] || value;
}

// ── Catégorie / Sous-catégorie dans les extractions ──────────────────────────
// Ticket.category stocke le NOM de la catégorie (feuille), pas sa position dans
// l'arbre : on remonte les parents pour produire deux colonnes exploitables —
// « Catégorie » = racine de premier niveau, « Sous-catégorie » = chemin sous la
// racine (ex. « SOUS CA », ou « parent > enfant » au-delà de deux niveaux).
async function buildCategoryPathResolver() {
  const categories = await prisma.ticketCategory.findMany({ select: { id: true, name: true, parentId: true } });
  const byId = new Map(categories.map((c) => [c.id, c]));
  const byName = new Map(categories.map((c) => [c.name, c]));
  const cache = new Map();

  return function resolve(name) {
    if (!name) return { root: '', sub: '' };
    if (cache.has(name)) return cache.get(name);

    const chain = [];
    const seen = new Set();
    let current = byName.get(name);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.unshift(current);
      current = current.parentId == null ? null : byId.get(Number(current.parentId));
    }
    // Catégorie inconnue (renommée ou supprimée) : on garde le libellé brut en racine
    const res = chain.length === 0
      ? { root: name, sub: '' }
      : { root: chain[0].name, sub: chain.slice(1).map((c) => c.name).join(' > ') };
    cache.set(name, res);
    return res;
  };
}

// Ajoute t.categoryRoot / t.categorySub sur chaque ticket. Idempotent : on ne
// recharge l'arbre des catégories que si un ticket n'a pas encore été traité.
async function decorateCategoryPaths(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return tickets;
  if (tickets.every((t) => t.categoryRoot !== undefined)) return tickets;
  const resolve = await buildCategoryPathResolver();
  for (const t of tickets) {
    const { root, sub } = resolve(t.category);
    t.categoryRoot = root;
    t.categorySub = sub;
  }
  return tickets;
}

// ── Génération XLSX (mêmes colonnes que l'export serveur) ────────────────────
async function buildTicketsXlsxBuffer(tickets) {
  await decorateCategoryPaths(tickets);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tickets');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Titre', key: 'title', width: 45 },
    { header: 'Statut', key: 'status', width: 16 },
    { header: 'Priorité', key: 'priority', width: 10 },
    { header: 'Catégorie', key: 'category', width: 22 },
    { header: 'Sous-catégorie', key: 'categorySub', width: 26 },
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
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columns.length).letter}1` };

  for (const t of tickets) {
    sheet.addRow({
      id: t.id,
      title: t.title,
      status: frLabel(EXPORT_STATUS_LABELS, t.status),
      priority: t.priority,
      category: t.categoryRoot || t.category || '',
      categorySub: t.categorySub || '',
      type: frLabel(EXPORT_TYPE_LABELS, t.type),
      source: frLabel(EXPORT_SOURCE_LABELS, t.source),
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
      approvalStatus: frLabel(EXPORT_APPROVAL_LABELS, t.approvalStatus),
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── Génération CSV (séparateur « ; », UTF-8 BOM, mêmes colonnes que le XLSX) ─
async function buildTicketsCsv(tickets) {
  await decorateCategoryPaths(tickets);
  const header = [
    'id', 'titre', 'statut', 'priorite', 'categorie', 'sous_categorie', 'type', 'source',
    'demandeur', 'technicien', 'equipe', 'lieu', 'cree_le', 'resolu_le', 'ferme_le',
    'sla_reponse_due', 'sla_resolution_due', 'sla_depasse_le', 'premiere_reponse', 'ia', 'approbation',
  ];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = tickets.map((t) => [
    t.id, cell(t.title), frLabel(EXPORT_STATUS_LABELS, t.status), t.priority,
    cell(t.categoryRoot || t.category || ''), cell(t.categorySub || ''),
    frLabel(EXPORT_TYPE_LABELS, t.type), cell(frLabel(EXPORT_SOURCE_LABELS, t.source)),
    t.requester?.fullName ? `${t.requester.fullName} (${t.requester.email})` : (t.requester?.email || ''),
    t.assignedTo?.fullName ? `${t.assignedTo.fullName} (${t.assignedTo.email})` : (t.assignedTo?.email || ''),
    t.team?.name || '',
    t.locationName || '', t.createdAt?.toISOString() || '', t.solvedAt?.toISOString() || '',
    t.closedAt?.toISOString() || '', t.slaResponseDueAt?.toISOString() || '', t.slaResolutionDueAt?.toISOString() || '',
    t.slaBreachedAt?.toISOString() || '', t.firstResponseAt?.toISOString() || '', t.aiProcessed ? 'oui' : 'non',
    frLabel(EXPORT_APPROVAL_LABELS, t.approvalStatus),
  ]);
  return [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
}

// ── Envoi HTTP d'une extraction (CSV / XLSX) ─────────────────────────────────
// Réutilisé par les exports des vues Catégories et Lieux : mêmes colonnes que
// GET /tickets/export, y compris Catégorie / Sous-catégorie.
async function sendTicketsExport(res, tickets, { format = 'xlsx', filenamePrefix = 'tickets_export' } = {}) {
  const normalized = format === 'csv' ? 'csv' : 'xlsx';
  const day = new Date().toISOString().slice(0, 10);
  const filename = `${filenamePrefix}_${day}.${normalized}`;
  await decorateCategoryPaths(tickets);

  if (normalized === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('\uFEFF' + await buildTicketsCsv(tickets));
  }

  const buffer = await buildTicketsXlsxBuffer(tickets);
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
}

// ── Aperçu (avant confirmation) : compte les tickets sans rien envoyer ───────
async function previewReport(user, args = {}) {
  const to = resolveRecipient(user, args);
  const query = await resolveReportQuery(args);
  const tickets = await fetchReportTickets(user, query);
  return {
    count: tickets.length,
    filtersLabel: describeFilters(query),
    to,
    cc: await resolveCcEmails(args, to),
    query,
  };
}

// ── Envoi : fetch → XLSX → email avec pièce jointe ───────────────────────────
async function sendTicketReportEmail({ user, args = {}, cc, to }) {
  const recipient = resolveRecipient(user, args, to);
  if (!recipient) throw new Error('Adresse email du destinataire introuvable');

  const query = await resolveReportQuery(args);
  const tickets = await fetchReportTickets(user, query);
  if (tickets.length === 0) {
    return { count: 0, sent: false, filtersLabel: describeFilters(query), cc: [], to: recipient };
  }

  const account = await getActiveEmailAccount();
  if (!account) throw new Error('Aucun compte email configuré pour l\'envoi (Outlook/M365 ou SMTP)');
  if (!user?.email) throw new Error('Adresse email de l\'expéditeur introuvable');

  // Copie : adresses explicites (param cc) + membres des équipes citées (ccTeams)
  const ccList = await resolveCcEmails(cc && cc.length > 0 ? { ...args, cc } : args, recipient);

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
    to: recipient,
    cc: ccList,
    subject,
    bodyHtml: html,
    attachments: [{ filename, content: buffer, contentType: XLSX_MIME }],
    saveAsMessage: false,
  });

  console.log(`[ticketReport] Rapport envoyé à ${recipient}${ccList.length ? ` (cc: ${ccList.join(', ')})` : ''} — ${tickets.length} ticket(s)`);
  return { count: tickets.length, sent: true, filename, subject, filtersLabel, cc: ccList, to: recipient };
}

module.exports = {
  periodToRange,
  periodLabel,
  resolveReportQuery,
  resolveRecipient,
  normalizeReportStatus,
  resolveCcEmails,
  fetchReportTickets,
  describeFilters,
  buildTicketsXlsxBuffer,
  buildTicketsCsv,
  decorateCategoryPaths,
  sendTicketsExport,
  TICKET_EXPORT_SELECT: REPORT_SELECT,
  previewReport,
  sendTicketReportEmail,
};
