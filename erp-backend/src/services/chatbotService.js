const prisma = require('../prismaClient');
const { getActiveProviders, callProviderWithFallback, callAiWithRetry } = require('./mailAnalyzer');
const { emitTicketCreated, emitTicketAssigned, emitTicketUpdated } = require('../utils/socket');
const { sendTicketCreationNotification, sendAssignmentNotificationEmail } = require('./emailSender');
const { sanitizeTicketHtml } = require('../utils/security');
const { recordFirstResponse } = require('./slaService');
const { logEvent } = require('./ticketEvent');
const analyticsTools = require('./analyticsTools');

const SYSTEM_PROMPT = `Tu es MARIE, l'assistante IA Helpdesk IT de Prosuma. Tu es une collègue expérimentée du support IT : naturelle, chaleureuse, efficace.

CONNAISSANCE DE LA BASE DE DONNÉES IT PROSUMA :
Tu as une connaissance complète de la structure et du contenu de la base PostgreSQL du helpdesk :
- **Équipes Système** : Sécurité, Réseau, Téléphonie, Système, Matériel, Applicatif, Logiciel, DÉVELOPPEMENT.
- **Catégories de tickets** : Sécurité, Réseau, Téléphonie, Système, Matériel, Applicatif, Logiciel, Serveur, Test.
- **Statuts des tickets** : NEW (Nouveau), OPEN (Ouvert), PENDING (En attente), WAITING_FOR_USER (En attente utilisateur), SOLVED (Résolu), CLOSED (Fermé), PLANNED (Planifié).
- **Priorités** : P1 (Critique), P2 (Haute), P3 (Moyenne), P4 (Basse).
- **Entités clés** : Tickets (id, titre, contenu, statut, priorité, demandeur, assigné, équipe, lieu, SLA, approbations, suivis/commentaires, temps passés, liens inter-tickets), Utilisateurs (fullName, email, role, team), Équipements/Inventaire (assets, serial, type, lieu), Base de connaissances (articles, procédures).
- **Compétences** : chaque technicien a des compétences (skills) liées à des domaines (ex: Cyrus, EREF, Réseau). Utilise-les pour identifier qui traite quoi.

RÈGLE "QUI TRAITE" (absolue) :
Quand on te demande "qui traite / qui s'occupe de / qui gère X", ne liste PAS seulement des tickets. Enchaîne obligatoirement :
1. search_tickets(query=X) pour trouver les tickets concernés,
2. Puis déduis l'équipe majoritaire et les techniciens récurrents parmi les résultats,
3. Puis search_knowledge(query=X) pour une procédure/article lié,
4. Puis si pertinent, cherche les compétences (skills) des techniciens identifiés.
Synthétise en : "X est traité par l'équipe [Y], techniciens [A (N×), B], procédure KB [titre]".

Tu es TOTALEMENT LIBRE sur la forme : ton, style, longueur, structure, formatage (markdown, tableaux, listes, gras, italique), emojis ou non — fais ce qui est le plus utile et le plus agréable pour ton interlocuteur. Réponds dans la langue de l'utilisateur. Varie tes tournures, montre ta personnalité, donne ton avis professionnel quand c'est pertinent. Analyse et interprète les données plutôt que de simplement les lister.

Un contexte (profil utilisateur, tickets, statistiques, base de connaissances) est fourni après ce prompt quand il existe : appuie-toi sur ce qui est pertinent, ignore le reste.

RÈGLE DE RESTITUTION ET FORMATAGE PROPRE (Absolue) :
- Restitue TOUJOURS les données sous un format lisible, élégant et naturel (tableaux Markdown épurés, listes synthétiques).
- Ne montre JAMAIS de détails techniques internes, de noms de champs de base de données (ex: "aiProcessed", "secondaryRequesterId", "outlookConversationId", "null", "undefined", "vector") ni de jargon de code.
- Si une personne apparaît dans une recherche de tickets, indique systématiquement et clairement son rôle (Demandeur / Assigné / Observateur). Si elle apparaît sous plusieurs rôles, regroupe les tickets par rôle.

RÈGLE DES OUTILS ET TRANSPARENCE :
- Ne dis JAMAIS "Je peux lancer l'outil X, voulez-vous que je le fasse ?" ou "Je n'ai pas la main pour exécuter cet outil". Si un outil existe, il est utilisé automatiquement et tu présentes directement les résultats. Si la donnée est là, réponds directement avec les chiffres réels.

RÈGLE DE VÉRACITÉ — JAMAIS D'INVENTION (absolue, prime sur tout le reste) :
- Les seuls numéros de tickets, chiffres, statuts et noms que tu peux citer sont ceux du contexte fourni. Écrire "#XXX", "[Ticket 6]", "#123 (détail non chargé)" ou tout numéro/statut absent du contexte est INTERDIT — même pour "compléter" un tableau.
- Si l'en-tête annonce un total (ex. "Tickets pertinents trouvés (7)") mais que le détail n'affiche que 5 lignes, dis-le tel quel : "j'ai bien 7 tickets au total, mais le détail des 2 derniers n'est pas chargé" et propose de relancer l'affichage — n'imagine JAMAIS les lignes manquantes.
- Si une donnée manque, dis-le simplement et propose de la récupérer. "Je vérifie et je reviens vers toi" vaut mille fois une réponse inventée.
- Si tu n'as effectué aucune recherche (pas de contexte de tickets), ne fais AUCUNE affirmation chiffrée sur des tickets.
En dehors de ça, aucune contrainte sur la forme : sois naturelle.

RÈGLE D'OR — DEMANDER PLUTÔT QUE DEVINER :
Quand une demande est ambiguë ou incomplète, ne choisis JAMAIS une interprétation au hasard. Pose une question de clarification courte et naturelle. Cas typiques :
- Une personne est mentionnée ("tickets de Steven", "ceux de Marie") sans préciser demandeur ou technicien → cherche les DEUX rôles, et si tu ne peux pas, demande : "Tu veux dire en tant que demandeur ou en tant que technicien assigné ?"
- Plusieurs utilisateurs portent le même nom → demande lequel (ou liste les deux en le signalant explicitement).
- Le nom ne correspond à personne dans l'annuaire → ne re-formule pas une orthographe au hasard : demande de vérifier le nom ou de donner l'email.
- "mes tickets", "son ticket", "ce problème" et tout pronom ambigu → vérifie le contexte de conversation ; s'il ne suffit pas, demande.
- Une stat ou un périmètre est vague ("les pannes récentes") → précise ce que tu as utilisé comme filtre (période, statut) et propose d'ajuster.
En dehors de ça, si le contexte (conversation précédente, profil utilisateur, résultat de recherche élargie) lève le doute, réponds directement sans reposer la question.

NE JAMAIS ÉNONCER UNE LIMITE :
- Ne formule jamais de phrase en "je ne peux pas", "je n'ai pas accès à", "cette fonctionnalité n'existe pas".
- Quand une demande sort de ce que tu peux faire, redirige directement vers l'action utile ou l'endroit approprié, sans jamais énoncer la limite elle-même.
- Ne dis jamais "c'est fait", "je l'ai créé", "je l'ai assigné" pour une action que tu n'as pas réellement exécutée via un outil.`;

// ── Nettoyage minimal des réponses IA ──────────────────────────────────

function cleanAiReply(text) {
  if (!text) return '';
  let cleaned = text
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/\n+$/, '')
    .trim();
  // Supprimer les fuites de Chain of Thought / audit preamble
  // (le LLM audit peut parfois sortir son analyse interne avant la réponse)
  cleaned = cleaned
    .replace(/^\s*(?:["']?(?:tickets?|réponse|résumé|analyse|note|internal|context|implicit)[^:]*:\s*)/i, '')
    .replace(/\b(?:CHAIN OF THOUGHT|chain of thought|réflexion interne|analyse interne|note interne|internal thought|reasoning)\b[^]*?(?=\n[#*\-]|$)/gi, '')
    .replace(/\b(?:Le système|la réponse|première réponse|le chatbot|MARIE)[^.]*?(?:répond|présente|soulève|contient|mentionne)[^.]*\./gi, '')
    .replace(/\b(?:Voici (?:le |un )?(?:résumé|aperçu|analyse|résultat)[^.]*)\./gi, '')
    .trim();
  return cleaned;
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


function normalizeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function resolveCanonicalTeamName(teamQuery, userId = null) {
  if (!teamQuery) return null;
  const lower = teamQuery.toLowerCase().trim();

  // 1. Possessif ("mon équipe", "ma team", "nos équipes") → récupérer l'équipe de l'utilisateur connecté
  if (/\b(mon|ma|mes|notre|nos)\s+(équipe|equipe|team)\b/i.test(lower) || lower === 'mon equipe' || lower === 'mon équipe') {
    if (userId) {
      try {
        const u = await prisma.user.findUnique({
          where: { id: userId },
          select: { team: { select: { name: true } } },
        });
        if (u?.team?.name) return u.team.name;
      } catch {}
    }
  }

  // 2. Recherche parmi les équipes DB avec tolérance aux accents
  try {
    const teams = await prisma.team.findMany({ select: { id: true, name: true } });
    const cleanedQuery = normalizeAccents(lower.replace(/^(?:l['’]|l|d['’]|de\s+l['’]|de\s+la\s+|l['’]équipe\s+|l['’]equipe\s+|équipe\s+|equipe\s+)/i, '').trim());
    if (!cleanedQuery) return teamQuery;

    for (const t of teams) {
      const cleanName = normalizeAccents(t.name.toLowerCase());
      if (cleanName.includes(cleanedQuery) || cleanedQuery.includes(cleanName)) {
        return t.name;
      }
    }
    for (const t of teams) {
      const cleanName = normalizeAccents(t.name.toLowerCase());
      const words = cleanedQuery.split(/\s+/).filter((w) => w.length > 2);
      if (words.some((w) => cleanName.includes(w))) {
        return t.name;
      }
    }
  } catch (err) {
    console.error('[chatbot] resolveCanonicalTeamName error:', err.message);
  }

  return teamQuery;
}

// ── Petites phrases (salutations, remerciements) : pas besoin de recherches ni de LLM de classification ──
function isGreetingMessage(message) {
  const lower = (message || '').toLowerCase().trim();
  if (lower.length > 80) return false;
  return /^(salut|bonjour|bonsoir|hello|hey|coucou|hi|yo|re|merci|merci beaucoup|ok|d'accord|super|parfait|top|génial|nickel|au revoir|bye|à demain|bonne journée|bonne soirée|bonne nuit)[\s!.,:?]*$/i.test(lower)
    || /^(salut|bonjour|bonsoir|hello|hey|coucou)[\s,!.,]*(marie|ia|bot)[\s!.,?]*$/i.test(lower);
}

// ── Recherche RAG (Base de connaissances) ─────────────────────────────

const { searchKnowledge: searchKnowledgeUnified } = require('./knowledgeSearch');

async function searchKnowledge(query, limit = 5) {
  try {
    return await searchKnowledgeUnified(query, { topK: limit, useHybrid: true, applyReranking: true });
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
  const teamMatch = query.match(/\b(?:equipe|équipe|team|groupe)\s+([A-ZÀ-Ÿa-zà-ÿ0-9_-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_-]+)?)/i);
  if (teamMatch) {
    const cand = teamMatch[1].replace(/\s+(?:a[- ]t[- ]il|a[- ]t[- ]elle|a|des|les|en|sur|pour|ce|cet|cette|du|de|tickets?|tikets?|tiquets?).*$/i, '').replace(/[\?!\.\,]+$/, '').trim();
    if (cand && !/^(du|de|la|le|les|des|un|une)$/i.test(cand)) {
      params.teamName = cand;
    }
  } else if (/\b(?:mon|ma|notre|nos)\s+(?:équipe|equipe|team)\b/i.test(lower)) {
    params.teamName = 'mon équipe';
  }

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

  // Personne : "de/par/du/pour/concernant/demandeur/technicien/évalue <Nom>" (ex: "tickets de Mariam Fofana", "évalue le technicien Jean Kouassi").
  const techPersonMatch = query.match(/\b(?:de|par|du|pour|concernant|sur|demandeur|technicien|technicienne|[ée]value|[ée]valuer|performance\s+de|bilan\s+de)\s+([A-ZÀ-Ÿa-zà-ÿ]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ]+)+)\b/i);
  const NON_PERSON_TERMS = /\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|semaine|mois|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|equipe|équipe|ticket|tickets|tiket|tikets|tiquet|tiquets|tcket|tckets|port|usb|imprimante|serveur|réseau|reseau|logiciel|mot de passe|wifi|vpn|switch|ordinateur|pc|application|messagerie|compte|accès|acces|connexion|antivirus|licence|dossier|fichier|base|site|bâtiment|batiment|agence|étage|etage|ouverture|securite|sécurité|sécurite|securité|téléphonie|telephonie|applicatif|matériel|materiel|développement|developpement|système|systeme|combien|total|nombre|statut|statuts|état|états|avancement|bilan|rapport|résumé|resume|liste|synthèse|synthese|historique)\b/i;
  if (techPersonMatch) {
    const candidate = techPersonMatch[1].replace(/\s+(?:a[- ]t[- ]il|a[- ]t[- ]elle|a|des|les|en|sur|pour|ce|cet|cette|du|de|tickets?|incidents?).*$/i, '').trim();
    if (!NON_PERSON_TERMS.test(candidate) && candidate.length > 2) {
      params.personName = candidate;
    }
  }

  // Si pas encore de personName, chercher un Prénom + Nom au début de la phrase (ex: "Steven Yapo a-t-il des tickets ?")
  if (!params.personName && !params.isMyTicketsRef) {
    const nameAtStartMatch = query.match(/^([A-ZÀ-Ÿa-zà-ÿ]{2,}\s+[A-ZÀ-Ÿa-zà-ÿ]{2,})\b/i);
    if (nameAtStartMatch) {
      const cand = nameAtStartMatch[1].trim();
      const lowerCand = cand.toLowerCase();
      const forbidden = [
        'liste des', 'montre les', 'tous les', 'quand il', 'quel est', 'est ce', 'y a', 'il y', 'le ticket',
        'un ticket', 'quels sont', 'je veux', 'je souhaite', 'je voudrais', 'peux tu', 'dis moi', 'evalue le',
        'évalue le', 'évaluer le', 'performance de', 'bilan de', 'les demandes', 'ouverture de',
      ];
      if (!forbidden.some((f) => lowerCand.startsWith(f)) && !NON_PERSON_TERMS.test(cand)) {
        params.personName = cand;
      }
    }
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
// ── Conditions de filtre personne, par niveaux de tolérance (escalier) ──
// Niveau 1 : phrase complète ("steven yapo"). Niveau 2 : tous les mots présents.
// Niveau 3 : au moins un mot (dernier recours — le fullName en base peut être
// incomplet, ex. "yapo" pour quelqu'un appelé "Steven Yapo").
function personFilterGroups(personName) {
  const name = String(personName || '').trim();
  const tokens = name.split(/\s+/).filter((t) => t.length >= 2);
  const relContains = (v) => ({
    OR: [
      { requester: { fullName: { contains: v, mode: 'insensitive' } } },
      { assignedTo: { fullName: { contains: v, mode: 'insensitive' } } },
      { assignees: { some: { fullName: { contains: v, mode: 'insensitive' } } } },
      { observers: { some: { fullName: { contains: v, mode: 'insensitive' } } } },
    ],
  });
  const groups = [relContains(name)];
  if (tokens.length > 1) {
    groups.push({ AND: tokens.map((t) => relContains(t)) });
    groups.push({ OR: tokens.flatMap((t) => relContains(t).OR) });
  }
  return groups;
}

function personNameTokens(personName) {
  const tokens = String(personName || '').trim().split(/\s+/).filter((t) => t.length >= 2);
  return tokens.length > 0 ? tokens.map((t) => t.toLowerCase()) : [String(personName || '').toLowerCase()];
}

// Recherche d'utilisateurs tolérante (même escalier) — sert aux notes de
// désambiguïsation : "Steven Yapo" doit retrouver l'utilisateur « yapo »
// au lieu de renvoyer "personne", ce qui poussait le LLM à improviser.
async function findUsersByNameTolerant(personName, limit = 5) {
  const name = String(personName || '').trim();
  if (!name) return { level: 'none', users: [] };
  const tokens = name.split(/\s+/).filter((t) => t.length >= 2);
  const tryFind = async (extra) => prisma.user.findMany({
    where: { ...extra, deletedAt: null },
    select: { id: true, fullName: true, email: true, role: true },
    take: limit,
    orderBy: { fullName: 'asc' },
  }).catch(() => []);
  let users = await tryFind({ OR: [
    { fullName: { contains: name, mode: 'insensitive' } },
    { email: { contains: name, mode: 'insensitive' } },
  ] });
  if (users.length > 0) return { level: 'phrase', users };
  if (tokens.length > 1) {
    users = await tryFind({ AND: tokens.map((t) => ({
      OR: [{ fullName: { contains: t, mode: 'insensitive' } }, { email: { contains: t, mode: 'insensitive' } }],
    })) });
    if (users.length > 0) return { level: 'all_tokens', users };
    users = await tryFind({ OR: tokens.flatMap((t) => [
      { fullName: { contains: t, mode: 'insensitive' } },
      { email: { contains: t, mode: 'insensitive' } },
    ]) });
    if (users.length > 0) return { level: 'any_token', users };
  }
  return { level: 'none', users: [] };
}

async function findTicketsForPersonAnyRole(personName, { limit = 20, period = null, user = null } = {}) {
  const base = {
    deletedAt: null,
    approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
  };
  if (period) {
    const { start, end } = resolvePeriodDates(period);
    if (start) base.createdAt = { ...base.createdAt, gte: start };
    if (end) base.createdAt = { ...base.createdAt, lt: end };
  }

  // Escalier de tolérance : on tente chaque niveau jusqu'à trouver des tickets.
  let tickets = [];
  let totalCount = 0;
  let matchLevel = 'none';
  const groups = personFilterGroups(personName);
  for (let i = 0; i < groups.length; i++) {
    const where = { ...base, ...groups[i] };
    // Respect du périmètre demandeur : un REQUESTER ne voit que ses propres tickets
    if (user?.role === 'REQUESTER') {
      where.AND = [...(where.AND || []), { requesterId: user.sub }];
    }
    [tickets, totalCount] = await Promise.all([
      prisma.ticket.findMany({
        where,
        take: limit,
        include: {
          requester: { select: { fullName: true, email: true } },
          assignedTo: { select: { fullName: true } },
          assignees: { select: { fullName: true } },
          observers: { select: { fullName: true } },
          team: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.ticket.count({ where }),
    ]);
    if (tickets.length > 0 || i === groups.length - 1) {
      matchLevel = i === 0 ? 'phrase' : (i === 1 ? 'all_tokens' : 'any_token');
      break;
    }
  }

  // Annoter chaque ticket avec le(s) rôle(s) de la personne pour un affichage honnête.
  // Matching PAR MOT : "Steven Yapo" doit annoter les tickets de l'utilisateur « yapo ».
  const toks = personNameTokens(personName);
  const nameMatches = (v) => {
    const s = (v || '').toLowerCase();
    return toks.some((t) => s.includes(t));
  };
  const annotated = tickets.map((t) => {
    const roles = [];
    if (nameMatches(t.requester?.fullName)) roles.push('demandeur');
    if (nameMatches(t.assignedTo?.fullName)) roles.push('assigné');
    if ((t.assignees || []).some((a) => nameMatches(a.fullName))) roles.push('assigné');
    if ((t.observers || []).some((o) => nameMatches(o.fullName))) roles.push('observateur');
    return { ...t, personRoles: roles };
  });
  return { tickets: annotated, totalCount, matchLevel };
}

function getKeywordVariants(kw) {
  if (!kw || typeof kw !== 'string') return [];
  const trimmed = kw.trim();
  if (!trimmed) return [];

  const set = new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()]);

  // Dé-accentuation
  const unaccented = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  set.add(unaccented);
  set.add(unaccented.toLowerCase());
  set.add(unaccented.toUpperCase());

  // Dictionnaire de correspondances d'accents IT français
  const knownMap = {
    "securite": ["Sécurité", "sécurité", "SECURITE", "Sécurite"],
    "reseau": ["Réseau", "réseau", "RESEAU", "Réseaux", "réseaux"],
    "telephonie": ["Téléphonie", "téléphonie", "TELEPHONIE"],
    "systeme": ["Système", "système", "SYSTEME", "Systèmes"],
    "materiel": ["Matériel", "matériel", "MATERIEL", "Matériels"],
    "developpement": ["DÉVELOPPEMENT", "Développement", "développement", "DEVELOPPEMENT"],
    "applicatif": ["Applicatif", "applicatif", "Applicatifs"],
    "logiciel": ["Logiciel", "logiciel", "Logiciels"],
  };

  const norm = unaccented.toLowerCase();
  if (knownMap[norm]) {
    for (const v of knownMap[norm]) set.add(v);
  }

  return [...set];
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

  // Équipe : filtre à la fois ticket.team.name ET assignedTo.team.name avec variantes d'accents
  if (params.teamName) {
    const variants = getKeywordVariants(params.teamName);
    const teamFilter = {
      OR: variants.flatMap(v => [
        { team: { name: { contains: v, mode: 'insensitive' } } },
        { assignedTo: { team: { name: { contains: v, mode: 'insensitive' } } } },
      ]),
    };
    if (where.OR) {
      where.AND = [...(where.AND || []), teamFilter];
    } else {
      where.OR = teamFilter.OR;
    }
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

  // Mot-clé (titre, contenu, catégorie, équipe) avec variantes d'accents
  if (params.keyword && params.keyword.length > 1) {
    const kw = params.keyword;
    const variants = getKeywordVariants(kw);
    const keywordFilter = variants.flatMap(v => [
      { title: { contains: v, mode: 'insensitive' } },
      { content: { contains: v, mode: 'insensitive' } },
      { category: { contains: v, mode: 'insensitive' } },
      { team: { name: { contains: v, mode: 'insensitive' } } },
      { assignedTo: { team: { name: { contains: v, mode: 'insensitive' } } } },
    ]);

    // Pour le chatbot : la recherche par mot-clé est globale (tous les tickets),
    // pas restreinte aux seuls tickets du demandeur/technicien. Un utilisateur qui
    // cherche "sauvegarde" doit trouver #73 même si ce n'est pas son ticket.
    where.OR = keywordFilter;
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
      // Compléter avec l'ID regex si le LLM l'a raté (ex: "montre-moi le ticket #12"
      // extrait à tort en keyword:"12") — un ID explicite est un signal déterministe fort.
      if (regexParams && regexParams.ticketId && !params.ticketId) {
        params.ticketId = regexParams.ticketId;
        if (params.keyword === String(regexParams.ticketId)) delete params.keyword;
      }
    }
    // Keyword purement numérique → c'est un ID de ticket, pas un mot-clé de recherche
    if (params?.keyword && /^\d+$/.test(params.keyword) && !params.ticketId) {
      params.ticketId = parseInt(params.keyword, 10);
      delete params.keyword;
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

// ── Recherche d'équipes ────────────────────────────────────────────────

async function searchTeams(query = '', limit = 10) {
  try {
    const teams = await prisma.team.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        groupEmail: true,
        members: { select: { id: true, fullName: true, role: true } },
        _count: { select: { tickets: true } },
      },
      orderBy: { name: 'asc' },
    });
    if (!query || !query.trim() || /liste|tous|équipes?|equipes?/i.test(query.trim())) {
      return teams.slice(0, limit);
    }
    const cleanQ = normalizeAccents(query.trim().toLowerCase());
    const filtered = teams.filter((t) => {
      const nameClean = normalizeAccents(t.name.toLowerCase());
      const descClean = normalizeAccents((t.description || '').toLowerCase());
      return nameClean.includes(cleanQ) || cleanQ.includes(nameClean);
    });
    return filtered.slice(0, limit);
  } catch (err) {
    console.error('[chatbot] Erreur searchTeams:', err.message);
    return [];
  }
}

// ── Tool definitions (function calling) ──────────────────────────────

const ALL_CHATBOT_TOOLS = [
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
      description: 'Chercher des tickets similaires à un problème donné, ou à un ticket existant par son numéro. Utilise la similarité vectorielle (sémantique) pour trouver les tickets les plus proches.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'integer', description: 'Numéro du ticket source pour chercher des similaires (optionnel)' },
          title: { type: 'string', description: 'Titre ou description du problème (optionnel si ticketId fourni)' },
          description: { type: 'string', description: 'Description détaillée (optionnel)' },
        },
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
      description: 'Classement des techniciens par nombre de tickets résolus ET total. Utile pour « qui a le plus résolu », « meilleur taux de résolution », « classement des techs ».',
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
  {
    type: 'function',
    function: {
      name: 'search_teams',
      description: 'Rechercher des équipes par nom et lister leurs membres. Utile pour demander la liste des membres d\'une équipe.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nom de l\'équipe (ex: sécurité, réseau, téléphonie)' },
        },
        required: ['query'],
      },
    },
  },
];

// ── Filtre : seuls les outils de lecture sont exposés au LLM ──
// Les actions d'écriture (create, change_status, assign) ne doivent JAMAIS
// être déclenchées par un choix du modèle — elles sont réservées au code interne.
const WRITE_ACTION_TOOLS = new Set(['create_ticket', 'change_ticket_status', 'assign_ticket']);
const CHATBOT_TOOLS = ALL_CHATBOT_TOOLS.filter(t => !WRITE_ACTION_TOOLS.has(t.function.name));

// ── Exécution des tools ──────────────────────────────────────────────

// ── Liste blanche des capacités (dérivée du CODE réel, jamais copiée à la main) ──
// Le LLM n'a le droit d'annoncer QUE les actions correspondant aux outils définis
// dans CHATBOT_TOOLS ci-dessus. Toute autre promesse ("je vous envoie un mail",
// "c'est planifié", "je relance l'équipe") est une hallucination d'action.
function buildCapabilityLine() {
  const names = CHATBOT_TOOLS.map((t) => t?.function?.name).filter(Boolean);
  return `\n\nCE QUE TU PEUX FAIRE (liste fermée) :\n${names.map((n) => '- ' + n).join('\n')}\n\nPour un suivi sur un ticket existant, tu peux l'ajouter directement (add_ticket_followup) après confirmation de l'utilisateur.\nRègle : quand l'utilisateur te demande d'ajouter un suivi, appelle add_ticket_followup directement avec ticketId et content. Ne demande PAS la visibilité (public/privé) — c'est public par défaut. Ne pose PAS de questions supplémentaires avant la confirmation.\nSi on te demande de créer, clôturer ou réassigner un ticket : ne dis jamais que tu ne peux pas — oriente directement et naturellement vers l'ERP, ou propose d'ajouter un suivi qui résume la demande. Ne mentionne jamais tes limites, tes outils, ou ce que tu ne fais pas.`;
}

async function executeTool(toolName, args, user, { confirmed = false } = {}) {
  // ── Garde-fou défensif : les actions d'écriture ne sont plus exécutables par le LLM ──
  if (WRITE_ACTION_TOOLS.has(toolName)) {
    return { redirect: true, message: 'Consulte directement l\'ERP pour cette action, ou ajoute un suivi sur le ticket concerné.' };
  }

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

      // ── Chemin direct : quand le LLM fournit des params structurés (locationName,
      // status, priority, etc.), on construit la requête Prisma directement sans repasser
      // par callSearchParamsAI qui risque de réinterpréter le query (ex: "Siège Abidjan"
      // → teamName:"Abidjan" au lieu de locationName:"Siège Abidjan"). ──
      const hasStructuredParams = p.locationName || p.status || p.priority || p.assignedTo || p.requester || p.person || p.category || p.period;
      if (hasStructuredParams && !p.query) {
        const searchParams = {};
        if (p.locationName) searchParams.locationName = p.locationName;
        if (p.status) searchParams.statuses = [p.status];
        if (p.priority) searchParams.priorities = [p.priority];
        if (p.assignedTo) searchParams.assignedToName = p.assignedTo;
        if (p.requester) searchParams.requesterName = p.requester;
        if (p.person) searchParams.personName = p.person;
        if (p.category) searchParams.keyword = p.category;
        if (p.period) searchParams.period = p.period;

        const where = buildSearchQuery(searchParams, user);
        const tickets = await prisma.ticket.findMany({
          where,
          take: p.limit || 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, title: true, status: true, priority: true, locationName: true, category: true,
            content: true, createdAt: true, slaResolutionDueAt: true, approvalStatus: true,
            requester: { select: { fullName: true, email: true } },
            assignedTo: { select: { fullName: true } },
            team: { select: { name: true } },
          },
        });
        console.log(`[chatbot] search_tickets direct: ${tickets.length} résultats pour ${JSON.stringify(searchParams)}`);
        return tickets.map(t => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          locationName: t.locationName, requester: t.requester?.fullName || null,
          assignedTo: t.assignedTo?.fullName || null, team: t.team?.name || null,
          createdAt: t.createdAt, category: t.category,
        }));
      }

      // ── Chemin classique : query texte → AI re-parsing ──
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
    case 'find_similar_tickets':
      return await findSimilarTickets(p.title, p.description || p.title, user, p.ticketId || null);
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
      // Inclure TOUS les tickets (ouverts ET résolus) pour un vrai classement
      // L'ancien filtre `status NOT IN (CLOSED, SOLVED)` excluait les résolutions
      // et rendait le comptage "résolus" toujours à 0.
      const period = p.period || '30d';
      const techWhere = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
      const startDate = getStartDateFromPeriod(period);
      if (startDate) {
        techWhere.createdAt = { gte: startDate };
      }
      const allTickets = await prisma.ticket.findMany({
        where: techWhere,
        select: { id: true, status: true, priority: true, assignedTo: { select: { fullName: true } } },
      });
      const techMap = new Map();
      for (const t of allTickets) {
        const name = t.assignedTo?.fullName || 'Non assigné';
        if (!techMap.has(name)) techMap.set(name, { total: 0, resolved: 0, urgent: 0 });
        const entry = techMap.get(name);
        entry.total++;
        if (t.status === 'SOLVED' || t.status === 'CLOSED') entry.resolved++;
        if (t.priority === 'P1' || t.priority === 'P2') entry.urgent++;
      }
      return [...techMap.entries()]
        .sort((a, b) => b[1].resolved - a[1].resolved) // classement par résolutions
        .slice(0, p.limit || 10)
        .map(([name, data], i) => ({
          rank: i + 1,
          name,
          total: data.total,
          resolved: data.resolved,
          resolutionRate: data.total > 0 ? Math.round((data.resolved / data.total) * 100) : 0,
          urgent: data.urgent,
        }));
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
    case 'search_teams':
      return await searchTeams(p.query, 10);
    case 'search_knowledge':
      return await searchKnowledge(p.query, 5);
    case 'add_ticket_followup':
      if (!confirmed) {
        const visLabel = p.isPrivate ? 'Privé (interne IT)' : 'Public';
        return {
          needsConfirmation: true,
          tool: toolName,
          args: p,
          message: `Je m'apprête à ajouter ce suivi au ticket #${p.ticketId} :\n> "${p.content}"\n\nVisibilité : ${visLabel}\n\nConfirme ?`,
        };
      }
      return await addTicketFollowup(p.ticketId, p.content, p.isPrivate, user);
    default:
      return `Outil inconnu: ${toolName}`;
  }
}

// ── Appel IA avec tool calling (boucle agentic) ─────────────────────

const MAX_TOOL_ROUNDS = 6;

async function callAIWithTools(messages, options = {}) {
  let providers = await getActiveProviders();
  if (providers.length === 0) throw new Error('Aucun fournisseur IA configuré.');

  // Mode vocal : modèle rapide (latence) + 3 tours max
  const maxRounds = options.voiceMode ? 3 : MAX_TOOL_ROUNDS;
  let forcedModelId = options.forcedModelId || null;
  if (options.voiceMode && !forcedModelId) {
    // Cherche le modèle le plus rapide (flash-lite) pour le vocal
    for (const p of providers) {
      const fast = p.models.find((m) => m.name.includes('flash-lite') || m.name.includes('flash-latest'));
      if (fast) { forcedModelId = fast.id; break; }
    }
  }

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

  // Préparer les messages avec résumé si la conversation est longue
  let { trimmedMessages, newSummary } = await prepareMessagesWithSummary(
    apiMessages,
    options.existingSummary || null,
    options.summaryModelId || null
  );
  if (newSummary) options._newSummary = newSummary;

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
  const allToolResults = []; // résultats d'outils cumulés — remontés à l'appelant pour la validation des chiffres
  for (let round = 0; round < maxRounds; round++) {
    // Tools disponibles jusqu'à l'avant-dernier round ; le dernier round force une
    // réponse texte. AUPARAVANT : tools uniquement au round 0 → si le LLM avait
    // besoin d'une 2e recherche (utilisateur trouvé → puis ses tickets), il n'avait
    // que l'invention comme issue.
    const callTools = round < maxRounds - 1;
    const result = await callAiWithRetry(() => callProviderWithFallback(providers, null, 'chatbot', {
      messages: trimmedMessages,
      system: systemContent,
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens ?? 4096,
      tools: callTools ? CHATBOT_TOOLS : undefined,
      forcedModelId: forcedModelId || options.forcedModelId,
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
    let pendingConfirmation = null;
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

      // Si l'outil nécessite une confirmation → arrêter la boucle immédiatement
      if (fnResult && fnResult.needsConfirmation) {
        pendingConfirmation = fnResult;
        break;
      }

      const resultText = typeof fnResult === 'string' ? fnResult : JSON.stringify(fnResult, null, 2);
      allToolResults.push(`## ${fnName}\n${resultText.substring(0, 6000)}`);
      toolResults.push(`## ${fnName}\n${resultText.substring(0, 6000)}`);
    }

    // Si une confirmation est en attente → renvoyer le message de confirmation
    // et persister l'action en attente dans le state conversationnel
    if (pendingConfirmation) {
      // Sauvegarder l'action en attente pour le prochain message
      if (options._stateKey) {
        await setConversationState(options._stateKey, 'pendingConfirmation', {
          tool: pendingConfirmation.tool,
          args: pendingConfirmation.args,
        }, []);
      }
      return { text: pendingConfirmation.message, toolData: allToolResults.join('\n\n---\n\n'), pendingConfirmation };
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

  // ⚠️ CHANGEMENT DE CONTRAT : renvoyer { text, toolData } au lieu d'une string.
  return { text: finalText, toolData: allToolResults.join('\n\n---\n\n'), pendingConfirmation: null };
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

// Seuil de tokens déclenchant un résumé (avant la troncature à 16k)
const SUMMARIZE_THRESHOLD_TOKENS = 12000;

/**
 * Résume les anciens messages d'une conversation pour libérer de l'espace dans le budget token.
 * Utilise un modèle léger (summaryAiModelId ou fallback) pour minimiser le coût.
 *
 * @param {Array} messages - Messages de la conversation (role + content)
 * @param {number|null} forcedModelId - ID du modèle à utiliser (optionnel)
 * @returns {string|null} Le résumé, ou null si échec
 */
async function summarizeConversationHistory(messages, forcedModelId = null) {
  const providers = await getActiveProviders();
  if (providers.length === 0) return null;

  // Prendre les 10 premiers messages à résumer (les plus anciens)
  const toSummarize = messages.slice(0, 10);
  if (toSummarize.length < 2) return null;

  const historyText = toSummarize
    .map((m) => `[${m.role === 'assistant' ? 'MARIE' : 'Utilisateur'}] ${(m.content || '').substring(0, 500)}`)
    .join('\n');

  const prompt = `Résume cette conversation ITSM en 3-4 points clés. Pour chaque point, indique le problème mentionné et le statut si connu.

CONVERSATION :
${historyText}

Réponds UNIQUEMENT avec le résumé en texte brut (pas de JSON, pas de markdown), 3-4 phrases max.`;

  try {
    const raw = await callProviderWithFallback(providers, prompt, 'chatbot', {
      forcedModelId,
      temperature: 0.1,
      maxTokens: 300,
    });
    return (raw || '').trim().substring(0, 1000) || null;
  } catch (err) {
    console.error(`[chatbot] Échec résumé conversation:`, err.message);
    return null;
  }
}

/**
 * Prépare l'historique pour l'appel IA en appliquant la troncature + résumé si nécessaire.
 * Si la conversation est longue (> 12k tokens), résume les anciens messages et les remplace
 * par un bloc "[Résumé de la conversation précédente]".
 *
 * @param {Array} apiMessages - Messages API (role + content)
 * @param {string|null} existingSummary - Résumé existant en DB (Conversation.summary)
 * @param {number|null} summaryModelId - ID du modèle léger pour le résumé
 * @returns {{ trimmedMessages: Array, newSummary: string|null }}
 */
async function prepareMessagesWithSummary(apiMessages, existingSummary = null, summaryModelId = null) {
  const MAX_HISTORY_TOKENS = 16000;
  let trimmedMessages = [...apiMessages];
  let totalTokens = trimmedMessages.reduce((s, m) => s + estimateTokens(m.content), 0);

  // Si on dépasse le seuil ET qu'on n'a pas déjà un résumé, en créer un
  if (totalTokens > SUMMARIZE_THRESHOLD_TOKENS) {
    // Avec ou sans résumé existant : on résume les plus anciens au-delà des 4 derniers
    if (!existingSummary) {
      const messagesToSummarize = trimmedMessages.slice(0, -4);
      if (messagesToSummarize.length >= 2) {
        const summary = await summarizeConversationHistory(messagesToSummarize, summaryModelId);
        if (summary) {
          const recentMessages = trimmedMessages.slice(-4);
          trimmedMessages = [
            { role: 'user', content: `[Résumé de la conversation précédente]\n${summary}` },
            ...recentMessages,
          ];
          totalTokens = trimmedMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
          return { trimmedMessages, newSummary: summary };
        }
      }
    } else {
      // Résumé hiérarchique : append, pas overwrite
      const messagesToSummarize = trimmedMessages.slice(0, -6);
      if (messagesToSummarize.length >= 2) {
        const summary = await summarizeConversationHistory(messagesToSummarize, summaryModelId);
        if (summary) {
          const combined = (existingSummary + '\n' + summary).slice(0, 3000);
          const recentMessages = trimmedMessages.slice(-6);
          trimmedMessages = [
            { role: 'user', content: `[Résumé de la conversation précédente]\n${combined}` },
            ...recentMessages,
          ];
          totalTokens = trimmedMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
          return { trimmedMessages, newSummary: combined };
        }
      }
    }
  }

  // Si on a déjà un résumé, l'injecter au début
  if (existingSummary && trimmedMessages.length > 2) {
    const recentMessages = trimmedMessages.slice(-6); // Garder les 6 derniers
    trimmedMessages = [
      { role: 'user', content: `[Résumé de la conversation précédente]\n${existingSummary}` },
      ...recentMessages,
    ];
    totalTokens = trimmedMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
  }

  // Troncature classique si toujours trop long
  while (trimmedMessages.length > 1 && totalTokens > MAX_HISTORY_TOKENS) {
    totalTokens -= estimateTokens(trimmedMessages[0].content);
    trimmedMessages.shift();
  }

  return { trimmedMessages, newSummary: null };
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

  // Préparer les messages avec résumé si la conversation est longue
  let { trimmedMessages, newSummary } = await prepareMessagesWithSummary(
    apiMessages,
    options.existingSummary || null,
    options.summaryModelId || null
  );
  if (newSummary) options._newSummary = newSummary;

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
    // 0.3 : tournures naturelles sans broder les chiffres. Le ton de MARIE vient du
    // SYSTEM_PROMPT, pas de la température — à 0.8 le modèle arrondit les totaux et
    // complète les tableaux (réponses factuelles = la voie de tous les intents à contexte).
    temperature: options.temperature ?? 0.3,
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

;

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
  const daysMatch = lower.match(/\b(\d+)\s*jours?\b/);
  if (daysMatch) return `${daysMatch[1]}d`;

  return null;
}

function getStartDateFromPeriod(period) {
  if (!period || period === 'all') return null;
  if (period === 'today' || period === '1d') return new Date(new Date().setHours(0, 0, 0, 0));
  if (period === 'yesterday') return new Date(Date.now() - 2 * 86400000);
  if (period === '7d' || period === 'this_week' || period === 'last_week') return new Date(Date.now() - 7 * 86400000);
  if (period === '30d' || period === 'this_month' || period === 'last_month') return new Date(Date.now() - 30 * 86400000);
  if (period === '90d') return new Date(Date.now() - 90 * 86400000);
  const match = String(period).match(/^(\d+)d$/);
  if (match) return new Date(Date.now() - parseInt(match[1], 10) * 86400000);
  return new Date(Date.now() - 30 * 86400000);
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
// Persisté en PostgreSQL via le champ Conversation.state (JSONB)
// Clé : "conv:{id}" ou "user:{id}" (fallback mémoire si pas de conversation)

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Fallback mémoire pour les cas sans conversationId (avant création)
const _memStateFallback = new Map();

function _extractConvId(key) {
  if (!key) return null;
  const m = key.match(/^conv:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

async function getConversationState(key) {
  if (!key) return null;

  const convId = _extractConvId(key);
  if (convId) {
    try {
      const conv = await prisma.conversation.findUnique({ where: { id: convId }, select: { state: true } });
      if (!conv?.state) return null;
      const state = conv.state;
      if (Date.now() - (state.timestamp || 0) > STATE_TTL_MS) return null;
      return state;
    } catch (err) {
      console.warn('[chatbot] getConversationState DB error:', err.message);
      return null;
    }
  }

  // Fallback mémoire (pas de conversationId)
  const state = _memStateFallback.get(key);
  if (!state) return null;
  if (Date.now() - state.timestamp > STATE_TTL_MS) {
    _memStateFallback.delete(key);
    return null;
  }
  return state;
}

async function setConversationState(key, intent, params, tickets = []) {
  if (!key) return;
  const state = { intent, params, tickets, timestamp: Date.now() };

  const convId = _extractConvId(key);
  if (convId) {
    try {
      await prisma.conversation.update({ where: { id: convId }, data: { state } });
    } catch (err) {
      console.warn('[chatbot] setConversationState DB error:', err.message);
    }
  } else {
    _memStateFallback.set(key, state);
  }
}

// ── Intent detection (IA + regex fallback) ─────────────────────────────

function detectIntentRegex(message, previousState = null) {
  const lower = message.toLowerCase();
  const period = parsePeriodFromText(message);

  // 1. Superlatifs / comparatifs / classements techniciens → top_technicians (AVANT change_status et assign_ticket)
  if (lower.match(/\b(quel|quelle|qui|le|la)\b.{0,30}\b(technicien|technicienne)\b.{0,30}\b(plus|moins|top|meilleur|pire|charg[ée]|r[ée]sout|r[ée]solu|performant)\b/)) return { intent: 'top_technicians', params: { period } };
  if (lower.match(/\b(technicien|technicienne)\b.{0,30}\b(a r[ée]solu|a le plus|résout|r[ée]solution)\b/)) return { intent: 'top_technicians', params: { period } };
  if (lower.match(/\b(plus|moins|top|meilleur|pire)\b.{0,20}\b(technicien|technicienne)\b/)) return { intent: 'top_technicians', params: { period } };
  if (lower.match(/\b(classement|performance|r[ée]so.u.*plus)\b.{0,20}\b(technicien|technicienne)\b/)) return { intent: 'top_technicians', params: { period } };

  // 2. Superlatifs / comparatifs sur lieux/magasins → top_locations
  if (lower.match(/\b(quel|quelle|quels|quelles|le|la|les)\b.{0,30}\b(magasin|lieu|site|centre)\b.{0,30}\b(plus|moins|plus grand|plus petit|top|meilleur|pire)\b/)) return { intent: 'top_locations', params: { period } };
  if (lower.match(/\b(magasin|lieu|site)\b.{0,20}\b(fait|fait le plus|a le plus|génère|genere|cause|provoque)\b/)) return { intent: 'top_locations', params: { period } };
  if (lower.match(/\b(classement|classe|ranking|palmar[èe]s|top)\b/) && lower.match(/\b(magasin|lieu|site|centre)\b/)) return { intent: 'top_locations', params: { period } };

  // 3. Répartition / bilans d'équipe → team_report (AVANT assign_ticket)
  if (lower.match(/\b(r[ée]partition|bilan.*quipe|r[ée]union.*hebdo|ouverts par equipe|ouverts par équipe)\b/)) return { intent: 'team_report', params: { period } };

  // 4. Recherche inventaire / matériel
  if (lower.match(/\b(inventaire|asset[s]?|mat[ée]riel en stock|pc en stock)\b/)) return { intent: 'search_inventory', params: { period } };
  if (lower.match(/\b([ée]quipement|asset|pc portable|imprimante|ordinateur)\b/) && lower.match(/\b(inventaire|stock)\b/)) return { intent: 'search_inventory', params: { period } };

  if (lower.match(/\b(r[ée]sume|r[ée]sum[ée])\b/)) {
    if (/\b(demandes?|tickets?|liste|requêtes?|interventions?|ses\s+tickets?|ses\s+demandes?)\b/.test(lower) && !/#\d+/.test(lower)) {
      return { intent: 'search_tickets', params: { period } };
    }
    return { intent: 'summary', params: { period } };
  }
  if (lower.match(/\b(similaire|doublon|m[êe]me (probl[èe]me|incident|sujet)|y a-t-il|d[ée]j[à])\b/)) return { intent: 'similar_tickets', params: { period } };

  // Actions précises sur tickets (AVANT les règles plus larges)
  if (lower.match(/\b(ferme|clôtur|cloture|change.*statut|met.*statut)\b/) && !lower.match(/\b(mot de passe|mot passe|password)\b/)) return { intent: 'change_status', params: { period } };
  if (lower.match(/\b(passe)\b/) && lower.match(/#\d+/) && !lower.match(/\b(mot de passe|mot passe|password)\b/)) return { intent: 'change_status', params: { period } };
  if (lower.match(/\b(assigne|affecte|attribue)\b/) && !lower.match(/\b(mot de passe|mot passe|password)\b/)) return { intent: 'assign_ticket', params: { period } };

  // search_teams : demandes d'affichage/liste des équipes sans mention explicite de "tickets" ou "demandes"
  if (/(?:liste|quelles?|quels?|montre|affiche|donne[- ]?moi|regarde|voir|qu'est-ce que|quelles sont)\b.*?(?:équipes?|equipes?)/i.test(lower)
    && !/(?:tickets?|tikets?|tiquets?|tckets?|demandes?|requêtes?)/i.test(lower)) {
    return { intent: 'search_teams', params: { period } };
  }

  // search_users
  if (lower.match(/\b(utilisateur|user|email de|t[ée]l[ée]phone de|nom de)\b/) && !lower.match(/\b(plus|moins|top|meilleur|pire|charg[ée]|résout|charge)\b/)) return { intent: 'search_users', params: { period } };
  if (lower.match(/\b(qui est|qui suis)[-\s]?(je)?\b/) && !lower.match(/\b(technicien|technicienne|le plus|la plus|meilleur|pire|charg[ée]|résout)\b/)) return { intent: 'search_users', params: { period } };

  // search_locations
  if (lower.match(/\b(lieu|site|o[uù] se trouve|adresse|localisation|magasin\s+(de\s+)?[a-z])\b/) && !lower.match(/\b(plus|moins|top|meilleur|pire|le plus|la plus|comparer|classement)\b/)) return { intent: 'search_locations', params: { period } };

  // Consultation / question sur un ticket spécifique par son numéro (#16, ticket 16, ticket #16...)
  if (/(?:#\d+|ticket\s*#?\s*\d+)/i.test(lower) && !/\b(ferme|clôtur|cloture|assigne|affecte|attribue|temps|liens?|doublon)\b/i.test(lower)) {
    const tidMatch = lower.match(/(?:#|ticket\s*#?\s*)(\d+)/i);
    const ticketId = tidMatch ? parseInt(tidMatch[1], 10) : null;
    return { intent: 'check_ticket', params: { period, ticketId } };
  }

  // Typo-tolerant ticket word matching: ticket, tickets, tiket, tikets, tiquet, tiquets, tcket, tckets, demande, demandes
  const TICKET_WORD = /(?:tickets?|tikets?|tiquets?|tckets?|demandes?|requêtes?)/i;

  // Date explicite + "tickets"
  if (/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(lower) && TICKET_WORD.test(lower)) {
    return { intent: 'search_tickets', params: { period } };
  }
  // Questions d'existence de tickets pour une personne, équipe ou domaine
  if (TICKET_WORD.test(lower) && /\b(a[- ]t[- ]il|a[- ]t[- ]elle|a des|y a[- ]t[- ]il|pour|concernant|sur|de|des|du|la)\b/i.test(lower) && !/\b(cr[ée]er?|ouvrir?|nouveau)\b/i.test(lower)) {
    return { intent: 'search_tickets', params: { period } };
  }

  if (lower.match(/\b(quels?|liste|listes|montre|affiche|donne[- ]?moi|cherche|recherche|tous?|toute?)\b/) && TICKET_WORD.test(lower)) return { intent: 'search_tickets', params: { period } };
  if (lower.match(/\b(quels?|liste|listes|montre|affiche|donne[- ]?moi|cherche|recherche|tous?|toute?)\b/) && lower.match(/\b(magasin|lieu|site|stats?|statistiques?|incident|probl[èe]me|panne|cat[ée]gorie|technicien|[ée]quipe|historique|d[ée]tail|resume|sommaire|securit[ée]?|r[ée]seau|t[ée]l[ée]phonie|systeme|mat[ée]riel|logiciel)\b/)) return { intent: 'search_tickets', params: { period } };
  if (lower.match(/\b(magasin|lieu|top|comparer|plus de probl[èe]mes?|statistiques?|stats?|analyse|pourquoi|cause)\b/)) return { intent: 'analytics', params: { period } };
  if (lower.match(/^\s*(oui|yes|go|confirme|c'est bon|vas-y|ok|d'accord|je confirme|oui crée|oui vas)\b/i)) return { intent: 'confirm_create_ticket', params: { period } };
  if (/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident)\b/.test(lower) && /\b(pour|au nom de|pour le compte)\b/.test(lower)) return { intent: 'create_ticket_for', params: { period } };
  if (lower.match(/\b(quand|date|qu'est-ce que|c'est quoi|donne|dis-moi)\b/) && lower.match(/\b(cr[ée][eé]|statut|état|avancement|d[ée]tail|priorit[ée]|assign[ée])\b/)) return { intent: 'check_ticket', params: { period } };
  if (lower.match(/\b(il|elle|ce ticket|celui-ci|celui-là|le ticket)\b/) && lower.match(/\b(statut|état|avancement|cr[ée][eé]|priorit[ée]|assign[ée]|d[ée]tail|lieu|cat[ée]gorie)\b/)) return { intent: 'check_ticket', params: { period } };
  if (lower.match(/\b(statut|état|avancement|suiv[ie]|ticket\s*#?\s*\d+|#\d+|num[ée]ro)\b/)) return { intent: 'check_ticket', params: { period } };
  if (lower.match(/\b(cr[ée]er?|ouvrir?|nouveau ticket|nouvelle demande|signaler|probl[èe]me|incident|panne|souci|ne marche|fonctionne plus|erreur|assistance)\b/)) return { intent: 'create_ticket', params: { period } };
  if (lower.match(/\b(rapport|synth[èe]se|combien|nombre|total)\b/)) return { intent: 'report', params: { period } };
  if (lower.match(/\b(escalade|escalader|parler [àa]|contacter|passer [àa]|transfert|agent humain|technicien humain)\b/)) return { intent: 'escalate', params: { period } };
  if (lower.match(/\b(aide|commandes?|fonctionnalit[ée]s?|que sais|que peux|help|menu)\b/)) return { intent: 'help', params: { period } };
  return { intent: 'general', params: { period } };
}

// ── Contexte utilisateur ──────────────────────────────────────────────

async function getUserContext(userId) {
  if (!userId) return '';
  try {
    // ⚠️ Champs alignés sur le schéma Prisma : `team` est une relation simple (Team?), et les
    // compétences passent par la table de liaison UserSkill (skills → skill.name).
    // Les anciens champs `teams`/`skills.name` n'existent pas → PrismaClientValidationError
    // avalée par le catch → le bot ne connaissait JAMAIS le profil de l'utilisateur connecté
    // (d'où des questions inutiles type "sous quel nom es-tu enregistré ?").
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullName: true,
        email: true,
        role: true,
        team: { select: { name: true } },
        skills: { select: { level: true, skill: { select: { name: true } } } },
      },
    });
    if (!user) return '';

    const parts = [`Nom: ${user.fullName}`, `Email: ${user.email}`, `Rôle: ${user.role}`];
    if (user.team?.name) parts.push(`Équipe: ${user.team.name}`);
    if (user.skills?.length) parts.push(`Compétences: ${user.skills.map((s) => s.skill?.name).filter(Boolean).join(', ')}`);
    return parts.join(' | ');
  } catch (err) {
    console.error('[chatbot] getUserContext échoué:', err.message);
    return '';
  }
}

// ── Actions métier ─────────────────────────────────────────────────────

const STATUS_LABEL = { NEW: 'Nouveau', OPEN: 'Ouvert', PENDING: 'En attente', WAITING_FOR_USER: 'En attente utilisateur', SOLVED: 'Résolu', CLOSED: 'Fermé', PLANNED: 'Planifié' };
const PRIORITY_LABEL = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };

async function generateReport(period = null, fullList = false, teamName = null) {
  let teamFilter = {};
  let teamTitleLabel = '';
  if (teamName) {
    const team = await prisma.team.findFirst({
      where: { name: { contains: teamName, mode: 'insensitive' } }
    });
    if (team) {
      teamFilter = { teamId: team.id };
      teamTitleLabel = ` — Équipe ${team.name}`;
    }
  }

  // Filtrage temporel optionnel
  let dateFilter = {};
  if (period) {
    const { start, end } = resolvePeriodDates(period);
    if (start) dateFilter.gte = start;
    if (end) dateFilter.lt = end;
  }

  const where = {
    deletedAt: null,
    approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
    status: { notIn: ['CLOSED', 'SOLVED'] },
    ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
    ...teamFilter,
  };

  const baseWhere = {
    deletedAt: null,
    approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
    ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
    ...teamFilter,
  };

  const resolvedWhere = {
    deletedAt: null,
    approvalStatus: { notIn: ['PENDING', 'REJECTED'] },
    status: { in: ['SOLVED', 'CLOSED'] },
    ...(Object.keys(dateFilter).length > 0 ? { solvedAt: dateFilter } : {}),
    ...teamFilter,
  };

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
    prisma.ticket.count({ where: resolvedWhere }),
    prisma.ticket.groupBy({ by: ['status'], _count: true, where }),
    prisma.ticket.groupBy({ by: ['priority'], _count: true, where }),
  ]);

  if (openCount === 0 && resolvedCount === 0) return `Aucun ticket pour cette période${teamTitleLabel}.`;

  const byStatus = {};
  for (const s of statusCounts) byStatus[s.status] = s._count;
  const byPriority = {};
  for (const p of priorityCounts) byPriority[p.priority] = p._count;

  const periodLabel = period ? ` (${period})` : '';
  let report = `**Rapport${teamTitleLabel}${periodLabel}**\n\n`;
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
      timeEntries: { orderBy: { entryDate: 'desc' }, take: 10, select: { minutes: true, description: true, entryDate: true, user: { select: { fullName: true } } } },
      followups: { orderBy: { createdAt: 'desc' }, take: 10, select: { content: true, isPrivate: true, createdAt: true, author: { select: { fullName: true } } } },
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

  if (ticket.content) {
    r += `\n**Description complète :**\n${ticket.content}\n`;
  }

  // Suivis / commentaires récents
  if (ticket.followups?.length > 0) {
    r += `\n**Derniers suivis / commentaires (${ticket.followups.length}) :**\n`;
    for (const f of ticket.followups) {
      const cleanText = (f.content || '').replace(/<[^>]*>/g, '').trim();
      r += `• [${new Date(f.createdAt).toLocaleDateString('fr-FR')}] **${f.author?.fullName || 'Système'}**${f.isPrivate ? ' (privé)' : ''} : ${cleanText}\n`;
    }
  }

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
    for (const e of ticket.timeEntries) {
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

async function findSimilarTickets(title, description, user = null, ticketId = null) {
  // Si un ticketId est fourni, utiliser la recherche vectorielle par embedding
  if (ticketId) {
    const { findSimilarTicketsByVector } = require('../services/similarIncidentDetector');
    const vectorResults = await findSimilarTicketsByVector(ticketId, 5, 0.5);
    if (vectorResults.length > 0) return vectorResults;
  }

  // Recherche vectorielle par texte si pas de ticketId
  const query = `${title || ''} ${description || ''}`.trim();
  if (query) {
    const { findSimilarByText } = require('../services/similarIncidentDetector');
    const vectorResults = await findSimilarByText(query, 5, 0.4);
    if (vectorResults.length > 0) return vectorResults;
  }

  // Fallback : recherche par mots-clés (si pas d'embedding disponible)
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
    const isAssigned = ticket.assignedToId === (user.sub || user.id);
    if (!isAssigned) {
      const isMultiAssigned = await prisma.ticket.findFirst({
        where: { id, assignees: { some: { id: user.sub || user.id } } },
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
      authorId: user.sub || user.id,
      content: sanitized,
      isPrivate: isPrivate === true,
    },
    include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  if (['ADMIN', 'TECHNICIAN', 'HOTLINE', 'SUPERADMIN'].includes(user.role)) {
    try {
      await recordFirstResponse(id, user.sub || user.id);
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

  // ⚠️ Le champ Prisma est `solvedAt` (PAS `resolvedAt` qui n'existe pas sur Ticket —
  // une sélection avec un champ inconnu lève PrismaClientValidationError et faisait
  // planter tout le handleMessage sur une demande "perf de <Nom>").
  const tickets = await prisma.ticket.findMany({
    where: { assignedToId: user.id, deletedAt: null },
    select: { status: true, priority: true, createdAt: true, solvedAt: true, closedAt: true },
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
      const resolvedDate = t.solvedAt || t.closedAt;
      if (resolvedDate) {
        totalResolutionTime += (new Date(resolvedDate) - new Date(t.createdAt)) / (1000 * 60 * 60);
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

// ── Passe 2 : Audit & Ajustement (Auto-correction par le second LLM) ─────
// Évalue la réponse proposée par la 1ère passe face à la question exacte de l'utilisateur,
// au contexte de conversation et aux outils disponibles.
// Si la 1ère réponse est satisfaisante, elle est conservée/affichée.
// Si elle contient des hallucinations, imprécisions, ou a renvoyé à tort "aucun résultat", elle est ajustée.
async function auditAndAdjustResponse(message, draftReply, options = {}) {
  const {
    conversationHistory = [],
    fullSystemPrompt = '',
    toolData = '',
    voiceModelOptions = {},
  } = options;

  if (!draftReply || isGreetingMessage(message)) {
    return draftReply;
  }

  // ── Auto-secours Passe 2 : si la 1ère passe a renvoyé "aucun ticket" ou "pas de données" ──
  const isNoDataReply = /\b(aucun ticket|n'ai trouvé aucun|aucun [ée]quipement|pas de données|aucune donnée|pas d'éléments|pas cette donnée)\b/i.test(draftReply);
  let rescueContext = '';

  if (isNoDataReply) {
    let rescued = [];

    // 1. Recherche par ID de ticket explicite (#16, ticket 16, etc.)
    const ticketIdMatches = [...message.matchAll(/(?:#|ticket\s*#?\s*)(\d+)/gi)]
      .map(m => parseInt(m[1], 10))
      .filter(id => !isNaN(id));

    if (ticketIdMatches.length > 0) {
      try {
        rescued = await prisma.ticket.findMany({
          where: { id: { in: ticketIdMatches }, deletedAt: null },
          take: 10,
          select: {
            id: true, title: true, status: true, priority: true, locationName: true, category: true,
            createdAt: true, solvedAt: true, closedAt: true,
            requester: { select: { fullName: true } }, assignedTo: { select: { fullName: true } },
          },
        });
      } catch (errId) {
        console.warn('[chatbot] Erreur Passe 2 Secours par ID:', errId.message);
      }
    }

    // 2. Recherche par mots-clés significatifs de la question
    if (rescued.length === 0) {
      const words = message.toLowerCase()
        .replace(/[^\wà-ÿ\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !/^(les|des|du|de|la|le|un|une|sur|pour|dans|par|avec|cette|ce|ces|quel|quels|quelle|quelles|qui|est|mon|ma|mes|vos|votre|nos|notre|mois|semaine|jour|demandes?|tickets?|recherche|montre|affiche|liste)$/i.test(w));

      if (words.length > 0) {
        try {
          const ORConditions = [];
          for (const w of words) {
            const num = parseInt(w, 10);
            if (!isNaN(num) && num > 0) ORConditions.push({ id: num });
            ORConditions.push(
              { title: { contains: w, mode: 'insensitive' } },
              { content: { contains: w, mode: 'insensitive' } },
              { category: { contains: w, mode: 'insensitive' } },
              { requester: { fullName: { contains: w, mode: 'insensitive' } } },
              { assignedTo: { fullName: { contains: w, mode: 'insensitive' } } }
            );
          }

          rescued = await prisma.ticket.findMany({
            where: { deletedAt: null, OR: ORConditions },
            take: 15,
            select: {
              id: true, title: true, status: true, priority: true, locationName: true, category: true,
              createdAt: true, solvedAt: true, closedAt: true,
              requester: { select: { fullName: true } }, assignedTo: { select: { fullName: true } },
            },
          });
        } catch (errRescue) {
          console.warn('[chatbot] Erreur Passe 2 Secours (non bloquant):', errRescue.message);
        }
      }
    }

    if (rescued.length > 0) {
      console.log(`[chatbot] Passe 2 Secours : ${rescued.length} ticket(s) retrouvé(s) en base pour la question "${message}"`);
      rescueContext = `\n\n⚠️ SECOURS PASSE 2 — ${rescued.length} TICKET(S) RÉEL(S) RETROUVÉ(S) EN BASE :\n` +
        rescued.map(t => `- Ticket #${t.id} "${t.title}" | Statut: ${t.status} | Priorité: ${t.priority} | Demandeur: ${t.requester?.fullName || 'inconnu'} | Assigné: ${t.assignedTo?.fullName || 'non assigné'} | Lieu: ${t.locationName || 'N/A'} | Créé le: ${new Date(t.createdAt).toLocaleDateString('fr-FR')}`).join('\n') +
        `\n\nSi la 1ère réponse disait "aucun ticket trouvé", UTILISE OBLIGATOIREMENT ces tickets ci-dessus pour répondre de manière exacte et complète à l'utilisateur !`;
    }
  }

  const AUDIT_SYSTEM_PROMPT = `Tu es l'Auditeur et Ajusteur Qualité du Chatbot MARIE (Helpdesk IT Prosuma).
Ta mission est d'évaluer et de valider (ou ajuster) la PREMIÈRE RÉPONSE proposée par le système face à la QUESTION EXACTE de l'utilisateur.

CRITÈRES D'EVALUATION ET D'AJUSTEMENT :
1. PERTINENCE : La réponse répond-elle directement, clairement et naturellement à la question posée ?
2. VÉRACITÉ : La réponse respecte-t-elle strictement les données fournies (pas de numéros de tickets inventés, pas de statistiques imaginées) ?
3. AUTO-SECOURS / DONNÉES MANQUANTES : Si la première réponse disait "aucun ticket trouvé" mais que des tickets ont été retrouvés par le secours Passe 2, réécris la réponse en utilisant ces tickets !
4. RESTITUTION ET STYLE : La réponse est-elle rédigée dans un français naturel et professionnel, sans jargon technique de base de données (ex: "null", "undefined", "aiProcessed", "secondaryRequesterId", "vector") ?
5. TRANSPARENCE ET RÔLES : Si une personne est citée, son rôle (Demandeur/Assigné/Observateur) est-il clair ? Y a-t-il des promesses d'outils fictifs non exécutés (ex: "Voulez-vous que je lance l'outil X ?") ?

RÈGLE DÉCISIONNELLE :
- Si la première réponse est BONNE et RÉPOND EXACTEMENT à la question : restitue-la telle quelle (ou avec un simple polissage de mise en forme si nécessaire).
- Si la première réponse N'EST PAS BONNE (hallucination, manqué de données retrouvées par secours, jargon DB, mauvaise détection de la question, promesse d'outil non exécuté) : AJUSTE et RÉÉCRIS la version finale corrigée.

IMPORTANT : Restitue UNIQUEMENT la réponse finale, sansAnalyse interne, sansCHAIN OF THOUGHT, sans-meta-commentaire. La réponse doit être directement utilisable par l'utilisateur.

${toolData ? `\n\nDONNÉES COMPLÉMENTAIRES DES OUTILS :\n${toolData}` : ''}
${rescueContext}`;

  try {
    const auditPrompt = [
      ...conversationHistory,
      { role: 'user', content: message },
      {
        role: 'user',
        content: `[PREMIÈRE RÉPONSE PROPOSÉE À AUDITER ET AJUSTER] :\n${draftReply}\n\nInspecte cette réponse par rapport à ma question ci-dessus. Si elle est satisfaisante et exacte, restitue-la. Si elle nécessite un ajustement ou une correction, réécris directement la version finale ajustée.`,
      },
    ];

    const auditRaw = await callAI(auditPrompt, {
      ...voiceModelOptions,
      forcedSystem: AUDIT_SYSTEM_PROMPT,
    });

    const cleanedAudit = cleanAiReply(auditRaw);
    if (cleanedAudit && cleanedAudit.length > 15) {
      console.log('[chatbot] Passe 2 (Audit / Ajustement) exécutée avec succès.');
      return cleanedAudit;
    }
  } catch (auditErr) {
    console.warn('[chatbot] Passe 2 (Audit) non bloquante, conservation réponse Passe 1:', auditErr.message);
  }

  return draftReply;
}

// ── Message handler ────────────────────────────────────────────────────

async function handleMessage(message, conversationHistory = [], user = null, pendingTicketData = null, conversationId = null, options = {}) {
  let history = Array.isArray(conversationHistory) ? conversationHistory : [];
  let currentUser = user;
  let currentPending = pendingTicketData;
  let currentConvId = conversationId;

  if (conversationHistory && !Array.isArray(conversationHistory) && typeof conversationHistory === 'object') {
    const opts = conversationHistory;
    history = Array.isArray(opts.conversationHistory) ? opts.conversationHistory : (Array.isArray(opts.history) ? opts.history : []);
    currentUser = opts.user || user;
    currentPending = opts.pendingTicketData || pendingTicketData;
    currentConvId = opts.conversationId || conversationId;
  }

  const userId = currentUser?.sub || currentUser?.id || null;
  // Clé d'état conversationnel : PAR CONVERSATION (pas par user) sinon les conversations
  // d'un même utilisateur se polluent entre elles (filtres hérités d'une autre conversation).
  const stateKey = currentConvId ? `conv:${currentConvId}` : (userId ? `user:${userId}` : null);
  const _stepLog = (step, detail) => console.log(`[chatbot] handleMessage step=${step} ${detail || ''}`);

  _stepLog('start', `msg="${message.substring(0, 80)}" userId=${userId} historyLen=${history.length}`);

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
  const previousState = await getConversationState(stateKey);
  _stepLog('context', `prevIntent=${previousState?.intent || 'none'} prevTickets=${previousState?.tickets?.length || 0}`);

  // ── Détection de confirmation d'action en attente (ex: add_ticket_followup) ──
  if (previousState?.intent === 'pendingConfirmation' && previousState?.params) {
    const isConfirmation = /^\s*(oui|yes|go|confirme|c'est bon|vas-y|ok|d'accord|je confirme|oui vas|oui je|vas|c'est parti|allons-y|make it so)\b/i.test(message.trim());
    const isDenial = /^\s*(non|no|annul|pas maintenant|stop|abort|cancel)\b/i.test(message.trim());

    if (isConfirmation) {
      const { tool, args } = previousState.params;
      // Whitelist explicite : seuls les outils autorisés peuvent être exécutés via confirmation
      if (tool !== 'add_ticket_followup') {
        await setConversationState(stateKey, 'general', {}, []);
        return {
          reply: "D'accord.",
          intent: 'general',
          action: null,
          widget: null,
          sources: [],
          citedTicketIds: [],
          citedKnowledgeIds: [],
          pendingTicketData: null,
        };
      }
      _stepLog('confirm-action', `tool=${tool} args=${JSON.stringify(args || {}).substring(0, 200)}`);
      try {
        const result = await executeTool(tool, args, currentUser, { confirmed: true });
        const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        // Nettoyer le state de confirmation
        await setConversationState(stateKey, 'general', {}, []);
        return {
          reply: cleanAiReply(resultText),
          intent: 'add_followup',
          action: null,
          widget: null,
          sources: [],
          citedTicketIds: [],
          citedKnowledgeIds: [],
          pendingTicketData: null,
        };
      } catch (confirmErr) {
        console.error('[chatbot] Erreur exécution confirmation:', confirmErr.message);
        await setConversationState(stateKey, 'general', {}, []);
        return {
          reply: "Une erreur est survenue lors de l'exécution. Réessayez ou décrivez votre demande.",
          intent: 'general',
          action: null,
          widget: null,
          sources: [],
          citedTicketIds: [],
          citedKnowledgeIds: [],
          pendingTicketData: null,
        };
      }
    }

    if (isDenial) {
      await setConversationState(stateKey, 'general', {}, []);
      return {
        reply: "D'accord, action annulée. N'hésite pas si tu as besoin d'autre chose.",
        intent: 'general',
        action: null,
        widget: null,
        sources: [],
        citedTicketIds: [],
        citedKnowledgeIds: [],
        pendingTicketData: null,
      };
    }
  }

  // ── Contexte utilisateur ──
  let userContext;
  try {
    userContext = await getUserContext(userId);
    _stepLog('userContext', `len=${(userContext || '').length}`);
  } catch (ucErr) {
    _stepLog('userContext-error', ucErr.message);
    userContext = '';
  }

  // ── Récupérer le modèle vocal configuré (optionnel, utilisé UNIQUEMENT en mode vocal) ──
  let voiceModelOptions = {};
  // Ne PAS appliquer voiceAiModelId au chatbot textuel — il est réservé au mode vocal
  // (voiceAiModelId pointe souvent vers un modèle TTS qui ne supporte pas le tool calling)

  // ── Construire le prompt système avec contexte utilisateur ──
  const userContextLine = userContext ? `\n\n**Profil de l\'utilisateur :** ${userContext}` : '';
  let forcedSystem = SYSTEM_PROMPT + buildCapabilityLine() + userContextLine;

  // ── Injecter le contexte de la recherche précédente pour les follow-ups ──
  if (previousState?.lastToolData || previousState?.lastMessage || previousState?.lastTicketIds?.length) {
    // Détection pronominale élargie : "son/sa/ce problème/ce ticket" + tous les déictiques
    const hasPronoun = /\b(son|sa|ses|ce|cette|cet|ces|leur|leurs|celui|celle|ceux|celles|il|elle|ils|elles|le|la|les|lui|leur)\b/i.test(message);
    const hasDeictic = /\b(ce |cette |cet |leur |leurs |ceux |ces |et |aussi |total|nombre|combien|statut|état|lesquels|lesquelles|ensuite|autre|détail|précis|encore|son|sa|ses)\b/i.test(message)
      || /^[\s!.,?]*$/.test(message.replace(/\b(oui|non|ok|merci|super|bon|du|de|le|la|les|des|un|une|et|ou|pour|sur|avec|dans|par)\b/gi, '').trim());
    // Toujours injecter si entités structurées existent (même sans match regex) — "son ticket ?" isolé doit marcher
    const shouldInject = hasPronoun || hasDeictic || previousState?.lastTicketIds?.length;
    if (shouldInject) {
      let contextInjection = '\n\nCONTEXTE DE LA RECHERCHE PRÉCÉDENTE :\n';
      if (previousState.lastMessage) contextInjection += `Question précédente : "${previousState.lastMessage}"\n`;
      if (previousState.lastTicketIds?.length) contextInjection += `Tickets mentionnés : ${previousState.lastTicketIds.map((id) => `#${id}`).join(', ')}\n`;
      if (previousState.lastPerson) contextInjection += `Personne mentionnée : ${previousState.lastPerson}\n`;
      if (previousState.lastLocation) contextInjection += `Lieu mentionné : ${previousState.lastLocation}\n`;
      if (previousState.lastToolData) contextInjection += `Résultats obtenus :\n${previousState.lastToolData.substring(0, 4000)}\n`;
      // Ajouter aussi l'historique textuel récent (3 derniers échanges) pour les références croisées
      const recentHistory = history.slice(-6).map((m) => `${m.role === 'assistant' ? 'MARIE' : 'Utilisateur'}: ${(m.content || '').slice(0, 300)}`).join('\n');
      if (recentHistory) contextInjection += `Historique récent :\n${recentHistory}\n`;
      contextInjection += `\nL'utilisateur fait un suivi sur cette recherche. Utilise ce contexte pour comprendre les références ("son ticket", "ce problème", "ce site", etc.).`;
      forcedSystem += contextInjection;
      _stepLog('context-injection', `injected ${previousState.lastToolData?.length || 0} chars + ${previousState.lastTicketIds?.length || 0} ticketIds`);
    }
  }

  let reply;
  let toolData = '';
  let _newSummary = null;
  let citedTicketIds = [];
  let citedKnowledgeIds = [];

  _stepLog('pre-llm', 'agentic-flow');

  // ═══ FLUX AGENTIC UNIFIÉ : un seul appel callAIWithTools ═══
  // Le LLM analyse la demande, choisit librement les outils dans CHATBOT_TOOLS,
  // et génère la réponse. Plus de classification d\'intent préalable.
  try {
    const r = await callAIWithTools(
      [{ role: 'user', content: message }],
      {
        ...voiceModelOptions,
        conversationHistory,
        forcedSystem,
        user,
        _stateKey: stateKey,
        existingSummary: options.existingSummary || null,
        summaryModelId: options.summaryModelId || null,
        voiceMode: !!options.voiceMode,
      }
    );

    // Si une confirmation est en attente, renvoyer directement le message
    if (r.pendingConfirmation) {
      return {
        reply: cleanAiReply(r.text),
        intent: 'add_followup',
        action: null,
        widget: null,
        sources: [],
        citedTicketIds: [],
        citedKnowledgeIds: [],
        pendingTicketData: null,
      };
    }

    reply = cleanAiReply(r.text);
    toolData = r.toolData || '';
    _newSummary = r._newSummary || null;
    _stepLog('llm-tools', `replyLen=${(reply || '').length} toolDataLen=${toolData.length}`);

    // ── Validation des chiffres cités — anti-hallucination complète ──
    // Couvre à la fois les IDs de tickets fantômes (#253) ET les chiffres
    // hallucinés (totaux, pourcentages, durées non sourcés dans toolData).
    {
      // Inclure le contexte précédent (toolData injecté via forcedSystem) pour les follow-ups
      const prevToolData = previousState?.lastToolData || '';
      const allowedText = [toolData, prevToolData, message].filter(Boolean).join('\n');

      // 1. IDs de tickets fantômes
      const mentionedIds = [...new Set(
        (String(reply).match(/(?:#|\bticket\s+n?°?\s*)(\d+)/gi) || [])
          .map(s => parseInt(s.replace(/[^\d]/g, '')))
          .filter(n => !isNaN(n) && n > 0 && n < 1000000)
      )];
      const allowedFromTools = new Set();
      // Extraire les IDs avec préfixe #/ticket (ex: #66, ticket n°66)
      (String(allowedText).match(/(?:#|\bticket\s+n?°?\s*)(\d+)/gi) || [])
        .forEach(s => allowedFromTools.add(String(parseInt(s.replace(/[^\d]/g, '')))));
      // Extraire les IDs depuis le JSON toolData (ex: "id": 66, "id":90)
      (String(toolData).match(/"id"\s*:\s*(\d+)/gi) || [])
        .forEach(s => { const m = s.match(/(\d+)/); if (m) allowedFromTools.add(m[1]); });
      const phantomIds = mentionedIds.filter(id => !allowedFromTools.has(String(id)));

      // 2. Chiffres libres non sourcés (totaux, pourcentages, durées)
      const unsourcedNumbers = findUnsourcedNumbers(reply, { allowedText });

      const hasPhantomIds = phantomIds.length > 0;
      const hasUnsourcedNumbers = unsourcedNumbers.length > 0;

      if (hasPhantomIds || hasUnsourcedNumbers) {
        const issues = [];
        if (hasPhantomIds) issues.push(`IDs fantômes: ${phantomIds.join(', ')}`);
        if (hasUnsourcedNumbers) issues.push(`Chiffres non sourcés: ${unsourcedNumbers.join(', ')}`);
        console.warn('[chatbot] Chiffres suspects dans la réponse:', issues.join(' | '), '— relance corrective');

        const retrySystem = SYSTEM_PROMPT + buildCapabilityLine() + userContextLine +
          (toolData ? `\n\nDONNÉES RÉCUPÉRÉES PAR LES OUTILS :\n${toolData}` : '');
        let retryInstruction = '\n\n⚠️ RÈGLE ABSOLUE — VÉRACITÉ DES CHIFFRES :\n';
        retryInstruction += 'Les numéros suivants n\'existent pas dans les données fournies et ne doivent PAS apparaître dans ta réponse :\n';
        if (hasPhantomIds) retryInstruction += `- IDs de tickets: ${phantomIds.join(', ')}\n`;
        if (hasUnsourcedNumbers) retryInstruction += `- Chiffres non sourcés: ${unsourcedNumbers.join(', ')}\n`;
        retryInstruction += 'Si tu n\'as pas la donnée exacte, dis-le simplement. Ne JAMAIS compléter un tableau, un classement ou une statistique avec des chiffres inventés.';

        try {
          const retryRaw = await callAI(
            [{ role: 'user', content: message }],
            {
              ...voiceModelOptions,
              conversationHistory,
              forcedSystem: retrySystem + retryInstruction,
            }
          );
          reply = cleanAiReply(retryRaw);

          // Re-vérification post-retry : si le modèle réintroduit des chiffres hallucinés,
          // on bascule sur un repli déterministe honnête plutôt que de risquer une 2e erreur.
          const retryIds = [...new Set(
            (String(reply).match(/(?:#|\bticket\s+n?°?\s*)(\d+)/gi) || [])
              .map(s => parseInt(s.replace(/[^\d]/g, '')))
              .filter(n => !isNaN(n) && n > 0 && n < 1000000)
          )];
          const retryAllowed = new Set();
          (String(allowedText).match(/(?:#|\bticket\s+n?°?\s*)(\d+)/gi) || [])
            .forEach(s => retryAllowed.add(String(parseInt(s.replace(/[^\d]/g, '')))));
          const retryPhantom = retryIds.filter(id => !retryAllowed.has(String(id)));
          const retryUnsourced = findUnsourcedNumbers(reply, { allowedText });

          if (retryPhantom.length > 0 || retryUnsourced.length > 0) {
            console.warn('[chatbot] Relance corrective n\'a pas corrigé les chiffres suspects, repli déterministe');
            reply = "Je n'ai pas cette donnée exacte de façon fiable — je préfère te le dire plutôt que de risquer une approximation. Réessaie ou précise ta recherche.";
          }
        } catch (retryErr) {
          console.error('[chatbot] Relance corrective échouée:', retryErr.message);
        }
      }
    }
  } catch (err) {
    // Fallback dégradé : recherche par ID de ticket explicite
    // Matche : #10, ticket 10, ticket #10, ticket n°10, ticket numero 10, demande 10...
    console.error('[chatbot] Échec appel LLM:', err.message);
    const ticketIdMatch = message.match(/(?:#|ticket\s*#?\s*|demande\s*n[°o]?\s*|requ[êe]te?\s*n[°o]?\s*)(\d+)/i);
    if (ticketIdMatch) {
      try {
        const ticket = await prisma.ticket.findUnique({
          where: { id: parseInt(ticketIdMatch[1], 10), deletedAt: null },
          select: {
            id: true, title: true, status: true, priority: true, locationName: true, category: true,
            createdAt: true,
            requester: { select: { fullName: true } },
            assignedTo: { select: { fullName: true } },
            team: { select: { name: true } },
          },
        });
        if (ticket) {
          reply = `**Ticket #${ticket.id}** : "${ticket.title}"\nStatut : ${ticket.status} | Priorité : ${ticket.priority}\nDemandeur : ${ticket.requester?.fullName || 'inconnu'} | Assigné : ${ticket.assignedTo?.fullName || 'non assigné'}\nÉquipe : ${ticket.team?.name || '-'} | Lieu : ${ticket.locationName || 'N/A'}\nCréé le : ${new Date(ticket.createdAt).toLocaleDateString('fr-FR')}`;
        } else {
          reply = `Ticket #${parseInt(ticketIdMatch[1], 10)} introuvable.`;
        }
      } catch (dbErr) {
        console.error('[chatbot] Fallback DB échoué:', dbErr.message);
        reply = "Je rencontre un souci temporaire d'accès aux services IA. Réessayez dans quelques instants.";
      }
    } else {
      reply = "Je rencontre un souci temporaire d'accès aux services IA. Réessayez dans quelques instants.";
    }
  }

  // ═══ PASSE 2 : Audit & Ajustement — désactivé en vocal (économise 1 LLM call, chiffres déjà garantis par snapshot) ═══
  if (reply && !isGreetingMessage(message) && !options.voiceMode) {
    try {
      _stepLog('pass2-audit', `draftLen=${reply.length}`);
      reply = await auditAndAdjustResponse(message, reply, {
        conversationHistory,
        fullSystemPrompt: forcedSystem,
        toolData: typeof toolData !== 'undefined' ? toolData : '',
        voiceModelOptions,
      });
    } catch (auditErr) {
      console.warn('[chatbot] Passe 2 Audit non bloquante:', auditErr.message);
    }
  }

  // citedTicketIds = ce que l'IA a RÉELLEMENT cité dans sa réponse, validé contre
  // la base (validateCitedIds filtre les tickets fantômes). Auparavant on renvoyait
  // tous les matchingTickets — une protection illusoire, jamais ce qui est cité.
  try {
    const mentioned = [...new Set((String(reply).match(/(?:#|\bticket\s+n?°?\s*)(\d+)/gi) || []).map((s) => Number(s.replace(/[^\d]/g, ''))))];
    if (mentioned.length > 0) {
      const v = await validateCitedIds(mentioned, [], 'agentic');
      citedTicketIds = v.ticketIds;
      if (v.issues.length > 0) console.warn('[chatbot] Tickets fantômes cités:', v.issues.join(' | '));
    }
  } catch (e) {
    console.error('[chatbot] validateCitedIds échoué (non bloquant):', e.message);
  }

  _stepLog('done', `replyLen=${(reply || '').length} citedTickets=${citedTicketIds.length}`);

  // ── Persister le contexte de recherche pour les follow-ups multi-tour ──
  if (stateKey && toolData) {
    // Extraire entités structurées pour résolution pronominale ("son ticket", "ce problème")
    const ticketIds = [...new Set((String(toolData).match(/(?:#|\bticket\s*n?°?\s*)(\d+)/gi) || []).map((s) => Number(s.replace(/[^\d]/g, ''))).filter((n) => n > 0))].slice(0, 5);
    // Personne / lieu mentionnés dans toolData (heuristique simple)
    const personMatch = String(toolData).match(/(?:demandeur|assigné|technicien)\s*:\s*([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s[A-ZÀ-ÿ][a-zà-ÿ]+)+)/);
    const locationMatch = String(toolData).match(/(?:lieu|magasin|site)\s*:\s*([A-ZÀ-ÿ][\w\s>-]+)/i);
    await setConversationState(stateKey, 'agentic', {
      lastToolData: toolData.substring(0, 6000),
      lastMessage: message,
      lastTicketIds: ticketIds.length ? ticketIds : (citedTicketIds || []).slice(0, 5),
      lastPerson: personMatch ? personMatch[1].trim() : null,
      lastLocation: locationMatch ? locationMatch[1].trim() : null,
    }, []);
  }

  return {
    reply,
    intent: 'general',
    action: null,
    widget: null,
    sources: [],
    citedTicketIds,
    citedKnowledgeIds,
    pendingTicketData: null,
    _newSummary,
  };
}

// ── Validation des chiffres cités par le LLM ─────────────────────────
// Extrait TOUS les chiffres explicitement cités dans la réponse (pas seulement les
// IDs de tickets — aussi les totaux, pourcentages, durées) et les compare au corpus
// autorisé (toolData + message utilisateur). Un chiffre absent du corpus est
// probablement halluciné et déclenche une relance corrective.
function findUnsourcedNumbers(reply, { allowedText = '', allowedIds = [] } = {}) {
  if (!reply) return [];

  // 1. Extraire les IDs de tickets cités (#X, "ticket X")
  const ticketIds = [...new Set(
    (String(reply).match(/(?:#|\bticket\s+n?°?\s*)(\d+)/gi) || [])
      .map(s => parseInt(s.replace(/[^\d]/g, '')))
      .filter(n => !isNaN(n) && n > 0 && n < 1000000)
  )];

  // 2. Extraire les chiffres libres (totaux, pourcentages, durées) — pattern large
  //    "12 tickets", "42%", "3h", "150 demandes", etc.
  const freeNumbers = [...new Set(
    (String(reply).match(/\b\d[\d\s.,]*(?:\s*%|\s*h(?:eures?)?|\s*min(?:utes?)?|\s*tickets?|\s*demandes?|\s*résolus?|\s*ouverts?|\s*urgents?|\s*liés?)\b/gi) || [])
      .map(s => parseInt(s.replace(/[^\d]/g, '')))
      .filter(n => !isNaN(n) && n > 0 && n < 1000000)
  )];

  const allMentioned = [...new Set([...ticketIds, ...freeNumbers])];
  if (allMentioned.length === 0) return [];

  // 3. Construire le corpus autorisé : allowedIds + IDs dans allowedText + tous les chiffres du toolData et du message
  const allowed = new Set((allowedIds || []).map(String));

  // IDs de tickets dans le corpus autorisé
  (String(allowedText).match(/(?:#|\bticket\s+n?°?\s*)(\d+)/gi) || [])
    .forEach(s => allowed.add(String(parseInt(s.replace(/[^\d]/g, '')))));

  // Chiffres libres dans le corpus autorisé (toolData + message)
  const corpusText = (allowedText || '');
  const corpusNumbers = (corpusText.match(/\b\d[\d\s.,]*(?:\s*%|\s*h(?:eures?)?|\s*min(?:utes?)?|\s*tickets?|\s*demandes?|\s*résolus?|\s*ouverts?|\s*urgents?|\s*liés?)\b/gi) || [])
    .map(s => parseInt(s.replace(/[^\d]/g, '')))
    .filter(n => !isNaN(n));
  for (const n of corpusNumbers) allowed.add(String(n));

  // Aussi autoriser les chiffres qui apparaissent tels quels dans le corpus brut
  const allCorpusDigits = (corpusText.match(/\b\d+\b/g) || []).map(s => String(parseInt(s, 10)));
  for (const d of allCorpusDigits) allowed.add(d);

  return allMentioned.filter(id => !allowed.has(String(id))).slice(0, 10);
}

// Repli déterministe : afficher proprement les données réelles sans wrapper trompeur.
function renderFallback(contextParts) {
  const data = (contextParts || [])
    .filter((p) => p && p.length > 30)
    .join('\n\n');
  if (!data) return null;
  return data;
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


module.exports = {
  handleMessage,
  searchTeams,
  searchTickets,
  findTicketsForPersonAnyRole,
  detectIntentRegex,
  extractSearchParamsRegex,
  resolveCanonicalTeamName,
  buildSearchQuery,
};
