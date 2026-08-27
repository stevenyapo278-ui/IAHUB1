const pdfParse = require('pdf-parse');

/**
 * Parse un PDF en blocs structurés : titres, paragraphes, tableaux, listes.
 * Utilise la mise en page du PDF (positions x/y, taille de police) pour détecter
 * la structure plutôt que de se fier uniquement au texte brut.
 */
async function extractStructuredContent(buffer) {
  const data = await pdfParse(buffer, {
    // Préserver les informations de position pour la détection de structure
    customRender: undefined,
  });

  const rawText = data.text || '';
  const pages = data.numpages || 1;
  const info = data.info || {};

  // Détecter les blocs structurés à partir du texte brut
  const blocks = parseTextToBlocks(rawText);

  return {
    blocks,
    pageCount: pages,
    title: info.Title || null,
    author: info.Author || null,
    subject: info.Subject || null,
    summary: generateSummary(blocks),
    blockCount: blocks.length,
    headingCount: blocks.filter(b => b.type === 'heading').length,
    tableCount: blocks.filter(b => b.type === 'table').length,
    paragraphCount: blocks.filter(b => b.type === 'paragraph').length,
  };
}

/**
 * Parse le texte brut en blocs structurés en détectant les patterns.
 */
function parseTextToBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let currentParagraph = [];
  let currentTable = [];
  let inTable = false;

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      const content = currentParagraph.join(' ').trim();
      if (content) {
        blocks.push({ type: 'paragraph', content });
      }
      currentParagraph = [];
    }
  }

  function flushTable() {
    if (currentTable.length > 0) {
      const rows = currentTable.map(line => {
        // Détecter les séparateurs de tableau (| ou tabulations multiples)
        if (line.includes('|')) {
          return line.split('|').map(cell => cell.trim()).filter(cell => cell);
        }
        // Tabulations
        if (line.includes('\t')) {
          return line.split('\t').map(cell => cell.trim()).filter(cell => cell);
        }
        // Espaces multiples (alignement visuel)
        return line.split(/\s{3,}/).map(cell => cell.trim()).filter(cell => cell);
      }).filter(row => row.length > 0);

      if (rows.length > 0) {
        // Première ligne = en-têtes
        const headers = rows[0];
        const data = rows.slice(1).filter(row =>
          // Filtrer les lignes de séparation (---, ===, etc.)
          !row.every(cell => /^[-=]+$/.test(cell))
        );

        blocks.push({
          type: 'table',
          headers,
          rows: data,
          content: formatTableAsText(headers, data),
        });
      }
      currentTable = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Ligne vide = séparateur de blocs
    if (!trimmed) {
      flushParagraph();
      if (inTable) {
        flushTable();
        inTable = false;
      }
      continue;
    }

    // Détection de tableau
    const isTableLine = (
      (trimmed.includes('|') && trimmed.split('|').length >= 3) ||
      (trimmed.includes('\t') && trimmed.split('\t').length >= 3) ||
      /^[-=+]{3,}$/.test(trimmed)
    );

    if (isTableLine) {
      flushParagraph();
      inTable = true;
      currentTable.push(trimmed);
      continue;
    }

    if (inTable) {
      flushTable();
      inTable = false;
    }

    // Détection de titre (heading)
    const headingMatch = detectHeading(trimmed);
    if (headingMatch) {
      flushParagraph();
      blocks.push(headingMatch);
      continue;
    }

    // Détection de liste
    const listMatch = detectList(trimmed);
    if (listMatch) {
      flushParagraph();
      // Regrouper les éléments de liste consécutifs
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.type === 'list') {
        lastBlock.items.push(listMatch.content);
        lastBlock.content = lastBlock.items.join('\n');
      } else {
        blocks.push({
          type: 'list',
          items: [listMatch.content],
          content: listMatch.content,
          ordered: listMatch.ordered,
        });
      }
      continue;
    }

    // Paragraphe normal
    currentParagraph.push(trimmed);
  }

  // Flush les derniers blocs
  flushParagraph();
  if (inTable) flushTable();

  return blocks;
}

/**
 * Détecte si une ligne est un titre et retourne le bloc heading.
 */
function detectHeading(line) {
  // Patterns markdown : #, ##, ###, etc.
  const mdMatch = line.match(/^(#{1,6})\s+(.+)/);
  if (mdMatch) {
    return {
      type: 'heading',
      level: mdMatch[1].length,
      content: mdMatch[2].trim(),
    };
  }

  // Ligne en MAJUSCULES avec longueur raisonnable ( titre de section )
  if (line.length > 3 && line.length < 100 && line === line.toUpperCase() && /^[A-ZÀÂÉÈÊËÏÎÔÙÛÜÇ\s\d\.\-:()]+$/.test(line)) {
    return { type: 'heading', level: 2, content: line };
  }

  // Ligne courte se terminant par ":" (souvent un titre de section)
  if (line.length < 80 && line.endsWith(':') && !line.includes('.') && /^[A-ZÀÂÉÈÊËÏÎÔÙÛÜÇ]/.test(line)) {
    return { type: 'heading', level: 3, content: line.slice(0, -1).trim() };
  }

  return null;
}

/**
 * Détecte si une ligne est un élément de liste.
 */
function detectList(line) {
  // Liste à puces : -, *, •
  const bulletMatch = line.match(/^[\-\*•]\s+(.+)/);
  if (bulletMatch) return { ordered: false, content: bulletMatch[1].trim() };

  // Liste numérotée : 1., 2., a), b), etc.
  const numMatch = line.match(/^(\d+[\.\)]\s+|[a-zA-Z][\.\)]\s+)(.+)/);
  if (numMatch) return { ordered: true, content: numMatch[2].trim() };

  return null;
}

/**
 * Formate un tableau en texte lisible.
 */
function formatTableAsText(headers, rows) {
  const lines = [headers.join(' | ')];
  lines.push(headers.map(() => '---').join(' | '));
  for (const row of rows) {
    lines.push(row.join(' | '));
  }
  return lines.join('\n');
}

/**
 * Génère un résumé court du document.
 */
function generateSummary(blocks) {
  const headings = blocks.filter(b => b.type === 'heading').map(b => b.content);
  if (headings.length > 0) {
    return `Document avec ${headings.length} section(s) : ${headings.slice(0, 5).join(', ')}`;
  }
  const paragraphs = blocks.filter(b => b.type === 'paragraph');
  if (paragraphs.length > 0) {
    return paragraphs[0].content.substring(0, 200) + (paragraphs[0].content.length > 200 ? '...' : '');
  }
  return 'Document sans structure détectée.';
}

module.exports = { extractStructuredContent, parseTextToBlocks };
