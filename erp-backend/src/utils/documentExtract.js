const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Extrait le texte brut d'un fichier uploadé selon son type MIME/extension.
async function extractText(buffer, mimeType, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown' || mimeType === 'text/plain') {
    return buffer.toString('utf-8');
  }

  throw new Error(`Type de fichier non supporté : ${mimeType || ext}`);
}

module.exports = { extractText };
