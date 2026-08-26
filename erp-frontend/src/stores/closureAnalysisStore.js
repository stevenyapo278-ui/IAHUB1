// Store module-level de l'analyse des clôtures — vit HORS du cycle de vie React.
//
// Pourquoi : l'analyse (POST /tickets/analyze-closures) peut prendre plusieurs
// secondes ; montée dans un simple useState, quitter la vue tuait le spinner et
// jetait le rapport de résultats. Ici :
//  - le POST est porté par le module : naviguer vers une autre vue puis revenir
//    n'interrompt ni l'analyse ni son affichage ;
//  - le rapport est dupliqué en sessionStorage (horodaté) : il survit même à un
//    rechargement complet de la page, et expire au bout de MAX_AGE_MS ;
//  - un double clic pendant une analyse en cours réutilise l'exécution unique.
import api from '../api/client';

const STORAGE_KEY = 'closure_analysis_results';
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // le rapport reste consultable 2 h

let state = { running: false, results: null, error: null };
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

function persist(results) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(results)); } catch { /* quota */ }
}

function hydrateFromSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.finishedAt || Date.now() - parsed.finishedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    state = { running: false, results: parsed, error: null };
  } catch { /* session indisponible */ }
}

export function getClosureAnalysisState() {
  return state;
}

export function subscribeClosureAnalysis(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Lance l'analyse si aucune n'est en cours (no-op sinon). Retourne la promesse
// du POST pour d'éventuels traitements additionnels ; les erreurs sont exposées
// dans l'état (state.error), pas rejetées vers l'appelant.
export function startClosureAnalysis() {
  if (state.running) return Promise.resolve(null);
  state = { running: true, results: state.results, error: null };
  emit();

  return api.post('/tickets/analyze-closures')
    .then(({ data }) => {
      const payload = { ...data, finishedAt: Date.now() };
      state = { running: false, results: payload, error: null };
      persist(payload);
      emit();
      return data;
    })
    .catch((err) => {
      state = { running: false, results: state.results, error: err.response?.data?.error || "Échec de l'analyse" };
      emit();
      return null;
    });
}

export function clearClosureAnalysis() {
  state = { running: false, results: null, error: null };
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  emit();
}

hydrateFromSession();
