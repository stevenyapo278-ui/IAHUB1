const prisma = require('../prismaClient');
const { GLPI_AI_REQUESTER_ID, glpiIdToCategory } = require('./glpiMapping');
const { getSystemSettings } = require('../services/systemSettings');

const VALIDATION_STATUS_WAITING = 2;
const VALIDATION_STATUS_APPROVED = 3;
const SOLUTION_STATUS_ACCEPTED = 3;
const TICKET_STATUS_SOLVED = 5;

const GLPI_STATUS_MAP = {
  1: 'NEW',
  2: 'OPEN',
  3: 'OPEN',
  4: 'PENDING',
  5: 'SOLVED',
  6: 'CLOSED',
};

function glpiPriorityToErp(priority) {
  if (priority >= 5) return 'P1';
  if (priority === 4) return 'P2';
  if (priority === 3) return 'P3';
  return 'P4';
}

async function getGlpiConfig(serviceName) {
  const name = serviceName || 'glpi';
  const config = await prisma.apiConfig.findUnique({ where: { serviceName: name } });
  if (!config || !config.isActive || !config.baseUrl || !config.apiKey) return null;
  const appToken = config.extra?.appToken;
  if (!appToken) return null;
  return { baseUrl: config.baseUrl, userToken: config.apiKey, appToken };
}

// Récupère la config GLPI active pour la création de tickets (selon SystemSettings.activeGlpiInstance)
async function getActiveGlpiConfig() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const activeInstance = settings?.activeGlpiInstance || 'glpi';
  return getGlpiConfig(activeInstance);
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
  }).catch((err) => {
    console.error('[glpiSync] Échec killSession (fuite possible de session GLPI):', err.message);
  });
}

// Récupère les tickets GLPI avec pagination et filtre optionnel par date.
// Si dateFrom/dateTo sont fournis, utilise les filtres GLPI criteria pour ne récupérer
// que les tickets créés/modifiés dans cet intervalle.
async function fetchAllGlpiTickets(config, sessionToken, { dateFrom, dateTo } = {}) {
  const PAGE_SIZE = 100;
  let offset = 0;
  const allTickets = [];

  while (true) {
    let url = `${config.baseUrl}/Ticket?range=${offset}-${offset + PAGE_SIZE - 1}`;

    const fetchOptions = {
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
    };

    // Si des dates sont fournies, utiliser la requête POST avec criteria (API GLPI avancée)
    if (dateFrom || dateTo) {
      const criteria = [
        { field: 1, searchtype: 2, value: '%' },
      ];
      if (dateFrom) {
        criteria.push({ field: 19, searchtype: 2, value: dateFrom });
      }
      if (dateTo) {
        criteria.push({ field: 19, searchtype: 3, value: dateTo });
      }

      const postRes = await fetch(`${config.baseUrl}/search/Ticket`, {
        method: 'POST',
        headers: {
          'App-Token': config.appToken,
          'Session-Token': sessionToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          criteria,
          range: `${offset}-${offset + PAGE_SIZE - 1}`,
        }),
      });

      if (!postRes.ok) break;
      const data = await postRes.json();
      const tickets = data.data || data || [];
      if (tickets.length === 0) break;
      allTickets.push(...tickets);
      if (tickets.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    } else {
      const res = await fetch(url, {
        headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
      });
      if (!res.ok) break;
      const tickets = await res.json();
      if (!Array.isArray(tickets) || tickets.length === 0) break;
      allTickets.push(...tickets);
      if (tickets.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  return allTickets;
}

// Sync standard : import incrémental (upsert par glpiTicketId), sans dates = tout récupérer
async function syncGlpiTickets() {
  const config = await getGlpiConfig();
  if (!config) return null;

  const sessionToken = await glpiInitSession(config);
  try {
    const tickets = await fetchAllGlpiTickets(config, sessionToken);
    let imported = 0;
    let updated = 0;

    for (const t of tickets) {
      const existing = await prisma.ticket.findUnique({ where: { glpiTicketId: t.id } });

      const glpiStatus = GLPI_STATUS_MAP[t.status] || 'NEW';
      const status = (existing?.status === 'WAITING_FOR_USER' && glpiStatus !== 'SOLVED' && glpiStatus !== 'CLOSED')
        ? 'WAITING_FOR_USER'
        : glpiStatus;

      // Résout le "Lieu" GLPI (locations_id) en nom complet via la table GlpiLocation.
      // Si le lieu n'est pas encore synchronisé, on le stocke en base silencieusement au
      // moment de la synchro du ticket, pour ne pas dépendre d'une synchro préalable.
      let glpiLocationName = null;
      if (t.locations_id) {
        const location = await prisma.glpiLocation.findUnique({
          where: { glpiLocationId: t.locations_id },
        });
        if (location) {
          glpiLocationName = location.completename || location.name;
        }
      }

      const data = {
        title: t.name,
        content: t.content || '',
        status,
        priority: glpiPriorityToErp(t.priority),
        category: await glpiIdToCategory(t.itilcategories_id),
        aiProcessed: t.users_id_recipient === GLPI_AI_REQUESTER_ID,
        glpiLocationId: t.locations_id || null,
        glpiLocationName,
      };

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
      await syncGlpiFollowups(config, sessionToken, t.id, ticketId);
      await maybeAutoApproveValidation(config, sessionToken, t.id);
      await maybeAutoApproveSolution(config, sessionToken, t);
    }

    // Post-sync : met à jour les noms de lieux pour les tickets qui ont un glpiLocationId
    // mais pas encore de glpiLocationName (cas où les lieux ont été synchronisés après les
    // tickets).
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE "Ticket" t
        SET "glpiLocationName" = l."completename"
        FROM "GlpiLocation" l
        WHERE t."glpiLocationId" = l."glpiLocationId"
          AND t."glpiLocationName" IS NULL
      `);
    } catch (err) {
      // La table GlpiLocation peut ne pas exister si la migration n'a pas encore été jouée —
      // dans ce cas on ignore silencieusement l'erreur, les lieux ne seront simplement pas résolus.
    }

    return { imported, updated };
  } finally {
    await glpiKillSession(config, sessionToken);
  }
}

// Réimport complet : supprime tous les tickets GLPI-syncés de l'ERP puis réimporte
// depuis GLPI avec filtre optionnel par date.
// NE TOUCHE PAS à GLPI — c'est une lecture seule.
async function fullReimportFromGlpi({ dateFrom, dateTo } = {}) {
  const config = await getGlpiConfig();
  if (!config) return null;

  // 1. Supprimer les tickets GLPI-syncés de l'ERP
  const deleted = await prisma.ticket.deleteMany({ where: { glpiTicketId: { not: null } } });
  console.log(`[glpiSync] ${deleted.count} tickets GLPI supprimés de l'ERP pour réimport`);

  // 2. Réimporter depuis GLPI
  const sessionToken = await glpiInitSession(config);
  try {
    const tickets = await fetchAllGlpiTickets(config, sessionToken, { dateFrom, dateTo });
    let imported = 0;

    for (const t of tickets) {
      let glpiLocationName = null;
      if (t.locations_id) {
        const location = await prisma.glpiLocation.findUnique({
          where: { glpiLocationId: t.locations_id },
        });
        if (location) {
          glpiLocationName = location.completename || location.name;
        }
      }

      const data = {
        title: t.name,
        content: t.content || '',
        status: GLPI_STATUS_MAP[t.status] || 'NEW',
        priority: glpiPriorityToErp(t.priority),
        category: await glpiIdToCategory(t.itilcategories_id),
        aiProcessed: t.users_id_recipient === GLPI_AI_REQUESTER_ID,
        glpiLocationId: t.locations_id || null,
        glpiLocationName,
      };

      const created = await prisma.ticket.create({ data: { ...data, glpiTicketId: t.id } });
      await syncTicketAttachments(config, sessionToken, t.id, created.id);
      await syncGlpiFollowups(config, sessionToken, t.id, created.id);
      imported += 1;
    }

    return { deleted: deleted.count, imported };
  } finally {
    await glpiKillSession(config, sessionToken);
  }
}

async function maybeAutoApproveValidation(config, sessionToken, glpiTicketId) {
  try {
    const settings = await getSystemSettings();
    if (!settings.autoApproveGlpiSolutions) return;

    const headers = { 'App-Token': config.appToken, 'Session-Token': sessionToken, 'Content-Type': 'application/json' };
    const res = await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}/TicketValidation`, { headers });
    if (!res.ok) return;
    const validations = await res.json();
    if (!Array.isArray(validations)) return;

    for (const v of validations) {
      if (v.status !== VALIDATION_STATUS_WAITING) continue;
      await fetch(`${config.baseUrl}/TicketValidation/${v.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ input: { id: v.id, status: VALIDATION_STATUS_APPROVED, comment_validation: 'Approuvé automatiquement (IA)' } }),
      }).catch((err) => {
        console.error(`[glpiSync] Échec approbation TicketValidation ${v.id} (ticket GLPI ${glpiTicketId}):`, err.message);
      });
    }
  } catch (err) {
    console.error('[glpiSync] Échec auto-approbation validation:', err.message);
  }
}

async function maybeAutoApproveSolution(config, sessionToken, ticket) {
  if (ticket.status !== TICKET_STATUS_SOLVED) return;

  try {
    const settings = await getSystemSettings();
    if (!settings.autoApproveGlpiSolutions) return;

    const headers = { 'App-Token': config.appToken, 'Session-Token': sessionToken, 'Content-Type': 'application/json' };
    const res = await fetch(`${config.baseUrl}/Ticket/${ticket.id}/ITILSolution`, { headers });
    if (!res.ok) return;
    const solutions = await res.json();
    if (!Array.isArray(solutions)) return;

    if (solutions.some((s) => s.status === SOLUTION_STATUS_ACCEPTED)) return;

    await fetch(`${config.baseUrl}/Ticket/${ticket.id}/ITILSolution`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: {
          items_id: ticket.id,
          itemtype: 'Ticket',
          content: 'Solution approuvée automatiquement (IA) — ticket marqué résolu sans solution soumise.',
          status: SOLUTION_STATUS_ACCEPTED,
          _do_not_compute_status: true,
        },
      }),
    }).catch((err) => {
      console.error(`[glpiSync] Échec création/approbation ITILSolution (ticket GLPI ${ticket.id}):`, err.message);
    });
  } catch (err) {
    console.error('[glpiSync] Échec auto-approbation solution:', err.message);
  }
}

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

function rewriteGlpiDocumentUrls(html, config, ticketId) {
  // Réécrit les URLs de documents GLPI (/document.send.php?docid=X) vers le proxy ERP
  // pour que les images/pièces jointes des suivis restent accessibles depuis l'ERP.
  return html.replace(
    /(["'])(?:https?:\/\/[^"']*?|\/?[^"']*?)\/document\.send\.php\?(?:[^"']*?&)?docid=(\d+)(?:&[^"']*?)?\1/gi,
    (match, quote, docId) => `${quote}/api/glpi/document/${docId}/file${quote}`
  );
}

function sanitizeGlpiHtml(html) {
  // Nettoie le HTML GLPI : supprime les balises <script> et les attributs on* (event handlers)
  // pour éviter toute injection XSS — GLPI est un système de confiance, mais on ne prend pas de risque.
  return html
    .replace(/<script\b[^<]*(?:<\/script>|<\/script\s*>)/gi, '')
    .replace(/<script(\s[^>]*)?>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\son\w+=\S+/gi, '');
}

async function syncGlpiFollowups(config, sessionToken, glpiTicketId, ticketId) {
  const res = await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}/ITILFollowup`, {
    headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
  });
  if (!res.ok) return;
  const followups = await res.json();
  if (!Array.isArray(followups)) return;

  for (const fu of followups) {
    if (!fu.id || !fu.content) continue;

    // Conserve le HTML original de GLPI au lieu de le stripper : les suivis peuvent contenir
    // des images embarquées (copies d'écran, captures), des tableaux, du formatage riche, etc.
    // Désormais aussi, tout document GLPI référencé via document.send.php?docid=X dans le HTML
    // est automatiquement réécrit vers notre proxy interne pour rester accessible depuis l'ERP.
    let content = fu.content.trim();
    if (!content) continue;

    // Réécrit les URLs des documents GLPI vers le proxy ERP
    content = rewriteGlpiDocumentUrls(content, config, ticketId);
    // Nettoie les scripts et event handlers (GLPI de confiance, mais par sécurité)
    content = sanitizeGlpiHtml(content);
    if (!content) continue;

    try {
      await prisma.followup.upsert({
        where: { glpiFollowupId: fu.id },
        update: { content, createdAt: fu.date_creation ? new Date(fu.date_creation) : undefined },
        create: {
          ticketId,
          glpiFollowupId: fu.id,
          source: 'glpi',
          content,
          createdAt: fu.date_creation ? new Date(fu.date_creation) : new Date(),
        },
      });
    } catch (err) {
      if (err.code !== 'P2002') {
        console.error(`[glpiSync] Échec sync followup GLPI ${fu.id}:`, err.message);
      }
    }
  }
}

module.exports = { syncGlpiTickets, fullReimportFromGlpi, syncGlpiFollowups, getGlpiConfig, getActiveGlpiConfig, glpiInitSession, glpiKillSession };
