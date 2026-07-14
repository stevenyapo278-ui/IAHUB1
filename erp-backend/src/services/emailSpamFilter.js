// Détecteur de spam déterministe pour emails entrants
// Permet de bloquer les réponses automatiques, les bounces, les newsletters, les emails d'absence, etc.
// Évite les appels LLM coûteux et inutiles.

const BLACKLISTED_DOMAINS = [
  'newsletter',
  'pub',
  'marketing',
  'noreply',
  'no-reply',
  'bounce',
  'postmaster',
  'mailer-daemon'
];

/**
 * Analyse un email et détermine s'il s'agit d'un spam / message automatique.
 * @param {Array} headers - Tableau d'objets en-têtes { name, value }
 * @param {string} subject - Sujet de l'email
 * @param {string} body - Corps textuel de l'email
 * @param {string} fromEmail - Adresse email de l'expéditeur
 * @returns {Object} { isSpam: boolean, reason: string|null }
 */
function checkEmailSpam(headers = [], subject = '', body = '', fromEmail = '') {
  const getHeader = (name) => {
    const h = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
    return h ? h.value : null;
  };

  // 1. Analyse des en-têtes MIME typiques de réponses automatiques
  // Auto-Submitted header (RFC 3834)
  const autoSubmitted = getHeader('auto-submitted');
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return { isSpam: true, reason: `Header Auto-Submitted: ${autoSubmitted}` };
  }

  // Precedence header
  const precedence = getHeader('precedence');
  if (precedence && ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence.toLowerCase())) {
    return { isSpam: true, reason: `Header Precedence: ${precedence}` };
  }

  // Autres headers d'auto-reply
  if (getHeader('x-autoreply') || getHeader('x-auto-reply')) {
    return { isSpam: true, reason: 'Header X-Auto-Reply détecté' };
  }

  // Notification de machine
  if (getHeader('x-fc-machinegenerated')) {
    return { isSpam: true, reason: 'Header X-FC-MachineGenerated détecté' };
  }

  // 2. Vérification de l'expéditeur (mots clés type noreply ou bounce)
  if (fromEmail) {
    const localPart = fromEmail.split('@')[0].toLowerCase();
    const domainPart = fromEmail.split('@')[1]?.toLowerCase() || '';

    // Check blacklisted words in local part
    const matchesBlacklist = BLACKLISTED_DOMAINS.some(term => 
      localPart.includes(term) || domainPart.includes(term)
    );
    if (matchesBlacklist) {
      return { isSpam: true, reason: `Expéditeur blacklisté/automatisé : ${fromEmail}` };
    }
  }

  // 3. Expressions régulières sur le Sujet (Absence, No-Reply, Newsletter)
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
    /failure\s*notice/i
  ];

  for (const regex of spamSubjectRegex) {
    if (regex.test(subject)) {
      return { isSpam: true, reason: `Sujet correspond à la regex : ${regex.toString()}` };
    }
  }

  // 4. Expressions régulières sur le Corps (Disclaimer de non-réponse, bounce mailer daemon)
  const spamBodyRegex = [
    /ce\s*message\s*a\s*(e|é)t(e|é)\s*g(e|é)n(e|é)r(e|é)\s*automatiquement/i,
    /ne\s*pas\s*r(e|é)pondre/i,
    /do\s*not\s*reply/i,
    /this\s*is\s*an\s*automated\s*email/i,
    /mail\s*delivery\s*system/i,
    /mailer\-daemon/i,
    /d(e|é)lai\s*de\s*remise\s*d(e|é)pass(e|é)/i
  ];

  // On limite l'analyse regex du corps aux 4000 premiers caractères pour attraper les signatures légales longues
  const bodySnippet = body.substring(0, 4000);
  for (const regex of spamBodyRegex) {
    if (regex.test(bodySnippet)) {
      return { isSpam: true, reason: `Corps correspond à la regex : ${regex.toString()}` };
    }
  }

  return { isSpam: false, reason: null };
}

module.exports = { checkEmailSpam };
