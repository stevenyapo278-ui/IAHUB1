const ENABLED_KEY = 'voiceAlertsEnabled';
const LANG_KEY = 'voiceAlertsLang';

// Langues proposées dans l'UI — code BCP 47 utilisé directement par SpeechSynthesisUtterance.lang.
export const VOICE_ALERT_LANGUAGES = [
  { code: 'fr-FR', label: 'Français' },
  { code: 'en-US', label: 'Anglais (US)' },
  { code: 'es-ES', label: 'Espagnol' },
  { code: 'de-DE', label: 'Allemand' },
  { code: 'pt-PT', label: 'Portugais' },
  { code: 'ar-SA', label: 'Arabe' },
];

// Préférences purement locales au navigateur (pas envoyées au backend) : chaque utilisateur peut
// activer/désactiver l'alerte vocale et choisir sa langue sur son propre poste, sans affecter les autres.
export function isVoiceAlertEnabled() {
  return localStorage.getItem(ENABLED_KEY) !== 'false';
}

export function setVoiceAlertEnabled(value) {
  localStorage.setItem(ENABLED_KEY, value ? 'true' : 'false');
}

export function getVoiceAlertLang() {
  return localStorage.getItem(LANG_KEY) || 'fr-FR';
}

export function setVoiceAlertLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
}

const TEST_MESSAGES = {
  'fr-FR': "Ceci est un test de l'alerte vocale.",
  'en-US': 'This is a test of the voice alert.',
  'es-ES': 'Esta es una prueba de la alerta de voz.',
  'de-DE': 'Dies ist ein Test des Sprachalarms.',
  'pt-PT': 'Este é um teste do alerta de voz.',
  'ar-SA': 'هذا اختبار للتنبيه الصوتي.',
};

export function speakTest(lang) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(TEST_MESSAGES[lang] || TEST_MESSAGES['fr-FR']);
  utterance.lang = lang;
  window.speechSynthesis.speak(utterance);
}
