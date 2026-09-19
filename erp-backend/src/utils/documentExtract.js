const path = require('path');
const fs = require('fs');
const os = require('os');
const { convert } = require('@opendataloader/pdf');
const mammoth = require('mammoth');

// Extrait le texte brut d'un fichier uploadé selon son type MIME/extension.
async function extractText(buffer, mimeType, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const tmpPdf = path.join(tmpDir, filename || 'upload.pdf');
    fs.writeFileSync(tmpPdf, buffer);

    try {
      await convert([tmpPdf], {
        outputDir: tmpDir,
        format: 'markdown',
        quiet: true,
      });

      const mdFile = path.join(tmpDir, path.basename(tmpPdf, '.pdf') + '.md');
      if (fs.existsSync(mdFile)) {
        return fs.readFileSync(mdFile, 'utf-8');
      }

      const jsonFile = path.join(tmpDir, path.basename(tmpPdf, '.pdf') + '.json');
      if (fs.existsSync(jsonFile)) {
        const json = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
        return json.content || json.text || JSON.stringify(json);
      }

      throw new Error('Aucune sortie générée par @opendataloader/pdf');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
