// ── Exports CSV / XLSX des journaux (Journal d'activité + Audit système) ──────
// Colonnes alignées sur les vues UI : mêmes libellés, mêmes formats de date.
const ExcelJS = require('exceljs');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_DETAIL_LENGTH = 2000;

// Détail (payload/metadata JSON) : résumé des changements quand ils existent,
// sinon le JSON tronqué (limite de cellule Excel + lisibilité).
function detailOf(value) {
  if (value === null || value === undefined) return '';
  const changes = Array.isArray(value.changes) ? value.changes : [];
  if (changes.length > 0) {
    const summary = changes
      .slice(0, 20)
      .map((c) => `${c.field}: ${c.fromLabel ?? c.from ?? ''} → ${c.toLabel ?? c.to ?? ''}`)
      .join(' | ');
    return changes.length > 20 ? `${summary} | … (+${changes.length - 20})` : summary;
  }
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
  } catch {
    return '';
  }
}

function decorateSheet(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columns.length).letter}1` };
}

// ── Journal d'activité (TicketEvent) ─────────────────────────────────────────
function buildTicketEventsRows(events) {
  return events.map((e) => ({
    createdAt: e.createdAt,
    type: e.type,
    actor: e.actor || '',
    ticketId: e.ticket?.id ?? e.ticketId ?? '',
    ticketTitle: e.ticket?.title ?? '',
    detail: detailOf(e.payload),
  }));
}

async function buildTicketEventsXlsxBuffer(events) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Journal d'activité");
  sheet.columns = [
    { header: 'Date', key: 'createdAt', width: 20 },
    { header: 'Type', key: 'type', width: 30 },
    { header: 'Acteur', key: 'actor', width: 30 },
    { header: 'Ticket', key: 'ticketId', width: 10 },
    { header: 'Titre', key: 'ticketTitle', width: 45 },
    { header: 'Détail', key: 'detail', width: 60 },
  ];
  sheet.getColumn('createdAt').numFmt = 'dd/mm/yyyy hh:mm';
  decorateSheet(sheet);
  for (const row of buildTicketEventsRows(events)) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildTicketEventsCsv(events) {
  const header = ['date', 'type', 'acteur', 'ticket', 'titre', 'detail'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = buildTicketEventsRows(events).map((r) => [
    r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt || ''),
    cell(r.type), cell(r.actor), r.ticketId, cell(r.ticketTitle), cell(r.detail),
  ]);
  return [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
}

// ── Audit système (AuditLog) ─────────────────────────────────────────────────
function buildAuditLogsRows(logs) {
  return logs.map((l) => ({
    createdAt: l.createdAt,
    action: l.action,
    actor: l.actorEmail || 'SYSTEM',
    targetType: l.targetType || '',
    targetId: l.targetId ?? '',
    targetLabel: l.targetLabel || '',
    ipAddress: l.ipAddress || '',
    detail: detailOf(l.metadata),
  }));
}

async function buildAuditLogsXlsxBuffer(logs) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Audit');
  sheet.columns = [
    { header: 'Date', key: 'createdAt', width: 20 },
    { header: 'Action', key: 'action', width: 32 },
    { header: 'Acteur', key: 'actor', width: 30 },
    { header: 'Type cible', key: 'targetType', width: 20 },
    { header: 'Réf cible', key: 'targetId', width: 10 },
    { header: 'Cible', key: 'targetLabel', width: 40 },
    { header: 'IP', key: 'ipAddress', width: 18 },
    { header: 'Détail', key: 'detail', width: 60 },
  ];
  sheet.getColumn('createdAt').numFmt = 'dd/mm/yyyy hh:mm';
  decorateSheet(sheet);
  for (const row of buildAuditLogsRows(logs)) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildAuditLogsCsv(logs) {
  const header = ['date', 'action', 'acteur', 'type_cible', 'ref_cible', 'cible', 'ip', 'detail'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = buildAuditLogsRows(logs).map((r) => [
    r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt || ''),
    cell(r.action), cell(r.actor), cell(r.targetType), r.targetId, cell(r.targetLabel),
    cell(r.ipAddress), cell(r.detail),
  ]);
  return [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
}

// ── Envoi HTTP d'une extraction (CSV / XLSX) ─────────────────────────────────
async function sendLogExport(res, { format = 'xlsx', filenamePrefix, data = [], kind = 'events' }) {
  const normalized = format === 'csv' ? 'csv' : 'xlsx';
  const day = new Date().toISOString().slice(0, 10);
  const filename = `${filenamePrefix}_${day}.${normalized}`;
  const isAudit = kind === 'audit';

  if (normalized === 'csv') {
    const csv = isAudit ? buildAuditLogsCsv(data) : buildTicketEventsCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('\uFEFF' + csv);
  }

  const buffer = isAudit ? await buildAuditLogsXlsxBuffer(data) : await buildTicketEventsXlsxBuffer(data);
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
}

module.exports = {
  buildTicketEventsCsv,
  buildTicketEventsXlsxBuffer,
  buildAuditLogsCsv,
  buildAuditLogsXlsxBuffer,
  sendLogExport,
};
