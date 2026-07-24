const prisma = require('../prismaClient');
const { getActiveProvider, callProvider } = require('./mailAnalyzer');
const { emitTicketCreated } = require('../utils/socket');

const SYSTEM_PROMPT = `Tu es l'assistant IA intelligent du helpdesk IT de Prosuma (IA Hub). Tu réponds en français, de manière claire, concise, précise et professionnelle.

Tu peux répondre aux questions sur :
1. Les TICKETS du système ERP (/tickets) : recherche par sujet, numéro, statut (Nouveau, Ouvert, En attente, Résolu, Fermé), catégorie, priorités, demandeur, technicien ou lieu.
2. Les procédures et informations de la Base de Connaissances IT.
3. La création de nouveaux tickets d'incident ou de demande.
4. L'état détaillé d'un ticket par son numéro (ex: #123).
5. L'escalade immédiate d'un incident vers un technicien (création automatique de ticket P2).
6. La génération d'un rapport ou d'une synthèse des tickets ouverts.

RÈGLES IMPORTANTES :
- Quand des tickets pertinents de la base de données sont fournis dans le contexte, utilise-les pour répondre précisément à la question de l'utilisateur avec leur numéro #ID, leur statut et leurs détails.
- Si tu trouves une solution dans la base de connaissances, cite la source.
- Pour créer un ticket, demande la confirmation de l'utilisateur avec le titre et le problème.
- Réponds toujours avec un format Markdown soigné (listes à puces, gras, italique).`;

const INTENT_PROMPT = `Tu es un classificateur d'intentions. Analyse le message utilisateur et réponds UNIQUEMENT avec un JSON valide (pas de texte avant ou après).

Intents possibles :
- "general" : question générale, salutation, conversation
- "search_tickets" : l'utilisateur pose une question sur les tickets existants (ex: "quelles sont les pannes vpn", "tickets imprimantes", "tickets de Paul")
- "create_ticket" : l'utilisateur veut créer/ouvrir un ticket, signale un problème
- "check_ticket" : l'utilisateur veut connaître le statut d'un ticket spécifique
- "report" : l'utilisateur veut un rapport/statistique des tickets
- "escalate" : l'utilisateur veut parler à un humain/technicien
- "help" : l'utilisateur demande de l'aide sur les fonctionnalités

Réponds avec :
{"intent": "nom_intent", "params": {}}

Si l'utilisateur mentionne un numéro de ticket (#123 ou "ticket 123"), ajoute "params": {"ticketId": 123}.
Si l'utilisateur veut créer un ticket et mentionne déjà un titre ou un problème, ajoute "params": {"title": "...", "description": "..."}.
Si l'utilisateur mentionne une priorité (urgent, critique, important, etc.), ajoute "params": {"priorityHint": "P1|P2|P3|P4"}.`;

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

async function searchTickets(query, limit = 5) {
  if (!query || !query.trim()) return [];
  const clean = query.trim();
  const lower = clean.toLowerCase();

  const idMatch = clean.match(/#?(\d+)/);
  const statusMatch = lower.match(/\b(nouveau|ouvert|attente|résolu|resolu|fermé|ferme)\b/);
  const priorityMatch = lower.match(/\b(p1|p2|p3|p4|critique|haute|moyenne|basse)\b/);

  const STATUS_MAP = {
    nouveau: 'NEW',
    ouvert: 'OPEN',
    attente: 'PENDING',
    résolu: 'SOLVED',
    resolu: 'SOLVED',
    fermé: 'CLOSED',
    ferme: 'CLOSED',
  };

  const PRIORITY_MAP = {
    p1: 'P1',
    critique: 'P1',
    p2: 'P2',
    haute: 'P2',
    p3: 'P3',
    moyenne: 'P3',
    p4: 'P4',
    basse: 'P4',
  };

  try {
    const where = {};

    if (statusMatch) {
      where.status = STATUS_MAP[statusMatch[1]];
    }
    if (priorityMatch) {
      where.priority = PRIORITY_MAP[priorityMatch[1]];
    }

    const words = clean.split(/\s+/).filter(
      (w) =>
        w.length > 2 &&
        ![
          'les', 'des', 'que', 'sur', 'pour', 'avec', 'par', 'dans', 'un', 'une', 'qui', 'est',
          'ticket', 'tickets', 'montre', 'cherche', 'donne', 'combien', 'quels', 'quelle', 'quelles',
          'est-ce', 'base', 'propos', 'avez-vous', 'avez', 'nous', 'vous'
        ].includes(w.toLowerCase())
    );

    if (words.length > 0) {
      where.OR = words.flatMap((w) => [
        { title: { contains: w, mode: 'insensitive' } },
        { content: { contains: w, mode: 'insensitive' } },
        { category: { contains: w, mode: 'insensitive' } },
        { glpiLocationName: { contains: w, mode: 'insensitive' } },
      ]);
    }

    if (idMatch) {
      const numId = parseInt(idMatch[1], 10);
      if (!where.OR) where.OR = [];
      where.OR.push({ id: numId }, { glpiTicketId: numId });
    }

    let tickets = await prisma.ticket.findMany({
      where,
      take: limit,
      include: {
        requester: { select: { fullName: true, email: true } },
        assignedTo: { select: { fullName: true } },
        team: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (tickets.length === 0 && (lower.includes('ticket') || lower.includes('récent') || lower.includes('problème') || lower.includes('incident'))) {
      tickets = await prisma.ticket.findMany({
        take: limit,
        include: {
          requester: { select: { fullName: true, email: true } },
          assignedTo: { select: { fullName: true } },
          team: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return tickets;
  } catch (err) {
    console.error('[chatbot] Erreur recherche tickets:', err.message);
    return [];
  }
}

// ── Appel IA ───────────────────────────────────────────────────────────

async function callAI(messages) {
  const provider = await getActiveProvider();
  if (!provider) throw new Error('Aucun fournisseur IA configuré.');

  const formattedMessages = messages.map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.content}`).join('\n\n');
  const prompt = `${SYSTEM_PROMPT}\n\n---\n\n${formattedMessages}`;
  return callProvider(provider, prompt);
}

async function callIntentAI(message) {
  const provider = await getActiveProvider();
  if (!provider) return null;

  try {
    const formatted = `${INTENT_PROMPT}\n\nUser: "${message}"\nJSON:`;
    const raw = await callProvider(provider, formatted);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return null;
}

// ── Intent detection (IA + regex fallback) ─────────────────────────────

function detectIntentRegex(message) {
  const lower = message.toLowerCase();
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident)\b/)) return 'create_ticket';
  if (lower.match(/\b(statut|état|avancement|suiv[ie]|ticket\s*#?\s*\d+|#\d+|num[ée]ro)\b/)) return 'check_ticket';
  if (lower.match(/\b(rapport|synth[èe]se|r[ée]sum[ée]|statistiques?|stats?|combien|nombre|total)\b/)) return 'report';
  if (lower.match(/\b(escalade|technicien|humain|agent|support|parler|[aà] quelqu'un|transfer)\b/)) return 'escalate';
  if (lower.match(/\b(aide|commandes?|fonctionnalit[ée]s?|que sais|que peux|help|menu)\b/)) return 'help';
  return 'general';
}

async function detectIntent(message) {
  const aiResult = await callIntentAI(message);
  if (aiResult?.intent) return aiResult;
  return { intent: detectIntentRegex(message), params: {} };
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
  return ticket;
}

// ── Message handler ────────────────────────────────────────────────────

async function handleMessage(message, conversationHistory = [], userId = null) {
  const { intent, params } = await detectIntent(message);

  // Recherche simultanée : RAG (Base de connaissances) + Tickets ERP
  const [knowledgeChunks, matchingTickets] = await Promise.all([
    searchKnowledge(message, 3),
    searchTickets(message, 5),
  ]);

  const knowledgeContext = knowledgeChunks.length > 0
    ? knowledgeChunks.map((c) => `[${c.title}] : ${c.content.substring(0, 500)}`).join('\n\n')
    : '';

  const contextParts = [];

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
      if (t.glpiLocationName) ticketContext += ` | Lieu : ${t.glpiLocationName}`;
      if (t.glpiTicketId) ticketContext += ` | GLPI #${t.glpiTicketId}`;
      ticketContext += `\n  - *Description :* ${(t.content || '').substring(0, 200)}...\n\n`;
    }
    contextParts.push(ticketContext);
  }

  let action = null;

  switch (intent) {
    case 'check_ticket': {
      const tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      if (tid) {
        const info = await checkTicketStatus(tid);
        contextParts.push(`**Résultat de la consultation :**\n${info}`);
      } else {
        contextParts.push(`L'utilisateur veut consulter un ticket mais n'a pas donné de numéro. Demandez-le.`);
      }
      break;
    }
    case 'report': {
      const report = await generateReport();
      contextParts.push(`**Rapport :**\n${report}`);
      break;
    }
    case 'create_ticket': {
      if (params?.title && params?.description) {
        try {
          const ticket = await createTicketFromChat(params.title, params.description, params?.priorityHint, userId);
          action = { type: 'ticket_created', ticketId: ticket.id };
          contextParts.push(`**Ticket créé avec succès :** #${ticket.id} — ${ticket.title}\nPriorité: ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\nLien: /tickets/${ticket.id}`);
        } catch (err) {
          contextParts.push(`Erreur lors de la création du ticket : ${err.message}`);
        }
      } else {
        contextParts.push(`L'utilisateur veut créer un ticket. Si les infos sont incomplètes, demande le titre et la description. Si tout est là, crée-le.`);
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
      contextParts.push(`**Fonctionnalités disponibles :**\n• **Recherche de tickets** : "Pose des questions sur les pannes, les catégories, les demandeurs..."\n• **Créer un ticket** : "Je veux signaler un problème"\n• **Consulter un ticket** : "Quel est le statut du ticket #123"\n• **Rapport** : "Donne-moi un rapport des tickets ouverts"\n• **Escalade** : "Je veux parler à un technicien"\n• **Base de connaissances** : pose une question sur l'IT`);
      break;
    }
  }

  // Messages pour l'IA
  const aiMessages = [];
  const recentHistory = conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    aiMessages.push({ role: msg.role, content: msg.content });
  }

  const systemContext = contextParts.length > 0 ? `\n\n${contextParts.join('\n\n')}` : '';
  aiMessages.push({ role: 'user', content: `${message}${systemContext}` });

  let reply;
  try {
    reply = await callAI(aiMessages);
  } catch (err) {
    reply = `Désolé, je rencontre un problème technique. Réessayez plus tard.\n\n*${err.message}*`;
  }

  return {
    reply,
    intent,
    action,
    sources: knowledgeChunks.map((c) => ({ title: c.title, id: c.documentId })),
  };
}

module.exports = { handleMessage };
