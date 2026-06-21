const prisma = require('../prismaClient');

// Texte par défaut codé en dur pour chaque prompt — utilisé si aucune ligne n'existe encore en
// base (premier démarrage) ou si l'admin n'a jamais modifié ce prompt depuis Paramètres > Prompts IA.
const DEFAULTS = {
  analyzeEmail: {
    label: "Analyse d'un email entrant (création de ticket)",
    template: `Tu es un agent ITSM expert. Analyse cet email de support informatique et retourne UNIQUEMENT un objet JSON valide (sans markdown, sans explication).

Email reçu :
De : {{fromName}} <{{from}}>
Sujet : {{subject}}
Corps : {{body}}

Retourne ce JSON :
{
  "summary": "résumé du problème en 1-2 phrases",
  "category": "Logiciel|Matériel|Réseau|Téléphonie|Système",
  "priority": "P1|P2|P3|P4",
  "team": "nom de l'équipe concernée",
  "confidence": 0.0-1.0,
  "suggestedTitle": "titre court pour le ticket (max 80 caractères)",
  "isSpam": false,
  "language": "fr|en|autre"
}

Règles de priorité :
- P1 : service totalement indisponible, impact critique sur la production
- P2 : dégradation majeure, plusieurs utilisateurs impactés
- P3 : problème limité à un utilisateur, contournement possible
- P4 : demande d'information, amélioration, question générale`,
  },
  analyzeIntent: {
    label: "Analyse de l'intention d'une réponse email sur un ticket existant",
    template: `Tu es un agent ITSM. Analyse ce message de réponse utilisateur concernant un ticket de support.

Contexte du ticket :
- Titre : {{ticketTitle}}
- Résumé : {{ticketSummary}}

Derniers échanges du fil (du plus ancien au plus récent) :
{{historyText}}

Nouveau message reçu :
Sujet : {{subject}}
Contenu : {{body}}

Étape 1 — détermine si ce message est une réponse AUTOMATIQUE (générée par un système, pas tapée par un humain en réponse au ticket). Indices typiques :
- message d'absence du bureau ("je suis en congés", "absent jusqu'au...", "out of office", "actuellement indisponible")
- accusé de réception automatique générique, ou notification système ("ce message a été généré automatiquement", "ne pas répondre à cet email")
- texte de relance/disclaimer standard répété en signature, qui ne répond pas réellement à la question posée dans le ticket
- toute mention de "résolu"/"problème réglé" qui apparaît dans une signature, un disclaimer ou un texte générique sans rapport direct avec le contenu réel du ticket, et non dans une phrase rédigée par l'utilisateur en réponse au problème
Si l'un de ces indices est présent ET que le message ne contient par ailleurs aucune information personnalisée et pertinente sur le problème du ticket, alors isAutoReply doit être true et intent doit être UNKNOWN — même si le mot "résolu" apparaît quelque part dans le texte.

Étape 2 — si ce n'est pas une réponse automatique, détermine l'intention principale parmi :
- RESOLVED : l'utilisateur confirme, même implicitement, que le problème initial décrit dans le titre/résumé du ticket n'existe plus. Mets-toi à la place du problème exact (ex: si le ticket parle d'une déconnexion ou d'un service indisponible, "je suis connecté", "ça remarche", "c'est revenu", "ça fonctionne" signifient RESOLVED — pas besoin que l'utilisateur dise littéralement le mot "résolu")
- STILL_PRESENT : l'utilisateur indique explicitement que le problème continue, persiste, ou qu'il a encore le souci décrit dans le ticket
- NEW_INFO : l'utilisateur ajoute des informations utiles sur le même problème, sans dire si c'est résolu ou non
- QUESTION : l'utilisateur pose une question, sans confirmer une résolution
- REOPEN : l'utilisateur signale que le problème est réapparu après résolution
- NEW_ISSUE_IN_THREAD : l'utilisateur confirme que le problème initial est résolu MAIS évoque aussi un problème différent, nouveau, sans rapport
- UNKNOWN : intention non déterminable, message ambigu ou trop court (ex: "ok", "merci" seul, sans rapport explicite avec le problème)

Important : compare toujours le contenu du message au problème PRÉCIS décrit dans le titre/résumé du ticket avant de choisir STILL_PRESENT — si le message décrit une situation positive opposée à ce problème (le service qui était down redevient up, la connexion qui manquait est rétablie, etc.), c'est RESOLVED, même sans le mot "résolu".

Réponds UNIQUEMENT avec un objet JSON strict sur une seule ligne, sans markdown, au format :
{"intent": "UN_DES_CODES", "confidence": 0.0 à 1.0, "newIssueSummary": "résumé court du nouveau sujet si NEW_ISSUE_IN_THREAD, sinon null", "isAutoReply": true ou false}`,
  },
  stripSignature: {
    label: "Extraction du corps réel (suppression de la signature)",
    template: `Tu es un agent ITSM. Voici le texte brut d'un email de support, qui peut contenir le message réel de l'expéditeur suivi d'une signature (nom, poste, téléphone, email, logo, disclaimer).

Texte brut :
{{rawBody}}

Extrait UNIQUEMENT le message réellement rédigé par l'expéditeur, sans la signature ni les coordonnées ni le disclaimer. Garde le texte exact, ne reformule rien. Si tu ne peux pas distinguer, renvoie le texte brut intégral.

Réponds UNIQUEMENT avec un objet JSON strict, sans markdown, au format :
{"body": "le message réel, sans la signature"}`,
  },
  filterOutSignatureImages: {
    label: 'Tri logo de signature / vraie pièce jointe (images inline)',
    template: `Tu es un agent ITSM. Voici une liste d'images intégrées (inline) dans un email de support, avec leurs métadonnées.
Détermine pour chacune si c'est probablement un LOGO/IMAGE DE SIGNATURE D'ENTREPRISE ou bien une VRAIE PIÈCE JOINTE UTILE (capture d'écran d'un problème, photo d'un équipement, document scanné).

Règle par défaut : une image inline avec un nom générique (ex: "image.png", "image001.png", sans mot comme "capture", "screenshot", "photo") doit être classée comme LOGO/SIGNATURE par défaut, SAUF si le corps du mail mentionne explicitement une pièce jointe, une capture d'écran, ou une photo (ex: "voir capture ci-joint", "screenshot", "photo du problème"). En cas de doute, privilégie LOGO/SIGNATURE.

Extrait du corps du mail (pour contexte) :
{{bodyText}}

Images :
{{imagesList}}

Réponds UNIQUEMENT avec un objet JSON strict, sans markdown, au format :
{"results": [{"index": 0, "isSignatureLogo": true ou false}, ...]}`,
  },
  generateKnowledgeDraft: {
    label: "Génération d'un article de base de connaissances depuis un ticket résolu",
    template: `Tu es un expert ITSM. À partir de ce ticket résolu, génère un article de base de connaissances en JSON.

Ticket :
- Titre : {{title}}
- Catégorie : {{category}}
- Priorité : {{priority}}
- Résumé IA : {{aiSummary}}
- Note de résolution du technicien : {{resolutionNote}}
- Historique échanges :
{{history}}

Retourne UNIQUEMENT ce JSON :
{
  "title": "titre de l'article",
  "problem": "description du problème",
  "cause": "cause identifiée",
  "solution": "solution appliquée étape par étape",
  "keywords": ["mot1", "mot2", "mot3"]
}`,
  },
  dailySummaryInsight: {
    label: 'Résumé en langage naturel du récapitulatif quotidien des tickets ouverts',
    template: `Tu es un responsable support IT qui rédige un résumé bref pour son équipe de direction.

Voici la liste des tickets actuellement ouverts (priorité, statut, technicien assigné, demandeur, âge en jours) :
{{ticketsList}}

Rédige un résumé en 2 à 3 phrases maximum, en français, qui met en avant ce qui demande une action immédiate : tickets critiques (P1/P2), tickets non assignés, tickets sans réponse depuis plusieurs jours. Ton direct et factuel, pas de formules de politesse, pas de markdown.

Réponds UNIQUEMENT avec un objet JSON strict, au format :
{"insight": "le résumé en 2-3 phrases"}`,
  },
  generateFollowupReply: {
    label: "Génération d'une réponse de suivi sur un ticket (conversation IA multi-tours)",
    template: `Tu es un agent de support IT qui répond par email à un utilisateur sur un ticket déjà ouvert.

Contexte du ticket :
- Titre : {{ticketTitle}}
- Résumé : {{ticketSummary}}

Historique complet de la conversation (du plus ancien au plus récent) :
{{historyText}}

Extraits de la base de connaissances pouvant être pertinents (peuvent être vides ou non pertinents, ignore-les si c'est le cas) :
{{knowledgeResults}}

Dernier message de l'utilisateur :
{{lastMessage}}

Rédige une réponse utile et précise si tu disposes d'assez d'éléments pour aider l'utilisateur. Si tu n'as pas assez d'informations ou que la base de connaissances ne couvre pas ce cas, indique-le honnêtement plutôt que d'inventer une solution.

Règles strictes de format :
- Réponse courte : 1 à 2 paragraphes maximum, va droit au but, pas de répétition de ce que l'utilisateur a déjà dit.
- N'inclus JAMAIS de formule de politesse ("Bonjour", "Cordialement"...), de signature, ni le nom de l'expéditeur ou du destinataire — ils sont ajoutés automatiquement par le système. Ta réponse doit commencer directement par le contenu utile.

Réponds UNIQUEMENT avec un objet JSON strict, sans markdown, au format :
{"canAnswer": true ou false, "replyHtml": "réponse en HTML simple (paragraphes, listes), sans formule de politesse ni signature, vide si canAnswer est false", "usedKnowledgeChunkIds": [identifiants numériques des extraits de connaissance réellement utilisés], "confidence": 0.0 à 1.0}`,
  },
};

// Remplace {{nomVariable}} par la valeur correspondante dans vars. Une clé absente de vars est
// remplacée par une chaîne vide plutôt que de laisser le littéral {{...}} dans le prompt final.
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const value = vars[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

// Récupère le texte du prompt (édité en base si présent, sinon le défaut codé en dur) et
// substitue les variables. N'écrit jamais en base ici — la ligne n'est créée qu'à la première
// modification via l'UI (cf. promptTemplate.routes.js).
async function getPrompt(key, vars = {}) {
  const def = DEFAULTS[key];
  if (!def) throw new Error(`Prompt inconnu : ${key}`);

  const row = await prisma.promptTemplate.findUnique({ where: { key } });
  const template = row?.template || def.template;
  return render(template, vars);
}

module.exports = { getPrompt, DEFAULTS };
