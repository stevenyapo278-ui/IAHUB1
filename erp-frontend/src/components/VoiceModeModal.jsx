import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mic, MicOff, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { useVoiceLive } from '../hooks/useVoiceLive';
import VoiceVisualizer from './VoiceVisualizer';

const STATE_CONFIG = {
  idle: { label: 'En attente', color: '#64748b' },
  connecting: { label: 'Connexion…', color: '#eab308' },
  listening: { label: 'Écoute…', color: '#3b82f6' },
  thinking: { label: 'Réflexion…', color: '#a855f7' },
  speaking: { label: 'Parle…', color: '#22c55e' },
  error: { label: 'Erreur', color: '#ef4444' },
};

export default function VoiceModeModal({ isOpen, onClose }) {
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);
  const lastTranscriptRef = useRef('');
  const lastReplyRef = useRef('');

  const {
    state,
    transcript,
    reply,
    error,
    isSupported,
    isMuted,
    analyserNode,
    startListening,
    stopAll,
    toggleMute,
  } = useVoiceLive();

  const isActive = ['listening', 'speaking', 'thinking'].includes(state);
  const config = STATE_CONFIG[state] || STATE_CONFIG.idle;

  const handleClose = useCallback(() => {
    stopAll();
    setMessages([]);
    onClose();
  }, [stopAll, onClose]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Track transcript → add user message
  useEffect(() => {
    if (transcript && transcript !== lastTranscriptRef.current) {
      lastTranscriptRef.current = transcript;
      setMessages((prev) => [...prev, { id: Date.now(), role: 'user', text: transcript }]);
    }
  }, [transcript]);

  // Track reply → update last assistant message or add new one
  useEffect(() => {
    if (reply && reply !== lastReplyRef.current) {
      lastReplyRef.current = reply;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, text: reply }];
        }
        return [...prev, { id: Date.now(), role: 'assistant', text: reply }];
      });
    }
  }, [reply]);

  // Reset lastReplyRef when new user transcript arrives
  useEffect(() => {
    if (transcript && transcript !== lastTranscriptRef.current) {
      lastReplyRef.current = '';
    }
  }, [transcript]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => e.key === 'Escape' && handleClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleClose]);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      stopAll();
      setMessages([]);
    }
  }, [isOpen, stopAll]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(40px)' }}
      >
        {/* Ambient glow */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          animate={{
            opacity: isActive ? [0.15, 0.25, 0.15] : 0.08,
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: `radial-gradient(circle at 50% 40%, ${config.color}44 0%, transparent 70%)`,
          }}
        />

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        >
          <X className="w-5 h-5 text-white/70" />
        </button>

        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl font-light tracking-[0.3em] text-white/90">MARIE</h1>
          <p className="text-xs text-white/40 mt-1 tracking-widest uppercase">Assistant vocal</p>
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
                isActive
                  ? { scale: [1, 1.6], opacity: [0.4, 0] }
                  : { scale: 1, opacity: 0 }
              }
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: i * 0.6,
                ease: 'easeOut',
              }}
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
            <VoiceVisualizer analyserNode={analyserNode} color={config.color} isActive={isActive} />
          </div>

          {/* Core orb */}
          <motion.button
            onClick={isActive ? stopAll : startListening}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
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
          <motion.div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: config.color }}
            animate={isActive ? { opacity: [1, 0.3, 1] } : { opacity: 0.6 }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <span className="text-xs text-white/60 tracking-widest uppercase">{config.label}</span>
        </div>

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

        {/* Messages area */}
        <div className="w-full max-w-md mx-4 flex-1 overflow-y-auto px-4 space-y-3 mb-4 max-h-[240px] scrollbar-thin scrollbar-thumb-white/10">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-purple-500/30 flex items-center justify-center text-[10px] text-white/70 font-medium shrink-0">
                    M
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-500/20 text-blue-100 rounded-br-md'
                      : 'bg-white/5 text-white/70 rounded-bl-md'
                  }`}
                >
                  {msg.text}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-blue-500/30 flex items-center justify-center text-[10px] text-white/70 font-medium shrink-0">
                    Vous
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-4 mb-6">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={toggleMute}
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
            onClick={stopAll}
            className="p-3 rounded-full bg-white/10 hover:bg-red-500/30 transition-colors"
            title="Arrêter"
          >
            <div className="w-5 h-5 rounded-sm bg-red-400" />
          </motion.button>
        </div>

        {/* Footer hint */}
        <p className="text-[11px] text-white/25 tracking-wider">
          {isSupported ? 'Cliquez sur l\'orbite pour parler · ESC pour fermer' : 'Navigateur non compatible'}
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
