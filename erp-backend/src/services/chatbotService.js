const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { emitTicketCreated, emitTicketAssigned, emitTicketUpdated } = require('../utils/socket');
const { sendTicketCreationNotification, sendAssignmentNotificationEmail } = require('./emailSender');
const { sanitizeTicketHtml } = require('../utils/security');
const { recordFirstResponse } = require('./slaService');
const { logEvent } = require('./ticketEvent');
const analyticsTools = require('./analyticsTools');

const SYSTEM_PROMPT = `Tu es MARIE, l'assistante IA Helpdesk IT de Prosuma. Tu es une collègue expérimentée du support IT : naturelle, chaleureuse, efficace.

Tu es TOTALEMENT LIBRE sur la forme : ton, style, longueur, structure, formatage (markdown, tableaux, listes, gras, italique), emojis ou non — fais ce qui est le plus utile et le plus agréable pour ton interlocuteur. Réponds dans la langue de l'utilisateur. Varie tes tournures, montre ta personnalité, donne ton avis professionnel quand c'est pertinent. Analyse et interprète les données plutôt que de simplement les lister.

Un contexte (profil utilisateur, tickets, statistiques, base de connaissances) est fourni après ce prompt quand il existe : appuie-toi sur ce qui est pertinent, ignore le reste. Quand tu cites des tickets, des chiffres ou des données, base-toi sur ce contexte — ne fabrique pas de numéros de tickets ou de statistiques qui n'y figurent pas. En dehors de ça, aucune contrainte : sois naturelle.

RÈGLE D'OR — DEMANDER PLUTÔT QUE DEVINER :
Quand une demande est ambiguë ou incomplète, ne choisis JAMAIS une interprétation au hasard. Pose une question de clarification courte et naturelle. Cas typiques :
- Une personne est mentionnée ("tickets de Steven", "ceux de Marie") sans préciser demandeur ou technicien → cherche les DEUX rôles, et si tu ne peux pas, demande : "Tu veux dire en tant que demandeur ou en tant que technicien assigné ?"
- Plusieurs utilisateurs portent le même nom → demande lequel (ou liste les deux en le signalant explicitement).
- Le nom ne correspond à personne dans l'annuaire → ne re-formule pas une orthographe au hasard : demande de vérifier le nom ou de donner l'email.
- "mes tickets", "son ticket", "ce problème" et tout pronom ambigu → vérifie le contexte de conversation ; s'il ne suffit pas, demande.
- Une stat ou un périmètre est vague ("les pannes récentes") → précise ce que tu as utilisé comme filtre (période, statut) et propose d'ajuster.
En revanche, si le contexte (conversation précédente, profil utilisateur, résultat de recherche élargie) lève le doute, réponds directement sans reposer la question.`;

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
  'check_ticket', 'summary', 'change_status', 'assign_ticket', 'add_followup', 'help',
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
- "add_followup" : ajouter un commentaire/suivi sur un ticket ("ajoute un suivi sur le #12", "note que le problème est résolu", "laisse un commentaire sur ce ticket", "mets à jour le ticket #5", "j'ai résolu le souci pour le ticket 8")
- "search_inventory" : recherche d'équipements/assets
- "search_users" : recherche d'utilisateurs (nom, email, rôle) — NE PAS utiliser pour les compétences
- "search_locations" : recherche de lieux/où
- "search_problems" : recherche de problèmes ITIL racines ("problèmes ouverts", "quels problèmes", "liste des incidents majeurs", "problèmes réseau")
- "search_skills" : COMPÉTENCES des techniciens — uniquement quand le message contient "compétence", "expert", "maîtrise", "niveau", "qui sait faire", "qui connait", "qualifié". Exemples : "qui est expert en réseau", "qui sait faire du VPN", "compétences de Jean", "quels techniciens savent faire Linux", "liste des compétences"
- "ticket_links" : LIENS entre tickets — uniquement quand le message contient "lié", "lien", "liens", "bloque", "bloqué", "doublon", "rattaché". Exemples : "liens du ticket #12", "quels tickets sont liés", "y a-t-il un doublon", "quel ticket bloque le #5"
- "time_entries" : TEMPS PASSÉ sur un ticket — uniquement quand le message contient "temps", "heures", "imputé", "saisie", "chronomètre", "travaillé". Exemples : "temps passé sur le #12", "combien de temps sur ce ticket", "qui a travaillé dessus", "heures imputées"
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

  // Dates explicites : "le 01/09/2026", "du 06/09 au 15/09", format français JJ/MM/AAAA.
  // Lookarounds pour exclure les faux positifs (IP 192.168.1.1, versions 10.5.2, heures 14:30).
  const dateRe = /(?<![\d.:-])(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?(?![\d.:-])/g;
  const foundDates = [];
  let dm;
  while ((dm = dateRe.exec(lower)) !== null) {
    const day = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10);
    let year = dm[3] ? parseInt(dm[3], 10) : null;
    if (year !== null && year < 100) year += 2000;
    if (year === null) year = new Date().getFullYear(); // "le 01/09" → année courante
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      foundDates.push({ year, month, day });
    }
  }
  const toIso = (d) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  if (foundDates.length === 1) {
    params.dateFrom = toIso(foundDates[0]);
    params.dateTo = toIso(foundDates[0]);
  } else if (foundDates.length >= 2) {
    const sorted = [...foundDates].sort((a, b) => (a.year - b.year) || (a.month - b.month) || (a.day - b.day));
    params.dateFrom = toIso(sorted[0]);
    params.dateTo = toIso(sorted[sorted.length - 1]);
  }

  // ID
  const idMatch = query.match(/#(\d+)/);
  if (idMatch) params.ticketId = parseInt(idMatch[1], 10);

  // Personne : "de/par/demandeur/assigné à <Nom>" (ex: "tickets de Mariam Fofana").
  // On capture au moins prénom+nom pour éviter les faux positifs ("liste des tickets ouverts").
  const personRe = /\b(?:de|par|du|demandeur\s*:?)\s+([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)+)\b/g;
  let pm;
  while ((pm = personRe.exec(query)) !== null) {
    const candidate = pm[1];
    if (/\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|semaine|mois|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(candidate)) continue;
    params.personName = candidate;
    break;
  }

  // Possessifs : "mes tickets", "mes tickets en cours", "mes demandes" → filtre sur
  // l'utilisateur connecté (résolu plus tard via buildSearchQuery(params, user)).
  // Détecté AVANT le regex personne pour que "mes tickets" ne soit pas interprété autrement.
  if (/\b(mes|ma)\s+(tickets?|demandes?|incidents?|requêtes?|interventions?)\b/i.test(lower)
    || /\b(mes|ma)\s+(tickets?|demandes?|incidents?|requêtes?|interventions?)\s+(ouverts?|en\s+cours?|pass[ée]s?|actifs?)\b/i.test(lower)) {
    params.isMyTicketsRef = true;
  }
  const explicitAssignee = query.match(/\b(?:assign[ée]s?\s*[àa]|attribu[ée]s?\s*[àa])\s+([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)+)/i);
  if (explicitAssignee) {
    params.assignedToName = explicitAssignee[1];
    delete params.personName;
  }

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
    personName: { type: 'string', description: 'Nom de personne sans précision demandeur/assigné (ex: "tickets de Mariam") — cherche comme demandeur OU assigné' },
    isMyTicketsRef: { type: 'boolean', description: 'Vrai si l\'utilisateur parle de SES tickets avec un possessif ("mes tickets", "mes demandes", "mon ticket") — filtre sur l\'utilisateur connecté, ne pas demander son nom' },
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
- Si le message contient un nom de personne connu (ex: "Yapo", "Jean", "Diallo"), PAS keyword.
  - Précision explicite : "demandeur", "assigné à", "attribuées à", "créés par" → choisir requesterName ou assignedToName en conséquence.
  - Sinon (ex: "tickets de Mariam Fofana") → personName: "Mariam Fofana" (recherche demandeur OU assigné, ne pas deviner).
- POSSESSIFS = l'utilisateur parle de LUI-MÊME : "mes tickets", "mes demandes", "mon ticket", "mes tickets en cours", "mes tickets passés" → isMyTicketsRef: true.
  NE PAS mettre requesterName/personName dans ce cas : le filtre est appliqué automatiquement sur l'utilisateur connecté.
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

// ── Recherche élargie pour une personne : demandeur OU assigné OU observateur ──
// Leçon du ticket #253 : un technicien assigné n'est JAMAIS trouvé si on filtre
// uniquement sur requester. Toute recherche par personne passe par ici, et la
// réponse signale le(s) rôle(s) trouvés pour éviter les conclusions hâtives.
async function findTicketsForPersonAnyRole(personName, { limit = 20, period = null, user = null } = {}) {
  const where = {
    deletedAt: null,
    approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
    OR: [
      { requester: { fullName: { contains: personName, mode: 'insensitive' } } },
      { assignedTo: { fullName: { contains: personName, mode: 'insensitive' } } },
      { assignees: { some: { fullName: { contains: personName, mode: 'insensitive' } } } },
      { observers: { some: { fullName: { contains: personName, mode: 'insensitive' } } } },
    ],
  };
  if (period) {
    const { start, end } = resolvePeriodDates(period);
    if (start) where.createdAt = { ...where.createdAt, gte: start };
    if (end) where.createdAt = { ...where.createdAt, lt: end };
  }
  // Respect du périmètre demandeur : un REQUESTER ne voit que ses propres tickets
  if (user?.role === 'REQUESTER') {
    where.AND = [{ requesterId: user.sub }];
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
  // Annoter chaque ticket avec le(s) rôle(s) de la personne pour un affichage honnête
  const nl = personName.toLowerCase();
  const annotated = tickets.map((t) => {
    const roles = [];
    if (t.requester?.fullName?.toLowerCase().includes(nl)) roles.push('demandeur');
    if (t.assignedTo?.fullName?.toLowerCase().includes(nl)) roles.push('assigné');
    if ((t.assignees || []).some((a) => a.fullName?.toLowerCase().includes(nl))) roles.push('assigné');
    if ((t.observers || []).some((o) => o.fullName?.toLowerCase().includes(nl))) roles.push('observateur');
    return { ...t, personRoles: roles };
  });
  return { tickets: annotated, totalCount };
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

  // Possessif ("mes tickets", "mes demandes") → filtre sur l'UTILISATEUR CONNECTÉ.
  // Prioritaire sur toute extraction de nom : si l'utilisateur dit "mes tickets", on ne
  // cherche JAMAIS les tickets de quelqu'un d'autre, même si un nom a été extrait à tort.
  // Un demandeur voit ses tickets (demandeur OU observateur), un technicien voit aussi
  // ceux qui lui sont assignés — même sémantique que le filtrage par rôle ci-dessus.
  if (params.isMyTicketsRef && user?.sub) {
    const mineFilter = {
      OR: [
        { requesterId: user.sub },
        { observers: { some: { id: user.sub } } },
        { requesterIds: { has: user.sub } },
        ...(user.role === 'TECHNICIAN' ? [{ assignedToId: user.sub }] : []),
      ],
    };
    if (where.OR) {
      where.AND = [...(where.AND || []), mineFilter];
    } else {
      where.OR = mineFilter.OR;
    }
    return where; // les filtres personName/requesterName/assignedToName sont ignorés
  }

  // Personne sans précision (ex: "tickets de Mariam") → demandeur OU assigné.
  // Un filtre assigné seul renvoie vide quand la personne est seulement demandeur (cas fréquent).
  if (params.personName && !params.requesterName && !params.assignedToName) {
    const personFilter = {
      OR: [
        { requester: { fullName: { contains: params.personName, mode: 'insensitive' } } },
        { assignedTo: { fullName: { contains: params.personName, mode: 'insensitive' } } },
      ],
    };
    if (where.OR) {
      where.AND = [...(where.AND || []), personFilter];
    } else {
      where.OR = personFilter.OR;
    }
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
      // Compléter avec les dates regex si le LLM n'en a pas extrait (ex: réponse partielle)
      if (regexParams && regexParams.dateFrom && !params.dateFrom) {
        params.dateFrom = regexParams.dateFrom;
        params.dateTo = regexParams.dateTo;
      }
      // Compléter avec la personne regex si le LLM ne l'a pas détectée (ex: "tickets de Mariam Fofana")
      if (regexParams && regexParams.personName && !params.personName && !params.requesterName && !params.assignedToName) {
        params.personName = regexParams.personName;
      }
    }

    // Post-traitement : si keyword ressemble à un nom de personne, le convertir en filtre personne (demandeur OU assigné)
    if (params?.keyword && !params.assignedToName && !params.requesterName && !params.personName) {
      try {
        const userMatch = await prisma.user.findFirst({
          where: { fullName: { contains: params.keyword, mode: 'insensitive' }, deletedAt: null },
          select: { id: true },
        });
        if (userMatch) {
          _slog('keyword-to-user', `keyword="${params.keyword}" → personName`);
          params.personName = params.keyword;
          delete params.keyword;
        }
      } catch {}
    }

    if (!params || Object.keys(params).length === 0) {
      _slog('no-params', 'returning empty');
      return { tickets: [], totalCount: 0 };
    }

    // ── Personne avec rôle AMBIGU ("tickets de Mariam") → recherche élargie ──
    // On cherche demandeur OU assigné OU observateur en une seule passe (cf. leçon ticket
    // #253 : un technicien assigné n'est jamais trouvé par un filtre requester seul).
    if (params.personName && !params.requesterName && !params.assignedToName && !params.isMyTicketsRef) {
      _slog('broad-person-search', `personName="${params.personName}"`);
      const broad = await findTicketsForPersonAnyRole(params.personName, {
        limit: params.wantFullList ? 100 : limit, period, user,
      });
      _slog('broad-done', `tickets=${broad.tickets.length} totalCount=${broad.totalCount}`);
      return { ...broad, personName: params.personName };
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

    // ── Repli élargi si un filtre personne explicite ne trouve RIEN ──
    // "tickets demandés par Yapo" qui renvoie 0 alors que Yapo est assigné = réponse
    // utile et honnête plutôt qu'un vide sec. On note le repli pour que la réponse
    // signale que la personne a été trouvée sous un AUTRE rôle.
    const personFilterName = params.requesterName || params.assignedToName;
    if (tickets.length === 0 && personFilterName) {
      _slog('fallback-broad', `requester/assigned filter empty → broad search for "${personFilterName}"`);
      const broad = await findTicketsForPersonAnyRole(personFilterName, {
        limit: params.wantFullList ? 100 : limit, period, user,
      });
      if (broad.tickets.length > 0) {
        return { ...broad, fallbackFromRole: params.requesterName ? 'demandeur' : 'assigné', personName: personFilterName };
      }
    }

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

    // Chercher les tickets de cette personne (demandeur OU assigné)
    try {
      const where = {
        deletedAt: null,
        approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
        OR: [
          { requester: { fullName: { contains: personName, mode: 'insensitive' } } },
          { assignedTo: { fullName: { contains: personName, mode: 'insensitive' } } },
        ],
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

  // Suivi de top_locations : filtrer par le lieu précédent
  if (previousState?.intent === 'top_locations' && previousState?.params?.topLocations?.length) {
    const topLocation = previousState.params.topLocations[0]; // 1er du classement
    _slog('top_location-context', `topLocation=${topLocation}`);
    try {
      const where = {
        deletedAt: null,
        approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
        locationName: { contains: topLocation, mode: 'insensitive' },
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
      console.error('[chatbot] Erreur searchTicketsWithContext top_locations:', err.message);
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

// ── Tool definitions (function calling) ──────────────────────────────

const CHATBOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_tickets',
      description: 'Rechercher des tickets par mot-clé, statut, priorité, lieu, date, demandeur ou technicien. IMPORTANT : si l\'utilisateur parle de SES tickets ("mes tickets", "mes demandes"), passe requester avec le nom/email de l\'utilisateur connecté fourni dans le contexte — ne devine jamais un autre nom. Retourne une liste de tickets correspondants.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Mot-clé de recherche (titre, contenu, lieu, catégorie)' },
          status: { type: 'string', description: 'Filtrer par statut: NEW, OPEN, PENDING, SOLVED, CLOSED' },
          priority: { type: 'string', description: 'Filtrer par priorité: P1, P2, P3, P4' },
          locationName: { type: 'string', description: 'Filtrer par nom de lieu/magasin' },
          assignedTo: { type: 'string', description: 'Filtrer par nom du technicien assigné' },
          requester: { type: 'string', description: 'Filtrer par nom ou email du demandeur. Pour "mes tickets", utiliser le nom de l\'utilisateur connecté (voir contexte profil)' },
          person: { type: 'string', description: 'Personne SANS rôle précisé ("tickets de Jean") → cherche comme demandeur OU assigné OU observateur. Préférer ceci à requester/assignedTo quand l\'utilisateur n\'a pas précisé, ou si requester ne renvoie rien' },
          period: { type: 'string', description: 'Période: today, yesterday, 7d, 30d, 90d, ou une date YYYY-MM-DD' },
          limit: { type: 'integer', description: 'Nombre max de résultats (défaut: 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_ticket',
      description: 'Obtenir les détails complets d\'un ticket par son numéro (statut, priorité, assigné, lieu, catégorie, SLA, dates, etc.)',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket' },
        },
        required: ['ticketId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ticket_summary',
      description: 'Obtenir un résumé IA d\'un ticket (historique, résolution, etc.)',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket' },
        },
        required: ['ticketId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_ticket',
      description: 'Créer un nouveau ticket. Demande toujours confirmation à l\'utilisateur avant de créer.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titre du ticket' },
          description: { type: 'string', description: 'Description du problème' },
          priority: { type: 'string', description: 'Priorité: P1, P2, P3, P4 (défaut: P3)' },
          category: { type: 'string', description: 'Catégorie du ticket' },
          locationName: { type: 'string', description: 'Lieu/magasin' },
        },
        required: ['title', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_ticket_status',
      description: 'Modifier le statut d\'un ticket',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket' },
          newStatus: { type: 'string', description: 'Nouveau statut: NEW, OPEN, PENDING, SOLVED, CLOSED' },
        },
        required: ['ticketId', 'newStatus'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_ticket',
      description: 'Assigner un ticket à un technicien',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket' },
          personName: { type: 'string', description: 'Nom du technicien' },
        },
        required: ['ticketId', 'personName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_similar_tickets',
      description: 'Chercher des tickets similaires à un problème donné (utile avant création)',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titre ou description du problème' },
          description: { type: 'string', description: 'Description détaillée' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ticket_links',
      description: 'Obtenir les liens entre tickets (doublons, bloqués, liés)',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket' },
        },
        required: ['ticketId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ticket_time_entries',
      description: 'Obtenir le temps passé sur un ticket (saisies chronométrées)',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket' },
        },
        required: ['ticketId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_locations',
      description: 'Classement des lieux/magasins par nombre de tickets. Utile pour "quel magasin a le plus de problèmes"',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Période: today, 7d, 30d, 90d, all (défaut: 30d)' },
          sortByUrgent: { type: 'boolean', description: 'Trier par tickets urgents (P1/P2) au lieu du total' },
          limit: { type: 'integer', description: 'Nombre de résultats (défaut: 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_technicians',
      description: 'Classement des techniciens par nombre de tickets. Utile pour "quel tech a le plus de tickets"',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Période: today, 7d, 30d, 90d, all (défaut: 30d)' },
          limit: { type: 'integer', description: 'Nombre de résultats (défaut: 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_report',
      description: 'Répartition des tickets ouverts par équipe. Utile pour les bilans et réunions.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Période: today, 7d, 30d, 90d (défaut: 30d)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_category_distribution',
      description: 'Distribution des tickets par catégorie',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Période' },
          locationId: { type: 'integer', description: 'ID du lieu pour filtrer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_root_cause',
      description: 'Analyser les causes racines d\'un problème sur un lieu ou une catégorie',
      parameters: {
        type: 'object',
        properties: {
          locationName: { type: 'string', description: 'Nom du lieu à analyser' },
          filterKeyword: { type: 'string', description: 'Mot-clé pour filtrer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_report',
      description: 'Rapport statistique global: nombre total de tickets, ouverts, résolus, par statut/priorité',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Période: today, 7d, 30d, 90d, ou null pour tout' },
          fullList: { type: 'boolean', description: 'Inclure la liste complète des tickets (défaut: false)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_inventory',
      description: 'Rechercher des équipements/assets dans l\'inventaire',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Mot-clé de recherche (nom, modèle, numéro de série)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_users',
      description: 'Rechercher des utilisateurs par nom ou email',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nom ou email de l\'utilisateur' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_locations',
      description: 'Rechercher des lieux/magasins',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nom du lieu' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'Rechercher dans la base de connaissances IT (solutions, procédures, docs)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Mot-clé ou question' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_ticket_followup',
      description: 'Ajouter un commentaire/suivi sur un ticket existant. Utile pour laisser une note, un update, ou un retour d\'information sur un ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket' },
          content: { type: 'string', description: 'Contenu du commentaire (texte libre)' },
          isPrivate: { type: 'boolean', description: 'Si true, le commentaire est visible uniquement par l\'équipe interne (défaut: false)' },
        },
        required: ['ticketId', 'content'],
      },
    },
  },
];

// ── Exécution des tools ──────────────────────────────────────────────

async function executeTool(toolName, args, user) {
  const p = args || {};
  switch (toolName) {
    case 'search_tickets': {
      // "tickets de <Personne>" sans rôle précisé → recherche élargie demandeur OU assigné
      // (cf. leçon ticket #253) plutôt qu'un filtre demandeur seul qui rate les techniciens.
      if (p.person && !p.requester && !p.assignedTo) {
        const broad = await findTicketsForPersonAnyRole(p.person, { limit: p.limit || 20, period: p.period, user });
        return broad.tickets.filter(t => {
          if (p.status && t.status !== p.status) return false;
          if (p.priority && t.priority !== p.priority) return false;
          if (p.locationName && !t.locationName?.toLowerCase().includes(p.locationName.toLowerCase())) return false;
          return true;
        }).map(t => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          locationName: t.locationName, requester: t.requester?.fullName || null,
          assignedTo: t.assignedTo?.fullName || null, team: t.team?.name || null,
          createdAt: t.createdAt, category: t.category,
          personRoles: t.personRoles,
        }));
      }

      const q = [p.query, p.locationName, p.assignedTo, p.requester, p.category].filter(Boolean).join(' ');
      const result = await searchTickets(q || ' ', p.limit || 20, user, p.period);
      const tickets = result.tickets || result;
      // Filtrer côté JS si des filtres spécifiques sont demandés
      return tickets.filter(t => {
        if (p.status && t.status !== p.status) return false;
        if (p.priority && t.priority !== p.priority) return false;
        if (p.locationName && !t.locationName?.toLowerCase().includes(p.locationName.toLowerCase())) return false;
        if (p.assignedTo && !t.assignedTo?.fullName?.toLowerCase().includes(p.assignedTo.toLowerCase())) return false;
        if (p.requester && !t.requester?.fullName?.toLowerCase().includes(p.requester.toLowerCase())) return false;
        return true;
      }).map(t => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
        locationName: t.locationName, requester: t.requester?.fullName || null,
        assignedTo: t.assignedTo?.fullName || null, team: t.team?.name || null,
        createdAt: t.createdAt, category: t.category,
      }));
    }
    case 'check_ticket':
      return await checkTicketStatus(p.ticketId);
    case 'get_ticket_summary':
      return await getTicketSummary(p.ticketId);
    case 'create_ticket':
      return await createTicketFromChat(p.title, p.description, p.priority || 'P3', user?.id, { category: p.category });
    case 'change_ticket_status':
      return await changeTicketStatus(p.ticketId, p.newStatus);
    case 'assign_ticket':
      return await assignTicket(p.ticketId, p.personName);
    case 'find_similar_tickets':
      return await findSimilarTickets(p.title, p.description || p.title, user);
    case 'get_ticket_links': {
      const ticket = await prisma.ticket.findUnique({
        where: { id: Number(p.ticketId) },
        include: {
          linksA: { select: { ticketB: { select: { id: true, title: true, status: true } }, type: true } },
          linksB: { select: { ticketA: { select: { id: true, title: true, status: true } }, type: true } },
        },
      });
      if (!ticket) return 'Ticket introuvable';
      const links = [
        ...(ticket.linksA || []).map(l => ({ linkedId: l.ticketB.id, title: l.ticketB.title, type: l.type, direction: 'vers' })),
        ...(ticket.linksB || []).map(l => ({ linkedId: l.ticketA.id, title: l.ticketA.title, type: l.type, direction: 'depuis' })),
      ];
      return links.length > 0 ? links : 'Aucun lien';
    }
    case 'get_ticket_time_entries': {
      const entries = await prisma.ticketTimeEntry.findMany({
        where: { ticketId: Number(p.ticketId) },
        orderBy: { entryDate: 'desc' },
        select: { minutes: true, description: true, entryDate: true, user: { select: { fullName: true } } },
      });
      if (entries.length === 0) return 'Aucune saisie de temps';
      const totalMin = entries.reduce((s, e) => s + e.minutes, 0);
      return { totalMinutes: totalMin, entries: entries.map(e => ({ user: e.user?.fullName, minutes: e.minutes, description: e.description, date: e.entryDate })) };
    }
    case 'get_top_locations': {
      const stats = await analyticsTools.getTopLocationsStats({ period: p.period || '30d', limit: p.limit || 5, sortByUrgent: p.sortByUrgent });
      return stats;
    }
    case 'get_top_technicians': {
      const where = { deletedAt: null, status: { notIn: ['CLOSED', 'SOLVED'] }, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
      const tickets = await prisma.ticket.findMany({ where, select: { id: true, assignedToId: true, assignedTo: { select: { fullName: true } } } });
      const techMap = new Map();
      for (const t of tickets) {
        const name = t.assignedTo?.fullName || 'Non assigné';
        techMap.set(name, (techMap.get(name) || 0) + 1);
      }
      return [...techMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, p.limit || 10).map(([name, total]) => ({ name, total }));
    }
    case 'get_team_report':
      return await analyticsTools.getTeamDistribution({ period: p.period || '30d' });
    case 'get_category_distribution':
      return await analyticsTools.getCategoryDistribution({ period: p.period, locationId: p.locationId });
    case 'analyze_root_cause':
      return await analyticsTools.analyzeRootCause({ locationName: p.locationName, filterKeyword: p.filterKeyword });
    case 'generate_report':
      return await generateReport(p.period || null, p.fullList || false);
    case 'search_inventory':
      return await searchAssets(p.query, 5);
    case 'search_users':
      return await searchUsers(p.query, 5);
    case 'search_locations':
      return await searchLocations(p.query, 10);
    case 'search_knowledge':
      return await searchKnowledge(p.query, 5);
    case 'add_ticket_followup':
      return await addTicketFollowup(p.ticketId, p.content, p.isPrivate, user);
    default:
      return `Outil inconnu: ${toolName}`;
  }
}

// ── Appel IA avec tool calling (boucle agentic) ─────────────────────

const MAX_TOOL_ROUNDS = 6;

async function callAIWithTools(messages, options = {}) {
  const providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun fournisseur IA configuré.');

  const systemContent = (options.forcedSystem || SYSTEM_PROMPT) + getDateContextLine();

  // Construire les messages API depuis l'historique
  const recentHistory = (options.conversationHistory || []).slice(-30);
  const apiMessages = [];
  for (const msg of recentHistory) {
    if (!msg || !msg.content || typeof msg.content !== 'string') continue;
    if (msg.content.includes('Désolé, je rencontre un problème technique')) continue;
    apiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
  }
  apiMessages.push({ role: 'user', content: messages[messages.length - 1].content });

  // Budget token
  const MAX_HISTORY_TOKENS = 16000;
  let trimmedMessages = [...apiMessages];
  let totalTokens = trimmedMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
  while (trimmedMessages.length > 1 && totalTokens > MAX_HISTORY_TOKENS) {
    totalTokens -= estimateTokens(trimmedMessages[0].content);
    trimmedMessages.shift();
  }
  // Valider alternance user/assistant
  if (trimmedMessages.length > 1) {
    const cleaned = [trimmedMessages[0]];
    for (let i = 1; i < trimmedMessages.length; i++) {
      if (trimmedMessages[i].role === cleaned[cleaned.length - 1].role) {
        cleaned[cleaned.length - 1].content += '\n\n' + trimmedMessages[i].content;
      } else {
        cleaned.push(trimmedMessages[i]);
      }
    }
    trimmedMessages = cleaned;
  }
  if (trimmedMessages.length > 0 && trimmedMessages[0].role !== 'user') {
    trimmedMessages.unshift({ role: 'user', content: '(Contexte de conversation précédente)' });
  }

  console.log(`[chatbot] callAIWithTools — ${trimmedMessages.length} messages, tools: ${CHATBOT_TOOLS.length}`);

  // Boucle agentic : LLM appelle des tools, on exécute, on renvoie les résultats
  let finalText = '';
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Premier round : avec tools. Rounds suivants : sans tools (pour forcer une réponse texte)
    const callTools = round === 0;
    const result = await callAiWithRetry(() => callProviderWithFallback(providers, null, 'chatbot', {
      messages: trimmedMessages,
      system: systemContent,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
      tools: callTools ? CHATBOT_TOOLS : undefined,
      forcedModelId: options.forcedModelId,
    }), { maxRetries: 2, baseDelay: 1500 });

    // result est { text, toolCalls } quand tools sont fournis, sinon string
    const text = typeof result === 'string' ? result : (result.text || '');
    const toolCalls = typeof result === 'string' ? null : (result.toolCalls || null);

    // Si pas de tool calls → réponse finale
    if (!toolCalls || toolCalls.length === 0) {
      finalText = text;
      break;
    }

    // Ajouter la réponse du LLM avec les tool calls aux messages
    trimmedMessages.push({ role: 'assistant', content: text || '(tool call)' });

    // Exécuter chaque tool et ajouter les résultats comme texte
    const toolResults = [];
    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      let fnArgs = {};
      try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}
      console.log(`[chatbot] Tool call: ${fnName}(${JSON.stringify(fnArgs).substring(0, 200)})`);

      let fnResult;
      try {
        fnResult = await executeTool(fnName, fnArgs, options.user);
      } catch (err) {
        fnResult = `Erreur: ${err.message}`;
        console.error(`[chatbot] Tool ${fnName} error:`, err.message);
      }

      const resultText = typeof fnResult === 'string' ? fnResult : JSON.stringify(fnResult, null, 2);
      toolResults.push(`## ${fnName}\n${resultText.substring(0, 6000)}`);
    }

    // Envoyer tous les résultats comme un seul message user
    trimmedMessages.push({
      role: 'user',
      content: `Voici les données récupérées par les outils. Analyse-les et réponds à l'utilisateur de manière naturelle :\n\n${toolResults.join('\n\n---\n\n')}`,
    });
  }

  // Nettoyer les tool_calls des messages
  for (const m of trimmedMessages) {
    if (m.tool_calls) delete m.tool_calls;
  }

  return finalText;
}

// ── Appel IA ───────────────────────────────────────────────────────────

// Estimation rapide du nombre de tokens (~4 caractères par token, rule of thumb)
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// Le LLM ne connaît pas la date réelle : on l'injecte à chaque appel pour éviter
// qu'il prenne une date passée pour une date future (ex: "tickets du 01/09/2026").
function getDateContextLine() {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `\n\n[Date du jour : ${today}] Utilise-la pour situer les dates mentionnées : une date antérieure est dans le passé, pas le futur.`;
}

async function callAI(messages, options = {}) {
  const providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun fournisseur IA configuré.');

  // ── Multi-turn : séparer system / user / assistant ──
  const intentHint = options.intentHint || '';
  const systemContent = (options.forcedSystem || (SYSTEM_PROMPT + intentHint)) + getDateContextLine();

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
  // "il y a" seul bloque — MAIS "il y a ... pour ce magasin/site" est un suivi de contexte
  if (/\bil y a\b/.test(lower) && !/\b(pour ce|dans ce|ce magasin|ce site|ce lieu)\b/.test(lower)) return false;
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
    if (previousState.intent === 'top_locations') {
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
  // Date explicite + "tickets" → recherche par date (ex: "il y a eu des tickets le 01/09/2026")
  if (/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(lower) && /\btickets?\b/.test(lower)) {
    return { intent: 'search_tickets', params: { period } };
  }
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
  // 0. Pré-détection par mots-clés pour les intents nouveaux (le LLM les confond souvent)
  const lower = message.toLowerCase();
  if (/\b(compétence|expert|maîtrise|niveau|qualifié|qui sait|qui connait)\b/.test(lower) && !/\b(ticket|statut|priorité)\b/.test(lower)) {
    return { intent: 'search_skills', params: {} };
  }
  if (/\b(temps?\s+pass[éeé]|heures?\s+(imputées?|passées?)|travaillé\s+sur|saisie\s+de\s+temps|pointage|chronomètre)/.test(lower) || (/\b(temps?|heures?)\b/.test(lower) && /\b(sur\s+le\s+ticket|#\d+)/.test(lower))) {
    return { intent: 'time_entries', params: {} };
  }
  if (/\b(lien[s]?\s+(du|sur|avec|entre)|lié[s]?\s+(à|au|au|x|avec)|bloque[s]?\s+(le|un|ce)|doublon|rattaché|bloqué\s+par)/.test(lower) || (/\b(lien[s]?)\b/.test(lower) && /#\d+/.test(lower))) {
    return { intent: 'ticket_links', params: {} };
  }

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

    const parts = [`Nom: ${user.fullName}`, `Email: ${user.email}`, `Rôle: ${user.role}`];
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
    include: {
      assignedTo: { select: { fullName: true } },
      team: { select: { name: true } },
      requester: { select: { fullName: true, email: true } },
      linksA: { select: { ticketB: { select: { id: true, title: true, status: true } }, type: true } },
      linksB: { select: { ticketA: { select: { id: true, title: true, status: true } }, type: true } },
      timeEntries: { orderBy: { entryDate: 'desc' }, take: 5, select: { minutes: true, description: true, entryDate: true, user: { select: { fullName: true } } } },
    },
  });

  if (!ticket) return `Ticket #${id} introuvable.`;

  let r = `**Ticket #${ticket.id}**\n`;
  r += `• **Titre :** ${ticket.title}\n`;
  r += `• **Statut :** ${STATUS_LABEL[ticket.status] || ticket.status}\n`;
  r += `• **Priorité :** ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\n`;
  r += `• **Type :** ${ticket.type || 'Incident'}\n`;
  r += `• **Urgence :** ${ticket.urgency || 'Moyenne'} | **Impact :** ${ticket.impact || 'Moyen'}\n`;
  r += `• **Demandeur :** ${ticket.requester?.fullName || 'Inconnu'}\n`;
  r += `• **Assigné à :** ${ticket.assignedTo?.fullName || 'Non assigné'}\n`;
  if (ticket.team) r += `• **Équipe :** ${ticket.team.name}\n`;
  if (ticket.category) r += `• **Catégorie :** ${ticket.category}\n`;
  if (ticket.locationName) r += `• **Lieu :** ${ticket.locationName}\n`;
  r += `• **Créé le :** ${new Date(ticket.createdAt).toLocaleDateString('fr-FR')}\n`;
  if (ticket.solvedAt) r += `• **Résolu le :** ${new Date(ticket.solvedAt).toLocaleDateString('fr-FR')}\n`;
  if (ticket.closedAt) r += `• **Fermé le :** ${new Date(ticket.closedAt).toLocaleDateString('fr-FR')}\n`;

  // SLA
  if (ticket.slaResponseDueAt || ticket.slaResolutionDueAt) {
    const now = new Date();
    r += `\n**SLA :**\n`;
    if (ticket.slaResponseDueAt) {
      const respDue = new Date(ticket.slaResponseDueAt);
      const respBreached = ticket.slaBreachedAt && !ticket.firstResponseAt;
      r += `• Réponse due : ${respDue.toLocaleDateString('fr-FR')} ${respBreached ? '⚠️ DÉPASSÉ' : (ticket.firstResponseAt ? '✅ Répondu' : (respDue > now ? `dans ${Math.round((respDue - now) / 3600000)}h` : '⏰ En retard'))}\n`;
    }
    if (ticket.slaResolutionDueAt) {
      const resDue = new Date(ticket.slaResolutionDueAt);
      const isResolved = ticket.status === 'SOLVED' || ticket.status === 'CLOSED';
      r += `• Résolution due : ${resDue.toLocaleDateString('fr-FR')} ${isResolved ? '✅ Résolu' : (resDue > now ? `dans ${Math.round((resDue - now) / 3600000)}h` : '⏰ En retard')}\n`;
    }
  }

  // Échéance
  if (ticket.dueDate) {
    r += `• **Échéance :** ${new Date(ticket.dueDate).toLocaleDateString('fr-FR')}\n`;
  }

  // Approbation
  if (ticket.approvalStatus && ticket.approvalStatus !== 'NOT_REQUIRED') {
    r += `• **Approbation :** ${ticket.approvalStatus}\n`;
  }

  // Escalade
  if (ticket.escalationLevel > 0) {
    r += `• **Escalade :** niveau ${ticket.escalationLevel}\n`;
  }

  // Liens
  const allLinks = [
    ...(ticket.linksA || []).map(l => ({ ...l.ticketB, linkType: l.type, direction: 'A→B' })),
    ...(ticket.linksB || []).map(l => ({ ...l.ticketA, linkType: l.type, direction: 'B→A' })),
  ];
  if (allLinks.length > 0) {
    r += `\n**Tickets liés :**\n`;
    for (const l of allLinks) {
      r += `• #${l.id} [${STATUS_LABEL[l.status] || l.status}] ${l.title} (${l.linkType})\n`;
    }
  }

  // Temps passé
  if (ticket.timeEntries?.length > 0) {
    const totalMin = ticket.timeEntries.reduce((s, e) => s + e.minutes, 0);
    r += `\n**Temps passé :** ${totalMin}min (${ticket.timeEntries.length} saisies)\n`;
    for (const e of ticket.timeEntries.slice(0, 3)) {
      r += `• ${e.user?.fullName || '?'} : ${e.minutes}min — ${e.description || 'sans description'}\n`;
    }
  }

  // Escalade manuelle
  if (ticket.dueDateNotifiedAt) r += `• **Relance envoyée**\n`;

  // CSAT
  if (ticket.csatScore) {
    r += `• **Satisfaction :** ${ticket.csatScore}/5${ticket.csatComment ? ` — "${ticket.csatComment}"` : ''}\n`;
  }

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
      linksA: { select: { ticketB: { select: { id: true, title: true, status: true } }, type: true } },
      linksB: { select: { ticketA: { select: { id: true, title: true, status: true } }, type: true } },
      timeEntries: { orderBy: { entryDate: 'desc' }, select: { minutes: true, description: true, entryDate: true, user: { select: { fullName: true } } } },
      observers: { select: { fullName: true } },
    },
  });

  if (!ticket) return `Ticket #${id} introuvable.`;

  let r = `**Résumé du Ticket #${ticket.id}**\n\n`;
  r += `**Titre :** ${ticket.title}\n`;
  r += `**Statut :** ${STATUS_LABEL[ticket.status] || ticket.status} | **Priorité :** ${PRIORITY_LABEL[ticket.priority] || ticket.priority}\n`;
  r += `**Type :** ${ticket.type || 'Incident'} | **Urgence :** ${ticket.urgency || 'Moyenne'} | **Impact :** ${ticket.impact || 'Moyen'}\n`;
  r += `**Demandeur :** ${ticket.requester?.fullName || 'Inconnu'} (${ticket.requester?.email || ''})\n`;
  r += `**Assigné à :** ${ticket.assignedTo?.fullName || 'Non assigné'}\n`;
  if (ticket.team) r += `**Équipe :** ${ticket.team.name}\n`;
  if (ticket.category) r += `**Catégorie :** ${ticket.category}\n`;
  if (ticket.locationName) r += `**Lieu :** ${ticket.locationName}\n`;
  if (ticket.source) r += `**Source :** ${ticket.source}\n`;
  r += `**Créé le :** ${new Date(ticket.createdAt).toLocaleDateString('fr-FR')}\n`;
  if (ticket.solvedAt) r += `**Résolu le :** ${new Date(ticket.solvedAt).toLocaleDateString('fr-FR')}\n`;
  if (ticket.closedAt) r += `**Fermé le :** ${new Date(ticket.closedAt).toLocaleDateString('fr-FR')}\n`;

  // SLA
  if (ticket.slaResponseDueAt || ticket.slaResolutionDueAt) {
    const now = new Date();
    r += `\n**SLA :**\n`;
    if (ticket.slaResponseDueAt) {
      const respDue = new Date(ticket.slaResponseDueAt);
      const respBreached = ticket.slaBreachedAt && !ticket.firstResponseAt;
      r += `• Réponse due : ${respDue.toLocaleDateString('fr-FR')} ${respBreached ? '⚠️ DÉPASSÉ' : (ticket.firstResponseAt ? '✅ Répondu' : (respDue > now ? `dans ${Math.round((respDue - now) / 3600000)}h` : '⏰ En retard'))}\n`;
    }
    if (ticket.slaResolutionDueAt) {
      const resDue = new Date(ticket.slaResolutionDueAt);
      const isResolved = ticket.status === 'SOLVED' || ticket.status === 'CLOSED';
      r += `• Résolution due : ${resDue.toLocaleDateString('fr-FR')} ${isResolved ? '✅ Résolu' : (resDue > now ? `dans ${Math.round((resDue - now) / 3600000)}h` : '⏰ En retard')}\n`;
    }
  }

  if (ticket.dueDate) r += `**Échéance :** ${new Date(ticket.dueDate).toLocaleDateString('fr-FR')}\n`;
  if (ticket.approvalStatus && ticket.approvalStatus !== 'NOT_REQUIRED') r += `**Approbation :** ${ticket.approvalStatus}\n`;
  if (ticket.escalationLevel > 0) r += `**Escalade :** niveau ${ticket.escalationLevel}\n`;

  r += `\n**Description :**\n${(ticket.content || 'Aucune description').substring(0, 800)}\n`;

  // Liens
  const allLinks = [
    ...(ticket.linksA || []).map(l => ({ ...l.ticketB, linkType: l.type })),
    ...(ticket.linksB || []).map(l => ({ ...l.ticketA, linkType: l.type })),
  ];
  if (allLinks.length > 0) {
    r += `\n**Tickets liés :**\n`;
    for (const l of allLinks) {
      r += `• #${l.id} [${STATUS_LABEL[l.status] || l.status}] ${l.title} (${l.linkType})\n`;
    }
  }

  // Temps passé
  if (ticket.timeEntries?.length > 0) {
    const totalMin = ticket.timeEntries.reduce((s, e) => s + e.minutes, 0);
    r += `\n**Temps passé :** ${totalMin}min total\n`;
    for (const e of ticket.timeEntries.slice(0, 5)) {
      r += `• ${e.user?.fullName || '?'} : ${e.minutes}min — ${e.description || 'sans description'}\n`;
    }
  }

  // Observateurs
  if (ticket.observers?.length > 0) {
    r += `**Observateurs :** ${ticket.observers.map(o => o.fullName).join(', ')}\n`;
  }

  // Derniers followups
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

async function addTicketFollowup(ticketId, content, isPrivate, user) {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) return { error: 'Numéro de ticket invalide.' };
  if (!content || !content.trim()) return { error: 'Le contenu du commentaire est requis.' };

  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, title: true, status: true, priority: true, requesterId: true, assignedToId: true } });
  if (!ticket) return { error: `Ticket #${id} introuvable.` };

  if (['SOLVED', 'CLOSED'].includes(ticket.status)) {
    return { error: `Impossible d'ajouter un commentaire sur un ticket ${ticket.status === 'SOLVED' ? 'résolu' : 'fermé'}.` };
  }

  if (user?.role === 'REQUESTER' && ticket.requesterId !== user.id) {
    return { error: 'Vous ne pouvez commenter que vos propres tickets.' };
  }

  if (user?.role === 'TECHNICIAN') {
    const isAssigned = ticket.assignedToId === user.id;
    if (!isAssigned) {
      const isMultiAssigned = await prisma.ticket.findFirst({
        where: { id, assignees: { some: { id: user.id } } },
        select: { id: true },
      });
      if (!isMultiAssigned) {
        return { error: 'Vous ne pouvez ajouter un suivi que sur les tickets qui vous sont assignés.' };
      }
    }
  }

  const sanitized = sanitizeTicketHtml(content.trim());

  const followup = await prisma.followup.create({
    data: {
      ticketId: id,
      authorId: user.id,
      content: sanitized,
      isPrivate: isPrivate === true,
    },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  if (['ADMIN', 'TECHNICIAN', 'HOTLINE', 'SUPERADMIN'].includes(user.role)) {
    try {
      await recordFirstResponse(id, user.id);
    } catch (err) {
      console.error('[chatbot] Enregistrement première réponse échoué:', err.message);
    }
  }

  try {
    await logEvent(id, 'FOLLOWUP_ADDED', user.email || 'CHATBOT', { followupId: followup.id });
  } catch (err) {
    console.error('[chatbot] Log event FOLLOWUP_ADDED échoué:', err.message);
  }

  try {
    emitTicketUpdated({ id, title: ticket.title, assignedToId: ticket.assignedToId, requesterId: ticket.requesterId }, { followupAdded: true });
  } catch (err) {
    console.error('[chatbot] Socket emit followup échoué:', err.message);
  }

  return { followup, ticketId: id, ticketTitle: ticket.title };
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

  // ── Signaux de désambiguïsation produits par searchTickets ──
  // 1) Recherche élargie par personne (rôle non précisé) : on liste les rôles rencontrés
  //    pour que la réponse soit honnête ("demandeur", "assigné"...).
  // 2) Repli après filtre demandeur/assigné vide : la personne a été trouvée sous un AUTRE rôle.
  // 3) Aucun résultat mais la personne existe : signaler pour inviter à préciser au lieu d'inventer.
  let ambiguityNote = '';
  if (ticketsResult.personName) {
    if (ticketsResult.fallbackFromRole) {
      ambiguityNote = `⚠️ FILTRE PAR PERSONNE : aucun ticket trouvé où ${ticketsResult.personName} est ${ticketsResult.fallbackFromRole}, MAIS une recherche élargie a trouvé des tickets. Mentionne explicitement que ${ticketsResult.personName} apparaît sous un AUTRE rôle que ${ticketsResult.fallbackFromRole} (regarde les champs Demandeur / Assigné à des tickets listés) — ne présente pas ces tickets comme s'ils correspondaient au filtre initial.`;
    } else {
      const roleSet = new Set();
      for (const t of matchingTickets) for (const r of t.personRoles || []) roleSet.add(r);
      if (roleSet.size > 0) {
        ambiguityNote = `⚠️ RECHERCHE PAR PERSONNE ("${ticketsResult.personName}") : recherche élargie aux rôles suivants → trouvés comme : ${[...roleSet].join(' ET ')}. Indique pour chaque ticket (ou en résumé) sous quel rôle ${ticketsResult.personName} apparaît (Demandeur / Assigné / Observateur). Si l'utilisateur semblait attendre UN rôle précis, signale-le et propose de filtrer.`;
      }
    }
  } else if (matchingTickets.length === 0 && params?.personName) {
    const personExists = await prisma.user.findFirst({
      where: { fullName: { contains: params.personName, mode: 'insensitive' }, deletedAt: null },
      select: { fullName: true },
    }).catch(() => null);
    if (personExists) {
      ambiguityNote = `⚠️ AUCUN TICKET pour "${params.personName}" (l'utilisateur existe : ${personExists.fullName}). N'invente RIEN. Dis simplement qu'aucun ticket n'a été trouvé et propose : vérifier l'orthographe, chercher par email, ou élargir la période.`;
    }
  }
  if (ambiguityNote) contextParts.push(ambiguityNote);

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
      ticketContext += `| # | Titre | Statut | Priorité | Demandeur | Lieu | SLA |\n|---|-------|--------|----------|-----------|------|-----|\n`;
      for (const t of matchingTickets) {
        let slaStatus = '-';
        if (t.slaResolutionDueAt) {
          const now = new Date();
          const due = new Date(t.slaResolutionDueAt);
          const isResolved = t.status === 'SOLVED' || t.status === 'CLOSED';
          slaStatus = isResolved ? '✅' : (due > now ? `${Math.round((due - now) / 3600000)}h` : '⚠️');
        }
        ticketContext += `| ${t.id} | ${(t.title || '').substring(0, 50)} | ${STATUS_LABEL[t.status] || t.status} | ${PRIORITY_LABEL[t.priority] || t.priority} | ${t.requester?.fullName || '-'} | ${t.locationName || '-'} | ${slaStatus} |\n`;
      }
    } else {
      for (const t of matchingTickets) {
        ticketContext += `• **Ticket #${t.id}** : "${t.title}"\n  - Statut : ${STATUS_LABEL[t.status] || t.status} | Priorité : ${PRIORITY_LABEL[t.priority] || t.priority}`;
        if (t.category) ticketContext += ` | Catégorie : ${t.category}`;
        if (t.requester) ticketContext += ` | Demandeur : ${t.requester.fullName}`;
        if (t.assignedTo) ticketContext += ` | Assigné à : ${t.assignedTo.fullName}`;
        if (t.locationName) ticketContext += ` | Lieu : ${t.locationName}`;
        if (t.slaResolutionDueAt) {
          const now = new Date();
          const due = new Date(t.slaResolutionDueAt);
          const isResolved = t.status === 'SOLVED' || t.status === 'CLOSED';
          ticketContext += ` | SLA: ${isResolved ? '✅ Résolu' : (due > now ? `dans ${Math.round((due - now) / 3600000)}h` : '⚠️ En retard')}`;
        }
        if (t.approvalStatus && t.approvalStatus !== 'NOT_REQUIRED') ticketContext += ` | Approbation : ${t.approvalStatus}`;
        if (t.glpiTicketId) ticketContext += ` | GLPI #${t.glpiTicketId}`;
        ticketContext += `\n  - *Description :* ${(t.content || '').substring(0, 200)}...\n\n`;
      }
    }
    contextParts.push(ticketContext);
  } else if (!DETERMINISTIC_INTENTS.has(intent) && !['general', 'create_ticket', 'create_ticket_for', 'confirm_create_ticket'].includes(intent)) {
    const emptyPersonMsg = params?.personName || params?.requesterName || params?.assignedToName
      ? `**Aucun ticket trouvé** pour cette recherche. Une personne était mentionnée dans la demande : ne conclus PAS que cette personne n'a aucun rôle ou que la demande est impossible — propose de vérifier l'orthographe, de chercher par email, ou de préciser demandeur/assigné.`
      : "**Aucun ticket trouvé dans la base de données** pour cette recherche. Ne pas inventer de tickets — indiquer simplement qu'aucun résultat n'a été trouvé.";
    contextParts.push(emptyPersonMsg);
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
      const where = { deletedAt: null, status: { notIn: ['CLOSED', 'SOLVED'] }, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
      if (startDate) where.createdAt = { ...where.createdAt, gte: startDate };
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
      // Sauvegarder les top locations dans params pour multi-turn
      params.topLocations = ranked.map(r => r.name);
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
      const where = { deletedAt: null, status: { notIn: ['CLOSED', 'SOLVED'] }, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
      if (startDate) where.createdAt = { ...where.createdAt, gte: startDate };
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

    case 'search_problems': {
      const kw = params?.keyword || message;
      const problems = await prisma.problem.findMany({
        where: {
          OR: [
            { title: { contains: kw, mode: 'insensitive' } },
            { description: { contains: kw, mode: 'insensitive' } },
            { category: { contains: kw, mode: 'insensitive' } },
          ],
        },
        include: {
          assignedTo: { select: { fullName: true } },
          team: { select: { name: true } },
          requester: { select: { fullName: true } },
          tickets: { select: { ticket: { select: { id: true, title: true, status: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      if (problems.length === 0) {
        contextParts.push(`**Aucun problème trouvé** pour "${kw}".`);
      } else {
        let txt = `**${problems.length} problème(s) trouvé(s) :**\n\n`;
        for (const p of problems) {
          txt += `• **#${p.id}** [${p.status}] ${p.title}\n`;
          txt += `  Priorité: ${PRIORITY_LABEL[p.priority] || p.priority} | Assigné: ${p.assignedTo?.fullName || 'Non assigné'} | Équipe: ${p.team?.name || '-'}\n`;
          if (p.tickets?.length > 0) {
            txt += `  Tickets liés: ${p.tickets.map(t => `#${t.ticket.id}`).join(', ')}\n`;
          }
        }
        contextParts.push(txt);
      }
      break;
    }

    case 'search_skills': {
      const personName = params?.personName || message;
      // Si un nom de personne est mentionné, chercher ses compétences
      if (personName && personName.length > 1) {
        const users = await prisma.user.findMany({
          where: {
            OR: [
              { fullName: { contains: personName, mode: 'insensitive' } },
              { email: { contains: personName, mode: 'insensitive' } },
            ],
            role: { in: ['TECHNICIAN', 'HOTLINE', 'ADMIN'] },
          },
          select: {
            id: true, fullName: true, role: true,
            skills: { select: { skill: { select: { name: true, category: true } }, level: true } },
          },
          take: 5,
        });
        if (users.length === 0) {
          contextParts.push(`**Aucun technicien trouvé** pour "${personName}".`);
        } else {
          let txt = `**Compétences des techniciens :**\n\n`;
          for (const u of users) {
            txt += `• **${u.fullName}** (${u.role})\n`;
            if (u.skills.length === 0) {
              txt += `  Aucune compétence renseignée\n`;
            } else {
              for (const s of u.skills) {
                txt += `  • ${s.skill.name} (${s.skill.category || 'Général'}) — niveau ${s.level}/5\n`;
              }
            }
          }
          contextParts.push(txt);
        }
      } else {
        // Lister toutes les compétences disponibles
        const allSkills = await prisma.skill.findMany({
          include: { userSkills: { select: { userId: true } } },
          orderBy: { name: 'asc' },
        });
        if (allSkills.length === 0) {
          contextParts.push(`**Aucune compétence** enregistrée dans le système.`);
        } else {
          let txt = `**${allSkills.length} compétence(s) disponible(s) :**\n\n`;
          for (const s of allSkills) {
            txt += `• **${s.name}** (${s.category || 'Général'}) — ${s.userSkills.length} technicien(s)\n`;
          }
          contextParts.push(txt);
        }
      }
      break;
    }

    case 'ticket_links': {
      let tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      if (!tid && conversationHistory.length > 0) {
        const lastUserMsgs = conversationHistory.filter(m => m.role === 'user');
        for (const m of lastUserMsgs.reverse()) {
          const match = m.content.match(/#?(\d+)/);
          if (match) { tid = match[1]; break; }
        }
      }
      if (tid) {
        const ticket = await prisma.ticket.findUnique({
          where: { id: parseInt(tid, 10) },
          include: {
            linksA: { select: { ticketB: { select: { id: true, title: true, status: true, priority: true, assignedTo: { select: { fullName: true } } } }, type: true } },
            linksB: { select: { ticketA: { select: { id: true, title: true, status: true, priority: true, assignedTo: { select: { fullName: true } } } }, type: true } },
          },
        });
        if (!ticket) {
          contextParts.push(`Ticket #${tid} introuvable.`);
        } else {
          const allLinks = [
            ...(ticket.linksA || []).map(l => ({ id: l.ticketB.id, title: l.ticketB.title, status: l.ticketB.status, priority: l.ticketB.priority, assignee: l.ticketB.assignedTo?.fullName, linkType: l.type, direction: 'ce ticket →' })),
            ...(ticket.linksB || []).map(l => ({ id: l.ticketA.id, title: l.ticketA.title, status: l.ticketA.status, priority: l.ticketA.priority, assignee: l.ticketA.assignedTo?.fullName, linkType: l.type, direction: '→ ce ticket' })),
          ];
          if (allLinks.length === 0) {
            contextParts.push(`**Ticket #${tid}** n'a aucun lien avec d'autres tickets.`);
          } else {
            let txt = `**Liens du ticket #${tid}** (${allLinks.length} lien(s)) :\n\n`;
            const TYPE_LABEL = { RELATED: 'Lié', DUPLICATE_OF: 'Doublon de', BLOCKS: 'Bloque', BLOCKED_BY: 'Bloqué par' };
            for (const l of allLinks) {
              txt += `• ${l.direction} #${l.id} [${STATUS_LABEL[l.status] || l.status}] ${l.title} — ${TYPE_LABEL[l.linkType] || l.linkType}\n`;
              txt += `  Priorité: ${PRIORITY_LABEL[l.priority] || l.priority} | Assigné: ${l.assignee || 'Non assigné'}\n`;
            }
            contextParts.push(txt);
          }
        }
      } else {
        contextParts.push(`Donnez le numéro d'un ticket pour voir ses liens (ex: "liens du ticket #12").`);
      }
      break;
    }

    case 'time_entries': {
      let tid = params?.ticketId || message.match(/#?(\d+)/)?.[1];
      if (!tid && conversationHistory.length > 0) {
        const lastUserMsgs = conversationHistory.filter(m => m.role === 'user');
        for (const m of lastUserMsgs.reverse()) {
          const match = m.content.match(/#?(\d+)/);
          if (match) { tid = match[1]; break; }
        }
      }
      if (tid) {
        const entries = await prisma.ticketTimeEntry.findMany({
          where: { ticketId: parseInt(tid, 10) },
          orderBy: { entryDate: 'desc' },
          select: { minutes: true, description: true, entryDate: true, user: { select: { fullName: true } } },
        });
        if (entries.length === 0) {
          contextParts.push(`**Aucune saisie de temps** pour le ticket #${tid}.`);
        } else {
          const totalMin = entries.reduce((s, e) => s + e.minutes, 0);
          let txt = `**Temps passé sur le ticket #${tid} :** ${totalMin}min total (${entries.length} saisie(s))\n\n`;
          for (const e of entries) {
            txt += `• **${e.user?.fullName || '?'}** — ${e.minutes}min`;
            if (e.description) txt += ` — ${e.description}`;
            txt += ` (${new Date(e.entryDate).toLocaleDateString('fr-FR')})\n`;
          }
          // Agrégat par technicien
          const byUser = new Map();
          for (const e of entries) {
            const name = e.user?.fullName || 'Inconnu';
            byUser.set(name, (byUser.get(name) || 0) + e.minutes);
          }
          if (byUser.size > 1) {
            txt += `\n**Résumé par technicien :**\n`;
            for (const [name, min] of [...byUser.entries()].sort((a, b) => b[1] - a[1])) {
              txt += `• ${name} : ${min}min\n`;
            }
          }
          contextParts.push(txt);
        }
      } else {
        contextParts.push(`Donnez le numéro d'un ticket pour voir le temps passé (ex: "temps passé sur le #12").`);
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
• **Vérifier statut** : "Quel est le statut du ticket #123" (inclut SLA, liens, temps passé)
• **Liens entre tickets** : "Y a-t-il des liens sur le #12", "Quels tickets sont bloqués"
• **Temps passé** : "Combien de temps sur le ticket #12", "Qui a travaillé dessus"
• **Changer statut** : "Ferme le ticket #5", "Passe le ticket 12 en résolu"
• **Assigner un ticket** : "Assigne le ticket #5 à Jean"
• **Rechercher un équipement** : "Où est l'imprimante HP ?", "Cherche le PC X1"
• **Rechercher un utilisateur** : "Qui est Jean ?", "Email de Paul"
• **Rechercher un lieu** : "Où se trouve le magasin Asten ?"
• **Problèmes ITIL** : "Problèmes ouverts", "Quels incidents majeurs", "Problèmes réseau"
• **Compétences** : "Qui est expert en réseau ?", "Qui sait faire du VPN ?", "Compétences de Jean"
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
  // Pour 'general' sans contexte déterministe : callAIWithTools (le LLM choisit ses outils)
  // Pour les autres intents : le contexte est déjà construit par les handlers, on le passe au LLM
  try {
    let raw;
    if (intent === 'general' && contextParts.length === 0) {
      raw = await callAIWithTools(
        [{ role: 'user', content: message }],
        { ...voiceModelOptions, conversationHistory, forcedSystem: SYSTEM_PROMPT, user }
      );
      _stepLog('llm-tools', `replyLen=${raw.length}`);
    } else {
      raw = await callAI(
        [{ role: 'user', content: message }],
        {
          ...voiceModelOptions,
          conversationHistory,
          forcedSystem: fullSystemPrompt,
        }
      );
      _stepLog('llm-free', `replyLen=${raw.length}`);
    }

    reply = cleanAiReply(raw);
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
  if (userId && ['search_tickets', 'report', 'analytics', 'check_ticket', 'team_report', 'top_locations', 'top_technicians', 'search_inventory', 'search_users', 'search_locations', 'search_problems', 'search_skills', 'ticket_links', 'time_entries'].includes(intent)) {
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
