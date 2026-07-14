const prisma = require('../prismaClient');

/**
 * Normalise une chaîne de caractères pour faciliter la comparaison (sans accents, minuscules).
 */
function normalizeString(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Vérifie si une valeur correspond à une règle de triage donnée.
 */
function testMatch(textToTest, matchType, matchValue) {
  if (!textToTest) return false;

  const normalizedText = normalizeString(textToTest);
  const normalizedValue = normalizeString(matchValue);

  switch (matchType) {
    case 'equals':
      return normalizedText.trim() === normalizedValue.trim();

    case 'starts_with':
      return normalizedText.startsWith(normalizedValue);

    case 'contains':
      return normalizedText.includes(normalizedValue);

    case 'regex':
      try {
        const regex = new RegExp(matchValue, 'i');
        // Protection basique ReDoS: limiter l'exécution de la regex aux 2000 premiers caractères
        return regex.test(textToTest.substring(0, 2000));
      } catch (err) {
        console.error(`[emailRuleEngine] Regex invalide "${matchValue}":`, err.message);
        return false;
      }

    default:
      return false;
  }
}

/**
 * Évalue un email entrant par rapport aux règles de triage configurées en base de données.
 * @param {string} subject - Sujet de l'email
 * @param {string} body - Corps textuel de l'email
 * @param {string} fromEmail - Adresse email de l'expéditeur
 * @returns {Promise<Object|null>} La règle qui correspond, ou null
 */
async function evaluateRules(subject = '', body = '', fromEmail = '') {
  try {
    // Charger toutes les règles actives triées par priorité décroissante
    const rules = await prisma.triageRule.findMany({
      where: { isActive: true },
      orderBy: [
        { priority: 'desc' },
        { id: 'asc' }
      ]
    });

    if (rules.length === 0) return null;

    for (const rule of rules) {
      let isMatch = false;

      switch (rule.matchField) {
        case 'subject':
          isMatch = testMatch(subject, rule.matchType, rule.matchValue);
          break;

        case 'body':
          isMatch = testMatch(body, rule.matchType, rule.matchValue);
          break;

        case 'subject_or_body':
          isMatch = testMatch(subject, rule.matchType, rule.matchValue) || 
                    testMatch(body, rule.matchType, rule.matchValue);
          break;

        case 'from':
          isMatch = testMatch(fromEmail, rule.matchType, rule.matchValue);
          break;

        default:
          break;
      }

      if (isMatch) {
        console.log(`[emailRuleEngine] Règle correspondante trouvée: "${rule.label}" (ID: ${rule.id})`);
        return {
          id: rule.id,
          label: rule.label,
          category: rule.category,
          skillName: rule.skillName,
          teamName: rule.teamName,
          ticketPriority: rule.ticketPriority || 'P3',
          isSpam: rule.isSpam
        };
      }
    }

    return null;
  } catch (err) {
    console.error('[emailRuleEngine] Échec de l\'évaluation des règles:', err.message);
    return null;
  }
}

module.exports = { evaluateRules };
