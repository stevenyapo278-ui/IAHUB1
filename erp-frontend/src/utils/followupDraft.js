// Brouillons de suivi non envoyés — persistance localStorage (anti-perte).
// Clé scopée par type de fiche (ticket/problème), id et utilisateur, pour que
// deux postes ou deux comptes partagés ne se mélangent pas.
import { richTextIsEmpty } from './sanitize';

const PREFIX = 'followup_draft';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

const keyFor = (kind, id, userId) => `${PREFIX}:${kind}:${id}:${userId || 'anon'}`;

export function readFollowupDraft(kind, id, userId) {
  const key = keyFor(kind, id, userId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || typeof rec.html !== 'string' || richTextIsEmpty(rec.html)) return null;
    if (Date.now() - (rec.ts || 0) > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return {
      html: rec.html,
      mentions: Array.isArray(rec.mentions) ? rec.mentions : [],
      priv: rec.priv === true,
    };
  } catch {
    return null;
  }
}

export function writeFollowupDraft(kind, id, userId, html, mentions = [], priv = false) {
  const key = keyFor(kind, id, userId);
  try {
    // Marqueurs d'images non reprises : les fichiers ne sont pas persistables,
    // on ne garde que le HTML (le dépôt des images reste à refaire à la main).
    const clean = (html || '').replace(/<!--IMAGE_\d+-->/g, '');
    if (richTextIsEmpty(clean)) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ html: clean, mentions, priv, ts: Date.now() }));
  } catch {
    // stockage indisponible (mode privé, quota) : le brouillon reste en mémoire
  }
}
