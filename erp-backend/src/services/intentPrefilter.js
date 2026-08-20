// Pré-filtre heuristique ZÉRO-COÛT avant tout appel LLM (analyzeIntent).
//
// Problème : chaque email de suivi d'un ticket déclenche un appel LLM (coût), alors que la
// grande majorité des messages (merci, ok, accusés simples...) ne contient aucun signal réel
// et se terminerait de toute façon en UNKNOWN.
//
// Principe : on ne facture l'IA QUE lorsqu'un signal substantif est détecté localement :
//   - résolution (ex. « ça remarche », « résolu ») — la résolution DOIT ensuite être
//     confirmée par le LLM (citation evidence + confiance >= 0.7, garde-fous inchangés) ;
//   - persistance du problème (« toujours en panne ») — la classification exacte
//     (STILL_PRESENT vs NEW_INFO vs QUESTION) reste au LLM, on ne la devine pas ;
//   - question posée au support ;
//   - réponse automatique (out-of-office, disclaimer...) — skip, jamais de suggestion.
// Messages triviaux (merci / ok / court / sans signal) : skip sans LLM, comportement = UNKNOWN
// (la branche UNKNOWN existante de applyIntentActions les traite déjà ainsi).
//
// Un faux négatif (résolution manquée) est accepté : le ticket reste actif et la Hotline/l'utilisateur
// peut toujours le clôturer; l'inverse (clôture à tort) coûte plus cher et reste bloqué par le LLM.

// Normalise un texte pour des correspondances robustes : minuscules + suppression des accents.
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Signaux que l'utilisateur confirme (même sans le mot) la résolution du problème précis.
const RESOLUTION_SIGNALS = [
  'resolu', 'regle', 'reglee', 'corrige', 'retabli', 'retablie',
  'fonctionne', 'ca fonctionne', 'cela fonctionne', 'il fonctionne', 'tout fonctionne',
  'remarche', 'marche a nouveau', 'ca marche', 'c est bon', 'c est regle',
  'plus de souci', 'plus de probleme', 'plus de panne', 'plus rien',
  'ca va mieux', 'sans probleme', 'reussi', 'reconnette', 'je suis connecte', 'connecte a nouveau',
];

// Signaux que le problème PERSISTE (le LLM tranchera STILL_PRESENT vs NEW_INFO vs QUESTION).
const CONTINUATION_SIGNALS = [
  'toujours', 'encore', 'pas resolu', 'ne fonctionne', 'ne marche', 'en panne',
  'indisponible', 'pas de retour', 'est en erreur', 'plante', 'crash', 'bug',
  'ne s affiche', 'ne peux pas', 'impossible de', 'pas arrive a', 'deconnexion',
];

// Signaux d'une question posée au support.
const QUESTION_SIGNALS = [
  'pouvez vous', 'peux tu', 'comment ', 'pourquoi', 'quand ', 'est il possible',
  's il vous plait', 'merci de me dire', 'que dois je', 'faut il', 'quel ',
  'quelle ', 'combien', 'ou est', 'ou puis je',
];

// Marqueurs de réponse AUTOMATIQUE (out-of-office, accusé, disclaimer).
const AUTO_REPLY_SIGNALS = [
  'absent', 'en conges', 'out of office', 'do not reply', 'ne pas repondre',
  'cet email a ete genere', 'notification automatique', 'automatically generated', 'genere automatiquement',
];

// Longueur (caractères) sous laquelle un message SANS signal est considéré trivial et ignoré.
const TRIVIAL_MAX_LENGTH = 120;

// Décide si l'analyse LLM est nécessaire.
// Retourne { skip: boolean, intent?: string, isAutoReply?: boolean }.
//  - skip=false  → analyser avec le LLM (comportement actuel, inchangé) ;
//  - skip=true   → traiter sans LLM : intent UNKNOWN (et isAutoReply=true pour les réponses auto).
function prefilterReply({ body = '', subject = '' }) {
  const text = normalize(`${subject} ${body}`);
  const hasSignal = (list) => list.some((s) => text.includes(s));

  // Un signal substantif prime toujours : on laisse le LLM trancher (précision requise).
  if (hasSignal(RESOLUTION_SIGNALS) || hasSignal(CONTINUATION_SIGNALS) || hasSignal(QUESTION_SIGNALS)) {
    return { skip: false };
  }

  // Réponse automatique seule (sans aucun signal substantif) : jamais de suggestion, skip.
  if (hasSignal(AUTO_REPLY_SIGNALS)) {
    return { skip: true, intent: 'UNKNOWN', isAutoReply: true };
  }

  // Message sans signal, court ou vide (« merci », « ok », « reçu », corps vide...) : skip.
  // Les longs messages sans signal (« j'écris pour faire le point... ») restent analysés par le LLM.
  const bodyLength = (body || '').trim().length;
  if (bodyLength < TRIVIAL_MAX_LENGTH) {
    return { skip: true, intent: 'UNKNOWN', isAutoReply: false };
  }

  return { skip: false };
}

module.exports = { prefilterReply, normalize, TRIVIAL_MAX_LENGTH };