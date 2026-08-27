// ── Sounds Apple style ────────────────────────────────────────────────────────
// Génération de sons de notification, interaction et validation via Web Audio API.
// Aucun fichier audio externe requis — tout est synthétisé en temps réel.

import { isSoundsEnabled, getSoundsVolume } from './soundPreference';

let audioCtx = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function playTone(frequency, duration, { type = 'sine', volume = 0.15, ramp = true, delay = 0 } = {}) {
  if (!isSoundsEnabled()) return;
  const masterVolume = getSoundsVolume();
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay);

  const adjustedVolume = volume * masterVolume;
  gain.gain.setValueAtTime(0, ctx.currentTime + delay);
  gain.gain.linearRampToValueAtTime(adjustedVolume, ctx.currentTime + delay + 0.02);
  if (ramp) {
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
  } else {
    gain.gain.setValueAtTime(adjustedVolume, ctx.currentTime + delay + duration - 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + duration);
  }

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration);
}

// ── Sons de notification (Apple Tri-tone inspired) ───────────────────────────

/** Notification ticket créé — mélodie ascendante douce (ding-ding-ding) */
export function playTicketCreated() {
  playTone(880, 0.15, { type: 'sine', volume: 0.12 });
  playTone(1108, 0.15, { type: 'sine', volume: 0.10, delay: 0.12 });
  playTone(1320, 0.2, { type: 'sine', volume: 0.08, delay: 0.24 });
}

/** Notification ticket assigné — double ton doux */
export function playTicketAssigned() {
  playTone(784, 0.12, { type: 'sine', volume: 0.10 });
  playTone(1047, 0.2, { type: 'sine', volume: 0.08, delay: 0.1 });
}

/** Notification ticket mis à jour — single ping */
export function playTicketUpdated() {
  playTone(1047, 0.18, { type: 'sine', volume: 0.08 });
}

// ── Sons d'interaction ───────────────────────────────────────────────────────

/** Clic sur bouton / action — micro-pop */
export function playClick() {
  playTone(1200, 0.06, { type: 'sine', volume: 0.04 });
}

/** Succès — chime bref */
export function playSuccess() {
  playTone(1047, 0.1, { type: 'sine', volume: 0.10 });
  playTone(1319, 0.15, { type: 'sine', volume: 0.08, delay: 0.08 });
}

/** Erreur / échec — ton descendant */
export function playError() {
  playTone(440, 0.15, { type: 'triangle', volume: 0.12 });
  playTone(330, 0.2, { type: 'triangle', volume: 0.10, delay: 0.1 });
}

// ── Sons d'approbation / rejet ───────────────────────────────────────────────

/** Approbation de ticket — mélodie ascendante réjouie (3 tons) */
export function playApproval() {
  playTone(523, 0.1, { type: 'sine', volume: 0.12 });
  playTone(659, 0.1, { type: 'sine', volume: 0.10, delay: 0.08 });
  playTone(784, 0.1, { type: 'sine', volume: 0.10, delay: 0.16 });
  playTone(1047, 0.25, { type: 'sine', volume: 0.08, delay: 0.24 });
}

/** Rejet de ticket — double ton descendant */
export function playRejection() {
  playTone(660, 0.12, { type: 'triangle', volume: 0.12 });
  playTone(440, 0.2, { type: 'triangle', volume: 0.10, delay: 0.1 });
}

/** Alerte P1 — urgence */
export function playAlertP1() {
  playTone(880, 0.08, { type: 'square', volume: 0.08 });
  playTone(880, 0.08, { type: 'square', volume: 0.08, delay: 0.12 });
  playTone(1100, 0.2, { type: 'square', volume: 0.06, delay: 0.24 });
}
