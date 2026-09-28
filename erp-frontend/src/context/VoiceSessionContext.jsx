import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useVoiceLive } from '../hooks/useVoiceLive';
import VoiceModeModal from '../components/VoiceModeModal';
import VoiceMiniOrb from '../components/VoiceMiniOrb';

// Session vocale GLOBALE : une seule instance de useVoiceLive pour toute l'app.
// - Le modal plein écran lit/writing la session via ce contexte
// - La mini-orbe persiste quand le modal est réduit (la session continue)
// - ChatWidget/ChatPage n'ont plus leur propre état `voiceModeOpen`
const VoiceSessionContext = createContext(null);

const ACTIVE_STATES = ['listening', 'speaking', 'thinking', 'connecting', 'reconnecting'];

export function VoiceSessionProvider({ children }) {
  const voice = useVoiceLive();
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  // Marie suit la navigation : informer le backend à chaque changement de route
  // pendant la session (outil get_context + préfixe ask_assistant lisent toolCtx.nav)
  const { sendNavigation } = voice;
  useEffect(() => {
    sendNavigation(`${location.pathname}${location.search}`);
  }, [location, sendNavigation]);

  // Ouvrir le modal (démarre la session si inactive)
  const open = useCallback(() => {
    setIsOpen(true);
    if (voice.state === 'idle' || voice.state === 'error') {
      voice.startListening();
    }
  }, [voice]);

  // Réduire : le modal se ferme MAIS la session continue (mini-orbe visible)
  const minimize = useCallback(() => {
    setIsOpen(false);
    // Session déjà inactive : pas de mini-orbe possible — libérer proprement
    if (!ACTIVE_STATES.includes(voice.state)) {
      voice.stopAll();
    }
  }, [voice]);

  // Arrêt réel : stop + fermeture (bouton ✕ du modal, ESC, ✕ de la mini-orbe)
  const close = useCallback(() => {
    voice.stopAll();
    setIsOpen(false);
  }, [voice]);

  const sessionActive = ACTIVE_STATES.includes(voice.state);
  const showMiniOrb = !isOpen && sessionActive;

  const value = useMemo(
    () => ({
      ...voice,
      isOpen,
      open,
      minimize,
      close,
      sessionActive,
      showMiniOrb,
    }),
    [voice, isOpen, open, minimize, close, sessionActive, showMiniOrb],
  );

  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
      <VoiceModeModal />
      <VoiceMiniOrb />
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSession() {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) {
    throw new Error('useVoiceSession doit être utilisé dans un VoiceSessionProvider');
  }
  return ctx;
}
