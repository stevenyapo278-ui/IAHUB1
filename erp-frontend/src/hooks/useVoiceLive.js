import { useState, useRef, useEffect, useCallback } from 'react';

export function useVoiceLive() {
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(() => {
    try { return localStorage.getItem('voiceNoiseSuppression') !== 'false'; } catch { return true; }
  });

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const workletRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const nextStartRef = useRef(0);
  const activeSourcesRef = useRef([]);
  const speakingRef = useRef(false);
  const readyRef = useRef(false);
  const mutedRef = useRef(false);
  const noiseSuppressionRef = useRef(noiseSuppressionEnabled);

  useEffect(() => {
    setIsSupported(
      typeof WebSocket !== 'undefined' &&
        typeof AudioContext !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.getUserMedia !== undefined
    );
  }, []);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    noiseSuppressionRef.current = noiseSuppressionEnabled;
    // Informer le worklet du toggle
    if (workletRef.current) {
      try { workletRef.current.port.postMessage({ type: 'config', noiseGate: { enabled: noiseSuppressionEnabled } }); } catch {}
    }
    try { localStorage.setItem('voiceNoiseSuppression', String(noiseSuppressionEnabled)); } catch {}
  }, [noiseSuppressionEnabled]);

  // ── Gestion des messages (transcriptions fragmentées de Gemini) ──
  // Gemini envoie les transcriptions par fragments : le backend relaie la phrase
  // ACCUMULÉE du tour en cours (partial) puis la phrase complète (final). Côté front,
  // chaque rôle a UNE bulle "live" qui grossit, committée en message définitif au
  // final — au lieu d'une bulle par mot.

  const upsertLive = useCallback((role, text) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.role === role && m.live);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], text };
        return copy;
      }
      return [...prev, { id: `${role}-live`, role, text, live: true }];
    });
  }, []);

  const commitLive = useCallback((role, text) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.role === role && m.live);
      const entry = { id: `${Date.now()}-${role}`, role, text };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
  }, []);

  const handleTranscript = useCallback((msg) => {
    if (msg.partial) {
      upsertLive(msg.role, msg.text);
    } else if (msg.final) {
      commitLive(msg.role, msg.text);
    } else {
      // Compatibilité ancien format (fragment brut sans partial/final)
      upsertLive(msg.role, msg.text);
    }
    if (msg.role === 'user') {
      setTranscript(msg.text);
      if (!msg.final) setState('thinking');
    } else {
      setReply(msg.text);
      if (!speakingRef.current) setState('speaking');
    }
  }, [upsertLive, commitLive]);

  const playVoiceChunk = useCallback((buffer) => {
    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;

    const int16 = new Int16Array(buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    // Jitter buffer : petit délai pour lisser les arrivées réseau et éviter les clics
    const jitterDelay = 0.04;
    const startAt = Math.max(nextStartRef.current, now + jitterDelay);
    source.start(startAt);
    nextStartRef.current = startAt + audioBuffer.duration;

    speakingRef.current = true;
    activeSourcesRef.current.push(source);

    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
      if (activeSourcesRef.current.length === 0) {
        speakingRef.current = false;
        setState((prev) => (prev === 'speaking' ? 'listening' : prev));
      }
    };
  }, []);

  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch {}
    });
    activeSourcesRef.current = [];
    speakingRef.current = false;
    nextStartRef.current = 0;
  }, []);

  const cleanupSession = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    stopPlayback();
    if (workletRef.current) {
      try { workletRef.current.disconnect(); } catch {}
      workletRef.current = null;
    }
    analyserRef.current = null;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
  }, [stopPlayback]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const toggleNoiseSuppression = useCallback(() => {
    setNoiseSuppressionEnabled((prev) => !prev);
  }, []);

  const startListening = useCallback(() => {
    cleanupSession();
    setError(null);
    setTranscript('');
    setReply('');
    setMessages([]);
    readyRef.current = false;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    (async () => {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      await audioCtx.audioWorklet.addModule('/pcm-processor.js');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Contraintes avancées Chrome (WebRTC APM v2)
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googNoiseSuppression2: true,
          googAutoGainControl: true,
          googHighpassFilter: true,
        },
      });
      streamRef.current = stream;

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
      workletRef.current = workletNode;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      // JWT passé en query string : le backend authentifie la session vocale (filtrage par rôle
      // dans le pipeline chatbot, "mes tickets" = ceux de l'utilisateur connecté, comme au chat).
      const token = localStorage.getItem('token');
      const authQuery = token ? `?token=${encodeURIComponent(token)}` : '';
      const ws = new WebSocket(`${proto}://${location.hostname}:4001${authQuery}`);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setState('connecting');
        // Configurer le worklet selon le toggle
        try { workletNode.port.postMessage({ type: 'config', noiseGate: { enabled: noiseSuppressionRef.current } }); } catch {}
        workletNode.port.onmessage = (e) => {
          // Si muté, ne rien envoyer
          if (mutedRef.current) return;
          // Filtrage anti-bruit : si activé, n'envoie que les frames avec parole détectée
          const isNoiseOnly = noiseSuppressionRef.current && e.data.isSpeech === false && !e.data.gateOpen;
          // On laisse passer quand même ~10% des frames silencieuses pour le VAD Gemini (silence contextuel)
          const shouldDrop = isNoiseOnly && Math.random() > 0.1;
          if (readyRef.current && ws.readyState === WebSocket.OPEN && e.data.pcm && !shouldDrop) {
            // Si gate fermé et filtre actif, remplacer le PCM par du silence plutôt que de dropper
            if (isNoiseOnly) {
              const silent = new Int16Array(e.data.pcm.byteLength / 2);
              ws.send(silent.buffer);
            } else {
              ws.send(e.data.pcm);
            }
          }
          const effectiveRms = e.data.rms ?? e.data.rawRms ?? 0;
          // Barge-in : seuil relevé à 0.06 et vérification gate/speech pour éviter les faux positifs (respiration, bruit)
          const isRealSpeech = e.data.isSpeech !== false && e.data.gateOpen !== false;
          if (effectiveRms >= 0.06 && speakingRef.current && isRealSpeech) {
            stopPlayback();
          }
        };
      };

      ws.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          playVoiceChunk(evt.data);
          return;
        }

        let msg;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }

        if (msg.type === 'ready') {
          readyRef.current = true;
          setState('listening');
        } else if (msg.type === 'transcript') {
          handleTranscript(msg);
        } else if (msg.type === 'interrupted') {
          stopPlayback();
        } else if (msg.type === 'error') {
          setError(msg.message);
          setState('error');
        } else if (msg.type === 'session_closed') {
          setState('idle');
        }
      };

      ws.onclose = () => {
        setState('idle');
      };

      ws.onerror = () => {
        setError('Connexion WebSocket échouée');
        setState('error');
      };

      // Keep-alive : ping toutes les 25s pour éviter NAT timeout
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'ping' })); } catch {} }
      }, 25000);
      ws.addEventListener('close', () => clearInterval(pingInterval));

      source.connect(workletNode);
      workletNode.connect(analyser);
      // Ne pas connecter analyser -> destination (évite larsen/écho)
    })().catch((err) => {
      setError(err.message || 'Erreur lors du démarrage');
      setState('error');
    });
  }, [playVoiceChunk, stopPlayback, cleanupSession, handleTranscript]);

  const stopAll = useCallback(() => {
    cleanupSession();
    setState('idle');
  }, [cleanupSession]);

  useEffect(() => () => stopAll(), [stopAll]);

  return {
    state,
    transcript,
    reply,
    messages,
    error,
    isSupported,
    isMuted,
    noiseSuppressionEnabled,
    analyserNode: analyserRef.current,
    startListening,
    stopAll,
    toggleMute,
    toggleNoiseSuppression,
  };
}
