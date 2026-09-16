const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { emitTicketCreated, emitTicketAssigned } = require('../utils/socket');
const { sendTicketCreationNotification, sendAssignmentNotificationEmail } = require('./emailSender');
const analyticsTools = require('./analyticsTools');

// ── Compteurs de vérification (monitoring) ─────────────────────────────
const factCheckCounters = {
  totalChecks: 0,
  corrections: 0,
  ghostTickets: 0,
  crossVerifyWarnings: 0,
  lastResetAt: Date.now(),
};

const SYSTEM_PROMPT = `Tu es l'Assistant IA Helpdesk IT de Prosuma.

RÈGLES STRICTES DE FORMATAGE :

1. Réponds uniquement en français.
2. Sois direct et concis (maximum 8-10 lignes sauf demande contraire).
3. N'utilise JAMAIS de formules creuses ("Bien sûr", "Voici les informations", "Avec plaisir", etc.).
4. N'utilise PAS d'emojis.
5. N'utilise PAS de titres Markdown (# ## ###).
6. N'utilise PAS de gras (**texte**) sauf pour les totaux importants.
7. Pour les données chiffrées :
   - Utilise UNIQUEMENT un tableau Markdown propre
   - Maximum 6 colonnes
   - Maximum 10 lignes de données
   - Une seule phrase courte après le tableau si nécessaire
8. Structure préférée pour les statistiques :
   - 1 phrase d'intro très courte (optionnelle)
   - Tableau Markdown
   - 1 phrase de conclusion maximum
9. Si tu génères un graphique (widget), dis juste une phrase courte. Le graphique s'affiche automatiquement.

RÈGLES ABSOLUES SUR LES DONNÉES :
10. N'invente JAMAIS de tickets, numéros, statuts ou données. Utilise UNIQUEMENT les informations présentes dans le contexte fourni.
11. Si aucun ticket n'est trouvé dans le contexte, indique clairement "Aucun ticket trouvé" ou "Aucun ticket ne correspond à votre recherche". Ne crée pas de numéros de ticket ni de détails inventés.
12. Si le contexte dit "Aucun ticket ouvert", c'est la réalité. Ne contredis jamais ces données.
13. Quand on te demande une liste de tickets, vérifie que chaque ticket mentionné existe bien dans les résultats de recherche fournis. Si la liste est vide, dis-le explicitement.

RÈGLES DE CITATION :
14. Tu dois renvoyer citedTicketIds avec UNIQUEMENT les IDs de tickets qui apparaissent dans le contexte "Tickets pertinents trouvés".
15. Tu dois renvoyer citedKnowledgeIds avec UNIQUEMENT les documentId qui apparaissent dans le contexte "Base de connaissances".
16. Si tu ne cites aucun ticket, renvoie citedTicketIds: [].
17. Si tu ne cites aucun document KB, renvoie citedKnowledgeIds: [].

18. Capacités :
   - Informations TICKETS (statut, priorité, détails)
   - STATISTIQUES & ANALYSES (top magasins, répartitions, causes racines)
   - Base de Connaissances IT
   - Création/escalade de tickets
   - Recherche inventaire, utilisateurs, lieux
   - Changement statut/assignation (si autorisé)
   - Résumés et détection de doublons`;

// ── Nettoyage des réponses IA ──────────────────────────────────────────

function cleanAiReply(text) {
  if (!text) return '';
  return text
    // Supprime les formules creuses en début de réponse
    .replace(/^(Bien sûr|Avec plaisir|Voici|Absolument|Certainement|Ok|D'accord|Je vais|Je peux)[ !,. :]*/i, '')
    // Supprime les titres markdown
    .replace(/^#{1,6}\s+/gm, '')
    // Supprime le gras excessif
    .replace(/\*\*(.*?)\*\*/g, '$1')
    // Supprime les emojis en début de ligne ou isolés
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // Limite les sauts de ligne
    .replace(/\n{3,}/g, '\n\n')
    // Nettoie les espaces en trop
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n+$/, '')
    .trim();
}

const INTENT_PROMPT = `Tu es un classificateur d'intentions. Analyse le message utilisateur et réponds UNIQUEMENT avec un JSON valide (pas de texte avant ou après).

Intents possibles :
- "analytics" : statistiques, comparaisons, classements, causes racines ("quel magasin a le plus de tickets", "pourquoi ce magasin a des pannes", "perf de Jean")
- "team_report" : répartition des tickets par équipe, reunion hebdomadaire, presenting ("répartition par équipe", "tickets par technicien", "bilan équipe", "réunion hebdo", "ouverts par équipe")
- "general" : question générale, salutation, conversation
- "search_tickets" : RECHERCHE ou LISTE de tickets existants. Toute demande qui commence par "liste", "quels", "montre", "tous les", "donne-moi les tickets" → search_tickets. Exemples : "pannes vpn", "tickets imprimantes", "liste tous les tickets ouverts", "quels sont les tickets VPN", "montre les tickets en attente", "tous les tickets Critique", "je veux la liste de tous les tickets", "donne-moi les tickets P1"
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
- "report" : rapport STATISTIQUE global — PAS une liste de tickets. "combien de tickets", "nombre total", "synthèse", "bilan chiffré". NE PAS utiliser pour "liste les tickets", "quels tickets", "montre les tickets".
- "escalate" : parler à un technicien/humain, escalade
- "help" : demande d'aide sur les fonctionnalités

RÈGLE IMPORTANTE : "liste les tickets", "quels tickets", "tous les tickets", "montre les tickets" → search_tickets (PAS report). Report = compter/résumer, search_tickets = lister/détail.

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

async function searchTickets(query, limit = 20, user = null, period = null) {
  if (!query || !query.trim()) return [];
  const clean = query.trim();
  const lower = clean.toLowerCase();

  const idMatch = clean.match(/#?(\d+)/);
  const statusMatch = lower.match(/\b(nouveaux?|ouverts?|attente|résolus?|resolu[s]?|fermés?|ferme[s]?)\b/);
  const priorityMatch = lower.match(/\b(p1|p2|p3|p4|critique|haute|moyenne|basse)\b/);

  // Détecter si l'utilisateur veut une liste complète ("liste tous", "montre tous", etc.)
  const wantsFullList = /\b(tous?|toute?|liste|liste[s]?|montre|affiche|donne-moi)\b/i.test(lower);

  const STATUS_MAP = {
    nouveau: 'NEW', nouveaux: 'NEW',
    ouvert: 'OPEN', ouverts: 'OPEN',
    attente: 'PENDING',
    résolu: 'SOLVED', résolus: 'SOLVED', resolu: 'SOLVED', resolus: 'SOLVED',
    fermé: 'CLOSED', fermés: 'CLOSED', ferme: 'CLOSED', fermes: 'CLOSED',
  };

  const PRIORITY_MAP = {
    p1: 'P1', critique: 'P1', p2: 'P2', haute: 'P2',
    p3: 'P3', moyenne: 'P3', p4: 'P4', basse: 'P4',
  };

  try {
    const where = { deletedAt: null };

    // ── Filtrage temporel ──────────────────────────────────────────────
    if (period) {
      const { start, end } = resolvePeriodDates(period);
      if (start) where.createdAt = { gte: start };
      if (end) where.createdAt = { ...where.createdAt, lt: end };
    }

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
      'bonjour', 'bonsoir', 'salut', 'hello', 'coucou', 'hey', 'hi', 'merci', 'svp', 'stp', 're', 'salutations',
      'tous', 'toute', 'tout', 'liste', 'listes', 'affiche', 'donne-moi',
    ]);

    const STATUS_WORDS = new Set([
      'nouveau', 'nouveaux', 'ouvert', 'ouverts', 'attente',
      'résolu', 'résolus', 'resolu', 'resolus', 'fermé', 'fermés', 'ferme', 'fermes',
    ]);
    const PRIORITY_WORDS = new Set([
      'p1', 'p2', 'p3', 'p4', 'critique', 'haute', 'moyenne', 'basse',
    ]);

    const words = clean.split(/\s+/).filter(
      (w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()) && !STATUS_WORDS.has(w.toLowerCase()) && !PRIORITY_WORDS.has(w.toLowerCase())
    );

    // Si pas de mots-clés mais filtre status/priority/id → rechercher par filtre uniquement
    if (words.length === 0 && !idMatch && !statusMatch && !priorityMatch) return [];

    if (words.length > 0) {
      const keywordFilter = words.flatMap((w) => [
        { title: { contains: w, mode: 'insensitive' } },
        { content: { contains: w, mode: 'insensitive' } },
        { category: { contains: w, mode: 'insensitive' } },
        { locationName: { contains: w, mode: 'insensitive' } },
        { requester: { fullName: { contains: w, mode: 'insensitive' } } },
        { assignedTo: { fullName: { contains: w, mode: 'insensitive' } } },
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

    // Si "liste tous" → pas de limit (max 100 pour sécurité)
    const effectiveLimit = wantsFullList ? 100 : limit;

    return await prisma.ticket.findMany({
      where,
      take: effectiveLimit,
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

// Estimation rapide du nombre de tokens (~4 caractères par token, rule of thumb)
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

async function callAI(messages, options = {}) {
  const providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun fournisseur IA configuré.');

  // ── Multi-turn : séparer system / user / assistant ──
  const intentHint = options.intentHint || '';
  const systemContent = options.forcedSystem || (SYSTEM_PROMPT + intentHint);

  // Construire l'historique en messages API (user/assistant alternés)
  const apiMessages = [];
  const recentHistory = (options.conversationHistory || []).slice(-10);
  for (const msg of recentHistory) {
    if (!msg || !msg.content || typeof msg.content !== 'string') continue;
    // Filtrer les messages d'erreur
    if (msg.content.includes('Désolé, je rencontre un problème technique') || msg.content.includes('Tous les providers IA ont échoué')) continue;
    apiMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    });
  }

  // Ajouter le message actuel avec le contexte
  const lastMsg = messages[messages.length - 1];
  apiMessages.push({ role: 'user', content: lastMsg.content });

  // Budget token dynamique : garder l'historique dans ~1500 tokens
  const MAX_HISTORY_TOKENS = 1500;
  let trimmedMessages = [...apiMessages];

  // Calculer le total des tokens de l'historique (sans le message actuel)
  let totalHistoryTokens = 0;
  for (let i = 0; i < trimmedMessages.length - 1; i++) {
    totalHistoryTokens += estimateTokens(trimmedMessages[i].content);
  }

  // Tronquer depuis les messages les plus anciens tant qu'on dépasse le budget
  while (trimmedMessages.length > 1 && totalHistoryTokens > MAX_HISTORY_TOKENS) {
    const removed = trimmedMessages.shift();
    totalHistoryTokens -= estimateTokens(removed.content);
  }

  // Valider l'alternance user/assistant (Anthropic l'exige strictement)
  // Le premier message doit être 'user', et pas deux user/assistant consécutifs
  if (trimmedMessages.length > 1) {
    const cleaned = [trimmedMessages[0]];
    for (let i = 1; i < trimmedMessages.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      const curr = trimmedMessages[i];
      if (curr.role === prev.role) {
        // Fusionner les messages consécutifs du même rôle
        prev.content = `${prev.content}\n\n${curr.content}`;
      } else {
        cleaned.push(curr);
      }
    }
    trimmedMessages = cleaned;
  }

  // S'assurer que le premier message est 'user' (Anthropic requirement)
  if (trimmedMessages.length > 0 && trimmedMessages[0].role !== 'user') {
    trimmedMessages.unshift({ role: 'user', content: '(Contexte de conversation précédente)' });
  }

  // Logging du prompt complet
  const promptSize = estimateTokens(systemContent) + trimmedMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  console.log(`[chatbot] callAI — ${trimmedMessages.length} messages, ~${promptSize} tokens estimés, intent: ${options.intentHint ? 'include' : 'none'}`);

  // Structured output si demandé
  const providerOptions = {
    messages: trimmedMessages,
    system: systemContent,
  };
  if (options.responseFormat) {
    providerOptions.responseFormat = options.responseFormat;
  }

  return callAiWithRetry(() => callProviderWithFallback(providers, null, 'chatbot', {
    ...providerOptions,
    forcedModelId: options.forcedModelId,
  }), {
    maxRetries: 2,
    baseDelay: 1500,
  });
}

// ── Appel Intent AI (structured output) ─────────────────────────────────

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      description: "Nom de l'intent détecté",
      enum: [
        'analytics', 'team_report', 'general', 'search_tickets', 'create_ticket',
        'create_ticket_for', 'confirm_create_ticket', 'check_ticket', 'summary',
        'similar_tickets', 'change_status', 'assign_ticket', 'search_inventory',
        'search_users', 'search_locations', 'report', 'escalate', 'help',
      ],
    },
    params: {
      type: 'object',
      description: 'Paramètres extraits du message',
      properties: {
        keyword: { type: 'string' },
        ticketId: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        personName: { type: 'string' },
        locationName: { type: 'string' },
        teamName: { type: 'string' },
        forUser: { type: 'string' },
        period: { type: 'string' },
        isWhy: { type: 'boolean' },
      },
    },
  },
  required: ['intent'],
};

async function callIntentAI(message) {
  const providers = await getActiveProviders();
  if (providers.length === 0) return null;

  try {
    const raw = await callAI(
      [{ role: 'user', content: `${INTENT_PROMPT}\n\nUser: "${message}"` }],
      { responseFormat: { type: 'json_schema', schema: INTENT_SCHEMA } }
    );
    const parsed = parseStructuredResponse(raw);
    if (parsed?.intent) return parsed;
    console.warn('[chatbot] callIntentAI: structured output invalide, fallback regex');
  } catch (err) {
    console.warn('[chatbot] callIntentAI échoué, fallback regex:', err.message);
  }
  return null;
}

// ── Extraction de période depuis le message utilisateur ────────────────

function parsePeriodFromText(text) {
  const lower = text.toLowerCase();

  // Jour
  if (/\b(aujourd.?hui|ce jour|ce matin|cette nuit)\b/.test(lower)) return '1d';
  if (/\b(hier|la veille)\b/.test(lower)) return 'yesterday';

  // Semaine
  if (/\b(cette semaine|depuis lundi|depuis le lundi)\b/.test(lower)) return 'this_week';
  if (/\b(semaine derni[èe]re|la semaine pass[ée]e)\b/.test(lower)) return 'last_week';
  if (/\b(\d+)\s*semaines?\b/.test(lower)) {
    const days = parseInt(lower.match(/(\d+)\s*semaines?/)[1]) * 7;
    return `${days}d`;
  }

  // Mois
  if (/\b(ce mois|le mois en cours|depuis le 1er)\b/.test(lower)) return 'this_month';
  if (/\b(mois dernier|le mois pass[ée]e?|mois pr[ée]c[ée]dent)\b/.test(lower)) return 'last_month';
  if (/\b(\d+)\s*mois\b/.test(lower)) {
    const months = parseInt(lower.match(/(\d+)\s*mois/)[1]);
    return `${months * 30}d`;
  }

  // Année
  if (/\b(cette ann[ée]e|en \d{4})\b/.test(lower)) {
    const yearMatch = lower.match(/en (\d{4})/);
    return yearMatch ? `year_${yearMatch[1]}` : 'year';
  }
  if (/\b(ann[ée]e derni[èe]re|l'ann[ée]e pass[ée]e)\b/.test(lower)) return 'last_year';

  // Périodes explicitement nommées
  if (/\b(7j|7 jours?|une semaine)\b/.test(lower)) return '7d';
  if (/\b(30j|30 jours?|un mois)\b/.test(lower)) return '30d';
  if (/\b(90j|90 jours?|3 mois)\b/.test(lower)) return '90d';

  return null; // pas de période détectée
}

/**
 * Convertit une clé période en objets Date { start, end }
 */
function resolvePeriodDates(periodKey) {
  const now = new Date();
  let start = null;
  let end = null;

  switch (periodKey) {
    case '1d': {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      break;
    }
    case 'yesterday': {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    }
    case 'this_week': {
      const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // lundi = 0
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      break;
    }
    case 'last_week': {
      const dayOfWeek2 = now.getDay() === 0 ? 6 : now.getDay() - 1;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek2 - 7);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek2);
      break;
    }
    case 'this_month': {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    }
    case 'last_month': {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case 'year': {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear() + 1, 0, 1);
      break;
    }
    case 'last_year': {
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear(), 0, 1);
      break;
    }
    default: {
      // "7d", "30d", "90d" etc.
      const dayMatch = periodKey.match(/^(\d+)d$/);
      if (dayMatch) {
        start = new Date(now.getTime() - parseInt(dayMatch[1]) * 86400000);
        end = now;
      }
      // "year_2025"
      const yearMatch = periodKey.match(/^year_(\d{4})$/);
      if (yearMatch) {
        start = new Date(parseInt(yearMatch[1]), 0, 1);
        end = new Date(parseInt(yearMatch[1]) + 1, 0, 1);
      }
    }
  }

  return { start, end };
}

// ── Intent detection (IA + regex fallback) ─────────────────────────────

function detectIntentRegex(message) {
  const lower = message.toLowerCase();
  const period = parsePeriodFromText(message);

  if (lower.match(/\b(r[ée]sume|r[ée]sum[ée])\b/)) return { intent: 'summary', params: { period } };
  if (lower.match(/\b(similaire|doublon|m[êe]me (probl[èe]me|incident|sujet)|y a-t-il|d[ée]j[à])\b/)) return { intent: 'similar_tickets', params: { period } };
  if (lower.match(/\b(ferme|clôtur|cloture|passe|r[ée]solu|resolu|change.*statut|met.*statut)\b/)) return { intent: 'change_status', params: { period } };
  if (lower.match(/\b(assigne|affecte|donne.*[àa]|attribue|passe.*[àa])\b/)) return { intent: 'assign_ticket', params: { period } };
  if (lower.match(/\b(inventaire|[ée]quipement|asset|pc portable|imprimante|mat[ée]riel)\b/)) return { intent: 'search_inventory', params: { period } };
  if (lower.match(/\b(utilisateur|user|qui est|email de|t[ée]l[ée]phone de|nom de)\b/)) return { intent: 'search_users', params: { period } };
  if (lower.match(/\b(lieu|site|o[uù] se trouve|adresse|localisation|magasin\s+(de\s+)?[a-z])\b/)) return { intent: 'search_locations', params: { period } };
  if (lower.match(/\b(r[ée]partition|par[ée]quipe|par[ée]quipe|bilan.*quipe|r[ée]union|hebdo|ouverts par|quipe)\b/)) return { intent: 'team_report', params: { period } };
  if (lower.match(/\b(magasin|lieu|top|comparer|plus de probl[èe]mes?|statistiques?|stats?|analyse|pourquoi|cause)\b/)) return { intent: 'analytics', params: { period } };
  if (lower.match(/^\s*(oui|yes|go|confirme|c'est bon|vas-y|ok|d'accord|je confirme|oui crée|oui vas)\b/i)) return { intent: 'confirm_create_ticket', params: { period } };
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident)\b/.test(lower) && /\b(pour|au nom de|pour le compte)\b/.test(lower))) return { intent: 'create_ticket_for', params: { period } };
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident|panne|souci|ne marche|fonctionne plus|erreur|assistance)\b/)) return { intent: 'create_ticket', params: { period } };
  if (lower.match(/\b(statut|état|avancement|suiv[ie]|ticket\s*#?\s*\d+|#\d+|num[ée]ro)\b/)) return { intent: 'check_ticket', params: { period } };
  if (lower.match(/\b(quels?|liste|listes|montre|affiche|donne[- ]?moi|cherche|recherche|tous?|toute?)\b.{0,20}\b tickets?\b/)) return { intent: 'search_tickets', params: { period } };
  if (lower.match(/\b(rapport|synth[èe]se|combien|nombre|total)\b/)) return { intent: 'report', params: { period } };
  if (lower.match(/\b(escalade|technicien|humain|agent|support|parler|[aà] quelqu'un|transfer)\b/)) return { intent: 'escalate', params: { period } };
  if (lower.match(/\b(aide|commandes?|fonctionnalit[ée]s?|que sais|que peux|help|menu)\b/)) return { intent: 'help', params: { period } };
  return { intent: 'general', params: { period } };
}

async function detectIntent(message) {
  const aiResult = await callIntentAI(message);
  if (aiResult?.intent) {
    // Enrichir avec la période extraite du texte (l'IA ne la détecte pas toujours)
    const textPeriod = parsePeriodFromText(message);
    if (textPeriod && !aiResult.params) aiResult.params = {};
    if (textPeriod && !aiResult.params.period) aiResult.params.period = textPeriod;
    return aiResult;
  }
  return detectIntentRegex(message);
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

async function generateReport(period = null, fullList = false) {
  const where = { status: { notIn: ['CLOSED', 'SOLVED'] } };

  // Filtrage temporel optionnel
  let dateFilter = {};
  if (period) {
    const { start, end } = resolvePeriodDates(period);
    if (start) dateFilter.gte = start;
    if (end) dateFilter.lt = end;
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
  }

  const [tickets, totalAll, resolvedCount] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        assignedTo: { select: { fullName: true } },
        team: { select: { name: true } },
        requester: { select: { fullName: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      ...(fullList ? {} : { take: 50 }),
    }),
    prisma.ticket.count({ where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {} }),
    prisma.ticket.count({
      where: {
        status: { in: ['SOLVED', 'CLOSED'] },
        ...(Object.keys(dateFilter).length > 0 ? { solvedAt: dateFilter } : {}),
      },
    }),
  ]);

  if (tickets.length === 0 && resolvedCount === 0) return 'Aucun ticket pour cette période.';

  const byStatus = {};
  const byPriority = {};
  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
  }

  const periodLabel = period ? ` (${period})` : '';
  let report = `**Rapport${periodLabel}**\n\n`;
  report += `• Total tickets : **${totalAll}**\n`;
  report += `• Ouverts : **${tickets.length}**\n`;
  report += `• Résolus/Fermés : **${resolvedCount}**\n\n`;

  if (tickets.length > 0) {
    report += `**Par statut (ouverts) :**\n`;
    for (const [s, c] of Object.entries(byStatus)) report += `• ${STATUS_LABEL[s] || s} : ${c}\n`;
    report += `\n**Par priorité (ouverts) :**\n`;
    for (const [p, c] of Object.entries(byPriority)) report += `• ${PRIORITY_LABEL[p] || p} : ${c}\n`;

    if (fullList) {
      report += `\n**Tous les tickets ouverts (${tickets.length}) :**\n`;
      report += `| # | Titre | Statut | Priorité | Assigné | Lieu |\n|---|-------|--------|----------|---------|------|\n`;
      for (const t of tickets) {
        report += `| ${t.id} | ${(t.title || '').substring(0, 50)} | ${STATUS_LABEL[t.status] || t.status} | ${PRIORITY_LABEL[t.priority] || t.priority} | ${t.assignedTo?.fullName || '-'} | ${t.locationName || '-'} |\n`;
      }
    } else {
      report += `\n**5 tickets les plus récents :**\n`;
      for (const t of tickets.slice(0, 5)) {
        report += `• **#${t.id}** ${t.title} — ${PRIORITY_LABEL[t.priority] || t.priority} — ${t.assignedTo?.fullName || 'Non assigné'}\n`;
      }
      if (tickets.length > 5) {
        report += `\n*...et ${tickets.length - 5} autres. Demandez "liste tous les tickets ouverts" pour voir la liste complète.*\n`;
      }
    }
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

  emitTicketAssigned(updated.id, updated.title, tech.id, 'manual');
  prisma.user.findUnique({ where: { id: tech.id }, select: { email: true, fullName: true } })
    .then((fullTech) => {
      if (fullTech?.email) {
        sendAssignmentNotificationEmail({
          ticketId: updated.id, ticketTitle: updated.title, priority: updated.priority,
          technicianEmail: fullTech.email, technicianName: fullTech.fullName, category: updated.category,
        }).catch(() => {});
      }
    }).catch(() => {});
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
      origin: 'CHATBOT',
      requesterId: userId,
      createdById: userId,
      type: 'INCIDENT',
      approvalStatus: 'PENDING',
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
      origin: 'CHATBOT',
      requesterId: userId,
      createdById: userId,
      type: 'INCIDENT',
      approvalStatus: 'PENDING',
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
    searchKnowledge(message, 8),
    searchTickets(message, 20, user, params?.period),
  ];

  if (intent === 'search_inventory') searches.push(searchAssets(params?.keyword || message, 5));
  else searches.push(Promise.resolve([]));

  if (intent === 'search_users' && isStaff(user)) searches.push(searchUsers(params?.personName || message, 5));
  else searches.push(Promise.resolve([]));

  if (intent === 'search_locations' && isStaff(user)) searches.push(searchLocations(params?.locationName || message, 10));
  else searches.push(Promise.resolve([]));

  const [knowledgeChunks, matchingTickets, assets, users, locations] = await Promise.all(searches);

  const knowledgeContext = knowledgeChunks.length > 0
    ? knowledgeChunks.map((c) => `[doc:${c.documentId} | ${c.title}] : ${c.content.substring(0, 500)}`).join('\n\n')
    : '';

  const contextParts = [];

  if (userContext) {
    contextParts.push(`**Profil de l'utilisateur :** ${userContext}`);
  }

  if (knowledgeContext) {
    contextParts.push(`**Informations de la base de connaissances :**\n${knowledgeContext}`);
  }

  if (matchingTickets.length > 0) {
    let ticketContext = `**Tickets pertinents trouvés (${matchingTickets.length}) :**\n`;
    // Format tableau compact pour beaucoup de résultats
    if (matchingTickets.length > 5) {
      ticketContext += `| # | Titre | Statut | Priorité | Demandeur | Lieu |\n|---|-------|--------|----------|-----------|------|\n`;
      for (const t of matchingTickets) {
        ticketContext += `| ${t.id} | ${(t.title || '').substring(0, 50)} | ${STATUS_LABEL[t.status] || t.status} | ${PRIORITY_LABEL[t.priority] || t.priority} | ${t.requester?.fullName || '-'} | ${t.locationName || '-'} |\n`;
      }
    } else {
      for (const t of matchingTickets) {
        ticketContext += `• **Ticket #${t.id}** : "${t.title}"\n  - Statut : ${STATUS_LABEL[t.status] || t.status} | Priorité : ${PRIORITY_LABEL[t.priority] || t.priority}`;
        if (t.category) ticketContext += ` | Catégorie : ${t.category}`;
        if (t.requester) ticketContext += ` | Demandeur : ${t.requester.fullName}`;
        if (t.assignedTo) ticketContext += ` | Assigné à : ${t.assignedTo.fullName}`;
        if (t.locationName) ticketContext += ` | Lieu : ${t.locationName}`;
        if (t.glpiTicketId) ticketContext += ` | GLPI #${t.glpiTicketId}`;
        ticketContext += `\n  - *Description :* ${(t.content || '').substring(0, 200)}...\n\n`;
      }
    }
    contextParts.push(ticketContext);
  } else {
    contextParts.push("**Aucun ticket trouvé dans la base de données** pour cette recherche. Ne pas inventer de tickets — indiquer simplement qu'aucun résultat n'a été trouvé.");
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
        // "le plus critique" → classement par nombre de tickets critiques (P1)
        const wantsUrgent = /critique|urgent|grave|s[ée]v[èe]re|p1/i.test(message) || /critical|urgent/i.test(params?.keyword || '');
        const period = params?.period || '30d';
        const stats = await analyticsTools.getTopLocationsStats({ filterKeyword: kw, period, limit: 5, sortByUrgent: wantsUrgent });
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
      const wantsFull = /\b(tous?|toute?|liste|liste[s]?|montre|affiche|donne[- ]?moi)\b/i.test(message);
      const report = await generateReport(params?.period || null, wantsFull);
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

  // Instructions spécifiques par intent pour guider le format de réponse
  const intentInstructions = {
    analytics: "Réponds uniquement avec un tableau Markdown propre suivi d'une seule phrase de conclusion. Pas d'introduction.",
    team_report: "Utilise un tableau avec les colonnes : Équipe | Ouverts | En cours | Résolus. Maximum 1 phrase après.",
    report: "Transmets le rapport tel quel. Si c'est une liste complète, affiche le tableau entièrement sans tronquer.",
    summary: "Résumé en 4-6 lignes maximum. Pas de tableau.",
    general: "Réponse courte et naturelle (3-6 lignes).",
    search_tickets: "Liste les tickets trouvés avec ID, titre, statut et lieu. Si beaucoup de résultats, utilise un tableau Markdown. Ne limite pas artificiellement le nombre.",
    check_ticket: "Donne le statut, la priorité, le lieu et le technicien assigné. Sois factuel.",
    create_ticket: "Confirme la création avec le numéro de ticket et un lien.",
    create_ticket_for: "Confirme la création pour l'utilisateur mentionné.",
    search_inventory: "Liste les équipements trouvés avec nom, type et lieu.",
    search_users: "Liste les utilisateurs trouvés avec nom, email et rôle.",
    search_locations: "Liste les lieux trouvés avec nom et adresse.",
  };

  // ── Classification intents info vs action ──
  const ACTION_INTENTS = new Set([
    'create_ticket', 'create_ticket_for', 'confirm_create_ticket',
    'change_status', 'assign_ticket', 'escalate',
  ]);

  const isActionIntent = ACTION_INTENTS.has(intent);

  // ── Construire le contexte système ──
  const intentHint = intentInstructions[intent]
    ? `\n\nINSTRUCTION SPÉCIFIQUE POUR CETTE INTENT : ${intentInstructions[intent]}`
    : '';

  const systemContext = contextParts.length > 0 ? `\n\n${contextParts.join('\n\n')}` : '';

  // ── Récupérer le modèle vocal configuré (optionnel) ──
  let voiceModelOptions = {};
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (settings?.voiceAiModelId) {
      voiceModelOptions = { forcedModelId: settings.voiceAiModelId };
    }
  } catch {}

  // ── Construire le message utilisateur avec contexte ──
  const userMessageWithCtx = `${message}${systemContext}${intentHint}`;

  let reply;
  let citedTicketIds = [];
  let citedKnowledgeIds = [];

  if (isActionIntent) {
    // ═══ INTENTS ACTION : la mutation est déjà exécutée par le switch/case ═══
    // On extraie la confirmation directement du résultat (contextParts)
    // Zéro appel LLM supplémentaire — la réponse est déterministe et fiable.
    const confirmPatterns = [
      { match: /\*\*Statut modifié\*\*/, template: (m) => m.replace(/\*\*/g, '') },
      { match: /\*\*Ticket créé\*\*/, template: (m) => m.replace(/\*\*/g, '') },
      { match: /\*\*Ticket assigné\*\*/, template: (m) => m.replace(/\*\*/g, '') },
      { match: /\*\*Escalade\*\*/, template: (m) => m.replace(/\*\*/g, '') },
      { match: /Erreur/i, template: (m) => m.replace(/\*\*/g, '') },
    ];

    const confirmMsg = contextParts.find(p => confirmPatterns.some(cp => cp.match.test(p)));
    if (confirmMsg) {
      const pattern = confirmPatterns.find(cp => cp.match.test(confirmMsg));
      reply = pattern ? pattern.template(confirmMsg) : confirmMsg.replace(/\*\*/g, '');
    } else {
      reply = generateActionReply(intent, message);
    }
  } else {
    // ═══ INTENTS INFORMATION : structured output pour reply + citations ═══
    const responseSchema = {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Réponse en français, concise, sans emojis ni titres markdown' },
        citedTicketIds: { type: 'array', items: { type: 'integer' }, description: 'IDs de tickets cités dans la réponse (uniquement ceux du contexte)' },
        citedKnowledgeIds: { type: 'array', items: { type: 'string' }, description: 'IDs des documents KB cités (uniquement ceux du contexte)' },
      },
      required: ['reply', 'citedTicketIds', 'citedKnowledgeIds'],
      additionalProperties: false,
    };

    try {
      const raw = await callAI(
        [{ role: 'user', content: userMessageWithCtx }],
        {
          ...voiceModelOptions,
          conversationHistory,
          intentHint: '',
          responseFormat: { type: 'json_object', schema: responseSchema },
        }
      );

      const parsed = parseStructuredResponse(raw);
      if (parsed && parsed.reply) {
        reply = cleanAiReply(parsed.reply);
        // Validation post-appel des IDs cités — filtre les fantômes
        const validated = await validateCitedIds(parsed.citedTicketIds, parsed.citedKnowledgeIds, intent);
        citedTicketIds = validated.ticketIds;
        citedKnowledgeIds = validated.knowledgeIds;
      } else {
        console.warn('[chatbot] Structured output parsing échoué, fallback texte brut');
        reply = cleanAiReply(raw);
      }
    } catch (err) {
      console.error('[chatbot] Échec structured output, fallback classique:', err.message);
      try {
        const raw = await callAI(
          [{ role: 'user', content: userMessageWithCtx }],
          { ...voiceModelOptions, conversationHistory, intentHint }
        );
        reply = cleanAiReply(raw);
      } catch (fallbackErr) {
        console.error('[chatbot] Échec fallback classique:', fallbackErr.message);
        reply = "Désolé, je rencontre une difficulté temporaire d'accès aux services IA. Veuillez réentreprendre votre demande dans quelques instants.";
      }
    }
  }

  // ═══ DOUBLE VÉRIFICATION : fact-checking post-réponse ═══
  // Détecte les erreurs (tickets fantômes, statuts erronés) et relance si nécessaire.
  // verifyResponseFacts ne MUTATION plus le texte — détection + logs uniquement.
  if (reply && !isActionIntent) {
    const verification = await verifyResponseFacts(reply, contextParts, intent, matchingTickets);
    if (verification.needsRetry && verification.retryContext) {
      // Relancer avec le structured output + contexte correctif dans le system prompt
      try {
        const correctiveSystem = `${SYSTEM_PROMPT}${intentHint}${systemContext}\n\n⚠️ CONTEXTE CORRECTIF (respecte-le strictement) :\n${verification.retryContext}Ne mentionne PAS ces éléments erronés dans ta réponse. Utilise UNIQUEMENT les données du contexte initial.`;
        const retryRaw = await callAI(
          [{ role: 'user', content: message }],
          {
            ...voiceModelOptions,
            conversationHistory,
            intentHint: '',
            responseFormat: { type: 'json_object', schema: responseSchema },
            forcedSystem: correctiveSystem,
          }
        );
        const retryParsed = parseStructuredResponse(retryRaw);
        if (retryParsed && retryParsed.reply) {
          reply = cleanAiReply(retryParsed.reply);
          const retryValidated = await validateCitedIds(retryParsed.citedTicketIds, retryParsed.citedKnowledgeIds, intent);
          citedTicketIds = retryValidated.ticketIds;
          citedKnowledgeIds = retryValidated.knowledgeIds;
          console.warn(`[chatbot] Retry structuré réussi après fact-check: ${verification.corrections.join(', ')}`);
        }
      } catch (retryErr) {
        console.error('[chatbot] Retry structuré échoué:', retryErr.message);
      }
    }
    // Vérification croisée (logs uniquement)
    crossVerifyWithContext(reply, matchingTickets, intent);
  }

  return {
    reply,
    intent,
    action,
    widget,
    sources: knowledgeChunks.map((c) => ({ title: c.title, id: c.documentId })),
    citedTicketIds,
    citedKnowledgeIds,
    pendingTicketData: pendingTicket || null,
  };
}

// ── Helpers pour le structured output ──────────────────────────────────

function parseStructuredResponse(raw) {
  if (!raw) return null;

  // 1. Tenter de parser directement
  try {
    return JSON.parse(raw);
  } catch {}

  // 2. Extraire JSON des markdown fences (```json ... ```)
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {}
  }

  // 3. Extraire le premier objet JSON trouvé
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  return null;
}

async function validateCitedIds(ticketIds, knowledgeIds, intent) {
  const result = { ticketIds: ticketIds || [], knowledgeIds: knowledgeIds || [], issues: [] };

  if (result.ticketIds.length > 0) {
    try {
      const existing = await prisma.ticket.findMany({
        where: { id: { in: result.ticketIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map(t => t.id));
      const ghostIds = result.ticketIds.filter(id => !existingIds.has(id));
      if (ghostIds.length > 0) {
        result.issues.push(`Tickets fantômes: ${ghostIds.join(', ')}`);
        console.warn(`[chatbot] IDs tickets fantômes cités par l'IA: ${ghostIds.join(', ')} (intent: ${intent})`);
        result.ticketIds = result.ticketIds.filter(id => existingIds.has(id));
      }
    } catch (err) {
      console.error('[chatbot] Erreur validation citedTicketIds:', err.message);
    }
  }

  if (result.knowledgeIds.length > 0) {
    try {
      const validIds = result.knowledgeIds.map(Number).filter(n => !isNaN(n));
      if (validIds.length > 0) {
        const existing = await prisma.knowledgeDocument.findMany({
          where: { id: { in: validIds } },
          select: { id: true },
        });
        const existingIds = new Set(existing.map(d => d.id));
        const ghostIds = result.knowledgeIds.filter(id => !existingIds.has(Number(id)));
        if (ghostIds.length > 0) {
          result.issues.push(`Knowledge fantômes: ${ghostIds.join(', ')}`);
          console.warn(`[chatbot] IDs knowledge fantômes cités par l'IA: ${ghostIds.join(', ')} (intent: ${intent})`);
          result.knowledgeIds = result.knowledgeIds.filter(id => existingIds.has(Number(id)));
        }
      }
    } catch (err) {
      console.error('[chatbot] Erreur validation citedKnowledgeIds:', err.message);
    }
  }

  if (result.issues.length > 0) {
    console.warn(`[chatbot] Validation IDs: ${result.issues.join(' | ')}`);
  }

  return result;
}

function generateActionReply(intent, message) {
  const replies = {
    change_status: "Le statut du ticket a été modifié avec succès.",
    assign_ticket: "Le ticket a été assigné avec succès.",
    create_ticket: "Le ticket a été créé avec succès.",
    create_ticket_for: "Le ticket a été créé pour l'utilisateur demandé.",
    confirm_create_ticket: "Le ticket a été créé avec succès.",
    escalate: "L'escalade a été effectuée. Un technicien a été notifié.",
  };
  return replies[intent] || "Action effectuée avec succès.";
}

// ── Double vérification : fact-checking post-réponse IA ───────────────
// Vérifie que les claims de l'IA (IDs de tickets, statuts, comptes)
// correspondent à la réalité en base AVANT d'envoyer la réponse.

const STATUS_LABEL_TO_DB = {
  'nouveau': 'NEW', 'nouveaux': 'NEW',
  'ouvert': 'OPEN', 'ouverts': 'OPEN',
  'en attente': 'PENDING', 'attente': 'PENDING',
  'résolu': 'SOLVED', 'résolus': 'SOLVED', 'resolu': 'SOLVED',
  'fermé': 'CLOSED', 'fermés': 'CLOSED', 'ferme': 'CLOSED',
};

const DB_STATUS_TO_FR = {
  'NEW': 'Nouveau', 'OPEN': 'Ouvert', 'PENDING': 'En attente',
  'SOLVED': 'Résolu', 'CLOSED': 'Fermé',
};

async function verifyResponseFacts(replyText, contextParts, intent, matchingTickets) {
  if (!replyText) return { reply: replyText, corrected: false, needsRetry: false, retryContext: '' };

  factCheckCounters.totalChecks++;
  const corrections = [];
  let needsRetry = false;
  let retryContext = '';

  // ═══ 1. Extraire tous les IDs de tickets mentionnés ═══
  const ticketIdPattern = /#(\d+)|ticket\s*#?\s*(\d+)/gi;
  const mentionedIds = new Set();
  let match;
  while ((match = ticketIdPattern.exec(replyText)) !== null) {
    const id = parseInt(match[1] || match[2], 10);
    if (id > 0 && id < 1000000) mentionedIds.add(id);
  }

  // ═══ 2. Vérifier chaque ID existe en base + récupérer statuts réels ═══
  const realTicketData = new Map();
  if (mentionedIds.size > 0) {
    try {
      const existingTickets = await prisma.ticket.findMany({
        where: { id: { in: [...mentionedIds] } },
        select: { id: true, status: true, title: true },
      });
      for (const t of existingTickets) {
        realTicketData.set(t.id, t);
      }

      for (const id of mentionedIds) {
        if (!realTicketData.has(id)) {
          corrections.push(`Ticket #${id} introuvable`);
          factCheckCounters.ghostTickets++;
          needsRetry = true;
          retryContext += `Le ticket #${id} n'existe pas en base. `;
        }
      }
    } catch (err) {
      console.error('[chatbot] Erreur vérification ticket IDs:', err.message);
    }
  }

  // ═══ 3. Vérifier les claims de statut (détection seule, pas de mutation) ═══
  const contextStatuses = new Map();
  const statusPattern = /Ticket\s*#(\d+).*?Statut\s*:\s*(Nouveau|Ouvert|En attente|Résolu|Fermé)/gi;
  for (const part of contextParts) {
    while ((match = statusPattern.exec(part)) !== null) {
      const id = parseInt(match[1], 10);
      const frStatus = match[2];
      contextStatuses.set(id, STATUS_LABEL_TO_DB[frStatus.toLowerCase()] || frStatus);
    }
  }

  for (const [id, realData] of realTicketData) {
    contextStatuses.set(id, realData.status);
  }

  const claimPatterns = [
    { regex: /#(\d+).*?(?:est|passe?\s+(?:à|a))\s+(?:le\s+)?statut\s+(?:de\s+)?["']?(nouveau|ouvert|en attente|résolu|fermé)["']?/gi, idGroup: 1, statusGroup: 2 },
    { regex: /#(\d+).*?(?:statut|état)\s*[:=]\s*["']?(nouveau|ouvert|en attente|résolu|fermé)["']?/gi, idGroup: 1, statusGroup: 2 },
    { regex: /ticket\s*#?(\d+).*?(?:est|été)\s+(?:mis|passé|classé)\s+(?:en|à|au)\s+["']?(nouveau|ouvert|en attente|résolu|fermé)["']?/gi, idGroup: 1, statusGroup: 2 },
    { regex: /#(\d+).*?(nouveau|ouvert|en attente|résolu|fermé)/gi, idGroup: 1, statusGroup: 2 },
  ];

  for (const { regex, idGroup, statusGroup } of claimPatterns) {
    while ((match = regex.exec(replyText)) !== null) {
      const ticketId = parseInt(match[idGroup], 10);
      const claimedFrStatus = match[statusGroup].toLowerCase();
      const claimedDbStatus = STATUS_LABEL_TO_DB[claimedFrStatus];

      if (ticketId && claimedDbStatus && contextStatuses.has(ticketId)) {
        const realStatus = contextStatuses.get(ticketId);
        if (realStatus !== claimedDbStatus) {
          const realFr = DB_STATUS_TO_FR[realStatus] || realStatus;
          corrections.push(`#${ticketId}: IA dit "${claimedFrStatus}" mais statut réel = "${realFr}"`);
          needsRetry = true;
          retryContext += `Le ticket #${ticketId} a le statut "${realFr}", pas "${claimedFrStatus}". `;
        }
      }
    }
  }

  // ═══ 4. Vérifier les comptes/totaux (détection seule) ═══
  const countPatterns = [
    /(\d+)\s*tickets?\s*(?:trouvé|ouvert|ouverts?|en|total)/gi,
    /total\s*[:=]?\s*(\d+)/gi,
    /(?:il y a|il existe)\s+(\d+)\s*ticket/gi,
  ];

  const actualCount = matchingTickets ? matchingTickets.length : null;
  if (actualCount !== null) {
    for (const regex of countPatterns) {
      while ((match = regex.exec(replyText)) !== null) {
        const claimedCount = parseInt(match[1], 10);
        if (claimedCount !== actualCount) {
          corrections.push(`Compte: IA dit ${claimedCount} mais réel = ${actualCount}`);
          needsRetry = true;
          retryContext += `Le nombre réel de tickets est ${actualCount}, pas ${claimedCount}. `;
        }
      }
    }
  }

  // ═══ 5. Logger les corrections ═══
  if (corrections.length > 0) {
    factCheckCounters.corrections++;
    console.warn(`[chatbot] Fact-check corrections (${intent}): ${corrections.join(' | ')}`);
  }

  return { reply: replyText, corrected: corrections.length > 0, corrections, needsRetry, retryContext };
}

// ── Vérification croisée : comparer la réponse IA aux données du contexte ─

function crossVerifyWithContext(replyText, matchingTickets, intent) {
  if (!replyText || !matchingTickets) return;

  // Vérifier le compte — seuil > 0 (tout écart est une erreur)
  const countClaim = replyText.match(/(\d+)\s*ticket/i);
  if (countClaim) {
    const claimedCount = parseInt(countClaim[1], 10);
    const actualCount = matchingTickets.length;
    if (claimedCount !== actualCount) {
      factCheckCounters.crossVerifyWarnings++;
      console.warn(`[chatbot] Cross-verify: IA dit ${claimedCount} tickets, réel = ${actualCount} (intent: ${intent})`);
    }
  }

  // Vérifier que chaque ticket # mentionné est dans matchingTickets
  const ticketIdPattern = /#(\d+)/g;
  let match;
  while ((match = ticketIdPattern.exec(replyText)) !== null) {
    const id = parseInt(match[1], 10);
    if (id > 0 && !matchingTickets.some(t => t.id === id)) {
      factCheckCounters.crossVerifyWarnings++;
      console.warn(`[chatbot] Cross-verify: #${id} mentionné mais absent du contexte (intent: ${intent})`);
    }
  }
}

module.exports = { handleMessage };
