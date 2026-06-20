const FormData = require('form-data');
const prisma = require('../prismaClient');
const { categoryToGlpiId, GLPI_AI_REQUESTER_ID, GLPI_TECHNICIANS } = require('../utils/glpiMapping');

const GLPI_STATUS_MAP = { NEW: 1, OPEN: 2, PENDING: 4, WAITING_FOR_USER: 4, SOLVED: 5, CLOSED: 6 };
const ERP_PRIORITY_MAP = { P1: 6, P2: 4, P3: 3, P4: 2 };
const GLPI_TYPE_MAP = { INCIDENT: 1, REQUEST: 2 };
const GLPI_URGENCY_IMPACT_MAP = { VERY_LOW: 1, LOW: 2, MEDIUM: 3, HIGH: 4, VERY_HIGH: 5, MAJOR: 6 };
const GLPI_SOURCE_MAP = { Helpdesk: 1, Email: 4, Téléphone: 2 };

async function getGlpiConfig() {
  const config = await prisma.apiConfig.findUnique({ where: { serviceName: 'glpi' } });
  if (!config || !config.isActive || !config.baseUrl || !config.apiKey) return null;
  const appToken = config.extra?.appToken;
  if (!appToken) return null;
  return { baseUrl: config.baseUrl, userToken: config.apiKey, appToken };
}

async function withGlpiSession(config, fn) {
  const sessionRes = await fetch(`${config.baseUrl}/initSession`, {
    headers: { 'App-Token': config.appToken, Authorization: `user_token ${config.userToken}` },
  });
  if (!sessionRes.ok) throw new Error(`GLPI initSession échoué (${sessionRes.status})`);
  const { session_token } = await sessionRes.json();
  try {
    return await fn(session_token);
  } finally {
    await fetch(`${config.baseUrl}/killSession`, {
      headers: { 'App-Token': config.appToken, 'Session-Token': session_token },
    }).catch(() => {});
  }
}

// Crée un ticket dans GLPI à partir de champs génériques (titre, contenu, priorité, catégorie).
// Retourne l'id du ticket GLPI créé, ou null si GLPI n'est pas configuré.
// followupNote : texte optionnel ajouté en suivi privé (ex: contexte de l'email d'origine).
async function createGlpiTicket({ title, content, priority, category, type, urgency, impact, source, followupNote }) {
  const config = await getGlpiConfig();
  if (!config) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const headers = {
      'App-Token': config.appToken,
      'Session-Token': sessionToken,
      'Content-Type': 'application/json',
    };

    const ticketPayload = {
      input: {
        name: title,
        content: content || '',
        status: 1,
        type: GLPI_TYPE_MAP[type] || 1,
        urgency: GLPI_URGENCY_IMPACT_MAP[urgency] || ERP_PRIORITY_MAP[priority] || 3,
        impact: GLPI_URGENCY_IMPACT_MAP[impact] || 3,
        priority: ERP_PRIORITY_MAP[priority] || 3,
        itilcategories_id: categoryToGlpiId(category) || 0,
        requesttypes_id: GLPI_SOURCE_MAP[source] || 1,
        users_id_recipient: GLPI_AI_REQUESTER_ID,
      },
    };

    const ticketRes = await fetch(`${config.baseUrl}/Ticket`, {
      method: 'POST',
      headers,
      body: JSON.stringify(ticketPayload),
    });
    if (!ticketRes.ok) throw new Error(`GLPI création ticket échoué (${ticketRes.status})`);
    const { id: glpiId } = await ticketRes.json();

    if (followupNote) {
      await fetch(`${config.baseUrl}/Ticket/${glpiId}/ITILFollowup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: { items_id: glpiId, itemtype: 'Ticket', content: followupNote, is_private: 1 },
        }),
      }).catch(() => {});
    }

    return glpiId;
  });
}

// Met à jour un ticket existant dans GLPI (statut, priorité, type, urgence, impact,
// catégorie, assignation). N'envoie que les champs fournis (undefined = inchangé).
// Ne fait rien si le ticket n'a pas de glpiTicketId ou si GLPI n'est pas configuré.
async function updateGlpiTicket(glpiTicketId, { status, priority, category, type, urgency, impact, assignedToGlpiId, teamGlpiId }) {
  const config = await getGlpiConfig();
  if (!config || !glpiTicketId) return;

  const input = {};
  if (status !== undefined) input.status = GLPI_STATUS_MAP[status] || 1;
  if (priority !== undefined) input.priority = ERP_PRIORITY_MAP[priority] || 3;
  if (category !== undefined) input.itilcategories_id = categoryToGlpiId(category) || 0;
  if (type !== undefined) input.type = GLPI_TYPE_MAP[type] || 1;
  if (urgency !== undefined) input.urgency = GLPI_URGENCY_IMPACT_MAP[urgency] || 3;
  if (impact !== undefined) input.impact = GLPI_URGENCY_IMPACT_MAP[impact] || 3;

  if (Object.keys(input).length === 0 && assignedToGlpiId === undefined && teamGlpiId === undefined) return;

  await withGlpiSession(config, async (sessionToken) => {
    const headers = {
      'App-Token': config.appToken,
      'Session-Token': sessionToken,
      'Content-Type': 'application/json',
    };

    if (Object.keys(input).length > 0) {
      await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ input: { id: glpiTicketId, ...input } }),
      });
    }

    if (assignedToGlpiId) {
      await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}/Ticket_User`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: { tickets_id: glpiTicketId, users_id: assignedToGlpiId, type: 2 } }),
      }).catch(() => {});
    }

    if (teamGlpiId) {
      await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}/Group_Ticket`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: { tickets_id: glpiTicketId, groups_id: teamGlpiId, type: 2 } }),
      }).catch(() => {});
    }
  });
}

// Ajoute un suivi (ITILFollowup) à un ticket GLPI existant — utilisé pour répercuter chaque
// réponse email ultérieure de l'utilisateur, et pas seulement le mail d'origine à la création.
// Ne fait rien si GLPI n'est pas configuré ou si le ticket n'a pas de glpiTicketId.
async function addGlpiFollowup(glpiTicketId, content, { isPrivate = false } = {}) {
  const config = await getGlpiConfig();
  if (!config || !glpiTicketId || !content) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const headers = {
      'App-Token': config.appToken,
      'Session-Token': sessionToken,
      'Content-Type': 'application/json',
    };
    const res = await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}/ITILFollowup`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: { items_id: glpiTicketId, itemtype: 'Ticket', content, is_private: isPrivate ? 1 : 0 },
      }),
    });
    if (!res.ok) throw new Error(`GLPI ajout followup échoué (${res.status})`);
    const { id } = await res.json();
    return id;
  });
}

// Supprime (purge) un ticket dans GLPI. Ne fait rien si GLPI n'est pas configuré
// ou si le ticket n'a pas de glpiTicketId. Échec silencieux (best-effort).
async function deleteGlpiTicket(glpiTicketId) {
  const config = await getGlpiConfig();
  if (!config || !glpiTicketId) return false;

  return withGlpiSession(config, async (sessionToken) => {
    const res = await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}?force_purge=true`, {
      method: 'DELETE',
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken, 'Content-Type': 'application/json' },
    });
    return res.ok;
  });
}

// Crée un ticket dans GLPI depuis les données d'un email analysé par l'IA,
// puis crée ou met à jour l'entrée correspondante dans la table Ticket de l'ERP.
// Si GLPI n'est pas configuré, le ticket est créé uniquement dans l'ERP.
async function createTicketFromEmail({ subject, body, from, fromName, analysis, emailAccountId }) {
  const title = analysis.suggestedTitle || subject;
  const content = `${body || ''}\n\n---\nAnalyse IA : ${analysis.summary}\nConfiance : ${Math.round((analysis.confidence || 0) * 100)}%`;
  const followupNote = from ? `Email original de ${fromName || from} &lt;${from}&gt;\nSujet : ${subject}` : null;

  let glpiTicketId = null;
  try {
    glpiTicketId = await createGlpiTicket({ title, content, priority: analysis.priority, category: analysis.category, followupNote });
  } catch (err) {
    console.error('[glpiTicketCreator] Création GLPI échouée:', err.message);
  }

  const erpTicket = await prisma.ticket.create({
    data: {
      ...(glpiTicketId ? { glpiTicketId } : {}),
      title,
      content: body || '',
      status: 'NEW',
      priority: analysis.priority || 'P3',
      category: analysis.category || null,
      sourceEmail: from || null,
      sourceName: fromName || null,
      sourceSubject: subject || null,
      aiProcessed: true,
      aiSummary: analysis.summary || null,
    },
  });

  // Assigne automatiquement le technicien le moins chargé de l'équipe correspondant à la
  // catégorie détectée par l'IA — best-effort, un ticket sans équipe connue reste non assigné.
  try {
    const { autoAssignTechnician } = require('./ticketAutoAssign');
    const assigned = await autoAssignTechnician(erpTicket.id, analysis.category);
    if (assigned && glpiTicketId) {
      await updateGlpiTicket(glpiTicketId, { assignedToGlpiId: assigned.glpiId });
    }
  } catch (err) {
    console.error('[glpiTicketCreator] Auto-assignation échouée:', err.message);
  }

  return { glpiTicketId, erpTicketId: erpTicket.id };
}

// Upload un fichier vers GLPI et l'attache à un ticket existant (Document + Document_Item).
// Retourne l'id du Document GLPI créé, ou null si GLPI n'est pas configuré.
async function uploadGlpiAttachment({ glpiTicketId, buffer, filename, mimeType }) {
  const config = await getGlpiConfig();
  if (!config || !glpiTicketId) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const form = new FormData();
    form.append(
      'uploadManifest',
      JSON.stringify({ input: { name: filename, _filename: [filename] } }),
      { contentType: 'application/json' }
    );
    form.append('filename[0]', buffer, { filename, contentType: mimeType || 'application/octet-stream' });

    // form-data en stream casse avec le fetch natif de Node (undici) : on le matérialise en buffer.
    const formBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      form.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      form.on('end', () => resolve(Buffer.concat(chunks)));
      form.on('error', reject);
      form.resume();
    });

    const docRes = await fetch(`${config.baseUrl}/Document`, {
      method: 'POST',
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken, ...form.getHeaders() },
      body: formBuffer,
    });
    if (!docRes.ok) throw new Error(`GLPI upload document échoué (${docRes.status})`);
    const { id: documentId } = await docRes.json();

    await fetch(`${config.baseUrl}/Document_Item`, {
      method: 'POST',
      headers: {
        'App-Token': config.appToken,
        'Session-Token': sessionToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: { documents_id: documentId, items_id: glpiTicketId, itemtype: 'Ticket' } }),
    });

    return documentId;
  });
}

// Récupère les groupes (Group) depuis GLPI et crée/met à jour les Team correspondantes
// dans l'ERP, en les liant via glpiGroupId. Retourne le nombre de groupes synchronisés,
// ou null si GLPI n'est pas configuré/accessible.
async function syncTeamsFromGlpi() {
  const config = await getGlpiConfig();
  if (!config) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const headers = { 'App-Token': config.appToken, 'Session-Token': sessionToken };

    const res = await fetch(`${config.baseUrl}/Group?range=0-200`, { headers });
    if (!res.ok) throw new Error(`GLPI récupération des groupes échouée (${res.status})`);
    const groups = await res.json();

    let synced = 0;
    for (const group of groups) {
      if (!group.name) continue;

      const existingByGlpiId = await prisma.team.findUnique({ where: { glpiGroupId: group.id } });
      if (existingByGlpiId) {
        await prisma.team.update({ where: { id: existingByGlpiId.id }, data: { name: group.name } });
        synced++;
        continue;
      }

      const existingByName = await prisma.team.findUnique({ where: { name: group.name } });
      if (existingByName) {
        await prisma.team.update({ where: { id: existingByName.id }, data: { glpiGroupId: group.id } });
        synced++;
        continue;
      }

      await prisma.team.create({ data: { name: group.name, glpiGroupId: group.id } });
      synced++;
    }
    return synced;
  });
}

module.exports = { createTicketFromEmail, createGlpiTicket, updateGlpiTicket, deleteGlpiTicket, uploadGlpiAttachment, syncTeamsFromGlpi, addGlpiFollowup };
