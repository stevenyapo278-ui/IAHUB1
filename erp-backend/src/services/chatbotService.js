const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { emitTicketCreated } = require('../utils/socket');
const { sendTicketCreationNotification } = require('./emailSender');
const analyticsTools = require('./analyticsTools');

const SYSTEM_PROMPT = `Tu es l'Assistant IA intelligent et analyste Helpdesk IT de Prosuma (IA Hub). Tu réponds en français, de manière chaleureuse, claire, concise, précise et professionnelle.

Tes capacités :
1. Saluer poliment et répondre de manière amicale aux salutations simples.
2. Fournir des informations sur les TICKETS (statut, priorité, détails, demandeur, technicien, lieu, résumé, doublons potentiels).
3. Produire des STATISTIQUES & ANALYSES (top magasins, répartitions par catégorie, causes racines, performances individuelles des techniciens).
4. Fournir des procédures et réponses issues de la Base de Connaissances IT.
5. Accompagner l'utilisateur pour créer de nouveaux tickets ou escalader vers un technicien.
6. RECHERCHER dans l'inventaire d'équipements (assets), les utilisateurs, et les lieux.
7. CHANGER le statut ou l'assignation d'un ticket (si autorisé).
8. Fournir des RÉSUMÉS de tickets existants.
9. DÉTECTER les tickets similaires avant création pour éviter les doublons.

RÈGLES DE FORMATAGE ET DE STYLE :
- Sois direct et concis : réponds précisément à ce qui est demandé.
- Utilise un format Markdown soigné (gras, puces, tableaux si approprié).
- Si l'utilisateur salue simplement, réponds avec courtoisie et propose tes services.
- Si des données statistiques ou des tickets sont fournis dans le contexte, utilise-les pour structurer ta réponse.
- Quand tu modifies un ticket ou en crées un un, confirme l'action avec le numéro et le lien.`;

const INTENT_PROMPT = `Tu es un classificateur d'intentions. Analyse le message utilisateur et réponds UNIQUEMENT avec un JSON valide (pas de texte avant ou après).

Intents possibles :
- "analytics" : statistiques, comparaisons, classements, causes racines ("quel magasin a le plus de tickets", "pourquoi ce magasin a des pannes", "perf de Jean")
- "team_report" : répartition des tickets par équipe, reunion hebdomadaire, presenting ("répartition par équipe", "tickets par technicien", "bilan équipe", "réunion hebdo", "ouverts par équipe")
- "general" : question générale, salutation, conversation
- "search_tickets" : recherche de tickets existants ("pannes vpn", "tickets imprimantes")
- "create_ticket" : créer/ouvrir un ticket pour soi-même, signaler un problème, demander de l'assistance, décrire un incident ("j'ai un problème", "j'ai besoin d'assistance", "mon imprimante ne marche pas", "l'imprimante du 2ème est en panne", "il y a un souci VPN", "signaler un incident", "ça ne fonctionne plus")
- "create_ticket_for" : créer un ticket au nom d'un autre utilisateur ("crée un ticket pour Paul", "ouvre un ticket pour M. Diallo", "ticket pour la compta")
- "confirm_create_ticket" : l'utilisateur confirme vouloir créer un ticket après avoir été demandé ("oui", "oui crée-le", "confirme", "go", "vas-y", "c'est bon", "je confirme", "oui vas-y")
- "check_ticket" : connaître le statut d'un ticket spécifique
- "summary" : résumer un ticket existant ("résume-moi le ticket #123", "résumé du ticket 45")
- "similar_tickets" : chercher des tickets similaires avant création
- "change_status" : modifier le statut d'un ticket
- "assign_ticket" : assigner un ticket à un technicien
- "search_inventory" : recherche d'équipements/assets
- "search_users" : recherche d'utilisateurs
- "search_locations" : recherche de lieux/où
- "report" : rapport/statistique global sur les tickets ouverts
- "escalate" : parler à un technicien/humain, escalade
- "help" : demande d'aide sur les fonctionnalités

Réponds avec : {"intent": "nom_intent", "params": {}}

Extraction de paramètres :
- Si mot-clé spécifique mentionné → "keyword": "..."
- Si question "pourquoi" → "isWhy": true
- Si numéro de ticket (#123) → "ticketId": 123
- Si titre + description fournis → "title": "...", "description": "..."
- Si un nom de personne mentionné → "personName": "..."
- Si un nom de lieu mentionné → "locationName": "..."
- Si un nom d'équipe mentionné → "teamName": "..."
- Si création pour un autre → "forUser": "..." (nom de la personne)`;

// ── Recherche RAG (Base de connaissances) ─────────────────────────────

async function searchKnowledge(query, limit = 5) {
  try {
    const response = await fetch('http://localhost:4000/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, useHybrid: true }),
    });
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

// ── Recherche de tickets ERP en base ───────────────────────────────────

async function searchTickets(query, limit = 5, user = null) {
  if (!query || !query.trim()) return [];
  const clean = query.trim();
  const lower = clean.toLowerCase();

  const idMatch = clean.match(/#?(\d+)/);
  const statusMatch = lower.match(/\b(nouveau|ouvert|attente|résolu|resolu|fermé|ferme)\b/);
  const priorityMatch = lower.match(/\b(p1|p2|p3|p4|critique|haute|moyenne|basse)\b/);

  const STATUS_MAP = {
    nouveau: 'NEW', ouvert: 'OPEN', attente: 'PENDING',
    résolu: 'SOLVED', resolu: 'SOLVED', fermé: 'CLOSED', ferme: 'CLOSED',
  };

  const PRIORITY_MAP = {
    p1: 'P1', critique: 'P1', p2: 'P2', haute: 'P2',
    p3: 'P3', moyenne: 'P3', p4: 'P4', basse: 'P4',
  };

  try {
    const where = {};

    // ── Filtrage par rôle ──────────────────────────────────────────────
    if (user && user.role === 'REQUESTER') {
      where.OR = [
        { requesterId: user.sub },
        { observers: { some: { id: user.sub } } },
      ];
    } else if (user && user.role === 'TECHNICIAN') {
      where.OR = [
        { assignedToId: user.sub },
        { requesterId: user.sub },
        { observers: { some: { id: user.sub } } },
      ];
    }

    if (statusMatch) where.status = STATUS_MAP[statusMatch[1]];
    if (priorityMatch) where.priority = PRIORITY_MAP[priorityMatch[1]];

    const STOP_WORDS = new Set([
      'les', 'des', 'que', 'sur', 'pour', 'avec', 'par', 'dans', 'un', 'une', 'qui', 'est',
      'ticket', 'tickets', 'montre', 'cherche', 'donne', 'combien', 'quels', 'quelle', 'quelles',
      'est-ce', 'base', 'propos', 'avez-vous', 'avez', 'nous', 'vous',
      'bonjour', 'bonsoir', 'salut', 'hello', 'coucou', 'hey', 'hi', 'merci', 'svp', 'stp', 're', 'salutations'
    ]);

    const words = clean.split(/\s+/).filter(
      (w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase())
    );

    if (words.length === 0 && !idMatch && !statusMatch && !priorityMatch) return [];

    if (words.length > 0) {
      const keywordFilter = words.flatMap((w) => [
        { title: { contains: w, mode: 'insensitive' } },
        { content: { contains: w, mode: 'insensitive' } },
        { category: { contains: w, mode: 'insensitive' } },
        { locationName: { contains: w, mode: 'insensitive' } },
      ]);

      // REQUESTER/TECHNICIAN : leur filtre role EST déjà dans where.OR
      // → on utilise AND pour combiner role + keyword
      if (user && (user.role === 'REQUESTER' || user.role === 'TECHNICIAN')) {
        const roleFilter = { OR: where.OR };
        where.AND = [roleFilter, { OR: keywordFilter }];
        delete where.OR;
      } else {
        where.OR = keywordFilter;
      }
    }

    if (idMatch) {
      const numId = parseInt(idMatch[1], 10);
      if (!where.OR) where.OR = [];
      where.OR.push({ id: numId }, { glpiTicketId: numId });
    }

    return await prisma.ticket.findMany({
      where,
      take: limit,
      include: {
        requester: { select: { fullName: true, email: true } },
        assignedTo: { select: { fullName: true } },
        team: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.error('[chatbot] Erreur recherche tickets:', err.message);
    return [];
  }
}

// ── Recherche d'inventaire (assets) ───────────────────────────────────

async function searchAssets(query, limit = 5) {
  if (!query || !query.trim()) return [];
  try {
    const response = await fetch(`http://localhost:4000/api/assets?q=${encodeURIComponent(query.trim())}&pageSize=${limit}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.assets || [];
  } catch {
    return [];
  }
}

// ── Recherche d'utilisateurs ──────────────────────────────────────────

async function searchUsers(query, limit = 5) {
  if (!query || !query.trim()) return [];
  try {
    const response = await fetch(`http://localhost:4000/api/users?search=${encodeURIComponent(query.trim())}&limit=${limit}`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

// ── Recherche de lieux ────────────────────────────────────────────────

async function searchLocations(query, limit = 10) {
  if (!query || !query.trim()) return [];
  try {
    const response = await fetch(`http://localhost:4000/api/locations?q=${encodeURIComponent(query.trim())}`);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data.slice(0, limit) : [];
  } catch {
    return [];
  }
}

// ── Appel IA ───────────────────────────────────────────────────────────

async function callAI(messages) {
  const providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun fournisseur IA configuré.');

  const formattedMessages = messages.map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.content}`).join('\n\n');
  const prompt = `${SYSTEM_PROMPT}\n\n---\n\n${formattedMessages}`;

  return callAiWithRetry(() => callProviderWithFallback(providers, prompt, 'chatbot'), {
    maxRetries: 2,
    baseDelay: 1500,
  });
}

async function callIntentAI(message) {
  const providers = await getActiveProviders();
  if (providers.length === 0) return null;

  try {
    const formatted = `${INTENT_PROMPT}\n\nUser: "${message}"\nJSON:`;
    const raw = await callProviderWithFallback(providers, formatted, 'chatbot');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return null;
}

// ── Intent detection (IA + regex fallback) ─────────────────────────────

function detectIntentRegex(message) {
  const lower = message.toLowerCase();
  if (lower.match(/\b(r[ée]sume|r[ée]sum[ée])\b/)) return 'summary';
  if (lower.match(/\b(similaire|doublon|m[êe]me (probl[èe]me|incident|sujet)|y a-t-il|d[ée]j[à])\b/)) return 'similar_tickets';
  if (lower.match(/\b(ferme|clôtur|cloture|passe|r[ée]solu|resolu|change.*statut|met.*statut)\b/)) return 'change_status';
  if (lower.match(/\b(assigne|affecte|donne.*[àa]|attribue|passe.*[àa])\b/)) return 'assign_ticket';
  if (lower.match(/\b(inventaire|[ée]quipement|asset|pc portable|imprimante|mat[ée]riel)\b/)) return 'search_inventory';
  if (lower.match(/\b(utilisateur|user|qui est|email de|t[ée]l[ée]phone de|nom de)\b/)) return 'search_users';
  if (lower.match(/\b(lieu|site|magasin|o[uù] se trouve|adresse|localisation)\b/)) return 'search_locations';
  if (lower.match(/\b(r[ée]partition|par[ée]quipe|par[ée]quipe|bilan.*quipe|r[ée]union|hebdo|ouverts par|quipe)\b/)) return 'team_report';
  if (lower.match(/\b(magasin|lieu|top|comparer|plus de probl[èe]mes?|statistiques?|stats?|analyse|pourquoi|cause)\b/)) return 'analytics';
  if (lower.match(/^\s*(oui|yes|go|confirme|c'est bon|vas-y|ok|d'accord|je confirme|oui crée|oui vas)\b/i)) return 'confirm_create_ticket';
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident)\b/.test(lower) && /\b(pour|au nom de|pour le compte)\b/.test(lower))) return 'create_ticket_for';
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident|panne|souci|ne marche|fonctionne plus|erreur|assistance)\b/)) return 'create_ticket';
  if (lower.match(/\b(statut|état|avancement|suiv[ie]|ticket\s*#?\s*\d+|#\d+|num[ée]ro)\b/)) return 'check_ticket';
  if (lower.match(/\b(rapport|synth[èe]se|combien|nombre|total)\b/)) return 'report';
  if (lower.match(/\b(escalade|technicien|humain|agent|support|parler|[aà] quelqu'un|transfer)\b/)) return 'escalate';
  if (lower.match(/\b(aide|commandes?|fonctionnalit[ée]s?|que sais|que peux|help|menu)\b/)) return 'help';
  return 'general';
}

async function detectIntent(message) {
  const aiResult = await callIntentAI(message);
  if (aiResult?.intent) return aiResult;
  return { intent: detectIntentRegex(message), params: {} };
}

// ── Contexte utilisateur ──────────────────────────────────────────────

async function getUserContext(userId) {
  if (!userId) return '';
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullName: true,
        email: true,
        role: true,
        teams: { select: { name: true } },
        skills: { select: { name: true } },
      },
    });
    if (!user) return '';

    const parts = [`Nom: ${user.fullName}`, `Rôle: ${user.role}`];
    if (user.teams?.length) parts.push(`Équipes: ${user.teams.map((t) => t.name).join(', ')}`);
    if (user.skills?.length) parts.push(`Compétences: ${user.skills.map((s) => s.name).join(', ')}`);
    return parts.join(' | ');
  } catch {
    return '';
  }
}

// ── Actions métier ─────────────────────────────────────────────────────

const STATUS_LABEL = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé' };
const PRIORITY_LABEL = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

async function generateReport() {
  const tickets = await prisma.ticket.findMany({
    where: { status: { notIn: ['CLOSED'] } },
    include: { assignedTo: { select: { fullName: true } }, team: { select: { name: true } } },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
  });

  if (tickets.length === 0) return 'Aucun ticket ouvert en ce moment.';

  const byStatus = {};
  const byPriority = {};
  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
  }

  let report = `**Rapport des tickets ouverts** (${tickets.length} total)\n\n`;
  report += `**Par statut :**\n`;
  for (const [s, c] of Object.entries(byStatus)) report += `• ${STATUS_LABEL[s] || s} : ${c}\n`;
  report += `\n**Par priorité :**\n`;
  for (const [p, c] of Object.entries(byPriority)) report += `• ${PRIORITY_LABEL[p] || p} : ${c}\n`;
  report += `\n**5 tickets les plus récents :**\n`;
  for (const t of tickets.slice(0, 5)) {
    report += `• **#${t.id}** ${t.title} — ${PRIORITY_LABEL[t.priority] || t.priority} — ${t.assignedTo?.fullName || 'Non assigné'}\n`;
  }
  return report;
}

async function checkTicketStatus(ticketId) {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) return 'Numéro de ticket invalide.';

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { assignedTo: { select: { fullName: true } }, team: { select: { name: true } } },
  });

  if (!ticket) return `Ticket #${id} introuvable.`;

  let r = `**Ticket #${ticket.id}**\n`;
  r += `• **Titre :** ${ticket.title}\n`;
  r += `• **Statut :** ${STATUS_LABEL[ticket.status] || ticket.status}\n`;
  r += `• **Priorité :** ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\n`;
  r += `• **Assigné à :** ${ticket.assignedTo?.fullName || 'Non assigné'}\n`;
  if (ticket.team) r += `• **Équipe :** ${ticket.team.name}\n`;
  r += `• **Créé le :** ${new Date(ticket.createdAt).toLocaleDateString('fr-FR')}\n`;
  return r;
}

async function getTicketSummary(ticketId) {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) return 'Numéro de ticket invalide.';

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      requester: { select: { fullName: true, email: true } },
      assignedTo: { select: { fullName: true } },
      team: { select: { name: true } },
      comments: { orderBy: { createdAt: 'desc' }, take: 5, select: { content: true, createdAt: true, author: { select: { fullName: true } } } },
    },
  });

  if (!ticket) return `Ticket #${id} introuvable.`;

  let r = `**Résumé du Ticket #${ticket.id}**\n\n`;
  r += `**Titre :** ${ticket.title}\n`;
  r += `**Statut :** ${STATUS_LABEL[ticket.status] || ticket.status} | **Priorité :** ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\n`;
  r += `**Demandeur :** ${ticket.requester?.fullName || 'Inconnu'} (${ticket.requester?.email || ''})\n`;
  r += `**Assigné à :** ${ticket.assignedTo?.fullName || 'Non assigné'}\n`;
  if (ticket.team) r += `**Équipe :** ${ticket.team.name}\n`;
  if (ticket.category) r += `**Catégorie :** ${ticket.category}\n`;
  if (ticket.locationName) r += `**Lieu :** ${ticket.locationName}\n`;
  r += `**Créé le :** ${new Date(ticket.createdAt).toLocaleDateString('fr-FR')}\n\n`;
  r += `**Description :**\n${(ticket.content || 'Aucune description').substring(0, 800)}\n`;

  if (ticket.comments?.length > 0) {
    r += `\n**Derniers commentaires :**\n`;
    for (const c of ticket.comments) {
      r += `• *${c.author?.fullName || 'Inconnu'}* (${new Date(c.createdAt).toLocaleDateString('fr-FR')}) : ${(c.content || '').substring(0, 200)}\n`;
    }
  }
  return r;
}

async function findSimilarTickets(title, description) {
  const query = `${title || ''} ${description || ''}`.trim();
  if (!query) return [];

  const words = query.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];

  return await prisma.ticket.findMany({
    where: {
      status: { notIn: ['CLOSED'] },
      OR: words.flatMap((w) => [
        { title: { contains: w, mode: 'insensitive' } },
        { content: { contains: w, mode: 'insensitive' } },
      ]),
    },
    take: 5,
    include: {
      requester: { select: { fullName: true } },
      assignedTo: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function changeTicketStatus(ticketId, newStatus) {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) return { error: 'Numéro de ticket invalide.' };

  const STATUS_MAP = {
    nouveau: 'NEW', ouvert: 'OPEN', attente: 'PENDING', résolu: 'SOLVED',
    resolu: 'SOLVED', fermé: 'CLOSED', ferme: 'CLOSED', new: 'NEW', open: 'OPEN',
    pending: 'PENDING', solved: 'SOLVED', closed: 'CLOSED',
  };

  const normalized = STATUS_MAP[newStatus.toLowerCase()];
  if (!normalized) return { error: `Statut "${newStatus}" non reconnu. Valeurs possibles : nouveau, ouvert, attente, résolu, fermé.` };

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return { error: `Ticket #${id} introuvable.` };

  const updated = await prisma.ticket.update({ where: { id }, data: { status: normalized } });
  return { ticket: updated, oldStatus: STATUS_LABEL[ticket.status], newStatus: STATUS_LABEL[normalized] };
}

async function assignTicket(ticketId, personName) {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) return { error: 'Numéro de ticket invalide.' };
  if (!personName) return { error: 'Nom du technicien requis.' };

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return { error: `Ticket #${id} introuvable.` };

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { fullName: { contains: personName, mode: 'insensitive' } },
        { email: { contains: personName, mode: 'insensitive' } },
      ],
    },
    select: { id: true, fullName: true, role: true },
    take: 5,
  });

  if (users.length === 0) return { error: `Aucun utilisateur trouvé pour "${personName}".` };

  const tech = users.find((u) => ['TECHNICIAN', 'HOTLINE', 'ADMIN'].includes(u.role)) || users[0];
  const updated = await prisma.ticket.update({
    where: { id },
    data: { assignedToId: tech.id, status: ticket.status === 'NEW' ? 'OPEN' : ticket.status },
  });

  emitTicketCreated(updated);
  return { ticket: updated, assignedTo: tech.fullName, oldAssignedTo: ticket.assignedToId };
}

async function createTicketFromChat(title, description, priority, userId) {
  const ticket = await prisma.ticket.create({
    data: {
      title,
      content: description,
      priority: priority || 'P3',
      status: 'NEW',
      source: 'Chatbot',
      requesterId: userId,
      type: 'INCIDENT',
    },
  });
  emitTicketCreated(ticket);
  // Notification aux boîtes configurées dans les Paramètres (best-effort, non bloquant)
  sendTicketCreationNotification(ticket).catch((err) =>
    console.error('[chatbot] Notification création ticket échouée:', err.message)
  );
  return ticket;
}

async function escalateToTechnician(message, userId) {
  const ticket = await prisma.ticket.create({
    data: {
      title: `Escalade depuis le chatbot : ${message.substring(0, 100)}`,
      content: message,
      priority: 'P2',
      status: 'NEW',
      source: 'Chatbot',
      requesterId: userId,
      type: 'INCIDENT',
    },
  });
  emitTicketCreated(ticket);
  sendTicketCreationNotification(ticket).catch((err) =>
    console.error('[chatbot] Notification escalade échouée:', err.message)
  );
  return ticket;
}

async function getTechnicianStats(personName) {
  if (!personName) return null;

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { fullName: { contains: personName, mode: 'insensitive' } },
        { email: { contains: personName, mode: 'insensitive' } },
      ],
    },
    select: { id: true, fullName: true, role: true },
  });

  if (!user) return null;

  const tickets = await prisma.ticket.findMany({
    where: { assignedToId: user.id },
    select: { status: true, priority: true, createdAt: true, resolvedAt: true },
  });

  const total = tickets.length;
  const byStatus = {};
  const byPriority = {};
  let resolvedCount = 0;
  let totalResolutionTime = 0;

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    if (t.status === 'SOLVED' || t.status === 'CLOSED') {
      resolvedCount++;
      if (t.resolvedAt) {
        totalResolutionTime += (new Date(t.resolvedAt) - new Date(t.createdAt)) / (1000 * 60 * 60);
      }
    }
  }

  return {
    name: user.fullName,
    total,
    resolvedCount,
    resolutionRate: total > 0 ? Math.round((resolvedCount / total) * 100) : 0,
    avgResolutionHours: resolvedCount > 0 ? Math.round(totalResolutionTime / resolvedCount) : 0,
    byStatus,
    byPriority,
  };
}

// ── Aide : vérification des rôles ─────────────────────────────────────

const STAFF_ROLES = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'];
const ADMIN_ROLES = ['SUPERADMIN', 'ADMIN', 'HOTLINE'];

function isStaff(user) {
  return user && STAFF_ROLES.includes(user.role);
}

function isAdminOrAbove(user) {
  return user && ADMIN_ROLES.includes(user.role);
}

// ── Message handler ────────────────────────────────────────────────────

async function handleMessage(message, conversationHistory = [], user = null, pendingTicketData = null) {
  const userId = user?.sub || null;
  const { intent, params } = await detectIntent(message);

  // Contexte utilisateur
  const userContext = await getUserContext(userId);

  // ── Vérification des permissions pour les intents sensibles ────────
  if (intent === 'change_status' && !isStaff(user)) {
    return {
      reply: "❌ Vous n'avez pas les droits pour modifier le statut d'un ticket. Seuls les techniciens, hotline et administrateurs peuvent effectuer cette action.",
      intent, action: null, widget: null, sources: [],
    };
  }

  if (intent === 'assign_ticket' && !isStaff(user)) {
    return {
      reply: "❌ Vous n'avez pas les droits pour assigner un ticket. Seuls les techniciens, hotline et administrateurs peuvent effectuer cette action.",
      intent, action: null, widget: null, sources: [],
    };
  }

  if (intent === 'search_users' && !isStaff(user)) {
    return {
      reply: "❌ Vous n'avez pas les droits pour rechercher des utilisateurs. Contactez un administrateur.",
      intent, action: null, widget: null, sources: [],
    };
  }

  if (intent === 'search_locations' && !isStaff(user)) {
    return {
      reply: "❌ Vous n'avez pas les droits pour rechercher des lieux. Contactez un administrateur.",
      intent, action: null, widget: null, sources: [],
    };
  }

  // Recherche simultanée : RAG + Tickets + (selon intent) inventaire/users/locations
  const searches = [
    searchKnowledge(message, 3),
    searchTickets(message, 5, user),
  ];

  if (intent === 'search_inventory') searches.push(searchAssets(params?.keyword || message, 5));
  else searches.push(Promise.resolve([]));

  if (intent === 'search_users' && isStaff(user)) searches.push(searchUsers(params?.personName || message, 5));
  else searches.push(Promise.resolve([]));

  if (intent === 'search_locations' && isStaff(user)) searches.push(searchLocations(params?.locationName || message, 10));
  else searches.push(Promise.resolve([]));

  const [knowledgeChunks, matchingTickets, assets, users, locations] = await Promise.all(searches);

  const knowledgeContext = knowledgeChunks.length > 0
    ? knowledgeChunks.map((c) => `[${c.title}] : ${c.content.substring(0, 500)}`).join('\n\n')
    : '';

  const contextParts = [];

  if (userContext) {
    contextParts.push(`**Profil de l'utilisateur :** ${userContext}`);
  }

  if (knowledgeContext) {
    contextParts.push(`**Informations de la base de connaissances :**\n${knowledgeContext}`);
  }

  if (matchingTickets.length > 0) {
    let ticketContext = "**Tickets pertinents trouvés dans la base de données (/tickets) :**\n";
    for (const t of matchingTickets) {
      ticketContext += `• **Ticket #${t.id}** : "${t.title}"\n  - Statut : ${STATUS_LABEL[t.status] || t.status} | Priorité : ${PRIORITY_LABEL[t.priority] || t.priority}`;
      if (t.category) ticketContext += ` | Catégorie : ${t.category}`;
      if (t.requester) ticketContext += ` | Demandeur : ${t.requester.fullName}`;
      if (t.assignedTo) ticketContext += ` | Assigné à : ${t.assignedTo.fullName}`;
      if (t.locationName) ticketContext += ` | Lieu : ${t.locationName}`;
      if (t.glpiTicketId) ticketContext += ` | GLPI #${t.glpiTicketId}`;
      ticketContext += `\n  - *Description :* ${(t.content || '').substring(0, 200)}...\n\n`;
    }
    contextParts.push(ticketContext);
  }

  if (assets.length > 0) {
    let assetContext = "**Équipements trouvés dans l'inventaire :**\n";
    for (const a of assets) {
      assetContext += `• **${a.name}** (${a.assetType}) — N° série: ${a.serialNumber || 'N/A'} | Inventaire: ${a.inventoryNumber || 'N/A'}`;
      if (a.manufacturer) assetContext += ` | Marque: ${a.manufacturer}`;
      if (a.model) assetContext += ` | Modèle: ${a.model}`;
      if (a.location) assetContext += ` | Lieu: ${a.location.name}`;
      if (a.owner) assetContext += ` | Propriétaire: ${a.owner.fullName}`;
      assetContext += `\n`;
    }
    contextParts.push(assetContext);
  }

  if (users.length > 0) {
    let userContextStr = "**Utilisateurs trouvés :**\n";
    for (const u of users) {
      userContextStr += `• **${u.fullName}** — Rôle: ${u.role}`;
      if (u.email) userContextStr += ` | Email: ${u.email}`;
      if (u.teams?.length) userContextStr += ` | Équipes: ${u.teams.map((t) => t.name).join(', ')}`;
      userContextStr += `\n`;
    }
    contextParts.push(userContextStr);
  }

  if (locations.length > 0) {
    let locContext = "**Lieux trouvés :**\n";
    for (const l of locations) {
      locContext += `• **${l.name}** — ${l.completename || ''}`;
      if (l.address) locContext += ` | Adresse: ${l.address}`;
      locContext += `\n`;
    }
    contextParts.push(locContext);
  }

  let action = null;
  let widget = null;
  let pendingTicket = null;

  switch (intent) {
    case 'analytics': {
      if (!isStaff(user)) {
        contextParts.push(`**Accès refusé :** Les statistiques et analyses ne sont accessibles qu'aux équipes support.`);
        break;
      }
      const lower = message.toLowerCase();
      const kwMatch = message.match(/\b(asten|caisse|vpn|réseau|reseau|imprimante|telephonie|logiciel)\b/i);
      const kw = params?.keyword || (kwMatch ? kwMatch[1] : null);

      // Si un nom de personne est mentionné → stats technicien (staff only)
      if (params?.personName || (lower.match(/\b(perf|performance|stats|statistiques)\b/) && lower.match(/\b([A-Z][a-z]+)\b/))) {
        if (!isStaff(user)) {
          contextParts.push(`**Accès refusé :** Les statistiques de performance ne sont accessibles qu'aux équipes support.`);
          break;
        }
        const techName = params?.personName || lower.match(/\b([A-Z][a-z]+)\b/)?.[1];
        if (techName) {
          const stats = await getTechnicianStats(techName);
          if (stats) {
            let statsText = `**Performance de ${stats.name} :**\n`;
            statsText += `• Total tickets assignés : ${stats.total}\n`;
            statsText += `• Résolus : ${stats.resolvedCount} (${stats.resolutionRate}%)\n`;
            statsText += `• Temps moyen de résolution : ${stats.avgResolutionHours}h\n`;
            statsText += `**Par statut :**\n`;
            for (const [s, c] of Object.entries(stats.byStatus)) statsText += `  • ${STATUS_LABEL[s] || s} : ${c}\n`;
            statsText += `**Par priorité :**\n`;
            for (const [p, c] of Object.entries(stats.byPriority)) statsText += `  • ${PRIORITY_LABEL[p] || p} : ${c}\n`;
            contextParts.push(statsText);
            break;
          }
        }
      }

      if (lower.includes('pourquoi') || params?.isWhy) {
        const rootCause = await analyticsTools.analyzeRootCause({ locationName: kw, filterKeyword: kw });
        contextParts.push(`**Données d'analyse de cause racine pour ${kw || 'l\'ensemble des tickets'} (${rootCause.sampleCount} incidents analysés) :**\n` +
          rootCause.ticketsSample.map(t => `• Ticket #${t.id} [${t.category || 'Général'}]: ${t.subject}`).join('\n')
        );
      } else {
        const stats = await analyticsTools.getTopLocationsStats({ filterKeyword: kw, period: '30d', limit: 5 });
        if (stats.rankings.length > 0) {
          widget = {
            type: 'chart',
            chartType: 'bar',
            title: `📊 Top Magasins / Lieux ${kw ? `(Filtre: ${kw})` : ''}`,
            data: stats.chartData,
            columns: ['name', 'Tickets', 'Urgents'],
            rankings: stats.rankings,
          };

          let statsText = `**Analyse statistique par Lieu / Magasin :**\n`;
          for (const r of stats.rankings) {
            statsText += `• **Rang #${r.rank} : ${r.locationName}** — ${r.totalTickets} tickets (${r.percentage}% du total, ${r.urgentTickets} urgents)\n`;
          }
          contextParts.push(statsText);
        }
      }
      break;
    }

    case 'check_ticket': {
      const tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      if (tid) {
        // Vérifier l'accès au ticket pour REQUESTER/TECHNICIAN
        if (user && (user.role === 'REQUESTER' || user.role === 'TECHNICIAN')) {
          const ticket = await prisma.ticket.findUnique({
            where: { id: parseInt(tid, 10) },
            select: { requesterId: true, assignedToId: true },
          });
          if (ticket) {
            const hasAccess = user.role === 'TECHNICIAN'
              ? (ticket.assignedToId === user.sub || ticket.requesterId === user.sub)
              : ticket.requesterId === user.sub;
            if (!hasAccess) {
              contextParts.push(`**Accès refusé :** Vous n'avez pas accès au ticket #${tid}.`);
              break;
            }
          }
        }
        const info = await checkTicketStatus(tid);
        contextParts.push(`**Résultat de la consultation :**\n${info}`);
      } else {
        contextParts.push(`L'utilisateur veut consulter un ticket mais n'a pas donné de numéro. Demandez-le.`);
      }
      break;
    }

    case 'summary': {
      const tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      if (tid) {
        // Vérifier l'accès au ticket pour REQUESTER/TECHNICIAN
        if (user && (user.role === 'REQUESTER' || user.role === 'TECHNICIAN')) {
          const ticket = await prisma.ticket.findUnique({
            where: { id: parseInt(tid, 10) },
            select: { requesterId: true, assignedToId: true },
          });
          if (ticket) {
            const hasAccess = user.role === 'TECHNICIAN'
              ? (ticket.assignedToId === user.sub || ticket.requesterId === user.sub)
              : ticket.requesterId === user.sub;
            if (!hasAccess) {
              contextParts.push(`**Accès refusé :** Vous n'avez pas accès au ticket #${tid}.`);
              break;
            }
          }
        }
        const summary = await getTicketSummary(tid);
        contextParts.push(`**Résumé :**\n${summary}`);
      } else {
        contextParts.push(`L'utilisateur veut un résumé de ticket mais n'a pas donné de numéro. Demandez-le.`);
      }
      break;
    }

    case 'similar_tickets': {
      const title = params?.title || '';
      const description = params?.description || message;
      const similar = await findSimilarTickets(title, description);
      if (similar.length > 0) {
        let simContext = `**Tickets similaires potentiels (${similar.length} trouvés) :**\n`;
        for (const t of similar) {
          simContext += `• **#${t.id}** ${t.title} — ${STATUS_LABEL[t.status] || t.status} — ${t.requester?.fullName || 'Inconnu'}\n`;
        }
        simContext += `\n*Voulez-vous créer un nouveau ticket ou mettre à jour un existant ?*`;
        contextParts.push(simContext);
      } else {
        contextParts.push(`**Aucun ticket similaire trouvé.** Vous pouvez créer un nouveau ticket si nécessaire.`);
      }
      break;
    }

    case 'change_status': {
      const tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      const statusWord = message.match(/\b(nouveau|ouvert|attente|résolu|resolu|fermé|ferme|new|open|pending|solved|closed)\b/i)?.[1];
      if (tid && statusWord) {
        // Vérifier l'accès au ticket
        if (user && (user.role === 'REQUESTER' || user.role === 'TECHNICIAN')) {
          const ticket = await prisma.ticket.findUnique({
            where: { id: parseInt(tid, 10) },
            select: { requesterId: true, assignedToId: true },
          });
          if (ticket) {
            const hasAccess = user.role === 'TECHNICIAN'
              ? (ticket.assignedToId === user.sub || ticket.requesterId === user.sub)
              : ticket.requesterId === user.sub;
            if (!hasAccess) {
              contextParts.push(`**Accès refusé :** Vous n'avez pas accès au ticket #${tid}.`);
              break;
            }
          }
        }
        const result = await changeTicketStatus(tid, statusWord);
        if (result.error) {
          contextParts.push(`**Erreur :** ${result.error}`);
        } else {
          action = { type: 'status_changed', ticketId: result.ticket.id };
          contextParts.push(`**Statut modifié :** Ticket #${result.ticket.id} passe de "${result.oldStatus}" à "${result.newStatus}".`);
        }
      } else {
        contextParts.push(`Pour changer le statut, donnez le numéro du ticket et le nouveau statut. Ex: "ferme le ticket #5" ou "passe le ticket 12 en résolu".`);
      }
      break;
    }

    case 'assign_ticket': {
      const tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      const person = params?.personName || message.match(/(?:à|a)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/)?.[1];
      if (tid && person) {
        // Vérifier l'accès au ticket
        if (user && (user.role === 'REQUESTER' || user.role === 'TECHNICIAN')) {
          const ticket = await prisma.ticket.findUnique({
            where: { id: parseInt(tid, 10) },
            select: { requesterId: true, assignedToId: true },
          });
          if (ticket) {
            const hasAccess = user.role === 'TECHNICIAN'
              ? (ticket.assignedToId === user.sub || ticket.requesterId === user.sub)
              : ticket.requesterId === user.sub;
            if (!hasAccess) {
              contextParts.push(`**Accès refusé :** Vous n'avez pas accès au ticket #${tid}.`);
              break;
            }
          }
        }
        const result = await assignTicket(tid, person);
        if (result.error) {
          contextParts.push(`**Erreur :** ${result.error}`);
        } else {
          action = { type: 'ticket_assigned', ticketId: result.ticket.id };
          contextParts.push(`**Ticket assigné :** Ticket #${result.ticket.id} assigné à **${result.assignedTo}**.`);
        }
      } else {
        contextParts.push(`Pour assigner un ticket, donnez le numéro et le nom du technicien. Ex: "assigne le ticket #5 à Jean".`);
      }
      break;
    }

    case 'search_inventory': {
      if (assets.length === 0) {
        contextParts.push(`**Aucun équipement trouvé** pour "${params?.keyword || message}". Essayez avec un autre terme.`);
      }
      break;
    }

    case 'search_users': {
      if (users.length === 0) {
        contextParts.push(`**Aucun utilisateur trouvé** pour "${params?.personName || message}". Essayez avec un autre terme.`);
      }
      break;
    }

    case 'search_locations': {
      if (locations.length === 0) {
        contextParts.push(`**Aucun lieu trouvé** pour "${params?.locationName || message}". Essayez avec un autre terme.`);
      }
      break;
    }

    case 'team_report': {
      if (!isStaff(user)) {
        contextParts.push(`**Accès refusé :** Le rapport par équipe n'est accessible qu'aux équipes support.`);
        break;
      }
      const teamDist = await analyticsTools.getTeamDistribution({ period: params?.period || '30d' });
      if (teamDist.teams.length > 0) {
        widget = {
          type: 'chart',
          chartType: 'bar',
          title: '📊 Répartition des tickets ouverts par équipe',
          data: teamDist.chartData,
          columns: ['name', 'Total', 'Urgents'],
          rankings: teamDist.teams.map((t, i) => ({
            rank: i + 1,
            locationName: t.teamName,
            totalTickets: t.total,
            urgentTickets: t.urgent,
          })),
        };

        let reportText = `**Répartition des tickets ouverts** (${teamDist.totalOpen} total, ${teamDist.unassignedCount} non assignés)\n\n`;
        for (const t of teamDist.teams) {
          reportText += `• **${t.teamName}** — ${t.total} tickets (${t.urgent} urgents)\n`;
          reportText += `  Nouveaux: ${t.byStatus.NEW} | Ouverts: ${t.byStatus.OPEN} | Attente: ${t.byStatus.PENDING}\n`;
        }
        contextParts.push(reportText);
      } else {
        contextParts.push(`**Aucun ticket ouvert** à ce jour.`);
      }
      break;
    }

    case 'create_ticket_for': {
      if (!isStaff(user)) {
        contextParts.push(`**Accès refusé :** Seuls les membres du support peuvent créer un ticket pour un autre utilisateur.`);
        break;
      }
      if (params?.title && params?.description && params?.forUser) {
        // Chercher l'utilisateur cible
        const targetUsers = await prisma.user.findMany({
          where: {
            OR: [
              { fullName: { contains: params.forUser, mode: 'insensitive' } },
              { email: { contains: params.forUser, mode: 'insensitive' } },
            ],
          },
          select: { id: true, fullName: true, role: true },
          take: 5,
        });
        if (targetUsers.length === 0) {
          contextParts.push(`**Utilisateur introuvable** pour "${params.forUser}". Vérifiez le nom.`);
        } else {
          const target = targetUsers[0];
          try {
            const ticket = await createTicketFromChat(params.title, params.description, params?.priorityHint, target.id);
            action = { type: 'ticket_created', ticketId: ticket.id };
            contextParts.push(`**Ticket créé pour ${target.fullName} :** #${ticket.id} — ${ticket.title}\nPriorité: ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\nDemandeur: ${target.fullName}\nLien: /tickets/${ticket.id}`);
          } catch (err) {
            contextParts.push(`Erreur lors de la création du ticket : ${err.message}`);
          }
        }
      } else {
        contextParts.push(`Pour créer un ticket pour un autre utilisateur, donnez : le nom de la personne, le titre et la description. Ex: "Crée un ticket pour Paul — Imprimante cassée — L'imprimante du 2ème étage ne fonctionne plus"`);
      }
      break;
    }

    case 'report': {
      if (!isStaff(user)) {
        contextParts.push(`**Accès refusé :** Le rapport des tickets n'est accessible qu'aux équipes support.`);
        break;
      }
      const report = await generateReport();
      contextParts.push(`**Rapport :**\n${report}`);
      break;
    }

    case 'create_ticket': {
      // TOUJOURS demander confirmation avant création
      const ticketTitle = params?.title || message.substring(0, 100);
      const ticketDesc = params?.description || message;
      const ticketPriority = params?.priorityHint || 'P3';

      // Vérifier les doublons
      const similar = await findSimilarTickets(ticketTitle, ticketDesc);

      let confirmMsg = `**Création de ticket**\n\n`;
      confirmMsg += `**Sujet :** ${ticketTitle}\n`;
      confirmMsg += `**Description :** ${ticketDesc.substring(0, 300)}${ticketDesc.length > 300 ? '...' : ''}\n`;
      confirmMsg += `**Priorité :** ${PRIORITY_LABEL[ticketPriority] || ticketPriority}\n`;
      confirmMsg += `**Source :** Chatbot\n\n`;

      if (similar.length > 0) {
        confirmMsg += `⚠️ **Attention, des tickets similaires existent déjà :**\n`;
        for (const t of similar.slice(0, 3)) {
          confirmMsg += `• **#${t.id}** ${t.title} — ${STATUS_LABEL[t.status] || t.status}\n`;
        }
        confirmMsg += `\n`;
      }

      confirmMsg += `**Voulez-vous que je crée ce ticket ?** Répondez "oui" pour confirmer.`;

      // Stocker les données en attente
      pendingTicket = { title: ticketTitle, description: ticketDesc, priority: ticketPriority };
      contextParts.push(confirmMsg);
      break;
    }

    case 'confirm_create_ticket': {
      // L'utilisateur confirme → créer le ticket avec les données en attente
      const dataToCreate = pendingTicketData || pendingTicket;
      if (dataToCreate) {
        try {
          const ticket = await createTicketFromChat(dataToCreate.title, dataToCreate.description, dataToCreate.priority, userId);
          action = { type: 'ticket_created', ticketId: ticket.id };
          contextParts.push(`✅ **Ticket créé avec succès :**\n\n**#${ticket.id}** — ${ticket.title}\n**Priorité :** ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\n**Source :** Chatbot\n\nLe ticket passe par le centre de validation avant d'être traité.`);
          pendingTicket = null;
        } catch (err) {
          contextParts.push(`Erreur lors de la création du ticket : ${err.message}`);
        }
      } else {
        contextParts.push(`Aucun ticket en attente de création. Décrivez d'abord votre problème.`);
      }
      break;
    }

    case 'escalate': {
      try {
        const ticket = await escalateToTechnician(message, userId);
        action = { type: 'escalation', ticketId: ticket.id };
        contextParts.push(`**Escalade effectuée :** Un ticket P2 (#${ticket.id}) a été créé et les techniciens ont été notifiés en temps réel.`);
      } catch (err) {
        contextParts.push(`Erreur lors de l'escalade : ${err.message}`);
      }
      break;
    }

    case 'help': {
      contextParts.push(`**Fonctionnalités disponibles :**\n
• **Réunion hebdomadaire** : "Répartition par équipe", "Bilan des tickets ouverts par équipe"
• **Recherche de tickets** : "Quels sont les tickets VPN ?", "Tickets imprimantes"
• **Statistiques** : "Quel magasin a le plus de problèmes ?", "Stats du magasin Asten"
• **Performance technicien** : "Perf de Jean", "Stats de Paul"
• **Signaler un problème** : "Je veux signaler un problème"
• **Créer pour un autre** : "Crée un ticket pour Paul — Imprimante cassée — Description..."
• **Résumé de ticket** : "Résume-moi le ticket #123"
• **Vérifier statut** : "Quel est le statut du ticket #123"
• **Changer statut** : "Ferme le ticket #5", "Passe le ticket 12 en résolu"
• **Assigner un ticket** : "Assigne le ticket #5 à Jean"
• **Rechercher un équipement** : "Où est l'imprimante HP ?", "Cherche le PC X1"
• **Rechercher un utilisateur** : "Qui est Jean ?", "Email de Paul"
• **Rechercher un lieu** : "Où se trouve le magasin Asten ?"
• **Doublons** : "Y a-t-il déjà un ticket pour ça ?"
• **Escalade** : "Parler à un technicien"
• **Base de connaissances** : Pose une question sur une procédure IT`);
      break;
    }
  }

  // Messages pour l'IA
  const aiMessages = [];
  const recentHistory = conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    if (!msg || !msg.content || typeof msg.content !== 'string') continue;
    if (msg.content.includes('Désolé, je rencontre un problème technique') || msg.content.includes('Tous les providers IA ont échoué')) continue;
    aiMessages.push({ role: msg.role, content: msg.content });
  }

  const systemContext = contextParts.length > 0 ? `\n\n${contextParts.join('\n\n')}` : '';
  aiMessages.push({ role: 'user', content: `${message}${systemContext}` });

  let reply;
  try {
    reply = await callAI(aiMessages);
  } catch (err) {
    console.error('[chatbot] Échec de la génération de réponse IA:', err.message);
    reply = "Désolé, je rencontre une difficulté temporaire d'accès aux services IA. Veuillez réentreprendre votre demande dans quelques instants.";
  }

  return {
    reply,
    intent,
    action,
    widget,
    sources: knowledgeChunks.map((c) => ({ title: c.title, id: c.documentId })),
    pendingTicketData: pendingTicket || null,
  };
}

module.exports = { handleMessage };
