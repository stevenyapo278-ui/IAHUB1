const ExcelJS = require('exceljs');

// Extraction de TABLEAU (une ligne = une entité : catégories, lieux…), distincte
// de l'extraction de tickets de ticketReportService. Mêmes formats que les tickets
// (XLSX avec en-tête stylisé + filtre automatique, CSV point-virgule UTF-8 BOM)
// pour que les deux exports s'ouvrent de la même manière dans Excel.

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Date → jj/mm/aaaa (le XLSX garde un objet Date et laisse Excel formater)
function formatFrDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function csvCell(value) {
  if (value === null || value === undefined || value === '') return '';
  const str = value instanceof Date ? formatFrDate(value) : String(value);
  return /[;"\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Envoie un fichier XLSX ou CSV.
 * @param {object} res        réponse Express
 * @param {object} options
 * @param {Array}  options.columns  [{ header, key, width?, numFmt? }]
 * @param {Array}  options.rows     [{ [key]: valeur }]
 * @param {string} options.format   'xlsx' | 'csv'
 * @param {string} options.filenamePrefix
 * @param {string} [options.sheetName]
 */
async function sendTableExport(res, { columns, rows, format = 'xlsx', filenamePrefix = 'export', sheetName }) {
  const normalized = format === 'csv' ? 'csv' : 'xlsx';
  const day = new Date().toISOString().slice(0, 10);
  const filename = `${filenamePrefix}_${day}.${normalized}`;

  if (normalized === 'csv') {
    const header = columns.map((c) => c.header).join(';');
    const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('\uFEFF' + [header, ...body].join('\n'));
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName || filenamePrefix);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columns.length).letter}1` };

  for (const row of rows) sheet.addRow(row);
  for (const c of columns) {
    if (c.numFmt) sheet.getColumn(c.key).numFmt = c.numFmt;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(Buffer.from(buffer));
}

module.exports = { sendTableExport, formatFrDate };
