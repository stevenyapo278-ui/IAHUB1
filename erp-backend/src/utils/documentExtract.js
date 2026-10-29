const path = require('path');
const fs = require('fs');
const os = require('os');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');

let odlConvert = null;
try {
  odlConvert = require('@opendataloader/pdf').convert;
} catch (_) {}

const pdfParse = require('pdf-parse');

// Plafond de texte extrait : au-delà, l'indexation coûterait des appels
// d'embedding pour un contenu qui n'apporte plus de contexte utile.
const MAX_EXTRACT_CHARS = 20000;

const TEXT_EXTENSIONS = new Set(['txt', 'log', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm']);
const TEXT_MIME_PREFIXES = ['text/'];

function extensionOf(filename) {
  return ((filename || '').split('.').pop() || '').toLowerCase();
}

function isTextType(mimeType, ext) {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return TEXT_MIME_PREFIXES.some((p) => (mimeType || '').startsWith(p));
}

function stripHtml(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cellToText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value.richText)) return value.richText.map((r) => r.text || '').join('');
  if (Array.isArray(value)) return value.map(cellToText).join(' ');
  if (value.text !== undefined) return String(value.text); // hyperlien
  if (value.result !== undefined) return cellToText(value.result); // formule
  if (value.error) return '';
  return '';
}

// Classeur Excel : une ligne par ligne de feuille, cellules séparées par « | ».
// C'est ce qui donne au RAG un contenu exploitable (références, montants, dates).
async function extractSpreadsheet(buffer, filename, ext) {
  if (ext === 'csv' || ext === 'tsv') {
    return buffer.toString('utf-8');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const lines = [];
  workbook.eachSheet((sheet) => {
    lines.push(`Feuille: ${sheet.name}`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = cellToText(cell.value).replace(/\s+/g, ' ').trim();
        if (text) cells.push(text);
      });
      if (cells.length > 0) lines.push(cells.join(' | '));
    });
  });
  return lines.join('\n');
}

async function extractPdf(buffer, filename) {
  if (odlConvert) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const tmpPdf = path.join(tmpDir, filename || 'upload.pdf');
    fs.writeFileSync(tmpPdf, buffer);

    try {
      await odlConvert([tmpPdf], {
        outputDir: tmpDir,
        format: 'markdown',
        quiet: true,
      });

      const base = path.basename(tmpPdf, '.pdf');
      const mdFile = path.join(tmpDir, base + '.md');
      if (fs.existsSync(mdFile)) {
        return fs.readFileSync(mdFile, 'utf-8');
      }

      const jsonFile = path.join(tmpDir, base + '.json');
      if (fs.existsSync(jsonFile)) {
        const json = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
        return json.content || json.text || JSON.stringify(json);
      }
    } catch (err) {
      console.warn('[documentExtract] opendataloader failed, falling back to pdf-parse:', err.message);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const data = await pdfParse(buffer);
  return data.text;
}

// Extrait le texte brut d'un fichier uploadé selon son type MIME/extension.
// Les images ne passent PAS par ici : elles sont traitées par OCR Vision dans
// services/attachmentIndexer.js.
async function extractText(buffer, mimeType, filename) {
  const ext = extensionOf(filename);

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return extractPdf(buffer, filename);
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === 'xlsx' || ext === 'csv' || ext === 'tsv' ||
      (mimeType || '').includes('spreadsheetml') || (mimeType || '').includes('ms-excel')) {
    return extractSpreadsheet(buffer, filename, ext);
  }

  if (isTextType(mimeType, ext)) {
    const raw = buffer.toString('utf-8');
    return (ext === 'html' || ext === 'htm' || (mimeType || '').includes('html')) ? stripHtml(raw) : raw;
  }

  throw new Error(`Type de fichier non supporté : ${mimeType || ext}`);
}

// Vrai si l'extraction de texte est censée fonctionner pour ce fichier.
function isTextExtractable(mimeType, filename) {
  const ext = extensionOf(filename);
  const mime = mimeType || '';
  return (
    ext === 'pdf' || mime === 'application/pdf' ||
    ext === 'docx' || mime.includes('wordprocessingml') ||
    ext === 'xlsx' || ext === 'csv' || ext === 'tsv' || mime.includes('spreadsheetml') || mime.includes('ms-excel') || mime.includes('csv') ||
    isTextType(mime, ext)
  );
}

module.exports = { extractText, isTextExtractable, stripHtml, MAX_EXTRACT_CHARS };
