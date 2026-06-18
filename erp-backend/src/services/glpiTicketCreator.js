const prisma = require('../prismaClient');
const { categoryToGlpiId, GLPI_AI_REQUESTER_ID, GLPI_TECHNICIANS } = require('../utils/glpiMapping');

const GLPI_STATUS_MAP = { NEW: 1, OPEN: 2, PENDING: 4, SOLVED: 5, CLOSED: 6 };
const ERP_PRIORITY_MAP = { P1: 6, P2: 4, P3: 3, P4: 2 };

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

// Crée un ticket dans GLPI depuis les données d'un email analysé par l'IA,
// puis crée ou met à jour l'entrée correspondante dans la table Ticket de l'ERP.
// Si GLPI n'est pas configuré, le ticket est créé uniquement dans l'ERP.
async function createTicketFromEmail({ subject, body, from, fromName, analysis, emailAccountId }) {
  const config = await getGlpiConfig();

  let glpiTicketId = null;

  if (config) {
    glpiTicketId = await withGlpiSession(config, async (sessionToken) => {
      const headers = {
        'App-Token': config.appToken,
        'Session-Token': sessionToken,
        'Content-Type': 'application/json',
      };

      const ticketPayload = {
        input: {
          name: analysis.suggestedTitle || subject,
          content: `${body || ''}\n\n---\nAnalyse IA : ${analysis.summary}\nConfiance : ${Math.round((analysis.confidence || 0) * 100)}%`,
          status: 1,
          urgency: ERP_PRIORITY_MAP[analysis.priority] || 3,
          priority: ERP_PRIORITY_MAP[analysis.priority] || 3,
          itilcategories_id: categoryToGlpiId(analysis.category) || 0,
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

      if (from) {
        await fetch(`${config.baseUrl}/Ticket/${glpiId}/ITILFollowup`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: {
              items_id: glpiId,
              itemtype: 'Ticket',
              content: `Email original de ${fromName || from} &lt;${from}&gt;\nSujet : ${subject}`,
              is_private: 1,
            },
          }),
        }).catch(() => {});
      }

      return glpiId;
    });
  }

  // Créer le ticket ERP (avec ou sans glpiTicketId)
  const erpTicket = await prisma.ticket.create({
    data: {
      ...(glpiTicketId ? { glpiTicketId } : {}),
      title: analysis.suggestedTitle || subject,
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

  return { glpiTicketId, erpTicketId: erpTicket.id };
}

module.exports = { createTicketFromEmail };
