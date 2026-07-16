const ENABLED_KEY = 'voiceAlertsEnabled';
const LANG_KEY = 'voiceAlertsLang';

export const VOICE_ALERT_LANGUAGES = [
  { code: 'fr-FR', label: 'Français' },
  { code: 'en-US', label: 'Anglais (US)' },
  { code: 'es-ES', label: 'Espagnol' },
  { code: 'de-DE', label: 'Allemand' },
  { code: 'pt-PT', label: 'Portugais' },
  { code: 'ar-SA', label: 'Arabe' },
];

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

function getSynth() {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis || null;
}

export function speakTest(lang) {
  const synth = getSynth();
  if (!synth) return;

  synth.cancel();

  const msg = TEST_MESSAGES[lang] || TEST_MESSAGES['fr-FR'];
  const utterance = new SpeechSynthesisUtterance(msg);
  utterance.lang = lang;
  utterance.rate = 1;
  utterance.pitch = 1;

  const voices = synth.getVoices();
  const match = voices.find((v) => v.lang === lang);
  if (match) utterance.voice = match;

  utterance.onstart = () => synth.resume();
  synth.speak(utterance);
}
