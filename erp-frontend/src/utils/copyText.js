// Copie du presse-papiers avec repli — miroir des 4 boutons « copier » de l'app.
//
// navigator.clipboard n'existe QUE dans un contexte sécurisé (HTTPS ou
// localhost) : servi en HTTP sur une IP LAN (ex. http://192.168.1.10:5173),
// l'API est absente et tout writeText lève — d'où les toasts « Erreur de copie ».
// Repli : textarea temporaire + document.execCommand('copy'), déprécié mais
// toujours supporté par tous les navigateurs et actif hors contexte sécurisé.
//
// @param {string} text texte à copier
// @returns {Promise<boolean>} true si la copie a réussi
export default async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // On retente via le repli ci-dessous (permission refusée, etc.)
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
