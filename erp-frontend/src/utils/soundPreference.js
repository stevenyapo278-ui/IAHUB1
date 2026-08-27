// ── Préférences de sons ──────────────────────────────────────────────────────
// Stockage local des préférences utilisateur pour les sons de notification.

const SOUNDS_ENABLED_KEY = 'soundsEnabled';
const SOUNDS_VOLUME_KEY = 'soundsVolume';
const SOUNDS_INTERACTION_KEY = 'soundsInteraction';

export function isSoundsEnabled() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(SOUNDS_ENABLED_KEY) !== 'false';
}

export function setSoundsEnabled(value) {
  localStorage.setItem(SOUNDS_ENABLED_KEY, value ? 'true' : 'false');
}

export function getSoundsVolume() {
  if (typeof window === 'undefined') return 0.5;
  const v = parseFloat(localStorage.getItem(SOUNDS_VOLUME_KEY));
  return isNaN(v) ? 0.5 : Math.max(0, Math.min(1, v));
}

export function setSoundsVolume(value) {
  localStorage.setItem(SOUNDS_VOLUME_KEY, String(Math.max(0, Math.min(1, value))));
}

export function isSoundsInteractionEnabled() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(SOUNDS_INTERACTION_KEY) !== 'false';
}

export function setSoundsInteractionEnabled(value) {
  localStorage.setItem(SOUNDS_INTERACTION_KEY, value ? 'true' : 'false');
}
