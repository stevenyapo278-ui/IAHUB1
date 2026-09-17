const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { emitTicketCreated, emitTicketAssigned } = require('../utils/socket');
const { sendTicketCreationNotification, sendAssignmentNotificationEmail } = require('./emailSender');
const analyticsTools = require('./analyticsTools');

const SYSTEM_PROMPT = `Tu es MARIE, l'assistante IA Helpdesk IT de Prosuma. Tu es une collègue expérimentée du support IT : naturelle, chaleureuse, efficace.

Tu es TOTALEMENT LIBRE sur la forme : ton, style, longueur, structure, formatage (markdown, tableaux, listes, gras, italique), emojis ou non — fais ce qui est le plus utile et le plus agréable pour ton interlocuteur. Réponds dans la langue de l'utilisateur. Varie tes tournures, montre ta personnalité, donne ton avis professionnel quand c'est pertinent. Analyse et interprète les données plutôt que de simplement les lister.

Un contexte (profil utilisateur, tickets, statistiques, base de connaissances) est fourni après ce prompt quand il existe : appuie-toi sur ce qui est pertinent, ignore le reste. Quand tu cites des tickets, des chiffres ou des données, base-toi sur ce contexte — ne fabrique pas de numéros de tickets ou de statistiques qui n'y figurent pas. En dehors de ça, aucune contrainte : sois naturelle.`;

// ── Nettoyage minimal des réponses IA ──────────────────────────────────

function cleanAiReply(text) {
  if (!text) return '';
  return text
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/\n+$/, '')
    .trim();
}

// ── Réponses directes pour les salutations ──
const GREETING_REPLIES = [
  'Bonjour ! Comment puis-je vous aider aujourd\'hui ?',
  'Bonjour ! Que puis-je faire pour vous ?',
  'Salut ! Une question, un souci, une recherche ? Je suis là.',
  'Bonjour ! Ravi de vous lire — que cherchez-vous ?',
  'Salut ! Dites-moi tout, je vous écoute.',
  'Bonjour ! Besoin d\'aide sur un ticket, des stats, autre chose ?',
];

// ── Intents qui produisent leur propre contexte déterministe (pas de message "aucun ticket") ──
const DETERMINISTIC_INTENTS = new Set([
  'analytics', 'team_report', 'top_locations', 'top_technicians', 'report',
  'check_ticket', 'summary', 'change_status', 'assign_ticket', 'help',
  'search_inventory', 'search_users', 'search_locations',
]);

// ── Petites phrases (salutations, remerciements) : pas besoin de recherches ni de LLM de classification ──
function isGreetingMessage(message) {
  const lower = (message || '').toLowerCase().trim();
  if (lower.length > 80) return false;
  return /^(salut|bonjour|bonsoir|hello|hey|coucou|hi|yo|re|merci|merci beaucoup|ok|d'accord|super|parfait|top|génial|nickel|au revoir|bye|à demain|bonne journée|bonne soirée|bonne nuit)[\s!.,:?]*$/i.test(lower)
    || /^(salut|bonjour|bonsoir|hello|hey|coucou)[\s,!.,]*(marie|ia|bot)[\s!.,?]*$/i.test(lower);
}

const INTENT_PROMPT = `Tu es un classificateur d'intentions. Analyse le message utilisateur et réponds UNIQUEMENT avec un JSON valide (pas de texte avant ou après).

Intents possibles :
- "analytics" : statistiques, comparaisons, classements, causes racines ("quel magasin a le plus de tickets", "pourquoi ce magasin a des pannes", "perf de Jean")
- "team_report" : répartition des tickets par équipe, reunion hebdomadaire, presenting ("répartition par équipe", "tickets par technicien", "bilan équipe", "réunion hebdo", "ouverts par équipe")
- "general" : question générale, salutation, conversation, OU questions de suivi sur un ticket déjà mentionné ("quand il a été créé", "quel est son statut", "qui l'a assigné", "donne plus de détails", "et pour Jean?")
- "search_tickets" : RECHERCHE ou LISTE de tickets existants. Toute demande qui commence par "liste", "quels", "montre", "tous les", "donne-moi les tickets" → search_tickets. Exemples : "pannes vpn", "tickets imprimantes", "liste tous les tickets ouverts", "quels sont les tickets VPN", "montre les tickets en attente", "tous les tickets Critique", "je veux la liste de tous les tickets", "donne-moi les tickets P1"
- "create_ticket" : créer/ouvrir un ticket pour soi-même, signaler un problème, demander de l'assistance, décrire un incident ("j'ai un problème", "j'ai besoin d'assistance", "mon imprimante ne marche pas", "l'imprimante du 2ème est en panne", "il y a un souci VPN", "signaler un incident", "ça ne fonctionne plus")
- "create_ticket_for" : créer un ticket au nom d'un autre utilisateur ("crée un ticket pour Paul", "ouvre un ticket pour M. Diallo", "ticket pour la compta")
- "confirm_create_ticket" : l'utilisateur confirme vouloir créer un ticket après avoir été demandé ("oui", "oui crée-le", "confirme", "go", "vas-y", "c'est bon", "je confirme", "oui vas-y")
- "check_ticket" : connaître le statut, la date de création, ou les détails d'un ticket spécifique ("quel est le statut du ticket #10", "quand a été créé le ticket 5", "qui a assigné le ticket #3")
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

RÈGLES CRITIQUES POUR LES SUIVIS DE CONVERSATION :
- Si le message contient des pronoms référant à un ticket précédent ("il", "elle", "ce ticket", "celui-ci", "son statut", "sa priorité", "quand il a été créé") → "check_ticket" ou "general" selon le contexte.
- "quand il a été créé" = question sur la DATE de création d'un ticket existant → "check_ticket" (PAS create_ticket).
- "quel est son statut" = question sur le statut d'un ticket déjà mentionné → "check_ticket" (PAS create_ticket).
- "créé" seul ne signifie PAS "créer un ticket". Regarde le contexte : "quand il a été créé" = passé, question → check_ticket.
- "et pour Jean?" ou "et ceux de Paul?" = follow-up sur une recherche précédente → herite de l'intent précédent via le contexte conversationnel.

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

// ── Fallback regex quand le LLM est indisponible ──────────────────────
function extractSearchParamsRegex(query) {
  const lower = query.toLowerCase();
  const params = {};

  // Statuts
  if (/\bouverts?\b/.test(lower) && !/\b(nouveau|résolu|fermé|attente)\b/.test(lower)) {
    params.statuses = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
  } else if (/\bnouveaux?\b/.test(lower)) {
    params.statuses = ['NEW'];
  } else if (/\battente\b/.test(lower)) {
    params.statuses = ['PENDING', 'WAITING_FOR_USER'];
  } else if (/\brésolus?\b/.test(lower) || /\bresolu[s]?\b/.test(lower)) {
    params.statuses = ['SOLVED'];
  } else if (/\bferm[ée]s?\b/.test(lower)) {
    params.statuses = ['CLOSED'];
  }

  // Priorités
  const prioMatch = lower.match(/\b(p1|p2|p3|p4|critique|haute|moyenne|basse)\b/);
  if (prioMatch) {
    const MAP = { p1: 'P1', critique: 'P1', p2: 'P2', haute: 'P2', p3: 'P3', moyenne: 'P3', p4: 'P4', basse: 'P4' };
    params.priorities = [MAP[prioMatch[1]]];
  }

  // Équipe
  const teamMatch = lower.match(/\b(?:equipe|équipe|team)\s+([a-zà-ÿ0-9\- ]+)/i);
  if (teamMatch) params.teamName = teamMatch[1].trim();

  // ID
  const idMatch = query.match(/#(\d+)/);
  if (idMatch) params.ticketId = parseInt(idMatch[1], 10);

  // Liste complète
  if (/\b(tous?|liste|montre|affiche|donne[- ]?moi)\b/.test(lower)) params.wantFullList = true;

  return Object.keys(params).length > 0 ? params : null;
}

// ── Recherche de tickets par paramètres structurés (LLM → Prisma) ─────
const SEARCH_PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    ticketId: { type: 'integer', description: 'Numéro de ticket (#123)' },
    statuses: {
      type: 'array',
      items: { type: 'string', enum: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'] },
      description: 'Statuts recherchés. "ouverts" = [NEW,OPEN,PLANNED,PENDING,WAITING_FOR_USER]; "ouvert" = [OPEN]; "en attente" = [PENDING]; "résolus" = [SOLVED]; "fermés" = [CLOSED]',
    },
    priorities: {
      type: 'array',
      items: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
      description: 'Priorités recherchées',
    },
    teamName: { type: 'string', description: "Nom d'équipe (ex: 'Abidjan', 'Support')" },
    locationName: { type: 'string', description: 'Lieu (ex: "Casino", "Super U")' },
    requesterName: { type: 'string', description: 'Nom du demandeur' },
    assignedToName: { type: 'string', description: 'Nom du technicien assigné' },
    keyword: { type: 'string', description: 'Mot-clé pour titre/contenu/catégorie (un seul mot significatif, PAS les articles/pronoms)' },
    dateFrom: { type: 'string', description: 'Date début ISO (ex: 2026-09-01)' },
    dateTo: { type: 'string', description: 'Date fin ISO (ex: 2026-09-16)' },
    wantFullList: { type: 'boolean', description: 'Vrai si l\'utilisateur veut une liste complète ("tous", "liste", "montre")' },
  },
  required: [],
};

async function callSearchParamsAI(message) {
  const _plog = (step, detail) => console.log(`[chatbot] callSearchParamsAI step=${step} ${detail || ''}`);
  const providers = await getActiveProviders();
  if (providers.length === 0) { _plog('no-providers', ''); return null; }

  _plog('start', `providers=${providers.length} msg="${message.substring(0, 60)}"`);

  let modelOptions = {};
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (settings?.intentAiModelId) {
      modelOptions = { forcedModelId: settings.intentAiModelId };
      _plog('model', `forcedModelId=${settings.intentAiModelId}`);
    }
  } catch {}

  const systemPrompt = `Tu extrais les paramètres de recherche de tickets à partir du message de l'utilisateur.
Règles:
- "tickets ouverts" ou "tous les tickets ouverts" → statuses: ["NEW","OPEN","PLANNED","PENDING","WAITING_FOR_USER"]
- "ticket ouvert" (singulier) → statuses: ["OPEN"]
- "en attente" → statuses: ["PENDING"]
- "résolus" → statuses: ["SOLVED"]
- "fermés" → statuses: ["CLOSED"]
- "P1" ou "critique" → priorities: ["P1"]
- "équipe Abidjan" → teamName: "Abidjan"
- "Casino" → locationName: "Casino"
- Extrais UN seul mot-clé significatif si présent (ex: "VPN" dans "tickets VPN"). PAS de mots vides (la, les, des, un, une, qui, pour, etc.)
- Si le message contient un nom de personne connu (ex: "Yapo", "Jean", "Diallo"), utilise assignedToName ou requesterName, PAS keyword. Ex: "tickets de Yapo" → assignedToName: "Yapo"
- wantFullList: vrai si "liste", "tous", "montre", "donne-moi" est présent
- DATES IMPORTANTES : les dates doivent être extraites en dateFrom/dateTo au format ISO (YYYY-MM-DD), JAMAIS en keyword.
  AUJOURD'HUI = ${new Date().toISOString().split('T')[0]}.
  - "du 06/09/2026" ou "ticket du 06/09/2026" → dateFrom: "2026-09-06", dateTo: "2026-09-06"
  - "entre le 01/09 et le 15/09" → dateFrom: "2026-09-01", dateTo: "2026-09-15"
  - "aujourd'hui" → dateFrom: AUJOURD'HUI, dateTo: AUJOURD'HUI
  - "hier" → dateFrom: AUJOURD'HUI - 1 jour, dateTo: AUJOURD'HUI - 1 jour
  - "avant hier" → dateFrom: AUJOURD'HUI - 2 jours, dateTo: AUJOURD'HUI - 2 jours
  - "cette semaine" → dateFrom: lundi de cette semaine, dateTo: dimanche de cette semaine
  - "la semaine dernière" → dateFrom: lundi semaine dernière, dateTo: dimanche semaine dernière
  - "le vendredi dernier" ou "vendredi passé" → dateFrom: date du dernier vendredi, dateTo: même date
  - "ce mois-ci" → dateFrom: 1er du mois, dateTo: dernier jour du mois
  - "le mois dernier" → dateFrom: 1er du mois dernier, dateTo: dernier jour du mois dernier
  - "cette année" → dateFrom: 2026-01-01, dateTo: 2026-12-31
  - Le format français DD/MM/YYYY signifie jour/mois/année. Ex: 06/09/2026 = 6 septembre 2026.
  - NE JAMAIS mettre une date en keyword. Si une date est présente, utilise dateFrom/dateTo.
- Si le message ne concerne PAS une recherche de tickets, retourne un objet vide {}

Réponds UNIQUEMENT avec le JSON, pas de commentaire.`;

  try {
    const raw = await callAI(
      [{ role: 'user', content: message }],
      { forcedSystem: systemPrompt, ...modelOptions }
    );
    _plog('ai-raw', `rawLen=${(raw || '').length} raw="${(raw || '').substring(0, 200)}"`);
    // Extraire le JSON du texte brut (peut être entouré de ```json ou non)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { _plog('no-json', ''); return null; }
    const parsed = JSON.parse(jsonMatch[0]);
    _plog('parsed', JSON.stringify(parsed));
    return parsed;
  } catch (err) {
    console.error('[chatbot] Erreur searchParams AI:', err.message);
    _plog('error', err.message);
    return null;
  }
}

function buildSearchQuery(params, user) {
  const where = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };

  // Filtrage par rôle
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

  // Statut
  if (params.statuses && params.statuses.length > 0) {
    if (params.statuses.length === 1) {
      where.status = params.statuses[0];
    } else {
      where.status = { in: params.statuses };
    }
  }

  // Priorité
  if (params.priorities && params.priorities.length > 0) {
    where.priority = params.priorities.length === 1 ? params.priorities[0] : { in: params.priorities };
  }

  // Équipe
  if (params.teamName) {
    where.team = { name: { contains: params.teamName, mode: 'insensitive' } };
  }

  // Lieu
  if (params.locationName) {
    where.locationName = { contains: params.locationName, mode: 'insensitive' };
  }

  // Demandeur
  if (params.requesterName) {
    where.requester = { fullName: { contains: params.requesterName, mode: 'insensitive' } };
  }

  // Assigné à
  if (params.assignedToName) {
    where.assignedTo = { fullName: { contains: params.assignedToName, mode: 'insensitive' } };
  }

  // ID
  if (params.ticketId) {
    where.OR = [...(where.OR || []), { id: params.ticketId }];
  }

  // Mot-clé (titre, contenu, catégorie)
  if (params.keyword && params.keyword.length > 1) {
    const kw = params.keyword;
    const keywordFilter = [
      { title: { contains: kw, mode: 'insensitive' } },
      { content: { contains: kw, mode: 'insensitive' } },
      { category: { contains: kw, mode: 'insensitive' } },
    ];

    if (user && (user.role === 'REQUESTER' || user.role === 'TECHNICIAN')) {
      const roleFilter = { OR: where.OR || [] };
      where.AND = [roleFilter, { OR: keywordFilter }];
      delete where.OR;
    } else {
      where.OR = [...(where.OR || []), ...keywordFilter];
    }
  }

  // Dates
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {};
    if (params.dateFrom) where.createdAt.gte = new Date(params.dateFrom);
    if (params.dateTo) where.createdAt.lt = new Date(params.dateTo + 'T23:59:59');
  }

  return where;
}

async function searchTickets(query, limit = 20, user = null, period = null) {
  if (!query || !query.trim()) return { tickets: [], totalCount: 0 };

  const _slog = (step, detail) => console.log(`[chatbot] searchTickets step=${step} ${detail || ''}`);
  _slog('start', `query="${query.substring(0, 80)}" limit=${limit} userId=${user?.sub} period=${period}`);

  try {
    // 1. Essai LLM pour extraire les paramètres structurés
    let params = null;
    try {
      _slog('llm-start', 'calling callSearchParamsAI...');
      params = await Promise.race([
        callSearchParamsAI(query),
        new Promise((_, reject) => setTimeout(() => reject(new Error('searchParams timeout')), 15000)),
      ]);
      _slog('llm-done', `params=${JSON.stringify(params || {})}`);
    } catch (e) {
      console.warn('[chatbot] searchParams LLM échoué, fallback regex:', e.message);
    }

    // 2. Fallback regex si le LLM échoue ou retourne des params incomplets
    const regexParams = extractSearchParamsRegex(query);
    if (!params || Object.keys(params).length === 0) {
      params = regexParams;
      _slog('regex-fallback', `params=${JSON.stringify(params || {})}`);
    } else {
      // Quand le regex détecte des statuts, prioriser le regex pour les statuts
      // et supprimer les keyword qui sont juste des mots de statut (ex: "ouverts")
      if (regexParams && regexParams.statuses) {
        if (params.statuses) {
          const missingPlanned = regexParams.statuses.includes('PLANNED') && !params.statuses.includes('PLANNED');
          if (missingPlanned) {
            _slog('regex-add-planned', `llm=${JSON.stringify(params.statuses)} → adding PLANNED`);
            params.statuses = regexParams.statuses;
          }
        } else {
          _slog('regex-override-statuses', `llm=${JSON.stringify(params)} regex statuses=${JSON.stringify(regexParams.statuses)}`);
          params.statuses = regexParams.statuses;
        }
        // Supprimer le keyword LLM si c'est un mot de statut (pour éviter filtre titre parasite)
        if (params.keyword && /^(ouvert|ouverts?|nouveau|nouveaux?|attente|résolu|resolu|fermé|ferme|planned|tickets?|ticket)$/i.test(params.keyword)) {
          _slog('regex-remove-keyword', `removed keyword="${params.keyword}" (status/generic word)`);
          delete params.keyword;
        }
        // Quand le regex détecte "ouverts" (pluriel = liste complète), supprimer le keyword LLM parasite
        // MAIS uniquement si c'est un mot générique (statut, "tickets", etc.) — pas un vrai mot-clé comme "VPN"
        if (regexParams.statuses && regexParams.statuses.length >= 4 && params.keyword) {
          const isGenericKeyword = /^(ouvert|ouverts?|nouveau|nouveaux?|attente|résolu|resolu|fermé|ferme|planned|tickets?|ticket)$/i.test(params.keyword);
          if (isGenericKeyword) {
            _slog('regex-remove-keyword-full-list', `removed keyword="${params.keyword}" (generic word in full list query)`);
            delete params.keyword;
          } else {
            _slog('regex-keep-keyword-full-list', `kept keyword="${params.keyword}" (real search term)`);
          }
        }
      }
      if (regexParams && regexParams.wantFullList) params.wantFullList = true;
    }

    // Post-traitement : si keyword ressemble à un nom de personne, le convertir en assignedToName/requesterName
    if (params?.keyword && !params.assignedToName && !params.requesterName) {
      try {
        const userMatch = await prisma.user.findFirst({
          where: { fullName: { contains: params.keyword, mode: 'insensitive' }, deletedAt: null },
          select: { id: true },
        });
        if (userMatch) {
          _slog('keyword-to-user', `keyword="${params.keyword}" → assignedToName`);
          params.assignedToName = params.keyword;
          delete params.keyword;
        }
      } catch {}
    }

    if (!params || Object.keys(params).length === 0) {
      _slog('no-params', 'returning empty');
      return { tickets: [], totalCount: 0 };
    }

    const where = buildSearchQuery(params, user);
    _slog('buildQuery', `where=${JSON.stringify(where, null, 0)}`);

    // Filtrage temporel optionnel (depuis l'extérieur)
    if (period) {
      const { start, end } = resolvePeriodDates(period);
      if (start) where.createdAt = { ...where.createdAt, gte: start };
      if (end) where.createdAt = { ...where.createdAt, lt: end };
    }

    const effectiveLimit = params.wantFullList ? 100 : limit;

    const [tickets, totalCount] = await Promise.all([
      prisma.ticket.findMany({
        where,
        take: effectiveLimit,
        include: {
          requester: { select: { fullName: true, email: true } },
          assignedTo: { select: { fullName: true } },
          team: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.ticket.count({ where }),
    ]);

    _slog('db-done', `tickets=${tickets.length} totalCount=${totalCount} limit=${effectiveLimit}`);
    return { tickets, totalCount };
  } catch (err) {
    console.error('[chatbot] Erreur recherche tickets:', err.message, err.stack);
    return { tickets: [], totalCount: 0 };
  }
}

async function searchTicketsWithContext(message, limit, user, period, previousState) {
  const _slog = (step, detail) => console.log(`[chatbot] searchTicketsWithContext step=${step} ${detail || ''}`);
  _slog('start', `msg="${message.substring(0, 60)}" prevIntent=${previousState?.intent} prevTickets=${previousState?.tickets?.length || 0}`);

  // Détecter si le message change juste un paramètre (ex: "et pour Jean")
  const lower = message.toLowerCase();
  const personMatch = lower.match(/\b(?:pour|de|à|a)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);

  // Anti-faux-positif : "de ticket ouverts", "à date", "pour aujourd'hui"... ne sont PAS des
  // personnes. On valide que ce "nom" correspond à un utilisateur réel avant de filtrer dessus.
  let validPersonName = null;
  if (personMatch && previousState?.intent === 'search_tickets') {
    const candidate = personMatch[1];
    try {
      const exists = await prisma.user.findFirst({
        where: { fullName: { contains: candidate, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
      });
      if (exists) validPersonName = candidate;
    } catch {}
  }

  if (validPersonName && previousState?.intent === 'search_tickets') {
    // Extraire le nom de la personne
    const personName = validPersonName;
    _slog('person-detected', `personName=${personName}`);

    // Chercher les tickets assignés à cette personne
    try {
      const where = {
        deletedAt: null,
        approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
        assignedTo: { fullName: { contains: personName, mode: 'insensitive' } },
      };

      if (period) {
        const { start, end } = resolvePeriodDates(period);
        if (start) where.createdAt = { ...where.createdAt, gte: start };
        if (end) where.createdAt = { ...where.createdAt, lt: end };
      }

      const [tickets, totalCount] = await Promise.all([
        prisma.ticket.findMany({
          where,
          take: limit,
          include: {
            requester: { select: { fullName: true, email: true } },
            assignedTo: { select: { fullName: true } },
            team: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.ticket.count({ where }),
      ]);

      _slog('db-done', `tickets=${tickets.length} totalCount=${totalCount}`);
      return { tickets, totalCount };
    } catch (err) {
      console.error('[chatbot] Erreur searchTicketsWithContext:', err.message);
      // Fallback utile : recherche normale au lieu de résultats vides
      return searchTickets(message, limit, user, period);
    }
  }

  // Fallback : recherche normale
  return searchTickets(message, limit, user, period);
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
  const recentHistory = (options.conversationHistory || []).slice(-30);
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

  // Budget token dynamique : garder l'historique dans ~16000 tokens
  const MAX_HISTORY_TOKENS = 16000;
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
    // Température élevée = réponses plus naturelles et variées (garde-fou retiré)
    temperature: options.temperature ?? 0.8,
    // Défaut provider = 2048 tokens : coupe les analyses longues en plein milieu → effet robot.
    // On double pour laisser MARIE développer ses analyses.
    maxTokens: options.maxTokens ?? 4096,
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

async function callIntentAI(message, conversationHistory = []) {
  const providers = await getActiveProviders();
  if (providers.length === 0) return null;

  // Modèle léger dédié à la classification (optionnel)
  let intentModelOptions = {};
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (settings?.intentAiModelId) {
      intentModelOptions = { forcedModelId: settings.intentAiModelId };
    }
  } catch {}

  // Construire le contexte conversationnel pour résoudre les pronoms
  let historyContext = '';
  if (conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-6);
    historyContext = '\n\nCONVERSATION PRÉCÉDENTE (pour résoudre les pronoms et références) :\n'
      + recent.map(m => `${m.role === 'user' ? 'Utilisateur' : 'MARIE'}: ${m.content.substring(0, 200)}`).join('\n');
  }

  try {
    const raw = await callAI(
      [{ role: 'user', content: `${INTENT_PROMPT}${historyContext}\n\nUser: "${message}"` }],
      { responseFormat: { type: 'json_schema', schema: INTENT_SCHEMA }, temperature: 0.1, ...intentModelOptions }
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

// ── Conversation state (multi-turn) ───────────────────────────────────

const conversationStates = new Map(); // userId → { intent, params, tickets, timestamp }
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getConversationState(userId) {
  if (!userId) return null;
  const state = conversationStates.get(userId);
  if (!state) return null;
  if (Date.now() - state.timestamp > STATE_TTL_MS) {
    conversationStates.delete(userId);
    return null;
  }
  return state;
}

function setConversationState(userId, intent, params, tickets = []) {
  if (!userId) return;
  conversationStates.set(userId, { intent, params, tickets, timestamp: Date.now() });
}

function isReferenceMessage(message) {
  const lower = message.toLowerCase().trim();
  // Les questions autonomes (comptage, listing, stats) ne sont JAMAIS de simples références
  // au message précédent. Ex: "il y a combien de ticket ouverts à date ?" doit être traité
  // comme une question fraîche, pas hériter de la dernière recherche (filtre VPN, etc.).
  if (/\b(combien|nombre|total|liste|montre[rz]?|classement|stats?|statistiques?)\b/.test(lower)) return false;
  if (/\bil y a\b/.test(lower)) return false;
  return /^(et|et aussi|et pour|maintenant|ok et|d'accord et|sinon| sinon|pareil|m[aè]me chose|ceux[- ]?(ci|là)?|celui[- ]?(ci|là)?|les m[aè]mes?|aussi|ensuite|et toi|et nous|pour nous|pour moi|pour l['']?équipe|il|elle|ce ticket|son|sa|ses)\b/.test(lower)
    || /^.{0,15}\b(et|aussi|pareil|ensuite)\b.{0,25}$/.test(lower)
    || /\b(aussi|pareil|comme (ça|avant)|de m[aè]me|ensuite|et|puis)\b/.test(lower) && message.length < 40;
}

function isTeamSearchMessage(message) {
  const lower = message.toLowerCase();
  return /(?:^|\s|')(quipe|equipe|team|groupe)(?:\s|$|')/i.test(lower.replace(/é/g, 'e').replace(/è/g, 'e'))
    && !/(?:^|\s)(rapport|bilan|combien|nombre|total|stats|statistiques)(?:\s|$)/i.test(lower);
}

// ── Intent detection (IA + regex fallback) ─────────────────────────────

function detectIntentRegex(message, previousState = null) {
  const lower = message.toLowerCase();
  const period = parsePeriodFromText(message);

  // Si c'est une référence ("et ceux de Jean ?", "aussi pour moi") et on a un state précédent
  if (previousState && isReferenceMessage(message)) {
    // Si le message mentionne une équipe → search_tickets (pas report)
    if (isTeamSearchMessage(message)) {
      return { intent: 'search_tickets', params: { period, inheritFrom: previousState } };
    }
    // Cas : "et pour Jean" → on garde le même intent mais on change un param
    if (previousState.intent === 'search_tickets') {
      return { intent: 'search_tickets', params: { period, inheritFrom: previousState } };
    }
    if (previousState.intent === 'report') {
      return { intent: 'report', params: { period, inheritFrom: previousState } };
    }
  }

  if (lower.match(/\b(r[ée]sume|r[ée]sum[ée])\b/)) return { intent: 'summary', params: { period } };
  if (lower.match(/\b(similaire|doublon|m[êe]me (probl[èe]me|incident|sujet)|y a-t-il|d[ée]j[à])\b/)) return { intent: 'similar_tickets', params: { period } };
  // change_status : "passe" seul = changement de statut, mais "mot passe" = recherche de tickets
  if (lower.match(/\b(ferme|clôtur|cloture|r[ée]solu|resolu|change.*statut|met.*statut)\b/) && !lower.match(/\b(mot de passe|mot passe|password)\b/)) return { intent: 'change_status', params: { period } };
  if (lower.match(/\b(passe)\b/) && !lower.match(/\b(mot de passe|mot passe|password|tickets?)\b/)) return { intent: 'change_status', params: { period } };
  if (lower.match(/\b(assigne|affecte|donne.*[àa]|attribue|passe.*[àa])\b/) && !lower.match(/\b(mot de passe|mot passe|password)\b/)) return { intent: 'assign_ticket', params: { period } };
  // search_inventory : uniquement si pas de signalement de problème (problème/panne/ne marche → create_ticket) et pas de demande de stats
  if (lower.match(/\b(inventaire|[ée]quipement|asset|pc portable|imprimante|mat[ée]riel)\b/) && !lower.match(/\b(probl[èe]me|panne|ne marche|fonctionne plus|erreur|assistance|signaler|incident|souci|statistiques?|stats?|analyse)\b/)) return { intent: 'search_inventory', params: { period } };
  // search_users : exclusions pour comparatifs/superlatifs qui vont en analytics
  if (lower.match(/\b(utilisateur|user|email de|t[ée]l[ée]phone de|nom de)\b/) && !lower.match(/\b(plus|moins|top|meilleur|pire|charg[ée]|résout|charge)\b/)) return { intent: 'search_users', params: { period } };
  if (lower.match(/\b(qui est|qui suis)[-\s]?(je)?\b/) && !lower.match(/\b(technicien|technicienne|le plus|la plus|meilleur|pire|charg[ée]|résout)\b/)) return { intent: 'search_users', params: { period } };
  // search_locations : exclusions pour comparatifs/superlatifs qui vont en analytics
  if (lower.match(/\b(lieu|site|o[uù] se trouve|adresse|localisation|magasin\s+(de\s+)?[a-z])\b/) && !lower.match(/\b(plus|moins|top|meilleur|pire|le plus|la plus|comparer|classement)\b/)) return { intent: 'search_locations', params: { period } };
  // Superlatifs / comparatifs sur techniciens/équipes → top_technicians (déterministe) — AVANT search_tickets
  if (lower.match(/\b(quel|quelle|qui|le|la)\b.{0,30}\b(technicien|technicienne)\b.{0,30}\b(plus|moins|top|meilleur|pire|charg[ée]|résout|performant)\b/)) return { intent: 'top_technicians', params: { period } };
  if (lower.match(/\b(quel|quelle|qui|le|la)\b.{0,30}(équipe|equipe).{0,30}\b(plus|moins|top|meilleur|pire|charg[ée]|résout|performant)\b/)) return { intent: 'top_technicians', params: { period } };
  if (lower.match(/\b(plus|moins|top|meilleur|pire)\b.{0,20}\b(technicien|technicienne|équipe|equipe)\b/)) return { intent: 'top_technicians', params: { period } };
  // Superlatifs / comparatifs sur magasins/lieux → top_locations (déterministe) — AVANT search_tickets
  // sinon "quel magasin a le plus de problèmes" est capté par le catch-all search_tickets
  if (lower.match(/\b(quel|quelle|quels|quelles|le|la|les)\b.{0,30}\b(magasin|lieu|site|centre)\b.{0,30}\b(plus|moins|plus grand|plus petit|top|meilleur|pire)\b/)) return { intent: 'top_locations', params: { period } };
  if (lower.match(/\b(magasin|lieu|site)\b.{0,20}\b(fait|fait le plus|a le plus|génère|genere|cause|provoque)\b/)) return { intent: 'top_locations', params: { period } };
  if (lower.match(/\b(classement|classe|ranking|palmar[èe]s|top)\b/) && lower.match(/\b(magasin|lieu|site|centre)\b/)) return { intent: 'top_locations', params: { period } };
  // search_tickets AVANT team_report et analytics : "montre les stats du magasin X" = recherche, pas rapport LLM
  if (lower.match(/\b(quels?|liste|listes|montre|affiche|donne[- ]?moi|cherche|recherche|tous?|toute?)\b/) && lower.match(/\b tickets?\b/)) return { intent: 'search_tickets', params: { period } };
  if (lower.match(/\b(quels?|liste|listes|montre|affiche|donne[- ]?moi|cherche|recherche|tous?|toute?)\b/) && lower.match(/\b(magasin|lieu|site|stats?|statistiques?|incident|probl[èe]me|panne|cat[ée]gorie|technicien|[ée]quipe|historique|d[ée]tail|resume|sommaire)\b/)) return { intent: 'search_tickets', params: { period } };
  if (lower.match(/\b(r[ée]partition|bilan.*quipe|r[ée]union|hebdo|ouverts par)\b/) && !lower.match(/\b tickets?\b/)) return { intent: 'team_report', params: { period } };
  if (lower.match(/\b(magasin|lieu|top|comparer|plus de probl[èe]mes?|statistiques?|stats?|analyse|pourquoi|cause)\b/)) return { intent: 'analytics', params: { period } };
  if (lower.match(/^\s*(oui|yes|go|confirme|c'est bon|vas-y|ok|d'accord|je confirme|oui crée|oui vas)\b/i)) return { intent: 'confirm_create_ticket', params: { period } };
  if (/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident)\b/.test(lower) && /\b(pour|au nom de|pour le compte)\b/.test(lower)) return { intent: 'create_ticket_for', params: { period } };
  // check_ticket AVANT create_ticket : "quand il a été créé", "quel est son statut", "son état"
  if (lower.match(/\b(quand|date|qu'est-ce que|c'est quoi|donne|dis-moi)\b/) && lower.match(/\b(cr[ée][eé]|statut|état|avancement|d[ée]tail|priorit[ée]|assign[ée])\b/)) return { intent: 'check_ticket', params: { period } };
  if (lower.match(/\b(il|elle|ce ticket|celui-ci|celui-là|le ticket)\b/) && lower.match(/\b(statut|état|avancement|cr[ée][eé]|priorit[ée]|assign[ée]|d[ée]tail|lieu|cat[ée]gorie)\b/)) return { intent: 'check_ticket', params: { period } };
  if (lower.match(/\b(statut|état|avancement|suiv[ie]|ticket\s*#?\s*\d+|#\d+|num[ée]ro)\b/)) return { intent: 'check_ticket', params: { period } };
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident|panne|souci|ne marche|fonctionne plus|erreur|assistance)\b/)) return { intent: 'create_ticket', params: { period } };
  if (lower.match(/\b(rapport|synth[èe]se|combien|nombre|total)\b/)) return { intent: 'report', params: { period } };
  if (lower.match(/\b(escalade|technicien|humain|agent|support|parler|[aà] quelqu'un|transfer)\b/)) return { intent: 'escalate', params: { period } };
  if (lower.match(/\b(aide|commandes?|fonctionnalit[ée]s?|que sais|que peux|help|menu)\b/)) return { intent: 'help', params: { period } };
  return { intent: 'general', params: { period } };
}

async function detectIntent(message, previousState = null, conversationHistory = []) {
  // 1. Regex d'abord — instantané, pas d'appel LLM
  const regexResult = detectIntentRegex(message, previousState);
  if (regexResult.intent !== 'general') {
    return regexResult;
  }

  // 2. LLM en fallback uniquement pour les cas ambigus (regex → "general")
  const aiResult = await callIntentAI(message, conversationHistory);
  if (aiResult?.intent) {
    const textPeriod = parsePeriodFromText(message);
    if (textPeriod && !aiResult.params) aiResult.params = {};
    if (textPeriod && !aiResult.params.period) aiResult.params.period = textPeriod;
    return aiResult;
  }

  return regexResult;
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

const STATUS_LABEL = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', WAITING_FOR_USER: 'En attente utilisateur', SOLVED: 'Résolu', CLOSED: 'Fermé' };
const PRIORITY_LABEL = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

async function generateReport(period = null, fullList = false) {
  const where = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, status: { notIn: ['CLOSED', 'SOLVED'] } };

  // Filtrage temporel optionnel
  let dateFilter = {};
  if (period) {
    const { start, end } = resolvePeriodDates(period);
    if (start) dateFilter.gte = start;
    if (end) dateFilter.lt = end;
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
  }

  const baseWhere = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] }, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) };

  const [tickets, openCount, totalAll, resolvedCount, statusCounts, priorityCounts] = await Promise.all([
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
    prisma.ticket.count({ where }),
    prisma.ticket.count({ where: baseWhere }),
    prisma.ticket.count({
      where: {
        deletedAt: null,
        status: { in: ['SOLVED', 'CLOSED'] },
        ...(Object.keys(dateFilter).length > 0 ? { solvedAt: dateFilter } : {}),
      },
    }),
    prisma.ticket.groupBy({ by: ['status'], _count: true, where }),
    prisma.ticket.groupBy({ by: ['priority'], _count: true, where }),
  ]);

  if (openCount === 0 && resolvedCount === 0) return 'Aucun ticket pour cette période.';

  const byStatus = {};
  for (const s of statusCounts) byStatus[s.status] = s._count;
  const byPriority = {};
  for (const p of priorityCounts) byPriority[p.priority] = p._count;

  const periodLabel = period ? ` (${period})` : '';
  let report = `**Rapport${periodLabel}**\n\n`;
  report += `• Total tickets : **${totalAll}**\n`;
  report += `• Ouverts : **${openCount}**\n`;
  report += `• Résolus/Fermés : **${resolvedCount}**\n\n`;

  if (openCount > 0) {
    report += `**Par statut (ouverts) :**\n`;
    for (const [s, c] of Object.entries(byStatus)) report += `• ${STATUS_LABEL[s] || s} : ${c}\n`;
    report += `\n**Par priorité (ouverts) :**\n`;
    for (const [p, c] of Object.entries(byPriority)) report += `• ${PRIORITY_LABEL[p] || p} : ${c}\n`;

    if (fullList) {
      report += `\n**Tous les tickets ouverts (${openCount}) :**\n`;
      report += `| # | Titre | Statut | Priorité | Assigné | Lieu |\n|---|-------|--------|----------|---------|------|\n`;
      for (const t of tickets) {
        report += `| ${t.id} | ${(t.title || '').substring(0, 50)} | ${STATUS_LABEL[t.status] || t.status} | ${PRIORITY_LABEL[t.priority] || t.priority} | ${t.assignedTo?.fullName || '-'} | ${t.locationName || '-'} |\n`;
      }
    } else {
      report += `\n**5 tickets les plus récents :**\n`;
      for (const t of tickets.slice(0, 5)) {
        report += `• **#${t.id}** ${t.title} — ${PRIORITY_LABEL[t.priority] || t.priority} — ${t.assignedTo?.fullName || 'Non assigné'}\n`;
      }
      if (openCount > 5) {
        report += `\n*...et ${openCount - 5} autres. Demandez "liste tous les tickets ouverts" pour voir la liste complète.*\n`;
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
      followups: { orderBy: { createdAt: 'desc' }, take: 5, select: { content: true, createdAt: true, author: { select: { fullName: true } } } },
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

  if (ticket.followups?.length > 0) {
    r += `\n**Derniers commentaires :**\n`;
    for (const c of ticket.followups) {
      r += `• *${c.author?.fullName || 'Inconnu'}* (${new Date(c.createdAt).toLocaleDateString('fr-FR')}) : ${(c.content || '').substring(0, 200)}\n`;
    }
  }
  return r;
}

async function findSimilarTickets(title, description, user = null) {
  const query = `${title || ''} ${description || ''}`.trim();
  if (!query) return [];

  const words = query.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];

  const where = {
    deletedAt: null,
    status: { notIn: ['CLOSED', 'SOLVED'] },
    OR: words.flatMap((w) => [
      { title: { contains: w, mode: 'insensitive' } },
      { content: { contains: w, mode: 'insensitive' } },
    ]),
  };

  // Filtrer par requester pour les non-staff (REQUESTER ne voit que ses tickets)
  if (user && !isStaff(user)) {
    where.requesterId = user.sub;
  }

  return await prisma.ticket.findMany({
    where,
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
    nouveau: 'NEW', ouvert: 'OPEN', attente: 'PENDING', 'attente utilisateur': 'WAITING_FOR_USER',
    résolu: 'SOLVED', resolu: 'SOLVED', fermé: 'CLOSED', ferme: 'CLOSED',
    new: 'NEW', open: 'OPEN', pending: 'PENDING', solved: 'SOLVED', closed: 'CLOSED',
    waiting_for_user: 'WAITING_FOR_USER',
  };

  const normalized = STATUS_MAP[newStatus.toLowerCase()];
  if (!normalized) return { error: `Statut "${newStatus}" non reconnu. Valeurs possibles : nouveau, ouvert, attente, attente utilisateur, résolu, fermé.` };

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

async function createTicketFromChat(title, description, priority, userId, { teamId = null, assignedToId = null, category = null } = {}) {
  const ticket = await prisma.ticket.create({
    data: {
      title,
      content: description,
      priority: priority || 'P3',
      status: assignedToId ? 'OPEN' : 'NEW',
      source: 'Chatbot',
      origin: 'CHATBOT',
      requesterId: userId,
      createdById: userId,
      type: 'INCIDENT',
      approvalStatus: 'PENDING',
      teamId: teamId || null,
      assignedToId: assignedToId || null,
      category: category || null,
    },
  });
  emitTicketCreated(ticket);
  // Notification aux boîtes configurées dans les Paramètres (best-effort, non bloquant)
  // Uniquement si le ticket est approuvé — sinon on attend l'approbation (ticketApproval.js)
  if (ticket.approvalStatus === 'APPROVED') {
    sendTicketCreationNotification(ticket).catch((err) =>
      console.error('[chatbot] Notification création ticket échouée:', err.message)
    );
  }
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
  if (ticket.approvalStatus === 'APPROVED') {
    sendTicketCreationNotification(ticket).catch((err) =>
      console.error('[chatbot] Notification escalade échouée:', err.message)
    );
  }
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

// ── Message handler ────────────────────────────────────────────────────

async function handleMessage(message, conversationHistory = [], user = null, pendingTicketData = null, conversationId = null) {
  const userId = user?.sub || null;
  // Clé d'état conversationnel : PAR CONVERSATION (pas par user) sinon les conversations
  // d'un même utilisateur se polluent entre elles (filtres hérités d'une autre conversation).
  const stateKey = conversationId ? `conv:${conversationId}` : `user:${userId}`;
  const _stepLog = (step, detail) => console.log(`[chatbot] handleMessage step=${step} ${detail || ''}`);

  _stepLog('start', `msg="${message.substring(0, 80)}" userId=${userId} historyLen=${conversationHistory.length}`);
  let intent, params;

  // ── Petit talk (salutations, remerciements) : réponse directe, zéro recherche, zéro classification ──
  // Évite 2-3 appels LLM + requêtes DB inutiles pour un simple "bonjour"
  if (isGreetingMessage(message)) {
    _stepLog('greeting', 'direct reply');
    return {
      reply: GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)],
      intent: 'general',
      action: null,
      widget: null,
      sources: [],
      citedTicketIds: [],
      citedKnowledgeIds: [],
      pendingTicketData: null,
    };
  }

  // Récupérer le state conversationnel précédent (isolé par conversation)
  const previousState = getConversationState(stateKey);
  _stepLog('context', `prevIntent=${previousState?.intent || 'none'} prevTickets=${previousState?.tickets?.length || 0}`);

  try {
    const intentResult = await detectIntent(message, previousState, conversationHistory);
    intent = intentResult.intent;
    params = intentResult.params;
    _stepLog('intent', `intent=${intent} params=${JSON.stringify(params || {})}`);
  } catch (intentErr) {
    _stepLog('intent-error', intentErr.message);
    throw intentErr;
  }

  // Contexte utilisateur
  let userContext;
  try {
    userContext = await getUserContext(userId);
    _stepLog('userContext', `len=${(userContext || '').length}`);
  } catch (ucErr) {
    _stepLog('userContext-error', ucErr.message);
    userContext = '';
  }

  // Recherche simultanée : RAG + Tickets + (selon intent) inventaire/users/locations
  _stepLog('searches', `intent=${intent}`);

  const searches = [
    searchKnowledge(message, 8),
    params?.inheritFrom
      ? searchTicketsWithContext(message, 20, user, params.period, params.inheritFrom)
      : searchTickets(message, 20, user, params?.period),
  ];

  if (intent === 'search_inventory') searches.push(searchAssets(params?.keyword || message, 5));
  else searches.push(Promise.resolve([]));

  if (intent === 'search_users') searches.push(searchUsers(params?.personName || message, 5));
  else searches.push(Promise.resolve([]));

  if (intent === 'search_locations') searches.push(searchLocations(params?.locationName || message, 10));
  else searches.push(Promise.resolve([]));

  const [knowledgeChunks, ticketsResult, assets, users, locations] = await Promise.all(searches);
  _stepLog('searches-done', `knowledge=${knowledgeChunks.length} tickets=${ticketsResult.tickets?.length || ticketsResult.length || 0} total=${ticketsResult.totalCount ?? '?'} assets=${assets.length} users=${users.length} locations=${locations.length}`);

  const matchingTickets = ticketsResult.tickets || ticketsResult; // compat: array ou { tickets, totalCount }
  const totalTicketCount = ticketsResult.totalCount ?? matchingTickets.length;

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
    let ticketContext = `**Tickets pertinents trouvés (${totalTicketCount}) :**\n`;
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
  } else if (!DETERMINISTIC_INTENTS.has(intent) && !['general', 'create_ticket', 'create_ticket_for', 'confirm_create_ticket'].includes(intent)) {
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

  _stepLog('pre-switch', `intent=${intent} contextParts=${contextParts.length}`);

  switch (intent) {
    case 'analytics': {
      const lower = message.toLowerCase();
      const kwMatch = message.match(/\b(asten|caisse|vpn|réseau|reseau|imprimante|telephonie|logiciel)\b/i);
      const kw = params?.keyword || (kwMatch ? kwMatch[1] : null);

      // Si un nom de personne est mentionné → stats technicien (staff only)
      if (params?.personName || (lower.match(/\b(perf|performance|stats|statistiques)\b/) && lower.match(/\b([A-Z][a-z]+)\b/))) {
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
        const period = params?.period || 'all';

        // Stats par lieu
        const stats = await analyticsTools.getTopLocationsStats({ filterKeyword: kw, period, limit: 5, sortByUrgent: wantsUrgent });

        // Stats par catégorie (si un mot-clé est fourni)
        let categoryStats = null;
        if (kw) {
          categoryStats = await analyticsTools.getCategoryDistribution({ filterKeyword: kw, period, limit: 6 });
        }

        if (stats.rankings.length > 0) {
          widget = {
            type: 'chart',
            chartType: 'bar',
            title: `📊 Top Magasins / Lieux ${kw ? `(Filtre: ${kw})` : ''}`,
            data: stats.chartData,
            columns: ['name', 'Tickets', 'Urgents'],
            rankings: stats.rankings,
          };

          let statsText = `**Analyse statistique${kw ? ` pour "${kw}"` : ''} :**\n\n`;

          // Afficher les stats par catégorie si disponibles
          if (categoryStats && categoryStats.categories.length > 0) {
            statsText += `**Par catégorie :**\n`;
            for (const cat of categoryStats.categories) {
              statsText += `• ${cat.name} : ${cat.count} tickets\n`;
            }
            statsText += `\n`;
          }

          // Stats par lieu
          statsText += `**Par lieu :**\n`;
          for (const r of stats.rankings) {
            statsText += `• **#${r.rank} ${r.locationName}** — ${r.totalTickets} tickets (${r.percentage}%, ${r.urgentTickets} urgents)\n`;
          }
          contextParts.push(statsText);
        } else if (categoryStats && categoryStats.categories.length > 0) {
          // Pas de stats par lieu, mais on a des stats par catégorie
          let statsText = `**Analyse statistique${kw ? ` pour "${kw}"` : ''} :**\n\n`;
          statsText += `**Par catégorie :**\n`;
          for (const cat of categoryStats.categories) {
            statsText += `• ${cat.name} : ${cat.count} tickets\n`;
          }
          contextParts.push(statsText);
        }
      }
      break;
    }

    case 'top_locations': {
      const period = params?.period || 'all';
      const startDate = period === 'all' ? null : (
        period === 'today' ? new Date(new Date().setHours(0,0,0,0)) :
        period === '7d' ? new Date(Date.now() - 7*86400000) :
        period === '30d' ? new Date(Date.now() - 30*86400000) :
        period === '90d' ? new Date(Date.now() - 90*86400000) : null
      );
      const where = {};
      if (startDate) where.createdAt = { gte: startDate };
      const tickets = await prisma.ticket.findMany({
        where,
        select: { id: true, priority: true, status: true, locationName: true },
      });
      const locationMap = new Map();
      for (const t of tickets) {
        const loc = t.locationName || 'Non spécifié';
        if (!locationMap.has(loc)) locationMap.set(loc, { total: 0, urgent: 0, byStatus: {} });
        const item = locationMap.get(loc);
        item.total++;
        if (t.priority === 'P1' || t.priority === 'P2') item.urgent++;
        item.byStatus[t.status] = (item.byStatus[t.status] || 0) + 1;
      }
      const ranked = [...locationMap.entries()]
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      if (ranked.length === 0) {
        contextParts.push(`**Aucun ticket trouvé** pour cette période.`);
        break;
      }
      const totalTickets = ranked.reduce((s, r) => s + r.total, 0);
      let txt = `**Classement des lieux** (${tickets.length} tickets, ${period === 'all' ? 'toutes périodes' : period})\n\n`;
      txt += `| Rang | Lieu | Tickets | Urgents | % |\n|---|---|---|---|---|\n`;
      for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i];
        const pct = Math.round((r.total / tickets.length) * 100);
        txt += `| ${i+1} | ${r.name} | ${r.total} | ${r.urgent} | ${pct}% |\n`;
      }
      contextParts.push(txt);
      break;
    }

    case 'top_technicians': {
      const period = params?.period || 'all';
      const startDate = period === 'all' ? null : (
        period === 'today' ? new Date(new Date().setHours(0,0,0,0)) :
        period === '7d' ? new Date(Date.now() - 7*86400000) :
        period === '30d' ? new Date(Date.now() - 30*86400000) :
        period === '90d' ? new Date(Date.now() - 90*86400000) : null
      );
      const where = {};
      if (startDate) where.createdAt = { gte: startDate };
      const tickets = await prisma.ticket.findMany({
        where,
        select: { id: true, priority: true, status: true, assignedToId: true, assignedTo: { select: { fullName: true } } },
      });
      const techMap = new Map();
      for (const t of tickets) {
        const name = t.assignedTo?.fullName || 'Non assigné';
        if (!techMap.has(name)) techMap.set(name, { total: 0, resolved: 0, urgent: 0 });
        const item = techMap.get(name);
        item.total++;
        if (t.status === 'SOLVED' || t.status === 'CLOSED') item.resolved++;
        if (t.priority === 'P1' || t.priority === 'P2') item.urgent++;
      }
      const ranked = [...techMap.entries()]
        .map(([name, data]) => ({ name, rate: data.total > 0 ? Math.round((data.resolved / data.total) * 100) : 0, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      if (ranked.length === 0) {
        contextParts.push(`**Aucun ticket trouvé** pour cette période.`);
        break;
      }
      let txt = `**Classement des techniciens** (${tickets.length} tickets, ${period === 'all' ? 'toutes périodes' : period})\n\n`;
      txt += `| Rang | Technicien | Tickets | Résolus | Taux | Urgents |\n|---|---|---|---|---|---|\n`;
      for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i];
        txt += `| ${i+1} | ${r.name} | ${r.total} | ${r.resolved} | ${r.rate}% | ${r.urgent} |\n`;
      }
      contextParts.push(txt);
      break;
    }

    case 'check_ticket': {
      let tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      // Si pas de numéro dans le message, chercher dans l'historique conversationnel
      if (!tid && conversationHistory.length > 0) {
        const lastUserMsgs = conversationHistory.filter(m => m.role === 'user');
        for (const m of lastUserMsgs.reverse()) {
          const match = m.content.match(/#?(\d+)/);
          if (match) { tid = match[1]; break; }
        }
        // Aussi chercher dans la réponse précédente du bot (ex: "Ticket 63", "#63")
        if (!tid) {
          const lastBotMsgs = conversationHistory.filter(m => m.role === 'assistant');
          for (const m of lastBotMsgs.reverse()) {
            const match = m.content.match(/(?:ticket|#)\s*(\d+)/i);
            if (match) { tid = match[1]; break; }
          }
        }
      }
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
      let tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      // Si pas de numéro dans le message, chercher dans l'historique conversationnel
      if (!tid && conversationHistory.length > 0) {
        const lastUserMsgs = conversationHistory.filter(m => m.role === 'user');
        for (const m of lastUserMsgs.reverse()) {
          const match = m.content.match(/#?(\d+)/);
          if (match) { tid = match[1]; break; }
        }
        if (!tid) {
          const lastBotMsgs = conversationHistory.filter(m => m.role === 'assistant');
          for (const m of lastBotMsgs.reverse()) {
            const match = m.content.match(/(?:ticket|#)\s*(\d+)/i);
            if (match) { tid = match[1]; break; }
          }
        }
      }
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
      const similar = await findSimilarTickets(title, description, user);
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
      const person = params?.personName || message.match(/(?:à|a)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/)?.[1];
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
      const similar = await findSimilarTickets(ticketTitle, ticketDesc, user);

      // Suggérer équipe et technicien basé sur le contenu
      let suggestedTeam = null;
      let suggestedTechnician = null;
      let suggestedCategory = null;
      let suggestedCategoryId = null;
      try {
        // Charger les catégories depuis la base et détecter la plus appropriée
        const allCategories = await prisma.ticketCategory.findMany({ select: { id: true, name: true, parentId: true } });
        const textToSearch = (ticketTitle + ' ' + ticketDesc).toLowerCase();
        
        // Mots-clés de fallback si aucune catégorie ne matche par nom
        const categoryKeywords = {
          'Réseau': /\b(vpn|réseau|reseau|dns|wifi|switch|pare-feu|firewall|ip|internet|connection)\b/i,
          'Matériel': /\b(imprimante|écran|clavier|souris|pc|ordinateur|disque dur|ssd|scanner)\b/i,
          'Sécurité': /\b(phishing|virus|antivirus|mot de passe|ssl|certificat|sécurite| sécurité)\b/i,
          'Système': /\b(windows|linux|serveur|ad|active directory|sauvegarde|profil|installation)\b/i,
          'Logiciel': /\b(office|outlook|sage|logiciel|license|mise à jour|update)\b/i,
          'Téléphonie': /\b(téléphone|phone|voip|standard|appel|extension)\b/i,
          'Applicatif': /\b(erp|application|api|module|import|export|rapport|dashboard)\b/i,
        };

        // 1. Essayer de matcher par nom de catégorie (insensible à la casse)
        for (const cat of allCategories) {
          const catNameLower = cat.name.toLowerCase();
          if (textToSearch.includes(catNameLower)) {
            suggestedCategory = cat.name;
            suggestedCategoryId = cat.id;
            break;
          }
        }

        // 2. Si pas de match par nom, utiliser les mots-clés de fallback
        if (!suggestedCategory) {
          for (const [catName, regex] of Object.entries(categoryKeywords)) {
            if (regex.test(textToSearch)) {
              // Chercher la catégorie correspondante en base
              const matchCat = allCategories.find((c) => c.name.toLowerCase() === catName.toLowerCase());
              if (matchCat) {
                suggestedCategory = matchCat.name;
                suggestedCategoryId = matchCat.id;
              } else {
                suggestedCategory = catName;
              }
              break;
            }
          }
        }

        // 3. Chercher le meilleur technicien pour cette catégorie
        const { team, technician } = await require('./ticketAutoAssign').findBestTechnician(suggestedCategory, suggestedCategory);
        suggestedTeam = team;
        suggestedTechnician = technician;
      } catch (err) {
        console.warn('[chatbot] Suggestion équipe/technicien échouée:', err.message);
      }

      let confirmMsg = `**Création de ticket**\n\n`;
      confirmMsg += `**Sujet :** ${ticketTitle}\n`;
      confirmMsg += `**Description :** ${ticketDesc.substring(0, 300)}${ticketDesc.length > 300 ? '...' : ''}\n`;
      confirmMsg += `**Priorité :** ${PRIORITY_LABEL[ticketPriority] || ticketPriority}\n`;
      if (suggestedCategory) confirmMsg += `**Catégorie :** ${suggestedCategory}\n`;
      if (suggestedTeam) confirmMsg += `**Équipe suggérée :** ${suggestedTeam.name}\n`;
      if (suggestedTechnician) confirmMsg += `**Technicien suggéré :** ${suggestedTechnician.fullName}\n`;
      confirmMsg += `**Demandeur :** ${user?.fullName || 'Vous'}\n`;
      confirmMsg += `**Source :** Chatbot\n\n`;

      if (similar.length > 0) {
        confirmMsg += `⚠️ **Attention, des tickets similaires existent déjà :**\n`;
        for (const t of similar.slice(0, 3)) {
          confirmMsg += `• **#${t.id}** ${t.title} — ${STATUS_LABEL[t.status] || t.status}\n`;
        }
        confirmMsg += `\n`;
      }

      confirmMsg += `**Voulez-vous que je crée ce ticket ?** Répondez "oui" pour confirmer.`;

      // Stocker les données en attente (avec équipe et technicien suggérés)
      pendingTicket = {
        title: ticketTitle,
        description: ticketDesc,
        priority: ticketPriority,
        teamId: suggestedTeam?.id || null,
        teamName: suggestedTeam?.name || null,
        assignedToId: suggestedTechnician?.id || null,
        assignedToName: suggestedTechnician?.fullName || null,
        category: suggestedCategory || null,
        categoryId: suggestedCategoryId || null,
      };
      contextParts.push(confirmMsg);
      break;
    }

    case 'confirm_create_ticket': {
      // L'utilisateur confirme → créer le ticket avec les données en attente
      const dataToCreate = pendingTicketData || pendingTicket;
      if (dataToCreate) {
        try {
          const ticket = await createTicketFromChat(dataToCreate.title, dataToCreate.description, dataToCreate.priority, userId, {
            teamId: dataToCreate.teamId || null,
            assignedToId: dataToCreate.assignedToId || null,
            category: dataToCreate.category || null,
          });
          action = { type: 'ticket_created', ticketId: ticket.id };
          let successMsg = `✅ **Ticket créé avec succès :**\n\n**#${ticket.id}** — ${ticket.title}\n`;
          successMsg += `**Priorité :** ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\n`;
          if (dataToCreate.teamName) successMsg += `**Équipe :** ${dataToCreate.teamName}\n`;
          if (dataToCreate.assignedToName) successMsg += `**Technicien :** ${dataToCreate.assignedToName}\n`;
          successMsg += `**Demandeur :** ${user?.fullName || 'Vous'}\n`;
          successMsg += `**Source :** Chatbot\n\nLe ticket passe par le centre de validation avant d'être traité.`;
          contextParts.push(successMsg);
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
  // ── Classification intents info vs action ──
  const ACTION_INTENTS = new Set([
    'create_ticket', 'create_ticket_for', 'confirm_create_ticket',
    'change_status', 'assign_ticket', 'escalate',
  ]);

  const isActionIntent = ACTION_INTENTS.has(intent);

  // ── Construire le contexte système ──
  const systemContext = contextParts.length > 0 ? `\n\n${contextParts.join('\n\n')}` : '';

  // ── Récupérer le modèle vocal configuré (optionnel) ──
  let voiceModelOptions = {};
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (settings?.voiceAiModelId) {
      voiceModelOptions = { forcedModelId: settings.voiceAiModelId };
    }
  } catch {}

  // ── Le contexte RAG va dans le system prompt, le message user reste propre ──
  const fullSystemPrompt = SYSTEM_PROMPT + systemContext;

  let reply;
  let citedTicketIds = [];
  let citedKnowledgeIds = [];

  _stepLog('pre-llm', `isAction=${isActionIntent} contextLen=${systemContext.length}`);

  // ═══ TOUJOURS passer par le LLM pour une réponse naturelle ═══
  try {
    const raw = await callAI(
      [{ role: 'user', content: message }],
      {
        ...voiceModelOptions,
        conversationHistory,
        forcedSystem: fullSystemPrompt,
      }
    );

    reply = cleanAiReply(raw);
    _stepLog('llm-free', `replyLen=${reply.length}`);
  } catch (err) {
    // Fallback dégradé mais UTILE : si on a des données déterministes, on les renvoie telles quelles
    // au lieu d'un message d'erreur générique. Sinon message d'attente court.
    console.error('[chatbot] Échec appel LLM:', err.message);
    const deterministicData = contextParts.filter((p) => p.length > 30).join('\n\n');
    reply = deterministicData
      ? deterministicData
      : "Je rencontre un souci temporaire d'accès aux services IA. Réessayez dans quelques instants.";
  }

  // Extraire les citedTicketIds du contexte si disponibles
  if (matchingTickets.length > 0) {
    citedTicketIds = matchingTickets.map(t => t.id);
  }

  _stepLog('done', `intent=${intent} replyLen=${(reply || '').length} action=${action?.type || 'null'} citedTickets=${citedTicketIds.length}`);

  // Sauvegarder le state conversationnel pour le multi-turn (isolé par conversation)
  if (userId && ['search_tickets', 'report', 'analytics', 'check_ticket', 'team_report', 'search_inventory', 'search_users', 'search_locations'].includes(intent)) {
    setConversationState(stateKey, intent, params, matchingTickets.map(t => ({ id: t.id, title: t.title, status: t.status })));
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


module.exports = { handleMessage };
