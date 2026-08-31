// Moteur d'évaluation des règles de tri inbox.
// Utilisé à la fois pour l'application automatique (pipeline) et le test manuel.

const prisma = require('../prismaClient');

// Champs supportés dans les conditions
const FIELD_ACCESSORS = {
  fromEmail: (email) => email.fromEmail || '',
  fromName: (email) => email.fromName || '',
  subject: (email) => email.subject || '',
  bodyPreview: (email) => email.bodyPreview || '',
  aiCategory: (email) => email.aiCategory || '',
  aiPriority: (email) => email.aiPriority || '',
  aiTeam: (email) => email.aiTeam || '',
  hasAttachments: (email) => String(email.hasAttachments || false),
};

// Opérateurs de comparaison
const OPERATORS = {
  contains: (fieldValue, ruleValue) => fieldValue.toLowerCase().includes(ruleValue.toLowerCase()),
  not_contains: (fieldValue, ruleValue) => !fieldValue.toLowerCase().includes(ruleValue.toLowerCase()),
  equals: (fieldValue, ruleValue) => fieldValue.toLowerCase() === ruleValue.toLowerCase(),
  starts_with: (fieldValue, ruleValue) => fieldValue.toLowerCase().startsWith(ruleValue.toLowerCase()),
  ends_with: (fieldValue, ruleValue) => fieldValue.toLowerCase().endsWith(ruleValue.toLowerCase()),
};

// Évalue une seule condition sur un email
function evaluateCondition(condition, email) {
  const accessor = FIELD_ACCESSORS[condition.field];
  const op = OPERATORS[condition.operator];
  if (!accessor || !op) return false;
  const fieldValue = accessor(email);
  return op(fieldValue, condition.value || '');
}

// Évalue toutes les conditions d'une règle sur un email
function evaluateRule(rule, email) {
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (conditions.length === 0) return false;

  const isAnd = (rule.conditionOperator || 'AND') === 'AND';
  if (isAnd) {
    return conditions.every((c) => evaluateCondition(c, email));
  }
  return conditions.some((c) => evaluateCondition(c, email));
}

// Applique l'action d'une règle sur un email (mutateur)
async function applyRuleAction(rule, emailId) {
  const config = rule.actionConfig || {};
  console.log(`[inboxRuleEngine] Application règle "${rule.action}" sur email #${emailId}`, JSON.stringify(config));
  switch (rule.action) {
    case 'move_to_folder':
      if (config.folderId) {
        await prisma.incomingEmail.update({ where: { id: emailId }, data: { folderId: Number(config.folderId) } });
        console.log(`[inboxRuleEngine] Email #${emailId} déplacé vers dossier #${config.folderId}`);
      }
      break;
    case 'mark_read':
      await prisma.incomingEmail.update({ where: { id: emailId }, data: { isRead: true } });
      break;
    case 'mark_spam':
      await prisma.incomingEmail.update({ where: { id: emailId }, data: { status: 'SPAM', aiIsSpam: true } });
      break;
    case 'mark_category':
      if (config.category) {
        await prisma.incomingEmail.update({ where: { id: emailId }, data: { aiCategory: config.category } });
      }
      break;
  }
}

// Applique toutes les règles actives sur un email entrant (appelé par le pipeline)
// Les règles sont évaluées dans l'ordre de position ; la première qui match gagne.
async function applyRulesToEmail(email) {
  const rules = await prisma.inboxRule.findMany({
    where: { isEnabled: true },
    orderBy: { position: 'asc' },
  });
  for (const rule of rules) {
    if (evaluateRule(rule, email)) {
      await applyRuleAction(rule, email.id);
      return rule; // première règle qui match
    }
  }
  return null;
}

// Compte le nombre d'emails existants qui matchent une règle (pour le test manuel)
async function matchRuleAgainstEmails(rule) {
  const emails = await prisma.incomingEmail.findMany({
    orderBy: { receivedAt: 'desc' },
    take: 3000,
  });
  let count = 0;
  for (const email of emails) {
    if (evaluateRule(rule, email)) count++;
  }
  return count;
}

module.exports = { applyRulesToEmail, applyRuleAction, matchRuleAgainstEmails, evaluateRule };
