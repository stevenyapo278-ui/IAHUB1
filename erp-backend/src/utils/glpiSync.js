const prisma = require('../prismaClient');
const { GLPI_AI_REQUESTER_ID, glpiIdToCategory } = require('./glpiMapping');
const { getSystemSettings } = require('../services/systemSettings');

// Statut GLPI "TicketValidation" : 2 = en attente, 3 = approuvé, 4 = refusé (constantes ITIL standard GLPI).
const VALIDATION_STATUS_WAITING = 2;
const VALIDATION_STATUS_APPROVED = 3;

// Statut GLPI "ITILSolution" — même échelle que CommonITILValidation (1=NONE, 2=WAITING, 3=ACCEPTED, 4=REFUSED).
const SOLUTION_STATUS_ACCEPTED = 3;
const TICKET_STATUS_SOLVED = 5;

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
  }).catch((err) => {
    console.error('[glpiSync] Échec killSession (fuite possible de session GLPI):', err.message);
  });
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
      const existing = await prisma.ticket.findUnique({ where: { glpiTicketId: t.id } });

      // Le statut GLPI 4 ("En attente") est ambigu : il correspond à la fois à PENDING et
      // WAITING_FOR_USER côté ERP. WAITING_FOR_USER est un statut piloté par l'analyse IA des
      // réponses email (intentAnalyzer) — on ne doit jamais l'écraser au profit de PENDING lors
      // d'une simple resynchronisation depuis GLPI, sinon le ticket sort silencieusement de la
      // file de revue humaine.
      const glpiStatus = GLPI_STATUS_MAP[t.status] || 'NEW';
      const status = (glpiStatus === 'PENDING' && existing?.status === 'WAITING_FOR_USER')
        ? 'WAITING_FOR_USER'
        : glpiStatus;

      const data = {
        title: t.name,
        content: t.content || '',
        status,
        priority: glpiPriorityToErp(t.priority),
        category: await glpiIdToCategory(t.itilcategories_id),
        aiProcessed: t.users_id_recipient === GLPI_AI_REQUESTER_ID,
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
      await maybeAutoApproveValidation(config, sessionToken, t.id);
      await maybeAutoApproveSolution(config, sessionToken, t);
    }

    return { imported, updated };
  } finally {
    await glpiKillSession(config, sessionToken);
  }
}

// Si le réglage "Auto-approbation des solutions GLPI" (Paramètres > Automatisation) est activé,
// approuve automatiquement toute demande de validation de solution en attente sur ce ticket.
// Best-effort : une erreur ici ne doit jamais interrompre la synchro globale des tickets.
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

// Cas réel observé en production : un ticket peut passer au statut "Résolu" SANS qu'aucune
// ITILSolution n'ait jamais été soumise (le technicien clôt sans remplir le champ solution).
// GLPI affiche alors un panneau "Approbation de la solution" vide en attente côté demandeur,
// mais il n'existe aucune ligne TicketValidation correspondante — l'auto-approbation classique
// (maybeAutoApproveValidation, ci-dessus) ne trouve donc jamais rien à approuver dans ce cas.
// Ici, on crée nous-mêmes la solution ET on l'approuve dans la même requête, en utilisant
// _do_not_compute_status pour contourner le garde-fou GLPI qui refuse normalement d'ajouter une
// solution sur un ticket déjà résolu (cf. ITILSolution::prepareInputForAdd côté GLPI).
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

    // Une solution accordée existe déjà (créée par un technicien ou un cycle précédent) : rien à faire.
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
