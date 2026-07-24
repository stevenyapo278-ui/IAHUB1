const FormData = require('form-data');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const { categoryToGlpiId, GLPI_AI_REQUESTER_ID } = require('../utils/glpiMapping');
const { getActiveGlpiConfig } = require('../utils/glpiSync');

const GLPI_STATUS_MAP = { NEW: 1, OPEN: 2, PENDING: 4, WAITING_FOR_USER: 4, SOLVED: 5, CLOSED: 6 };
const ERP_PRIORITY_MAP = { P1: 6, P2: 4, P3: 3, P4: 2 };
const GLPI_TYPE_MAP = { INCIDENT: 1, REQUEST: 2 };
const GLPI_URGENCY_IMPACT_MAP = { VERY_LOW: 1, LOW: 2, MEDIUM: 3, HIGH: 4, VERY_HIGH: 5, MAJOR: 6 };
const GLPI_SOURCE_MAP = { Helpdesk: 1, Email: 4, Téléphone: 2 };

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
// Ajoute aussi un marqueur de source selon le réglage glpiSourceMarker (internal_note | none).
// Respecte dryRunMode : si activé, simule la création sans rien écrire dans GLPI.
async function createGlpiTicket({ title, content, priority, category, type, urgency, impact, source, followupNote, locationId }) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  if (settings && settings.enableGlpiTicketCreation === false) return null;

  // Dry-run : ne pas écrire dans GLPI, retourner un ID fictif pour permettre la création ERP
  if (settings?.dryRunMode) {
    // ID négatif unique pour le dry-run : le timestamp en secondes modulo 1M + un random 0-999.
    // Reste dans les limites d'un INTEGER PostgreSQL (4 bytes signés, max ~2,1 milliards).
    // Date.now() brut (~1,78 billion en 2026) dépasse ces limites.
    const fakeGlpiId = -(Math.floor(Date.now() / 1000) % 1000000 + Math.floor(Math.random() * 1000));
    console.log(`[glpiTicketCreator][DRY-RUN] Ticket GLPI simulé avec ID fictif ${fakeGlpiId}`);
    return fakeGlpiId;
  }

  const config = await getActiveGlpiConfig();
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
        itilcategories_id: (await categoryToGlpiId(category)) || 0,
        requesttypes_id: GLPI_SOURCE_MAP[source] || 1,
        users_id_recipient: GLPI_AI_REQUESTER_ID,
        ...(locationId ? { locations_id: Number(locationId) } : {}),
      },
    };

    const ticketRes = await fetch(`${config.baseUrl}/Ticket`, {
      method: 'POST',
      headers,
      body: JSON.stringify(ticketPayload),
    });
    if (!ticketRes.ok) throw new Error(`GLPI création ticket échoué (${ticketRes.status})`);
    const { id: glpiId } = await ticketRes.json();

    // Notes privées à ajouter au ticket GLPI
    const followupParts = [];
    if (followupNote) followupParts.push(followupNote);

    // Marqueur de source : note privée indiquant que le ticket a été créé automatiquement
    const sourceMarker = settings?.glpiSourceMarker || 'internal_note';
    if (sourceMarker === 'internal_note') {
      const markerText = `[Plateforme SOS] Ticket créé automatiquement via la plateforme de traitement des emails.`;
      followupParts.push(markerText);
    }

    if (followupParts.length > 0) {
      const combinedNote = followupParts.join('\n\n---\n\n');
      await fetch(`${config.baseUrl}/Ticket/${glpiId}/ITILFollowup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: { items_id: glpiId, itemtype: 'Ticket', content: combinedNote, is_private: 1 },
        }),
      }).catch((err) => {
        console.error(`[glpiTicketCreator] Échec ajout followup initial (ticket GLPI ${glpiId}):`, err.message);
      });
    }

    return glpiId;
  });
}

// Met à jour un ticket existant dans GLPI (statut, priorité, type, urgence, impact,
// catégorie, assignation). N'envoie que les champs fournis (undefined = inchangé).
// Ne fait rien si le ticket n'a pas de glpiTicketId ou si GLPI n'est pas configuré.
// Respecte dryRunMode et enableGlpiTicketClosure pour les changements de statut.
async function updateGlpiTicket(glpiTicketId, { status, priority, category, type, urgency, impact, assignedToGlpiId, teamGlpiId }) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

  // Dry-run : ne pas écrire dans GLPI
  if (settings?.dryRunMode) {
    console.log(`[glpiTicketCreator][DRY-RUN] Mise à jour GLPI ${glpiTicketId} simulée (non écrite)`);
    return;
  }

  // Fermeture de tickets désactivée
  if (status && settings?.enableGlpiTicketClosure === false && ['SOLVED', 'CLOSED'].includes(status)) {
    console.log(`[glpiTicketCreator] Fermeture GLPI désactivée par configuration (enableGlpiTicketClosure=false) pour le ticket ${glpiTicketId}`);
    status = undefined;
  }

  const config = await getActiveGlpiConfig();
  if (!config || !glpiTicketId) return;

  const input = {};
  if (status !== undefined) input.status = GLPI_STATUS_MAP[status] || 1;
  if (priority !== undefined) input.priority = ERP_PRIORITY_MAP[priority] || 3;
  if (category !== undefined) input.itilcategories_id = (await categoryToGlpiId(category)) || 0;
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
      }).catch((err) => {
        console.error(`[glpiTicketCreator] Échec assignation technicien GLPI (ticket ${glpiTicketId}, user ${assignedToGlpiId}) — désynchro ERP/GLPI possible:`, err.message);
      });
    }

    if (teamGlpiId) {
      await fetch(`${config.baseUrl}/Ticket/${glpiTicketId}/Group_Ticket`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: { tickets_id: glpiTicketId, groups_id: teamGlpiId, type: 2 } }),
      }).catch((err) => {
        console.error(`[glpiTicketCreator] Échec assignation équipe GLPI (ticket ${glpiTicketId}, groupe ${teamGlpiId}) — désynchro ERP/GLPI possible:`, err.message);
      });
    }
  });
}

// Ajoute un suivi (ITILFollowup) à un ticket GLPI existant — utilisé pour répercuter chaque
// réponse email ultérieure de l'utilisateur, et pas seulement le mail d'origine à la création.
// Ne fait rien si GLPI n'est pas configuré ou si le ticket n'a pas de glpiTicketId.
// Respecte les réglages dryRunMode et enableGlpiFollowupCreation :
//   - dryRun = true → n'écrit rien dans GLPI, retourne un ID fictif
//   - enableGlpiFollowupCreation = false → n'ajoute pas de suivi
async function addGlpiFollowup(glpiTicketId, content, { isPrivate = false } = {}) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

  // Dry-run : ne pas écrire dans GLPI, simuler un succès
  if (settings?.dryRunMode) {
    console.log(`[glpiTicketCreator][DRY-RUN] Suivi GLPI ${glpiTicketId} simulé (non écrit)`);
    return -1;
  }

  // Création de suivis désactivée
  if (settings?.enableGlpiFollowupCreation === false) {
    console.log(`[glpiTicketCreator] Ajout de suivi GLPI désactivé par configuration (enableGlpiFollowupCreation=false)`);
    return null;
  }

  const config = await getActiveGlpiConfig();
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
  const config = await getActiveGlpiConfig();
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
async function createTicketFromEmail({ subject, body, from, fromName, analysis, emailAccountId, locationId, tx = prisma }) {
  const title = analysis.suggestedTitle || subject;
  const content = `${body || ''}\n\n---\nAnalyse IA : ${analysis.summary}\nConfiance : ${Math.round((analysis.confidence || 0) * 100)}%`;
  const followupNote = from ? `Email original de ${fromName || from} &lt;${from}&gt;\nSujet : ${subject}` : null;

  let glpiTicketId = null;
  try {
    glpiTicketId = await createGlpiTicket({ title, content, priority: analysis.priority, category: analysis.category, followupNote, locationId });
  } catch (err) {
    console.error('[glpiTicketCreator] Création GLPI échouée:', err.message);
  }

  let glpiLocationName = null;
  if (locationId) {
    const loc = await tx.glpiLocation.findUnique({ where: { glpiLocationId: Number(locationId) } });
    glpiLocationName = loc?.completename || loc?.name || null;
  }

  const erpTicket = await tx.ticket.create({
    data: {
      ...(glpiTicketId ? { glpiTicketId } : {}),
      title,
      content: body || '',
      status: 'NEW',
      priority: analysis.priority || 'P3',
      category: analysis.category || null,
      ...(locationId ? { glpiLocationId: Number(locationId), glpiLocationName } : {}),
      sourceEmail: from || null,
      sourceName: fromName || null,
      sourceSubject: subject || null,
      aiProcessed: true,
      aiSummary: analysis.summary || null,
    },
  });

  // Assigne automatiquement le meilleur technicien : d'abord par compétence (domaine d'expertise),
  // puis par équipe (fallback). L'assignation est journalisée dans ReassignmentLog pour le suivi
  // de précision et l'apprentissage futur.
  try {
    const { autoAssignTechnicianWithAI } = require('./ticketAutoAssign');
    const { sendAssignmentNotificationEmail } = require('./emailSender');
    const { getSystemSettings } = require('./systemSettings');
    // Priorité : compétence exacte suggérée par l'IA (ex: "PORT USB") > catégorie générale (ex: "Matériel")
    const skillHint = analysis.suggestedSkill || analysis.category;
    const assigned = await autoAssignTechnicianWithAI(erpTicket.id, analysis.category, skillHint);
    if (assigned && glpiTicketId) {
      await updateGlpiTicket(glpiTicketId, { assignedToGlpiId: assigned.glpiId });
    }

    // Envoyer un email au technicien si le réglage est activé
    if (assigned) {
      const fullUser = await tx.user.findUnique({ where: { id: assigned.id } });
      if (fullUser?.email) {
        const settings = await getSystemSettings();
        if (settings.notifyTechnicianOnAssignment) {
          await sendAssignmentNotificationEmail({
            ticketId: erpTicket.id,
            glpiTicketId,
            ticketTitle: erpTicket.title,
            priority: erpTicket.priority,
            technicianEmail: fullUser.email,
            technicianName: fullUser.fullName,
            category: analysis.category,
          }).catch((err) => console.error('[glpiTicketCreator] Échec envoi notification assignation:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('[glpiTicketCreator] Auto-assignation échouée:', err.message);
  }

  return { glpiTicketId, erpTicketId: erpTicket.id };
}

// Upload un fichier vers GLPI et l'attache à un ticket existant (Document + Document_Item).
// Retourne l'id du Document GLPI créé, ou null si GLPI n'est pas configuré.
async function uploadGlpiAttachment({ glpiTicketId, buffer, filename, mimeType }) {
  const config = await getActiveGlpiConfig();
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

// Helper de pagination générique pour récupérer tous les éléments d'un endpoint GLPI
async function fetchAllGlpiItems(config, sessionToken, endpoint) {
  const PAGE_SIZE = 100;
  let offset = 0;
  const allItems = [];

  while (true) {
    const url = `${config.baseUrl}/${endpoint}?range=${offset}-${offset + PAGE_SIZE - 1}`;
    const res = await fetch(url, {
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
    }).catch(() => null);

    if (!res || !res.ok) break;
    const data = await res.json().catch(() => []);
    const items = Array.isArray(data) ? data : (data.data || []);
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allItems;
}

// Récupère la carte { users_id: email } depuis GLPI (table UserEmail)
async function fetchGlpiUserEmails(config, sessionToken) {
  const PAGE_SIZE = 100;
  let offset = 0;
  const emailMap = {};

  while (true) {
    const res = await fetch(`${config.baseUrl}/UserEmail?range=${offset}-${offset + PAGE_SIZE - 1}`, {
      headers: { 'App-Token': config.appToken, 'Session-Token': sessionToken },
    }).catch(() => null);
    if (!res || !res.ok) break;
    const data = await res.json().catch(() => []);
    const items = Array.isArray(data) ? data : (data.data || []);
    if (items.length === 0) break;

    for (const item of items) {
      if (item.users_id && item.email) {
        if (!emailMap[item.users_id] || item.is_default) {
          emailMap[item.users_id] = item.email;
        }
      }
    }
    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return emailMap;
}

// Résout l'adresse email d'un utilisateur GLPI / Active Directory
function resolveGlpiUserEmail(u, emailMap = {}) {
  // 1. Email direct sur l'objet
  let email = u._useremails?.[0]?.email || u.email || u.user_email || emailMap[u.id] || null;
  if (email && typeof email === 'string' && email.trim() !== '') {
    return email.trim().toLowerCase();
  }

  // 2. Si le nom GLPI (u.name) est un UPN Active Directory (ex: prenom.nom@prosuma.ci)
  if (u.name && typeof u.name === 'string' && u.name.includes('@') && u.name.includes('.')) {
    return u.name.trim().toLowerCase();
  }

  // 3. Email fallback pour les comptes AD / locaux sans adresse dans GLPI
  const cleanName = (u.name || `user_${u.id}`).toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  return `${cleanName}@prosuma.ci`;
}

// Récupère les groupes (Group) depuis GLPI et crée/met à jour les Team correspondantes
// dans l'ERP, en les liant via glpiGroupId. Retourne le nombre de groupes synchronisés,
// ou null si GLPI n'est pas configuré/accessible.
async function syncTeamsFromGlpi() {
  const config = await getActiveGlpiConfig();
  if (!config) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const groups = await fetchAllGlpiItems(config, sessionToken, 'Group');

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

// Récupère les catégories (ITILCategory) depuis GLPI et crée/met à jour les TicketCategory
// correspondantes dans l'ERP, en les liant via glpiCategoryId.
async function syncCategoriesFromGlpi() {
  const config = await getActiveGlpiConfig();
  if (!config) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const categories = await fetchAllGlpiItems(config, sessionToken, 'ITILCategory');

    let synced = 0;
    for (const cat of categories) {
      if (!cat.name) continue;

      const existingByGlpiId = await prisma.ticketCategory.findUnique({ where: { glpiCategoryId: cat.id } });
      if (existingByGlpiId) {
        await prisma.ticketCategory.update({ where: { id: existingByGlpiId.id }, data: { name: cat.name } });
        synced++;
        continue;
      }

      const existingByName = await prisma.ticketCategory.findUnique({ where: { name: cat.name } });
      if (existingByName) {
        await prisma.ticketCategory.update({ where: { id: existingByName.id }, data: { glpiCategoryId: cat.id } });
        synced++;
        continue;
      }

      await prisma.ticketCategory.create({ data: { name: cat.name, glpiCategoryId: cat.id } });
      synced++;
    }
    return synced;
  });
}

// Synchronise les "Lieux" (Location) depuis GLPI vers la table GlpiLocation de l'ERP.
// Effectue la pagination complète et met à jour automatiquement glpiLocationName sur les tickets.
async function syncLocationsFromGlpi() {
  const config = await getActiveGlpiConfig();
  if (!config) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const locations = await fetchAllGlpiItems(config, sessionToken, 'Location');

    let synced = 0;
    for (const loc of locations) {
      if (!loc.name && !loc.completename) continue;

      await prisma.glpiLocation.upsert({
        where: { glpiLocationId: loc.id },
        update: {
          name: loc.name || loc.completename,
          completename: loc.completename || loc.name,
          address: loc.address || null,
          postcode: loc.postcode || null,
          town: loc.town || null,
          country: loc.country || null,
          building: loc.building || null,
          room: loc.room || null,
        },
        create: {
          glpiLocationId: loc.id,
          name: loc.name || loc.completename,
          completename: loc.completename || loc.name,
          address: loc.address || null,
          postcode: loc.postcode || null,
          town: loc.town || null,
          country: loc.country || null,
          building: loc.building || null,
          room: loc.room || null,
        },
      });
      synced++;
    }

    // Raccordement automatique des noms de lieux sur tous les tickets historiques qui ont glpiLocationId
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE "Ticket" t
        SET "glpiLocationName" = l."completename"
        FROM "GlpiLocation" l
        WHERE t."glpiLocationId" = l."glpiLocationId"
          AND t."glpiLocationName" IS NULL
      `);
    } catch (err) {
      // Ignoré silencieusement si la table/colonne n'existe pas encore
    }

    return synced;
  });
}

// Synchronise les utilisateurs (User) depuis GLPI / Active Directory vers la table User de l'ERP.
async function syncUsersFromGlpi({ createMissing = true } = {}) {
  const config = await getActiveGlpiConfig();
  if (!config) return null;

  return withGlpiSession(config, async (sessionToken) => {
    const emailMap = await fetchGlpiUserEmails(config, sessionToken);
    const users = await fetchAllGlpiItems(config, sessionToken, 'User');

    // Fetch Group_User si createMissing pour assigner l'équipe
    let userGroupMap = {};
    if (createMissing) {
      try {
        const groupUsers = await fetchAllGlpiItems(config, sessionToken, 'Group_User');
        for (const gu of groupUsers) {
          const uid = gu.users_id;
          if (!userGroupMap[uid]) userGroupMap[uid] = [];
          userGroupMap[uid].push(gu.groups_id);
        }
      } catch (e) { /* ignore group fetch errors */ }
    }

    let synced = 0;
    for (const u of users) {
      if (!u.name && !u.realname && !u.firstname) continue;

      const glpiId = u.id;
      const email = resolveGlpiUserEmail(u, emailMap);
      const fullName = [u.realname, u.firstname].filter(Boolean).join(' ') || u.name;

      if (!email) continue;

      // 1. Chercher par glpiId
      let existing = await prisma.user.findUnique({ where: { glpiId } });

      // 2. Chercher par email si pas trouvé par glpiId
      if (!existing) {
        existing = await prisma.user.findUnique({ where: { email } });
      }

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { glpiId, fullName },
        });
        synced++;
      } else if (createMissing) {
        // Trouver l'équipe à partir du groupe GLPI
        const groupIds = userGroupMap[glpiId] || [];
        let teamId = null;
        for (const gid of groupIds) {
          const team = await prisma.team.findUnique({ where: { glpiGroupId: gid } });
          if (team) { teamId = team.id; break; }
        }

        const passwordHash = await bcrypt.hash(crypto.randomBytes(20).toString('hex'), 10);
        await prisma.user.create({
          data: {
            email,
            passwordHash,
            fullName,
            role: 'REQUESTER',
            glpiId,
            teamId,
            mustChangePassword: true,
          },
        });
        synced++;
      }
    }
    return synced;
  });
}

// Récupère la liste des utilisateurs GLPI / Active Directory non encore importés dans l'ERP.
async function getImportableGlpiUsers() {
  const config = await getActiveGlpiConfig();
  if (!config) throw new Error('GLPI non configuré');

  return withGlpiSession(config, async (sessionToken) => {
    const emailMap = await fetchGlpiUserEmails(config, sessionToken);
    const users = await fetchAllGlpiItems(config, sessionToken, 'User');

    // Récupérer les glpiId déjà présents dans l'ERP
    const existingIds = new Set(
      (await prisma.user.findMany({ where: { glpiId: { not: null } }, select: { glpiId: true } }))
        .map((u) => u.glpiId)
    );
    // Récupérer les emails déjà présents dans l'ERP
    const existingEmails = new Set(
      (await prisma.user.findMany({ select: { email: true } })).map((u) => u.email)
    );

    const importable = [];
    for (const u of users) {
      if (!u.name && !u.realname && !u.firstname) continue;
      const email = resolveGlpiUserEmail(u, emailMap);
      if (!email) continue;
      if (existingIds.has(u.id)) continue;
      if (existingEmails.has(email)) continue;

      importable.push({
        glpiId: u.id,
        name: u.name || null,
        firstName: u.firstname || null,
        realName: u.realname || null,
        email,
        fullName: [u.realname, u.firstname].filter(Boolean).join(' ') || u.name,
      });
    }
    return importable;
  });
}

// Importe sélectivement des utilisateurs GLPI dans l'ERP.
async function importGlpiUsers(glpiUserIds) {
  const config = await getActiveGlpiConfig();
  if (!config) throw new Error('GLPI non configuré');

  return withGlpiSession(config, async (sessionToken) => {
    const emailMap = await fetchGlpiUserEmails(config, sessionToken);
    const allUsers = await fetchAllGlpiItems(config, sessionToken, 'User');

    // Filtrer ceux dont l'ID est dans la liste demandée
    const users = allUsers.filter((u) => glpiUserIds.includes(u.id));

    let imported = 0;
    const errors = [];

    for (const u of users) {
      const email = resolveGlpiUserEmail(u, emailMap);
      if (!email) {
        errors.push({ glpiId: u.id, reason: 'Email manquant' });
        continue;
      }
      const fullName = [u.realname, u.firstname].filter(Boolean).join(' ') || u.name;

      // Vérifier qu'il n'existe pas déjà
      const existingByGlpiId = await prisma.user.findUnique({ where: { glpiId: u.id } });
      if (existingByGlpiId) {
        errors.push({ glpiId: u.id, reason: 'Déjà importé' });
        continue;
      }
      const existingByEmail = await prisma.user.findUnique({ where: { email } });
      if (existingByEmail) {
        errors.push({ glpiId: u.id, reason: `Email ${email} déjà utilisé dans l'ERP` });
        continue;
      }

      const passwordHash = await bcrypt.hash(crypto.randomBytes(20).toString('hex'), 10);
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          role: 'TECHNICIAN',
          glpiId: u.id,
          mustChangePassword: true,
        },
      });
      imported++;
    }

    return { imported, errors };
  });
}

module.exports = { createTicketFromEmail, createGlpiTicket, updateGlpiTicket, deleteGlpiTicket, uploadGlpiAttachment, syncTeamsFromGlpi, syncCategoriesFromGlpi, syncLocationsFromGlpi, syncUsersFromGlpi, addGlpiFollowup, getImportableGlpiUsers, importGlpiUsers };

