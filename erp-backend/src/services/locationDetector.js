// ── Détection STRICTE du lieu d'un ticket ──────────────────────────────────
// Règle demandée : le lieu est déterminé en analysant la SIGNATURE et l'ADRESSE EMAIL de
// l'expéditeur, puis en comparant ces indices avec la liste des lieux en base (table Location).
// Si rien ne correspond → lieu "INDÉTERMINÉ". Il est INTERDIT d'utiliser le nom d'une
// application, d'un logiciel, d'un équipement ou tout autre terme ne figurant pas en base.
const UNDETERMINED = 'INDÉTERMINÉ';

// Termes applicatifs / outils / équipements qui ne doivent JAMAIS être retenus comme lieu
const APP_LIKE_TERMS = new Set([
  'excel', 'word', 'powerpoint', 'outlook', 'teams', 'sharepoint', 'onedrive', 'office',
  'microsoft', 'windows', 'linux', 'google', 'gmail', 'chrome', 'edge', 'adobe', 'pdf',
  'sap', 'sage', 'odoo', 'glpi', 'erp', 'crm', 'vpn', 'wifi', 'antivirus', 'internet',
  'intranet', 'logiciel', 'application', 'appli', 'software', 'imprimante', 'imprimate',
  'ordinateur', 'pc', 'serveur', 'routeur', 'switch', 'borne', 'biometrie', 'camera',
  'telephone', 'telephonie', 'caisse', 'imprimante', 'helpdesk', 'ticket', 'support',
  'mail', 'email', 'messagerie', 'motdepasse', 'compte',
]);

// Normalisation française : minuscules, sans accents, ponctuation → espaces
function normalizeLocationText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Un nom est "applicatif" si tous ses mots significatifs appartiennent à la liste interdite
function isAppLikeLocation(name) {
  const tokens = normalizeLocationText(name).split(' ').filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.every((t) => APP_LIKE_TERMS.has(t));
}

/**
 * Extrait la zone de signature d'un email brut.
 * On privilégie le texte retiré par le stripper de signature (diff entre le corps brut
 * et le corps nettoyé) ; sinon fallback déterministe sur la fin du message.
 * @param {string} fullBody - Corps brut complet (avant stripping)
 * @param {string} cleanBody - Corps nettoyé (signature retirée)
 * @returns {string} Texte de la zone de signature (max 1200 caractères)
 */
function extractSignatureZone(fullBody, cleanBody) {
  const full = String(fullBody || '');
  const clean = String(cleanBody || '');
  if (!full.trim()) return '';

  let zone = '';
  if (clean && clean.length > 20 && full.includes(clean)) {
    zone = full.replace(clean, ' ').trim();
  }
  if (zone.length < 20) {
    // Fallback déterministe : la signature se trouve en fin de message
    zone = full.slice(-500);
  }
  return zone.slice(-1200);
}

/**
 * Détecte le lieu d'un demandeur à partir de sa signature et de son adresse email,
 * en comparant STRICTEMENT avec la liste des lieux passée en paramètre (issus de la base).
 * @param {Object} params
 * @param {string} [params.fromEmail] - Adresse email de l'expéditeur
 * @param {string} [params.fromName] - Nom affiché de l'expéditeur
 * @param {string} [params.signatureText] - Zone de signature extraite du message
 * @param {Array<{id:number, name:string, completename:string}>} params.locations - Lieux en base
 * @returns {{locationId:number, locationName:string, matchedOn:string}|null} Lieu détecté ou null (→ INDÉTERMINÉ)
 */
function detectLocationFromSender({ fromEmail, fromName, signatureText, locations = [] }) {
  if (!locations || locations.length === 0) return null;

  // Corpus de recherche : signature + adresse email (partie locale ET domaine) + nom affiché.
  // Volontairement limité à ces indices : le lieu mentionné dans la DESCRIPTION du problème
  // (ex: "panne de caisse au magasin X") ne doit jamais désigner le lieu du demandeur.
  const emailNorm = normalizeLocationText(fromEmail || '').replace(/\./g, ' ');
  const corpus = normalizeLocationText(`${signatureText || ''} ${emailNorm} ${fromName || ''}`);
  if (!corpus) return null;
  const padded = ` ${corpus} `;

  // Candidats : nom + nom complet de chaque lieu (minimum 3 caractères, jamais "applicatif")
  const matches = []; // { locationId, locationName, candidate, candidateLength }
  for (const loc of locations) {
    const candidates = new Set();
    if (loc.completename) candidates.add(normalizeLocationText(loc.completename));
    if (loc.name) candidates.add(normalizeLocationText(loc.name));
    for (const cand of candidates) {
      if (!cand || cand.length < 3) continue;
      if (isAppLikeLocation(cand)) continue;
      // Correspondance sur mots entiers uniquement ("cocody" ne matche pas "cocody2")
      if (padded.includes(` ${cand} `)) {
        matches.push({
          locationId: loc.id,
          locationName: loc.name || loc.completename,
          candidate: cand,
          candidateLength: cand.length,
        });
      }
    }
  }

  if (matches.length === 0) return null;

  // Le candidat le plus long gagne (le plus spécifique : "SUPERMARCHE MARCORY" > "MARCORY")
  matches.sort((a, b) => b.candidateLength - a.candidateLength);
  const best = matches[0];
  // Ambiguïté stricte : deux lieux DISTINCTS ex æquo → on ne devine pas → INDÉTERMINÉ
  const tie = matches.find((m) => m.candidateLength === best.candidateLength && m.locationId !== best.locationId);
  if (tie) {
    console.log(`[locationDetector] Correspondance ambiguë ("${best.locationName}" vs "${tie.locationName}") → INDÉTERMINÉ`);
    return null;
  }

  return { locationId: best.locationId, locationName: best.locationName, matchedOn: 'signature_email' };
}

module.exports = {
  detectLocationFromSender,
  extractSignatureZone,
  normalizeLocationText,
  isAppLikeLocation,
  APP_LIKE_TERMS,
  UNDETERMINED,
};
