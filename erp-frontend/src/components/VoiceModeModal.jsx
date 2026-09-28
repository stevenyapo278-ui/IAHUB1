import { useRef, useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Mic, MicOff, Volume2, VolumeX, Loader2, Ear, EarOff, Wrench, Flame, ArrowRight, ScrollText, Ticket, Minus } from 'lucide-react';
import { useVoiceSession } from '../context/VoiceSessionContext';
import VoiceVisualizer from './VoiceVisualizer';
import VoiceToolCard from './VoiceToolCard';
import api from '../api/client';

const STATE_CONFIG = {
  idle: { label: 'En attente', color: '#64748b' },
  connecting: { label: 'Connexion…', color: '#eab308' },
  reconnecting: { label: 'Reconnexion…', color: '#f97316' },
  listening: { label: 'Écoute…', color: '#3b82f6' },
  thinking: { label: 'Réflexion…', color: '#a855f7' },
  speaking: { label: 'Parle…', color: '#22c55e' },
  error: { label: 'Erreur', color: '#ef4444' },
};

// Libellés FR des outils vocaux pour le chip « Marie utilise… »
const TOOL_LABELS = {
  get_ticket_count: 'compte les tickets',
  search_tickets: 'cherche des tickets',
  check_ticket: 'consulte un ticket',
  get_ticket_summary: 'résume un ticket',
  create_ticket: 'crée un ticket',
  update_ticket_status: 'met à jour un ticket',
  add_ticket_followup: 'ajoute un suivi',
  generate_report: 'prépare un rapport',
  get_context: 'lit la page actuelle',
  ask_assistant: 'réfléchit',
  search_knowledge: 'cherche dans la base de connaissances',
  search_teams: 'consulte les équipes',
  search_users: 'cherche un utilisateur',
};

export default function VoiceModeModal() {
  const messagesEndRef = useRef(null);

  const {
    state,
    messages,
    error,
    isSupported,
    isMuted,
    noiseSuppressionEnabled,
    analyserNode,
    playbackAnalyserNode,
    activeTool,
    toolResult,
    summary,
    summaryPending,
    startListening,
    stopAll,
    toggleMute,
    toggleNoiseSuppression,
    isBrainstormMode,
    isOpen,
    close,
    minimize,
    requestSummary,
    clearSummary,
  } = useVoiceSession();

  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  // Alerte ticket P1 reçue pendant la session (event window déclenché par SocketContext)
  const [p1Alert, setP1Alert] = useState(null);
  // Création de ticket à partir du résumé de session
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [createdTicket, setCreatedTicket] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const isActive = ['listening', 'speaking', 'thinking', 'reconnecting'].includes(state);
  const baseConfig = STATE_CONFIG[state] || STATE_CONFIG.idle;
  // Orbe : analyser du micro en écoute, analyser de sortie quand Marie parle
  const activeAnalyser = state === 'speaking' && playbackAnalyserNode ? playbackAnalyserNode : analyserNode;

  // Surcharger les couleurs d'état en mode brainstorming
  const config = isBrainstormMode
    ? {
        ...baseConfig,
        color: state === 'listening'
          ? '#a855f7' // Violet d'écoute brainstorming !
          : (state === 'speaking' || state === 'thinking' ? '#ec4899' : baseConfig.color) // Rose d'idées/réponses !
      }
    : baseConfig;

  // ✕ en haut à droite = RÉDUIRE (la session continue via la mini-orbe)
  const handleClose = useCallback(() => {
    minimize();
  }, [minimize]);

  // Demander le résumé de session (→ carte résumé)
  const handleRequestSummary = useCallback(() => {
    setCreatedTicket(null);
    setSummaryError(null);
    requestSummary();
  }, [requestSummary]);

  // Créer un ticket à partir du résumé de l'échange
  const handleCreateTicketFromSummary = useCallback(async () => {
    if (!summary || creatingTicket) return;
    setCreatingTicket(true);
    setSummaryError(null);
    try {
      const res = await api.post('/tickets', {
        title: `Échange vocal MARIE — ${new Date().toLocaleDateString('fr-FR')}`,
        content: summary,
        priority: 'P3',
      });
      setCreatedTicket(res.data || null);
    } catch (err) {
      setSummaryError(err.response?.data?.error || err.message || 'Création du ticket impossible');
    } finally {
      setCreatingTicket(false);
    }
  }, [summary, creatingTicket]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Alerte P1 : carte visuelle pendant la session (le son est déjà joué par SocketContext)
  useEffect(() => {
    if (!isOpen) return undefined;
    let timer = null;
    const onP1 = (e) => {
      const t = e.detail;
      if (!t?.id) return;
      setP1Alert(t);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setP1Alert(null), 10000);
    };
    window.addEventListener('voice:p1-alert', onP1);
    return () => {
      window.removeEventListener('voice:p1-alert', onP1);
      if (timer) clearTimeout(timer);
    };
  }, [isOpen]);

  // ESC = réduire comme le ✕ (la session continue)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => e.key === 'Escape' && handleClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Assistant vocal MARIE"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(40px)' }}
      >
        {/* Ambient glow */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          animate={
            reduceMotion
              ? { opacity: 0.12 }
              : { opacity: isActive ? [0.15, 0.25, 0.15] : 0.08 }
          }
          transition={reduceMotion ? { duration: 0 } : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: `radial-gradient(circle at 50% 40%, ${config.color}44 0%, transparent 70%)`,
          }}
        />

        {/* Close button = réduire (la session continue en mini-orbe) */}
        <button
          onClick={handleClose}
          aria-label="Réduire : la session vocale continue en arrière-plan"
          className="absolute top-5 right-5 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        >
          <X className="w-5 h-5 text-white/80" />
        </button>

        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl font-light tracking-[0.3em] text-white/90">MARIE</h1>
          <p className="text-xs text-white/65 mt-1 tracking-widest uppercase">
            {isBrainstormMode ? '💡 Session Brainstorming' : 'Assistant vocal'}
          </p>
        </motion.div>

        {/* Orb area */}
        <div className="relative w-[200px] h-[200px] flex items-center justify-center mb-6">
          {/* Pulse rings */}
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute inset-0 rounded-full"
              style={{ border: `1px solid ${config.color}` }}
              animate={
                reduceMotion
                  ? { scale: 1, opacity: isActive ? 0.3 : 0 }
                  : isActive
                    ? { scale: [1, 1.6], opacity: [0.4, 0] }
                    : { scale: 1, opacity: 0 }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.6,
                      ease: 'easeOut',
                    }
              }
            />
          ))}

          {/* Outer glow ring */}
          <motion.div
            className="absolute inset-2 rounded-full"
            animate={{
              boxShadow: isActive
                ? [`0 0 20px ${config.color}00`, `0 0 40px ${config.color}66`, `0 0 20px ${config.color}00`]
                : `0 0 10px ${config.color}22`,
              borderColor: isActive ? [`${config.color}33`, `${config.color}88`, `${config.color}33`] : `${config.color}33`,
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ border: '1px solid' }}
          />

          {/* VoiceVisualizer */}
          <div className="absolute inset-2 overflow-hidden rounded-full opacity-60">
            <VoiceVisualizer analyserNode={activeAnalyser} color={config.color} isActive={isActive} state={state} />
          </div>

          {/* Core orb */}
          <motion.button
            onClick={isActive ? stopAll : startListening}
            aria-label={
              isActive
                ? "Arrêter l'écoute et la parole"
                : 'Démarrer une conversation avec Marie'
            }
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            animate={
              !reduceMotion && state === 'listening'
                ? {
                    scale: [1, 1.04, 1],
                    boxShadow: [
                      `0 8px 32px ${config.color}44`,
                      `0 8px 48px ${config.color}77`,
                      `0 8px 32px ${config.color}44`,
                    ],
                  }
                : {}
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 2, repeat: Infinity, ease: 'easeInOut' }
            }
            className="relative z-10 w-24 h-24 rounded-full flex items-center justify-center cursor-pointer focus:outline-none"
            style={{
              background: `linear-gradient(135deg, ${config.color}33, ${config.color}11)`,
              boxShadow: `0 8px 32px ${config.color}44, inset 0 1px 0 rgba(255,255,255,0.1)`,
            }}
          >
            <AnimatePresence mode="wait">
              {state === 'thinking' || state === 'connecting' ? (
                <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1, rotate: 360 }} exit={{ opacity: 0 }} transition={{ rotate: { duration: 1, repeat: Infinity, ease: 'linear' } }}>
                  <Loader2 className="w-8 h-8 text-white/80" />
                </motion.div>
              ) : state === 'speaking' ? (
                <motion.div key="volume" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <Volume2 className="w-8 h-8 text-white/80" />
                </motion.div>
              ) : state === 'listening' ? (
                <motion.div key="mic" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <Mic className="w-8 h-8 text-white/80" />
                </motion.div>
              ) : state === 'error' ? (
                <motion.div key="micoff" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <MicOff className="w-8 h-8 text-white/80" />
                </motion.div>
              ) : (
                <motion.div key="mic-idle" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <Mic className="w-8 h-8 text-white/50" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>

        {/* Status label */}
        <div className="flex items-center gap-2 mb-4">
          {state === 'listening' ? (
            <div className="flex items-end gap-0.5 h-3.5 shrink-0" title="Microphone actif - Écoute en cours">
              <motion.div className="w-0.5 bg-blue-400 rounded-full" animate={{ height: [4, 12, 4] }} transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }} style={{ height: 4 }} />
              <motion.div className="w-0.5 bg-blue-400 rounded-full" animate={{ height: [6, 16, 6] }} transition={{ duration: 0.7, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }} style={{ height: 6 }} />
              <motion.div className="w-0.5 bg-blue-400 rounded-full" animate={{ height: [8, 10, 8] }} transition={{ duration: 0.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }} style={{ height: 8 }} />
              <motion.div className="w-0.5 bg-blue-400 rounded-full" animate={{ height: [4, 14, 4] }} transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut', delay: 0.45 }} style={{ height: 4 }} />
            </div>
          ) : (
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: config.color }}
              animate={isActive ? { opacity: [1, 0.3, 1] } : { opacity: 0.6 }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
          <span className="text-xs text-white/70 tracking-widest uppercase">{config.label}</span>
        </div>

        {/* Chip « Marie utilise… » (outil en cours d'exécution) */}
        <AnimatePresence>
          {activeTool && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 mb-3 px-3.5 py-1.5 rounded-full bg-purple-500/20 border border-purple-400/40"
            >
              <Loader2 className="w-3.5 h-3.5 text-purple-300 animate-spin shrink-0" />
              <Wrench className="w-3.5 h-3.5 text-purple-300/80 shrink-0" />
              <span className="text-xs text-purple-100">
                Marie utilise {TOOL_LABELS[activeTool] || activeTool}…
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mx-4 mb-4 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm max-w-md text-center"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sous-titres : le tour courant en GRAND, l'historique en dessous */}
        {messages.length > 0 && (
          <div className="w-full max-w-2xl mx-4 mb-4 px-4 flex flex-col items-center">
            {/* Historique compact */}
            <div className="w-full max-h-[110px] overflow-y-auto mb-3 space-y-1 text-center scrollbar-thin scrollbar-thumb-white/10">
              {messages.slice(0, -1).map((m) => (
                <p key={m.id} className="text-xs leading-relaxed">
                  <span className={m.role === 'user' ? 'text-blue-300/90' : 'text-purple-300/90'}>
                    {m.role === 'user' ? 'Vous' : 'Marie'} :
                  </span>{' '}
                  <span className="text-white/50 line-clamp-2">{m.text}</span>
                </p>
              ))}
              <div ref={messagesEndRef} />
            </div>
            {/* Tour courant en sous-titre géant */}
            {(() => {
              const last = messages[messages.length - 1];
              return (
                <motion.div
                  key={last.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center w-full"
                >
                  <div
                    className={`text-[11px] uppercase tracking-[0.25em] mb-1.5 ${
                      last.role === 'user' ? 'text-blue-300' : 'text-purple-300'
                    }`}
                  >
                    {last.role === 'user' ? 'Vous' : 'Marie'}
                  </div>
                  <p
                    className={`text-lg sm:text-2xl font-light leading-snug ${
                      last.role === 'user' ? 'text-blue-50' : 'text-white/95'
                    }`}
                  >
                    {last.text}
                    {last.live && (
                      <span className="inline-block w-2 h-5 ml-1 align-middle bg-current animate-pulse" />
                    )}
                  </p>
                </motion.div>
              );
            })()}
          </div>
        )}

        {/* Carte résultat d'outil (tickets cliquables, confirmation, stats) */}
        <AnimatePresence mode="wait">
          {toolResult && (
            <VoiceToolCard key={`${toolResult.name}-${toolResult.data?.kind}`} result={toolResult} onNavigate={handleClose} />
          )}
        </AnimatePresence>

        {/* Résumé de session + création de ticket à partir de l'échange */}
        <AnimatePresence>
          {summary && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="w-full max-w-2xl mx-4 mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 overflow-hidden"
              aria-live="polite"
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-400/20 bg-emerald-500/10">
                <ScrollText className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-200 flex-1">
                  Résumé de notre échange
                </span>
                <button
                  type="button"
                  onClick={clearSummary}
                  aria-label="Masquer le résumé"
                  className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60"
                >
                  <X className="w-3.5 h-3.5 text-white/70" />
                </button>
              </div>
              <div className="p-3">
                <p className="text-sm text-white/85 leading-relaxed max-h-[140px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                  {summary}
                </p>
                {summaryError && (
                  <p className="mt-2 text-xs text-red-300">{summaryError}</p>
                )}
                <div className="mt-2.5">
                  {createdTicket ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleClose();
                        navigate(`/tickets/${createdTicket.id}`);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-xs text-emerald-200 hover:bg-emerald-500/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 transition-colors"
                    >
                      Ticket #{createdTicket.id} créé <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCreateTicketFromSummary}
                      disabled={creatingTicket}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-400/40 text-xs text-blue-200 hover:bg-blue-500/30 disabled:opacity-60 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60 transition-colors"
                    >
                      {creatingTicket ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> Création…
                        </>
                      ) : (
                        <>
                          <Ticket className="w-3 h-3" /> Créer un ticket de notre échange
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Alerte P1 reçue pendant la session */}
        <AnimatePresence>
          {p1Alert && (
            <motion.button
              type="button"
              initial={reduceMotion ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              onClick={() => {
                setP1Alert(null);
                handleClose();
                navigate(`/tickets/${p1Alert.id}`);
              }}
              className="w-full max-w-2xl mx-4 mb-4 flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-400/40 text-left hover:bg-red-500/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400/60 transition-colors"
            >
              <span className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-400/40 flex items-center justify-center shrink-0">
                <Flame className="w-5 h-5 text-red-400 animate-pulse" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-bold text-red-300 uppercase tracking-wider">
                  Incident critique P1
                </span>
                <span className="block text-sm text-white/90 truncate">
                  #{p1Alert.id} — {p1Alert.title || p1Alert.titre}
                </span>
              </span>
              <span className="text-xs text-red-200 shrink-0 flex items-center gap-1">
                Ouvrir <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Controls row */}
        <div className="flex items-center gap-4 mb-6">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={toggleNoiseSuppression}
            aria-label={noiseSuppressionEnabled ? 'Désactiver le filtre anti-bruit' : 'Activer le filtre anti-bruit'}
            className={`p-3 rounded-full transition-colors ${noiseSuppressionEnabled ? 'bg-emerald-500/30 hover:bg-emerald-500/40' : 'bg-white/10 hover:bg-white/20'}`}
            title={noiseSuppressionEnabled ? 'Filtre anti-bruit activé' : 'Filtre anti-bruit désactivé'}
          >
            {noiseSuppressionEnabled ? (
              <Ear className="w-5 h-5 text-emerald-400" />
            ) : (
              <EarOff className="w-5 h-5 text-white/65" />
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={toggleMute}
            aria-label={isMuted ? 'Réactiver le microphone' : 'Couper le microphone'}
            className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            title={isMuted ? 'Démuter' : 'Muter'}
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5 text-white/60" />
            ) : (
              <Volume2 className="w-5 h-5 text-white/60" />
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={handleRequestSummary}
            aria-label="Résumer notre échange"
            title="Résumer notre échange"
            className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            {summaryPending ? (
              <Loader2 className="w-5 h-5 text-emerald-300 animate-spin" />
            ) : (
              <ScrollText className="w-5 h-5 text-white/70" />
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={stopAll}
            aria-label="Arrêter définitivement la session vocale"
            className="p-3 rounded-full bg-white/10 hover:bg-red-500/30 transition-colors"
            title="Arrêter"
          >
            <div className="w-5 h-5 rounded-sm bg-red-400" />
          </motion.button>
        </div>

        {/* Footer hint */}
        <p className="text-[11px] text-white/50 tracking-wider">
          {isSupported ? 'Cliquez sur l\'orbite pour parler · ESC pour fermer' : 'Navigateur non compatible'}
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
