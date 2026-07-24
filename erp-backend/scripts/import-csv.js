const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const prisma = new PrismaClient();

const STATUS_MAP = {
  'Nouveau': 'NEW',
  'En cours (Attribué)': 'OPEN',
  'En cours': 'OPEN',
  'En attente': 'PENDING',
  'Résolu': 'SOLVED',
  'Clos': 'CLOSED',
};

const PRIORITY_MAP = {
  'Très haute': 'P1',
  'Haute': 'P2',
  'Moyenne': 'P3',
  'Basse': 'P4',
};

function parseDate(str) {
  if (!str || str.trim() === '') return null;
  const parts = str.trim().split('-');
  if (parts.length < 3) return null;
  const [day, month, yearAndTime] = parts;
  const yearTime = yearAndTime.split(' ');
  const year = yearTime[0];
  const time = yearTime[1] || '';
  if (!day || !month || !year) return null;
  const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${time ? 'T' + time : 'T00:00:00'}`;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function parseTechnician(str) {
  if (!str || str.trim() === '') return null;
  const match = str.match(/\((\d+)\)/);
  return match ? parseInt(match[1]) : null;
}

function stripHtml(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function importLocations(csvPath) {
  console.log(`\n📥 Import des lieux depuis ${csvPath}...`);
  const fileStream = fs.createReadStream(csvPath, 'utf-8');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers = null;
  let count = 0;
  let skipped = 0;

  for await (const line of rl) {
    const cols = line.split(';').map(c => c.replace(/^"|"$/g, '').trim());
    if (!headers) {
      headers = cols;
      continue;
    }
    const name = cols[0];
    if (!name) { skipped++; continue; }

    const existing = await prisma.glpiLocation.findFirst({ where: { name } });
    if (existing) { skipped++; continue; }

    await prisma.glpiLocation.create({
      data: {
        glpiLocationId: -(count + 1),
        name,
        completename: name,
      },
    });
    count++;
  }

  console.log(`  ✅ ${count} lieux importés, ${skipped} déjà existants`);
  return count;
}

async function importTickets(csvPath) {
  console.log(`\n📥 Import des tickets depuis ${csvPath}...`);
  const fileStream = fs.createReadStream(csvPath, 'utf-8');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers = null;
  let total = 0;
  let imported = 0;
  let skipped = 0;

  for await (const line of rl) {
    const cols = line.split(';').map(c => c.replace(/^"|"$/g, '').trim());
    if (!headers) {
      headers = cols.map(c => c.replace(/^\uFEFF/, ''));
      continue;
    }
    total++;

    const rawId = cols[0].replace(/\s+/g, '');
    const glpiId = parseInt(rawId);
    if (!glpiId || isNaN(glpiId)) { skipped++; continue; }

    const existing = await prisma.ticket.findUnique({ where: { glpiTicketId: glpiId } });
    if (existing) { skipped++; continue; }

    const title = stripHtml(cols[1]) || '(Sans titre)';
    const statut = STATUS_MAP[cols[3]] || 'CLOSED';
    const priorite = PRIORITY_MAP[cols[7]] || 'P3';
    const categorie = stripHtml(cols[10]) || null;
    const lieu = stripHtml(cols[11]) || null;
    const demandeur = stripHtml(cols[8]) || null;
    const technicienGlpiId = parseTechnician(cols[9]);
    const groupe = cols[14] || null;
    const dateCreation = parseDate(cols[5]);
    const dateResolution = parseDate(cols[12]);
    const dateCloture = parseDate(cols[6]);
    const type = categorie?.toLowerCase().startsWith('incident') ? 'INCIDENT' : 'REQUEST';

    try {
      await prisma.ticket.create({
        data: {
          glpiTicketId: glpiId,
          title,
          content: title,
          status: statut,
          priority: priorite,
          category: categorie,
          glpiLocationName: lieu,
          sourceName: demandeur,
          createdAt: dateCreation || new Date(),
          solvedAt: dateResolution,
          closedAt: dateCloture || dateResolution,
          type,
          aiProcessed: false,
        },
      });
      imported++;
    } catch (err) {
      console.error(`  ❌ Erreur ticket ${glpiId}: ${err.message}`);
      skipped++;
    }

    if (total % 1000 === 0) console.log(`  ... ${total} lignes traitées, ${imported} importés`);
  }

  console.log(`  ✅ ${imported} tickets importés sur ${total} (${skipped} ignorés)`);
  return { total, imported, skipped };
}

async function main() {
  console.log('🚀 Import des données CSV dans la base ERP');
  console.log('==========================================');

  const ticketsPath = process.argv[2] || path.join(__dirname, '../../glpi (1).csv');
  const locationsPath = process.argv[3] || path.join(__dirname, '../../glpi lieu.csv');

  if (fs.existsSync(locationsPath)) {
    await importLocations(locationsPath);
  } else {
    console.log('  ⚠️ Fichier lieux non trouvé');
  }

  if (fs.existsSync(ticketsPath)) {
    await importTickets(ticketsPath);
  } else {
    console.log('  ⚠️ Fichier tickets non trouvé');
  }

  console.log('\n✅ Import terminé');
}

main().catch(console.error).finally(() => prisma.$disconnect());
