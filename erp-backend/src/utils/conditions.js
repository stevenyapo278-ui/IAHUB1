// Condition « si … » partagée par le backend :
//  - requiredIf des champs (obligation conditionnelle d'un champ)
//  - trigger du bloc « Validation supérieure » (form.approval)
// Même logique que conditionMet() dans FormRequest.jsx :
// la règle est vraie si la source est remplie ou cochée ; si `equals` est
// renseigné, valeur égale (liste déroulante) ou présente dans le tableau
// (liste multiple). Case non cochée / champ vide → règle fausse.
function evaluateCondition(rule, answers) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
  const question = String(rule.question || '').trim();
  if (!question) return false;
  const val = answers[question];
  const isEmpty = val === undefined || val === null || val === ''
    || (Array.isArray(val) && val.length === 0);
  if (isEmpty) return false;
  if (rule.equals === undefined || rule.equals === null || rule.equals === '') return true;
  if (Array.isArray(val)) return val.map(String).includes(String(rule.equals));
  return String(val) === String(rule.equals);
}

module.exports = { evaluateCondition };
