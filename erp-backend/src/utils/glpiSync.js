const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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
  return {
    baseUrl: config.baseUrl,
    userToken: config.apiKey,
    appToken,
    dateFrom: config.extra?.dateFrom || null,
    dateTo: config.extra?.dateTo || null,
  };
}

// Récupère la config GLPI Production active
async function getActiveGlpiConfig() {
  return getGlpiConfig('glpi');
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

function parseGlpiDate(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const normalized = rawDate.trim().includes('T') ? rawDate.trim() : rawDate.trim().replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function isTicketInDateRange(t, dateFrom, dateTo) {
  const d = parseGlpiDate(t.date || t.date_creation || t.date_mod);
  if (!d) return true;
  if (dateFrom && d < new Date(`${dateFrom}T00:00:00`)) return false;
  if (dateTo && d > new Date(`${dateTo}T23:59:59`)) return false;
  return true;
}

// Résout un objet Ticket GLPI complet depuis un objet brut (ex. retour de /search/Ticket)
async function resolveGlpiTicketDetails(config, sessionToken, t) {
  if (t && t.id && t.name) {
    return t; // C'est déjà un objet Ticket complet (ex. issu de GET /Ticket)
  }
  // GLPI /search/Ticket retourne les colonnes sous forme de clés numériques (champ 2 = id)
  const glpiId = t ? (t[2] || t['2'] || t.id) : null;
  if (!glpiId) return null;

  try {
    const res = await fetch(`${config.baseUrl}/Ticket/${glpiId}`, {
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`[glpiSync] Échec résolution détails ticket GLPI ${glpiId}:`, err.message);
    return null;
  }
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

    // Si des dates sont fournies, utiliser la requête POST avec criteria (API GLPI avancée)
    if (dateFrom || dateTo) {
      // Champ 15 dans GLPI = Date d'ouverture (date).
      // link: 'AND' est requis pour que GLPI ne combine pas avec un OR par défaut.
      const criteria = [];
      if (dateFrom) {
        criteria.push({
          ...(criteria.length > 0 ? { link: 'AND' } : {}),
          field: 15,
          searchtype: 2, // 2 = superieur ou egal (morethan)
          value: `${dateFrom} 00:00:00`,
        });
      }
      if (dateTo) {
        criteria.push({
          ...(criteria.length > 0 ? { link: 'AND' } : {}),
          field: 15,
          searchtype: 3, // 3 = inferieur ou egal (lessthan)
          value: `${dateTo} 23:59:59`,
        });
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
      const rawTickets = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
      if (rawTickets.length === 0) break;

      // GLPI /search/Ticket renvoie des lignes avec clés numériques (ex: "2" pour ID).
      // On résout chaque ticket via GET /Ticket/:id pour obtenir l'objet standard complet.
      const resolved = await Promise.all(
        rawTickets.map((rt) => resolveGlpiTicketDetails(config, sessionToken, rt))
      );
      // Double vérification client des dates
      const validTickets = resolved.filter(Boolean).filter((t) => isTicketInDateRange(t, dateFrom, dateTo));
      allTickets.push(...validTickets);

      if (rawTickets.length < PAGE_SIZE) break;
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
    const tickets = await fetchAllGlpiTickets(config, sessionToken, {
      dateFrom: config.dateFrom,
      dateTo: config.dateTo,
    });
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

      const createdAt = parseGlpiDate(t.date || t.date_creation || t.date_mod);

      const data = {
        title: t.name,
        content: stripHtml(t.content) || '',
        status,
        priority: glpiPriorityToErp(t.priority),
        category: await glpiIdToCategory(t.itilcategories_id),
        aiProcessed: t.users_id_recipient === GLPI_AI_REQUESTER_ID,
        glpiLocationId: t.locations_id || null,
        glpiLocationName,
        ...(createdAt ? { createdAt } : {}),
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
      await syncGlpiTicketActors(config, sessionToken, t.id, ticketId);
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

  // Persister les filtres de dates dans ApiConfig pour que les synchros automatiques (arrière-plan) les respectent aussi
  try {
    const currentApi = await prisma.apiConfig.findUnique({ where: { serviceName: 'glpi' } });
    if (currentApi) {
      await prisma.apiConfig.update({
        where: { serviceName: 'glpi' },
        data: {
          extra: {
            ...(currentApi.extra || {}),
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
          },
        },
      });
    }
  } catch (err) {
    console.error('[glpiSync] Échec mise à jour ApiConfig.extra avec filtres de dates:', err.message);
  }

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

      const createdAt = parseGlpiDate(t.date || t.date_creation || t.date_mod);

      const data = {
        title: t.name,
        content: stripHtml(t.content) || '',
        status: GLPI_STATUS_MAP[t.status] || 'NEW',
        priority: glpiPriorityToErp(t.priority),
        category: await glpiIdToCategory(t.itilcategories_id),
        aiProcessed: t.users_id_recipient === GLPI_AI_REQUESTER_ID,
        glpiLocationId: t.locations_id || null,
        glpiLocationName,
        ...(createdAt ? { createdAt } : {}),
      };

      const created = await prisma.ticket.create({ data: { ...data, glpiTicketId: t.id } });
      await syncTicketAttachments(config, sessionToken, t.id, created.id);
      await syncGlpiFollowups(config, sessionToken, t.id, created.id);
      await syncGlpiTicketActors(config, sessionToken, t.id, created.id);
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
  // Réécrit les URLs de documents GLPI (/document.send.php?docid=X) vers le proxy ERP.
  // Le chemin sans /api permet à Axios (baseURL = .../api) de résoudre correctement
  // l'URL vers /api/glpi/document/X/file côté backend.
  return html.replace(
    /(["'])(?:https?:\/\/[^"']*?|\/?[^"']*?)\/document\.send\.php\?(?:[^"']*?&)?docid=(\d+)(?:&[^"']*?)?\1/gi,
    (match, quote, docId) => `${quote}/glpi/document/${docId}/file${quote}`
  );
}

function sanitizeGlpiHtml(html) {
  // Nettoie le HTML GLPI : supprime les balises <script>, les attributs on* (event handlers),
  // et les <a> qui embarquent directement une image GLPI (le lien est inutile et déclenche une
  // navigation vers une URL que seul le blob processing côté frontend sait résoudre).
  return html
    .replace(/<script\b[^<]*(?:<\/script>|<\/script\s*>)/gi, '')
    .replace(/<script(\s[^>]*)?>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\son\w+=\S+/gi, '')
    // Supprime les <a href="/glpi/document/..."><img ...></a> — garde l'image, enlève le lien
    .replace(/<a\s[^>]*href=["']\/glpi\/document\/\d+\/file["'][^>]*>\s*(<img[^>]*\/?>)\s*<\/a>/gi, '$1')
    // Supprime aussi les <a target="_blank"> seuls s'ils pointent vers un document GLPI
    .replace(/<a\s[^>]*href=["']\/glpi\/document\/\d+\/file["'][^>]*>\s*<\/a>/gi, '');
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

// Récupère les acteurs (Demandeurs, Techniciens, Observateurs) associés au ticket GLPI
// depuis GET /Ticket/:id/Ticket_User?expand_dropdowns=true et met à jour requesterId / assigneeId sur le ticket ERP.
async function syncGlpiTicketActors(config, sessionToken, glpiTicketId, ticketId) {
  try {
    // expand_dropdowns=true : GLPI résout users_id en objet { id, name, realname, firstname }
    // directement dans la réponse — évite un second appel /User/:id par acteur.
    const res = await fetch(
      `${config.baseUrl}/Ticket/${glpiTicketId}/Ticket_User?expand_dropdowns=true`,
      { headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken } }
    );
    if (!res.ok) return;

    const actors = await res.json();
    if (!Array.isArray(actors) || actors.length === 0) return;

    // Helpers pour extraire l'id numérique et le nom depuis un acteur, que users_id soit
    // un entier (expand_dropdowns désactivé) ou un objet (expand_dropdowns activé).
    function getGlpiId(actor) {
      if (!actor.users_id) return null;
      if (typeof actor.users_id === 'object') return actor.users_id.id || null;
      return actor.users_id;
    }

    function getFullName(actor) {
      if (typeof actor.users_id === 'object') {
        const { realname, firstname, name } = actor.users_id;
        const full = [firstname, realname].filter(Boolean).join(' ').trim();
        return full || name || null;
      }
      return null;
    }

    function buildEmail(actor, glpiId) {
      if (typeof actor.users_id === 'object') {
        const { name } = actor.users_id;
        if (name && name.includes('@')) return name;
        if (name) return `${name}@prosuma.ci`;
      }
      return `glpi_user_${glpiId}@prosuma.ci`;
    }

    // type 1 = Demandeur, type 2 = Assigné, type 3 = Observateur
    const requesterActor = actors.find((a) => a.type === 1);
    const assigneeActor  = actors.find((a) => a.type === 2);

    const updates = {};

    // ─── Demandeur ─────────────────────────────────────────────────────────────
    if (requesterActor) {
      const glpiId = getGlpiId(requesterActor);
      if (glpiId) {
        let requester = await prisma.user.findUnique({ where: { glpiId } });
        if (!requester) {
          try {
            let fullName = getFullName(requesterActor);
            let email    = buildEmail(requesterActor, glpiId);
            // Fallback si expand_dropdowns n'a pas résolu l'objet
            if (!fullName) {
              const uRes = await fetch(`${config.baseUrl}/User/${glpiId}`, {
                headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                fullName = [uData.realname, uData.firstname].filter(Boolean).join(' ') || uData.name || `Utilisateur ${glpiId}`;
                email    = (uData.name && uData.name.includes('@')) ? uData.name : `${uData.name || glpiId}@prosuma.ci`;
              } else {
                fullName = `Utilisateur ${glpiId}`;
              }
            }
            const passwordHash = await bcrypt.hash(crypto.randomBytes(20).toString('hex'), 10);
            requester = await prisma.user.create({
              data: { glpiId, fullName, email, passwordHash, role: 'REQUESTER', mustChangePassword: true },
            });
          } catch (e) { /* email unique en conflit — l'utilisateur existe déjà sous un autre glpiId */ }
        }
        if (requester) updates.requesterId = requester.id;
      }
    }

    // ─── Technicien assigné ─────────────────────────────────────────────────────
    if (assigneeActor) {
      const glpiId = getGlpiId(assigneeActor);
      if (glpiId) {
        let assignee = await prisma.user.findUnique({ where: { glpiId } });
        if (!assignee) {
          try {
            let fullName = getFullName(assigneeActor);
            let email    = buildEmail(assigneeActor, glpiId);
            // Fallback si expand_dropdowns n'a pas résolu l'objet
            if (!fullName) {
              const uRes = await fetch(`${config.baseUrl}/User/${glpiId}`, {
                headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                fullName = [uData.realname, uData.firstname].filter(Boolean).join(' ') || uData.name || `Technicien ${glpiId}`;
                email    = (uData.name && uData.name.includes('@')) ? uData.name : `${uData.name || glpiId}@prosuma.ci`;
              } else {
                fullName = `Technicien ${glpiId}`;
              }
            }
            const passwordHash = await bcrypt.hash(crypto.randomBytes(20).toString('hex'), 10);
            assignee = await prisma.user.create({
              data: { glpiId, fullName, email, passwordHash, role: 'TECHNICIAN', mustChangePassword: true },
            });
          } catch (e) { /* email unique en conflit — l'utilisateur existe déjà sous un autre glpiId */ }
        }
        if (assignee) updates.assignedToId = assignee.id;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.ticket.update({ where: { id: ticketId }, data: updates });
    }
  } catch (err) {
    console.error(`[glpiSync] syncGlpiTicketActors ticket GLPI ${glpiTicketId}:`, err.message);
  }
}


module.exports = { syncGlpiTickets, fullReimportFromGlpi, syncGlpiFollowups, syncGlpiTicketActors, getGlpiConfig, getActiveGlpiConfig, glpiInitSession, glpiKillSession };
