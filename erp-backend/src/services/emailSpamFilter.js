// Détecteur de spam et d'emails d'information déterministe pour emails entrants
// Permet de bloquer les réponses automatiques, les bounces, les newsletters, les emails d'absence,
// ainsi que les notes d'information et communiqués à diffusion générale.
// Évite les appels LLM coûteux et la création de tickets indésirables.

const BLACKLISTED_DOMAINS = [
  'newsletter',
  'pub',
  'marketing',
  'noreply',
  'no-reply',
  'bounce',
  'postmaster',
  'mailer-daemon',
  'diffusion',
  'communique',
  'communication',
  'bulletin',
  'annonces',
  'note-info',
  'all-staff',
  'touts-les-collaborateurs',
];

/**
 * Analyse un email et détermine s'il s'agit d'un spam / message automatique / email d'information.
 * @param {Array} headers - Tableau d'objets en-têtes { name, value }
 * @param {string} subject - Sujet de l'email
 * @param {string} body - Corps textuel de l'email
 * @param {string} fromEmail - Adresse email de l'expéditeur
 * @returns {Object} { isSpam: boolean, isInformational?: boolean, reason: string|null }
 */
function checkEmailSpam(headers = [], subject = '', body = '', fromEmail = '') {
  const getHeader = (name) => {
    const h = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
    return h ? h.value : null;
  };

  // 1. Analyse des en-têtes MIME typiques de réponses automatiques et listes de diffusion
  // Auto-Submitted header (RFC 3834)
  const autoSubmitted = getHeader('auto-submitted');
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return { isSpam: true, isInformational: true, reason: `Header Auto-Submitted: ${autoSubmitted}` };
  }

  // Precedence header
  const precedence = getHeader('precedence');
  if (precedence && ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence.toLowerCase())) {
    return { isSpam: true, isInformational: true, reason: `Header Precedence: ${precedence}` };
  }

  // En-têtes de liste de diffusion de masse (RFC 2369 / Mailman / Campaign)
  if (
    getHeader('list-id') ||
    getHeader('list-unsubscribe') ||
    getHeader('list-post') ||
    getHeader('x-mailman-version') ||
    getHeader('x-campaign-id') ||
    getHeader('x-broadcast')
  ) {
    return { isSpam: true, isInformational: true, reason: 'Header de liste de diffusion / mailing list détecté' };
  }

  // Autres headers d'auto-reply
  if (getHeader('x-autoreply') || getHeader('x-auto-reply')) {
    return { isSpam: true, isInformational: false, reason: 'Header X-Auto-Reply détecté' };
  }

  // Notification de machine
  if (getHeader('x-fc-machinegenerated')) {
    return { isSpam: true, isInformational: true, reason: 'Header X-FC-MachineGenerated détecté' };
  }

  // 2. Vérification de l'expéditeur (mots clés type noreply, bounce, diffusion, newsletter)
  if (fromEmail) {
    const localPart = fromEmail.split('@')[0].toLowerCase();
    const domainPart = fromEmail.split('@')[1]?.toLowerCase() || '';

    // Check blacklisted words in local part or domain
    const matchesBlacklist = BLACKLISTED_DOMAINS.some(term => 
      localPart.includes(term) || domainPart.includes(term)
    );
    if (matchesBlacklist) {
      return { isSpam: true, isInformational: true, reason: `Expéditeur blacklisté/diffusion : ${fromEmail}` };
    }
  }

  // 3. Expressions régulières sur le Sujet (Absence, No-Reply, Newsletter, Notes d'information, Communiqués)
  const spamSubjectRegex = [
    /out\s*of\s*office/i,
    /absent/i,
    /vacances/i,
    /cong(e|é)s?/i,
    /indisponible/i,
    /automatic\s*reply/i,
    /r(e|é)ponse\s*automatique/i,
    /newsletter/i,
    /no\-reply/i,
    /noreply/i,
    /notification\s*automatique/i,
    /statut\s*de\s*remise/i,
    /undelivered\s*mail/i,
    /delivery\s*status/i,
    /postmaster/i,
    /failure\s*notice/i,
    // Patterns d'emails purement informatifs (acceptant des suffixes comme RH, Direction, etc.)
    /^(\[\s*)?(note\s*d['’]info(rmation)?|communiqu[eé]|avis\s*de\s*maint(enance)?|flash\s*info|information\s*g[eé]n[eé]rale|note\s*de\s*service|compte[\s-]rendu|circulaire|invitation|bulletin\s*d['’]info|pour\s*info(rmation)?|fyi)/i,
    /^(\[\s*)?(maintenance\s*programm[eé]e|rappel\s*:|annonce\s*:|proc[eé]dure\s*:)(\s*\]|\b)/i,
  ];

  for (const regex of spamSubjectRegex) {
    if (regex.test(subject)) {
      const isInfo = /note|communiqu|maint|info|service|compte|circulaire|invitation|bulletin|fyi|annonce|proc[eé]dure/i.test(subject);
      return { isSpam: true, isInformational: isInfo, reason: `Sujet correspond à la regex : ${regex.toString()}` };
    }
  }

  // 4. Expressions régulières sur le Corps (Disclaimer de non-réponse, bounce mailer daemon, message d'information générale)
  const spamBodyRegex = [
    /ce\s*message\s*a\s*(e|é)t(e|é)\s*g(e|é)n(e|é)r(e|é)\s*automatiquement/i,
    /ne\s*pas\s*r(e|é)pondre/i,
    /do\s*not\s*reply/i,
    /this\s*is\s*an\s*automated\s*email/i,
    /mail\s*delivery\s*system/i,
    /mailer\-daemon/i,
    /d(e|é)lai\s*de\s*remise\s*d(e|é)pass(e|é)/i,
    // Phrases d'information générale sans demande de support
    /ceci\s*est\s*un\s*message\s*(d['’]information|automatique|g[eé]n[eé]ral)/i,
    /ne\s*n[eé]cessite\s*aucune\s*action\s*(de\s*votre\s*part)?/i,
    /pour\s*votre\s*information\s*uniquement/i,
    /diffus[eé]\s*[aà]\s*l['’]ensemble\s*du\s*personnel/i,
    /message\s*adress[eé]\s*[aà]\s*tous\s*les\s*collaborateurs/i,
  ];

  // On limite l'analyse regex du corps aux 4000 premiers caractères pour attraper les signatures légales longues
  const bodySnippet = body.substring(0, 4000);
  for (const regex of spamBodyRegex) {
    if (regex.test(bodySnippet)) {
      const isInfo = /information|action|personnel|collaborateurs/i.test(bodySnippet);
      return { isSpam: true, isInformational: isInfo, reason: `Corps correspond à la regex : ${regex.toString()}` };
    }
  }

  return { isSpam: false, isInformational: false, reason: null };
}

module.exports = { checkEmailSpam };

