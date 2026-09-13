/**
 * Service de génération du rapport PDF du tableau de bord ITSM.
 * Utilise uniquement pdfkit (polices Helvetica intégrées).
 *
 * Sections :
 * 1. En-tête (bandeau indigo)
 * 2. KPI Résumé (cartes 2 colonnes)
 * 3. Répartition par statut (barres horizontales)
 * 4. Répartition par priorité (barres horizontales)
 * 5. SLA & Qualité (tableau par priorité)
 * 6. Performance techniciens (tableau)
 * 7. Liste tickets (tableau zébré, auto-pagination)
 */

const PDFDocument = require('pdfkit');

// ── Palette ──────────────────────────────────────────────────────────────────
const COLORS = {
  primary: '#6366f1',     // indigo
  primaryDark: '#4f46e5',
  primaryLight: '#e0e7ff',
  text: '#0f172a',        // slate-900
  textSecondary: '#334155', // slate-700
  textMuted: '#64748b',   // slate-500
  bgCard: '#f8fafc',      // slate-50
  bgHeader: '#f1f5f9',    // slate-100
  border: '#e2e8f0',      // slate-200
  success: '#22c55e',     // green-500
  warning: '#f59e0b',     // amber-500
  danger: '#ef4444',      // red-500
  info: '#3b82f6',        // blue-500
  // Statuts
  statusNew: '#6366f1',
  statusOpen: '#f59e0b',
  statusPlanned: '#8b5cf6',
  statusPending: '#f97316',
  statusWaiting: '#64748b',
  statusSolved: '#22c55e',
  statusClosed: '#94a3b8',
  // Priorités
  p1: '#ef4444',
  p2: '#f59e0b',
  p3: '#3b82f6',
  p4: '#94a3b8',
};

const STATUS_LABELS = {
  NEW: 'Nouveau', OPEN: 'Ouvert', PLANNED: 'Planifié',
  PENDING: 'En attente', WAITING_FOR_USER: 'Attente utilisateur',
  SOLVED: 'Résolu', CLOSED: 'Clôturé',
};

const STATUS_COLORS = {
  NEW: COLORS.statusNew, OPEN: COLORS.statusOpen, PLANNED: COLORS.statusPlanned,
  PENDING: COLORS.statusPending, WAITING_FOR_USER: COLORS.statusWaiting,
  SOLVED: COLORS.statusSolved, CLOSED: COLORS.statusClosed,
};

const PRIORITY_COLORS = { P1: COLORS.p1, P2: COLORS.p2, P3: COLORS.p3, P4: COLORS.p4 };

const PAGE_W = 595.28; // A4 largeur
const PAGE_H = 841.89; // A4 hauteur
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Helpers de rendu ─────────────────────────────────────────────────────────

/** Titre de section avec ligne colorée */
function drawSectionTitle(doc, title, y) {
  if (y > PAGE_H - 120) { doc.addPage(); y = MARGIN; }
  doc.save();
  doc.rect(MARGIN, y, 4, 14).fill(COLORS.primary);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text).text(title, MARGIN + 10, y + 1, { width: CONTENT_W });
  return y + 22;
}

/** Bandeau horizontal coloré (en-tête) */
function drawHeader(doc, periodStr) {
  // Bandeau indigo
  doc.save();
  doc.rect(0, 0, PAGE_W, 80).fill(COLORS.primary);
  // Titre
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text('Rapport ITSM', MARGIN, 22, { width: CONTENT_W });
  // Sous-titre
  doc.font('Helvetica').fontSize(9).fillColor('#e0e7ff').text(
    `${periodStr}  •  généré le ${new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}`,
    MARGIN, 48, { width: CONTENT_W }
  );
  doc.restore();
  return 96; // y après le bandeau
}

/** Grille de KPI cards (2 colonnes) */
function drawKpiCards(doc, items, startY) {
  let y = startY;
  const cardW = (CONTENT_W - 8) / 2; // 2 colonnes avec gap 8px
  const cardH = 36;

  for (let i = 0; i < items.length; i += 2) {
    const col = i % 2;
    const x = MARGIN + col * (cardW + 8);

    // Carte 1
    if (items[i]) {
      doc.save();
      doc.roundedRect(x, y, cardW, cardH, 4).fill(COLORS.bgCard);
      // Pastille couleur
      doc.circle(x + 14, y + cardH / 2, 5).fill(items[i].color);
      // Label
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted).text(items[i].label, x + 26, y + 6, { width: cardW - 36 });
      // Valeur
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text).text(String(items[i].value), x + 26, y + 18, { width: cardW - 36 });
      // Mini barre de progression si pct
      if (items[i].pct != null) {
        const barW = cardW - 36;
        const barX = x + 26;
        const barY = y + cardH - 8;
        doc.rect(barX, barY, barW, 3).fill(COLORS.border);
        doc.rect(barX, barY, Math.round(barW * items[i].pct / 100), 3).fill(items[i].color);
      }
      doc.restore();
    }

    // Carte 2
    if (items[i + 1]) {
      const x2 = x + cardW + 8;
      doc.save();
      doc.roundedRect(x2, y, cardW, cardH, 4).fill(COLORS.bgCard);
      doc.circle(x2 + 14, y + cardH / 2, 5).fill(items[i + 1].color);
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted).text(items[i + 1].label, x2 + 26, y + 6, { width: cardW - 36 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text).text(String(items[i + 1].value), x2 + 26, y + 18, { width: cardW - 36 });
      if (items[i + 1].pct != null) {
        const barW = cardW - 36;
        const barX = x2 + 26;
        const barY = y + cardH - 8;
        doc.rect(barX, barY, barW, 3).fill(COLORS.border);
        doc.rect(barX, barY, Math.round(barW * items[i + 1].pct / 100), 3).fill(items[i + 1].color);
      }
      doc.restore();
    }

    y += cardH + 6;
  }
  return y;
}

/** Barres horizontales proportionnelles */
function drawBarsSection(doc, title, items, startY) {
  let y = drawSectionTitle(doc, title, startY);
  const maxVal = Math.max(...items.map((i) => i.count), 1);
  const barMaxW = CONTENT_W - 160; // espace pour label + valeur
  const barH = 14;
  const barX = MARGIN + 120;

  for (const item of items) {
    if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN; }
    const pct = (item.count / maxVal) * 100;
    const barW = Math.max(Math.round(barMaxW * pct / 100), 2);

    // Label
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.textSecondary)
      .text(item.label, MARGIN, y + 1, { width: 115, ellipsis: true });
    // Barre de fond
    doc.rect(barX, y + 2, barMaxW, barH).fill(COLORS.border);
    // Barre remplie
    doc.rect(barX, y + 2, barW, barH).fill(item.color);
    // Valeur
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.text)
      .text(String(item.count), barX + barMaxW + 6, y + 1, { width: 34 });

    y += barH + 5;
  }
  return y + 4;
}

/** Tableau avec header et zébrage */
function drawTable(doc, { headers, rows, cols, startY, headerBg }) {
  let y = startY;
  const bg = headerBg || COLORS.bgHeader;

  // Header
  doc.save();
  doc.rect(MARGIN, y - 2, CONTENT_W, 14).fill(bg);
  doc.restore();
  let x = MARGIN;
  for (let i = 0; i < headers.length; i++) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.textSecondary)
      .text(headers[i], x + 2, y, { width: cols[i] - 4, lineBreak: false, ellipsis: true });
    x += cols[i];
  }
  y += 14;

  // Rows
  for (let r = 0; r < rows.length; r++) {
    if (y > PAGE_H - 60) {
      doc.addPage();
      y = MARGIN;
      // Re-dessiner header sur nouvelle page
      doc.save();
      doc.rect(MARGIN, y - 2, CONTENT_W, 14).fill(bg);
      doc.restore();
      x = MARGIN;
      for (let i = 0; i < headers.length; i++) {
        doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.textSecondary)
          .text(headers[i], x + 2, y, { width: cols[i] - 4, lineBreak: false, ellipsis: true });
        x += cols[i];
      }
      y += 14;
    }

    // Zébrage
    if (r % 2 === 0) {
      doc.save();
      doc.rect(MARGIN, y - 2, CONTENT_W, 12).fill(COLORS.bgCard);
      doc.restore();
    }

    x = MARGIN;
    for (let i = 0; i < rows[r].length; i++) {
      const val = rows[r][i];
      const isBold = typeof val === 'object' && val.bold;
      const text = typeof val === 'object' ? val.text : String(val);
      const color = typeof val === 'object' ? (val.color || COLORS.text) : COLORS.text;
      const font = isBold ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(font).fontSize(7).fillColor(color)
        .text(text, x + 2, y, { width: cols[i] - 4, lineBreak: false, ellipsis: true });
      x += cols[i];
    }
    y += 12;
  }
  return y;
}

// ── Générateur principal ────────────────────────────────────────────────────

function generateReport(data) {
  const { periodStr, tickets, totalTickets, resolved, p1, avgResolution, aiDrafts, techCount, byStatus, byPriority, byCategory, byTeam, slaData } = data;

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  // ─── 1. En-tête ───────────────────────────────────────────────────────────
  let y = drawHeader(doc, periodStr);

  // ─── 2. KPI Résumé ────────────────────────────────────────────────────────
  const resolutionPct = totalTickets > 0 ? Math.round((resolved / totalTickets) * 100) : 0;
  y = drawKpiCards(doc, [
    { label: 'Total tickets', value: totalTickets, color: COLORS.primary },
    { label: 'Tickets ouverts', value: totalTickets - resolved, color: COLORS.warning },
    { label: 'Tickets résolus', value: resolved, color: COLORS.success, pct: resolutionPct },
    { label: 'Taux de résolution', value: `${resolutionPct}%`, color: COLORS.success, pct: resolutionPct },
    { label: 'Tickets P1 critiques', value: p1, color: COLORS.danger },
    { label: 'Délai résolution moyen', value: `${avgResolution} h`, color: COLORS.info },
    { label: 'Brouillons IA approuvés', value: aiDrafts, color: '#8b5cf6' },
    { label: 'Techniciens actifs', value: techCount, color: COLORS.primaryDark },
  ], y + 4);

  // ─── 3. Répartition par statut ────────────────────────────────────────────
  const statusItems = byStatus
    .map((s) => ({
      label: STATUS_LABELS[s.status] || s.status,
      count: s._count,
      color: STATUS_COLORS[s.status] || COLORS.textMuted,
    }))
    .sort((a, b) => b.count - a.count);

  if (statusItems.length > 0) {
    y = drawBarsSection(doc, 'Répartition par statut', statusItems, y + 6);
  }

  // ─── 4. Répartition par priorité ──────────────────────────────────────────
  const prioItems = ['P1', 'P2', 'P3', 'P4']
    .map((p) => {
      const found = byPriority.find((x) => x.priority === p);
      return { label: p, count: found ? found._count : 0, color: PRIORITY_COLORS[p] };
    })
    .filter((i) => i.count > 0);

  if (prioItems.length > 0) {
    y = drawBarsSection(doc, 'Répartition par priorité', prioItems, y);
  }

  // ─── 5. Répartition par catégorie (top 8) ─────────────────────────────────
  const catItems = byCategory
    .slice(0, 8)
    .map((c) => ({
      label: c.category || 'Sans catégorie',
      count: c._count,
      color: COLORS.primary,
    }));

  if (catItems.length > 0) {
    y = drawBarsSection(doc, 'Top catégories', catItems, y);
  }

  // ─── 6. Répartition par équipe ────────────────────────────────────────────
  if (byTeam.length > 0) {
    // Résoudre les noms d'équipes
    const teamIds = byTeam.map((t) => t.teamId).filter((id) => id !== null);
    const teamNames = {};
    if (data.teams) {
      for (const t of data.teams) teamNames[t.id] = t.name;
    }
    const teamItems = byTeam
      .map((t) => ({
        label: teamNames[t.teamId] || 'Non assignée',
        count: t._count,
        color: COLORS.primary,
      }))
      .sort((a, b) => b.count - a.count);

    y = drawBarsSection(doc, 'Répartition par équipe', teamItems, y);
  }

  // ─── 7. SLA & Qualité ─────────────────────────────────────────────────────
  if (slaData && slaData.byPriority) {
    if (y > PAGE_H - 200) { doc.addPage(); y = MARGIN; }
    y = drawSectionTitle(doc, 'SLA & Qualité par priorité', y);

    const slaHeaders = ['Priorité', 'Total', 'Résolus', 'Breachs', 'Taux breach', 'Délai moy.', 'CSAT'];
    const slaCols = [55, 50, 55, 55, 70, 65, 60];
    const slaRows = [];

    for (const p of ['P1', 'P2', 'P3', 'P4']) {
      const d = slaData.byPriority[p];
      if (!d || d.total === 0) continue;
      slaRows.push([
        { text: p, bold: true, color: PRIORITY_COLORS[p] },
        String(d.total),
        String(d.resolved),
        String(d.breached),
        `${d.breachRate}%`,
        d.avgResolutionHours != null ? `${d.avgResolutionHours} h` : '—',
        slaData.csat?.average != null ? `${slaData.csat.average}/5` : '—',
      ]);
    }

    // Ligne totaux
    if (slaData.totals) {
      slaRows.push([
        { text: 'Total', bold: true },
        String(slaData.totals.total),
        '',
        String(slaData.totals.breached),
        `${slaData.totals.breachRate}%`,
        '',
        '',
      ]);
    }

    y = drawTable(doc, { headers: slaHeaders, rows: slaRows, cols: slaCols, startY: y });
  }

  // ─── 8. Performance techniciens ───────────────────────────────────────────
  if (data.techStats && data.techStats.length > 0) {
    if (y > PAGE_H - 200) { doc.addPage(); y = MARGIN; }
    y = drawSectionTitle(doc, 'Performance des techniciens', y);

    const techHeaders = ['Technicien', 'Assignés', 'Résolus', 'Taux', 'SLA%', 'CSAT'];
    const techCols = [130, 60, 60, 55, 55, 55];
    const techRows = [];

    for (const t of data.techStats.slice(0, 15)) {
      if (t.assigned === 0) continue;
      const rate = t.assigned > 0 ? Math.round((t.resolved / t.assigned) * 100) : 0;
      techRows.push([
        { text: t.fullName, bold: true },
        String(t.assigned),
        String(t.resolved),
        `${rate}%`,
        t.slaCompliancePct != null ? `${t.slaCompliancePct}%` : '—',
        t.csatAvg != null ? `${t.csatAvg}/5` : '—',
      ]);
    }

    y = drawTable(doc, { headers: techHeaders, rows: techRows, cols: techCols, startY: y });
  }

  // ─── 9. Liste des tickets ─────────────────────────────────────────────────
  if (tickets.length > 0) {
    if (y > PAGE_H - 120) { doc.addPage(); y = MARGIN; }
    y = drawSectionTitle(doc, `Liste des tickets (${tickets.length})`, y);

    const tktHeaders = ['ID', 'Titre', 'Statut', 'Priorité', 'Demandeur', 'Assigné', 'Équipe', 'Créé le'];
    const tktCols = [30, 145, 45, 42, 100, 90, 80, 60];
    const tktRows = tickets.map((t) => [
      String(t.id),
      t.title || '',
      { text: STATUS_LABELS[t.status] || t.status, color: STATUS_COLORS[t.status] || COLORS.text },
      { text: t.priority, color: PRIORITY_COLORS[t.priority] || COLORS.text },
      t.requester?.fullName || '—',
      t.assignedTo?.fullName || '—',
      t.team?.name || '—',
      new Date(t.createdAt).toLocaleDateString('fr-FR'),
    ]);

    y = drawTable(doc, { headers: tktHeaders, rows: tktRows, cols: tktCols, startY: y });
  }

  // ─── Footer ───────────────────────────────────────────────────────────────
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
      .text(
        `Rapport ITSM — ${periodStr}  •  Page ${i + 1}/${pageCount}`,
        MARGIN, PAGE_H - 24,
        { width: CONTENT_W, align: 'center' }
      );
  }

  doc.end();
  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

module.exports = { generateReport };
