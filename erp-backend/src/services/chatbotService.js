const prisma = require('../prismaClient');
const { getActiveProvider, callProvider } = require('./mailAnalyzer');

const SYSTEM_PROMPT = `Tu es l'assistant IA du helpdesk IT de Prosuma. Tu réponds en français, de manière concise et professionnelle.

Tu peux aider les utilisateurs à :
1. **Trouver des informations** dans la base de connaissances IT
2. **Créer des tickets** d'incident ou de demande
3. **Consulter l'état de leurs tickets** (par numéro)
4. **Escalader vers un technicien** si tu ne peux pas résoudre
5. **Générer un rapport** des tickets ouverts

## Règles IMPORTANTES :
- Si tu trouves une réponse dans la base de connaissances, cite-la et indique la source (titre du document).
- Pour créer un ticket, demande les informations manquantes (titre, description du problème).
- Pour consulter un ticket, demande le numéro.
- Si tu ne peux PAS résoudre le problème, propose d'escalader vers un technicien.
- Pour un rapport, résume les tickets ouverts par statut/priorité.
- Sois toujours poli et utile. Si tu ne sais pas, dis-le franchement.

## Format de réponse :
Réponds toujours en texte brut, sans markdown brut excessif. Tu peux utiliser des listes à puces et du gras.`;

// Recherche dans la base de connaissances (RAG)
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

// Appel IA avec le system prompt + contexte RAG + historique
async function callAI(messages) {
  const provider = await getActiveProvider();
  if (!provider) throw new Error('Aucun fournisseur IA configuré. Ajoutez une clé API dans Paramètres > Fournisseurs IA.');

  const formattedMessages = messages.map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.content}`).join('\n\n');
  const prompt = `${SYSTEM_PROMPT}\n\n---\n\n${formattedMessages}`;

  return callProvider(provider, prompt);
}

// Détecte l'intention de l'utilisateur
function detectIntent(message) {
  const lower = message.toLowerCase();

  // Créer un ticket
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident)\b/)) {
    return 'create_ticket';
  }
  // Consulter un ticket
  if (lower.match(/\b(statut|état|avancement|suiv[ie]|ticket\s*#?\s*\d+|#\d+|num[ée]ro)\b/)) {
    return 'check_ticket';
  }
  // Rapport
  if (lower.match(/\b(rapport|synth[èe]se|r[ée]sum[ée]|statistiques?|stats?|combien|nombre|total)\b/)) {
    return 'report';
  }
  // Escalade
  if (lower.match(/\b(escalade|technicien|humain|agent|support|parler|[aà] quelqu'un|transfer)\b/)) {
    return 'escalate';
  }
  // Aide / commandes
  if (lower.match(/\b(aide|commandes?|fonctionnalit[ée]s?|que sais|que peux|help|menu)\b/)) {
    return 'help';
  }
  return 'general';
}

// Génère un rapport des tickets ouverts
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

  const STATUS_LABEL = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé' };
  const PRIORITY_LABEL = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

  let report = `**Rapport des tickets ouverts** (${tickets.length} total)\n\n`;
  report += `**Par statut :**\n`;
  for (const [status, count] of Object.entries(byStatus)) {
    report += `• ${STATUS_LABEL[status] || status} : ${count}\n`;
  }
  report += `\n**Par priorité :**\n`;
  for (const [priority, count] of Object.entries(byPriority)) {
    report += `• ${PRIORITY_LABEL[priority] || priority} : ${count}\n`;
  }

  report += `\n**5 tickets les plus récents :**\n`;
  for (const t of tickets.slice(0, 5)) {
    const assignee = t.assignedTo?.fullName || 'Non assigné';
    report += `• **#${t.id}** ${t.title} — ${PRIORITY_LABEL[t.priority] || t.priority} — ${assignee}\n`;
  }

  return report;
}

// Consulte le statut d'un ticket
async function checkTicketStatus(ticketId) {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) return 'Numéro de ticket invalide.';

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { assignedTo: { select: { fullName: true } }, team: { select: { name: true } } },
  });

  if (!ticket) return `Ticket #${id} introuvable.`;

  const STATUS_LABEL = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé' };
  const PRIORITY_LABEL = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

  let response = `**Ticket #${ticket.id}**\n`;
  response += `• **Titre :** ${ticket.title}\n`;
  response += `• **Statut :** ${STATUS_LABEL[ticket.status] || ticket.status}\n`;
  response += `• **Priorité :** ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\n`;
  response += `• **Assigné à :** ${ticket.assignedTo?.fullName || 'Non assigné'}\n`;
  if (ticket.team) response += `• **Équipe :** ${ticket.team.name}\n`;
  response += `• **Créé le :** ${new Date(ticket.createdAt).toLocaleDateString('fr-FR')}\n`;

  return response;
}

// Traite un message du chatbot
async function handleMessage(message, conversationHistory = [], userId = null) {
  const intent = detectIntent(message);

  // Recherche RAG dans la base de connaissances
  const knowledgeChunks = await searchKnowledge(message, 3);
  const knowledgeContext = knowledgeChunks.length > 0
    ? knowledgeChunks.map((c) => `[${c.title}] : ${c.content.substring(0, 500)}`).join('\n\n')
    : '';

  // Construit le contexte pour l'IA
  const contextParts = [];
  if (knowledgeContext) {
    contextParts.push(`**Informations de la base de connaissances :**\n${knowledgeContext}`);
  }

  // Ajoute les informations spécifiques à l'intention
  switch (intent) {
    case 'check_ticket': {
      const ticketMatch = message.match(/#?(\d+)/);
      if (ticketMatch) {
        const ticketInfo = await checkTicketStatus(ticketMatch[1]);
        contextParts.push(`**Résultat de la consultation :**\n${ticketInfo}`);
      }
      break;
    }
    case 'report': {
      const report = await generateReport();
      contextParts.push(`**Rapport :**\n${report}`);
      break;
    }
    case 'help': {
      contextParts.push(`**Fonctionnalités disponibles :**\n• Créer un ticket : "Je veux signaler un problème"\n• Consulter un ticket : "Quel est le statut du ticket #123"\n• Rapport : "Donne-moi un rapport des tickets ouverts"\n• Escalade : "Je veux parler à un technicien"\n• Base de connaissances : pose une question sur l'IT`);
      break;
    }
  }

  // Construit les messages pour l'IA
  const aiMessages = [];

  // System context
  const systemContext = contextParts.length > 0
    ? `\n\n${contextParts.join('\n\n')}`
    : '';

  // Historique de conversation (les 10 derniers messages max)
  const recentHistory = conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    aiMessages.push({ role: msg.role, content: msg.content });
  }

  // Message courant enrichi
  aiMessages.push({
    role: 'user',
    content: `${message}${systemContext}`,
  });

  // Appel IA
  let reply;
  try {
    reply = await callAI(aiMessages);
  } catch (err) {
    reply = `Désolé, je rencontre un problème technique. Réessayez plus tard.\n\n*${err.message}*`;
  }

  return {
    reply,
    intent,
    sources: knowledgeChunks.map((c) => ({ title: c.title, id: c.documentId })),
  };
}

module.exports = { handleMessage };
