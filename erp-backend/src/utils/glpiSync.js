const prisma = require('../prismaClient');
const { GLPI_CATEGORIES, GLPI_AI_REQUESTER_ID } = require('./glpiMapping');

// Statuts GLPI -> statuts ERP (cf. doc API GLPI : 1=Nouveau, 2=En cours (assigné), 3=En cours (planifié), 4=En attente, 5=Résolu, 6=Clos)
const GLPI_STATUS_MAP = {
  1: 'NEW',
  2: 'OPEN',
  3: 'OPEN',
  4: 'PENDING',
  5: 'SOLVED',
  6: 'CLOSED',
};

// Priorités GLPI (1=Très basse ... 6=Majeure) -> priorités ERP (P1=urgent ... P4=faible)
function glpiPriorityToErp(priority) {
  if (priority >= 5) return 'P1';
  if (priority === 4) return 'P2';
  if (priority === 3) return 'P3';
  return 'P4';
}

const GLPI_CATEGORY_ID_TO_NAME = Object.fromEntries(
  Object.entries(GLPI_CATEGORIES).map(([name, id]) => [id, name])
);

async function getGlpiConfig() {
  const config = await prisma.apiConfig.findUnique({ where: { serviceName: 'glpi' } });
  if (!config || !config.isActive || !config.baseUrl || !config.apiKey) return null;
  const appToken = config.extra?.appToken;
  if (!appToken) return null;
  return { baseUrl: config.baseUrl, userToken: config.apiKey, appToken };
}

async function glpiInitSession(config) {
  const res = await fetch(`${config.baseUrl}/initSession`, {
    method: 'GET',
    headers: {
      'App-Token': config.appToken,
      Authorization: `user_token ${config.userToken}`,
    },
  });
  if (!res.ok) throw new Error(`GLPI initSession a échoué (${res.status})`);
  const data = await res.json();
  return data.session_token;
}

async function glpiKillSession(config, sessionToken) {
  await fetch(`${config.baseUrl}/killSession`, {
    method: 'GET',
    headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
  }).catch(() => {});
}

// Récupère les tickets GLPI et les importe/met à jour dans la table Ticket de l'ERP.
// Retourne { imported, updated } ou null si GLPI n'est pas configuré.
async function syncGlpiTickets() {
  const config = await getGlpiConfig();
  if (!config) return null;

  const sessionToken = await glpiInitSession(config);
  try {
    const res = await fetch(`${config.baseUrl}/Ticket?range=0-99`, {
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
    });
    if (!res.ok) throw new Error(`GLPI Ticket list a échoué (${res.status})`);
    const tickets = await res.json();

    let imported = 0;
    let updated = 0;

    for (const t of tickets) {
      const data = {
        title: t.name,
        content: t.content || '',
        status: GLPI_STATUS_MAP[t.status] || 'NEW',
        priority: glpiPriorityToErp(t.priority),
        category: GLPI_CATEGORY_ID_TO_NAME[t.itilcategories_id] || null,
        aiProcessed: t.users_id_recipient === GLPI_AI_REQUESTER_ID,
      };

      const existing = await prisma.ticket.findUnique({ where: { glpiTicketId: t.id } });
      let ticketId;
      if (existing) {
        await prisma.ticket.update({ where: { id: existing.id }, data });
        ticketId = existing.id;
        updated += 1;
      } else {
        const created = await prisma.ticket.create({ data: { ...data, glpiTicketId: t.id } });
        ticketId = created.id;
        imported += 1;
      }

      await syncTicketAttachments(config, sessionToken, t.id, ticketId);
    }

    return { imported, updated };
  } finally {
    await glpiKillSession(config, sessionToken);
  }
}

// Récupère les pièces jointes (Document_Item) d'un ticket GLPI et les enregistre dans TicketAttachment
async function syncTicketAttachments(config, sessionToken, glpiTicketId, ticketId) {
  const res = await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}/Document_Item`, {
    headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
  });
  if (!res.ok) return;
  const items = await res.json();
  if (!Array.isArray(items)) return;

  for (const item of items) {
    const docRes = await fetch(`${config.baseUrl}/Document/${item.documents_id}`, {
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
    });
    if (!docRes.ok) continue;
    const doc = await docRes.json();

    await prisma.ticketAttachment.upsert({
      where: { glpiDocumentId: item.documents_id },
      update: { filename: doc.filename || doc.name, mimeType: doc.mime || null, ticketId },
      create: {
        ticketId,
        glpiDocumentId: item.documents_id,
        filename: doc.filename || doc.name,
        mimeType: doc.mime || null,
      },
    });
  }
}

module.exports = { syncGlpiTickets, getGlpiConfig, glpiInitSession, glpiKillSession };
