const prisma = require('../prismaClient');
const { getSystemSettings } = require('./systemSettings');

// ── Copies (CC) des réponses IA (Paramètres > Avancé) ──────────────────────────
// Quand un demandeur écrit uniquement à la boîte IA (sans copier les humains ou
// les listes de diffusion), la réponse de l'IA part vers lui seul et personne
// d'autre ne voit le fil. Ce module calcule les adresses à ajouter en copie sur
// les emails sortants générés par l'IA (réponses de conversation + accusé de
// réception, selon le toggle dédié).
//
// Réglages (SystemSettings) :
//   • aiReplyCcEnabled           — master switch (désactivé par défaut)
//   • aiReplyCcEmails            — CSV d'adresses ajoutées en CC
//   • aiReplyCcMode              — ALWAYS           : toujours ajouter les CC
//                                  IF_NO_CC         : seulement si la demande
//                                                     n'avait déjà aucune copie
//                                  EXTERNAL_REQUESTER : seulement si le domaine
//                                                     du demandeur n'est pas interne
//   • aiReplyCcInternalDomains   — CSV de domaines internes (pour EXTERNAL_REQUESTER)
//   • aiReplyCcIncludeTeamGroup  — ajoute Team.groupEmail de l'équipe du ticket
//
// Garde-fous :
//   • Ticket.skipAiReplyCc       — opt-out par ticket (fils sensibles)
//   • les boîtes mail supervisées par la plateforme (EmailAccount.emailAddress)
//     sont EXCLUES de la copie : sinon l'IA se copierait elle-même et son email
//     serait ré-ingéré par le pipeline (boucle infinie)
//   • plafond de 10 adresses en copie (au-delà, risque de rejet SMTP + bruit)

const MAX_CC = 10;
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

// Découpe un CSV (« a@x.ci, b@x.ci; c@x.ci ») en adresses validées, dédupliquées
// et ramenées en minuscules. Les entrées invalides sont ignorées silencieusement.
function parseEmailList(csv) {
  if (!csv) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(csv).split(/[,;\n]/)) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!EMAIL_RE.test(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

// Découpe un CSV de domaines (« prosuma.ci, groupe.ci ») en Set de minuscules.
function parseDomainSet(csv) {
  if (!csv) return new Set();
  const seen = new Set();
  for (const raw of String(csv).split(/[,;\n]/)) {
    const domain = raw.trim().toLowerCase().replace(/^@/, '');
    if (domain) seen.add(domain);
  }
  return seen;
}

// Les boîtes supervisées par la plateforme ne doivent JAMAIS être mises en copie
// d'une réponse IA : Outlook re-delivre le message à la boîte, le pipeline le
// traite à nouveau → boucle (analyse → réponse → re-analyse → …).
async function getSupervisedMailboxes() {
  const accounts = await prisma.emailAccount.findMany({
    where: { isActive: true },
    select: { emailAddress: true },
  });
  return new Set(accounts.map((a) => (a.emailAddress || '').toLowerCase()).filter(Boolean));
}

// Domaine d'une adresse email (« jean@prosuma.ci » → « prosuma.ci »), ou null.
function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at > 0 ? String(email).slice(at + 1).toLowerCase() : null;
}

/**
 * Calcule la liste finale de copie (CC) pour un email sortant IA.
 *
 * @param {Object} p
 * @param {number} p.ticketId
 * @param {string} p.toEmail          destinataire principal (demandeur)
 * @param {string[]} [p.existingCc]   copie déjà présente sur la demande d'origine
 * @param {string} [p.channel]        'REPLY' (réponse de conversation) | 'ACK' (accusé)
 * @returns {Promise<string[]>} liste complète de copie (existingCc + CC IA), dédupliquée
 */
async function resolveAiReplyCc({ ticketId, toEmail, existingCc = [], channel = 'REPLY' }) {
  const settings = await getSystemSettings();
  if (!settings.aiReplyCcEnabled) return dedupe(existingCc);

  // L'accusé de réception a son propre toggle (souvent on ne veut prévenir les
  // autres qu'à partir de la vraie réponse IA, pas dès la prise de demande).
  if (channel === 'ACK' && settings.aiReplyCcOnAcknowledgement === false) {
    return dedupe(existingCc);
  }

  // Opt-out par ticket (fils sensibles) : on ne touche à rien.
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      skipAiReplyCc: true,
      teamId: true,
      team: { select: { groupEmail: true } },
      requester: { select: { email: true } },
    },
  });
  if (!ticket || ticket.skipAiReplyCc) return dedupe(existingCc);

  const base = dedupe(existingCc);
  const baseSet = new Set(base);

  // Mode : ne rien ajouter dans certains cas.
  const mode = settings.aiReplyCcMode || 'ALWAYS';
  if (mode === 'IF_NO_CC' && base.length > 0) return base;
  if (mode === 'EXTERNAL_REQUESTER') {
    const internalDomains = parseDomainSet(settings.aiReplyCcInternalDomains);
    // Sans domaine interne configuré, on ne peut pas trancher → on n'ajoute rien
    // (prudence : mieux vaut ne pas spammer que de spammer tout le monde).
    if (internalDomains.size === 0) return base;
    const requesterEmail = ticket.requester?.email || toEmail;
    const requesterDomain = domainOf(requesterEmail);
    if (!requesterDomain || internalDomains.has(requesterDomain)) return base;
  }

  // Cibles à ajouter : la liste configurée + (option) l'email de groupe de l'équipe.
  const targets = parseEmailList(settings.aiReplyCcEmails);
  if (settings.aiReplyCcIncludeTeamGroup && ticket.team?.groupEmail) {
    const group = ticket.team.groupEmail.toLowerCase();
    if (!targets.includes(group)) targets.push(group);
  }

  if (targets.length === 0) return base;

  // Exclusions : destinataire principal, déjà en copie, et boîtes supervisées
  // (anti-boucle).
  const supervised = await getSupervisedMailboxes();
  const excluded = new Set([...baseSet, String(toEmail || '').toLowerCase(), ...supervised]);

  const final = [...base];
  for (const email of targets) {
    if (final.length >= MAX_CC) break;
    if (excluded.has(email)) continue;
    final.push(email);
    excluded.add(email);
  }
  return final;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

module.exports = { resolveAiReplyCc, parseEmailList, parseDomainSet, MAX_CC };
