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
  const [isBrainstormMode, setIsBrainstormMode] = useState(false);

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
  // ── Nouvelles références ──
  // pauseAudioRef : quand Marie parle, on suspend l'envoi PCM pour éviter que
  // sa propre voix soit retranscrite comme parole utilisateur (faux barge-in).
  // Note: l'écho-cancellation matérielle gère l'écho physique ; ce flag gère le
  // cas où le signal de référence AEC n'est pas partagé avec Gemini.
  const pauseAudioRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const stoppedRef = useRef(false); // true si l'utilisateur a manuellement arrêté
  const startingRef = useRef(false); // Verrou anti-double-clic d'initialisation asynchrone
  const assistantTurnFinishedRef = useRef(true); // Verrou de tour de parole de l'assistante (half-duplex)

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

  const playEarcon = useCallback((type = 'listen') => {
    try {
      const audioCtx = audioCtxRef.current;
      if (!audioCtx || audioCtx.state !== 'running') return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'listen' ? 587.33 : 880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch {}
  }, []);

  const handleTranscript = useCallback((msg) => {
    if (msg.partial) {
      upsertLive(msg.role, msg.text);
    } else if (msg.final) {
      commitLive(msg.role, msg.text);
    } else {
      upsertLive(msg.role, msg.text);
    }
    if (msg.role === 'user') {
      setTranscript(msg.text);
      if (!msg.final) {
        setState('thinking');
        assistantTurnFinishedRef.current = false; // L'utilisateur parle : l'assistante va démarrer son tour
        pauseAudioRef.current = true; // Verrouiller le micro
      }
      if (msg.final) playEarcon('listen');
    } else {
      setReply(msg.text);
      if (!speakingRef.current) setState('speaking');
      if (msg.final) {
        assistantTurnFinishedRef.current = true; // L'assistante a fini de générer côté serveur
        // Ne réouvrir le micro que si tout l'audio a fini d'être joué côté client
        if (activeSourcesRef.current.length === 0) {
          pauseAudioRef.current = false; // Réouvrir le micro
          setState((prev) => (prev === 'speaking' ? 'listening' : prev));
        }
      }
    }
  }, [upsertLive, commitLive, playEarcon]);

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
    if (analyserRef.current) {
      source.connect(analyserRef.current);
    }

    const now = audioCtx.currentTime;
    // Jitter buffer 10ms, séquentiel strict — pas de chevauchement
    // L'ancien plafonnement `if (startAt-now>0.35) startAt=now` causait deux voix superposées
    // (même phrase jouée en même temps, décalée de ~0.35s)
    const jitterDelay = 0.01;
    const startAt = Math.max(nextStartRef.current, now + jitterDelay);
    // Si dérive > 0.8s (réseau très lent), on log mais on garde la séquence pour éviter le chevauchement
    if (startAt - now > 0.8) {
      console.warn(`[voice] Drift ${((startAt-now)*1000).toFixed(0)}ms — maintien séquentiel`);
    }
    source.start(startAt);
    nextStartRef.current = startAt + audioBuffer.duration;

    speakingRef.current = true;
    pauseAudioRef.current = true; // Marie parle : suspendre l'envoi PCM
    activeSourcesRef.current.push(source);

    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
      if (activeSourcesRef.current.length === 0) {
        speakingRef.current = false;
        nextStartRef.current = 0;
        // Re-ouvrir le micro uniquement si l'assistante a fini de générer et que tout l'audio a été joué !
        if (assistantTurnFinishedRef.current) {
          pauseAudioRef.current = false; // Marie a fini : reprendre l'envoi PCM
          setState((prev) => (prev === 'speaking' ? 'listening' : prev));
        }
      }
    };
  }, []);

  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch {}
    });
    activeSourcesRef.current = [];
    speakingRef.current = false;
    assistantTurnFinishedRef.current = true; // Libérer le verrou de parole de l'assistante
    pauseAudioRef.current = false;
    nextStartRef.current = 0;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'bargeIn' })); } catch {}
    }
  }, []);

  const cleanupSession = useCallback(() => {
    startingRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
      // Annuler les handlers pour éviter une cascade de reconnexions concomitantes
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
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
    if (startingRef.current || wsRef.current) return;
    stoppedRef.current = false; // Nouvelle session : autoriser la reconnexion auto
    cleanupSession();
    startingRef.current = true; // Activer le verrou d'initialisation
    setError(null);
    setTranscript('');
    setReply('');
    setMessages([]);
    readyRef.current = false;
    assistantTurnFinishedRef.current = true; // Réinitialiser le verrou de parole de l'assistante

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
        startingRef.current = false; // Connexion réussie : libérer le verrou
        reconnectCountRef.current = 0; // Reset compteur à chaque connexion réussie
        setState('connecting');
        // Configurer le worklet selon le toggle
        try { workletNode.port.postMessage({ type: 'config', noiseGate: { enabled: noiseSuppressionRef.current } }); } catch {}
        workletNode.port.onmessage = (e) => {
          // Ne pas envoyer de PCM si : muet, pas prêt, WS fermé, ou Marie est en train de parler
          if (mutedRef.current || pauseAudioRef.current) return;
          if (readyRef.current && ws.readyState === WebSocket.OPEN && e.data.pcm) {
            ws.send(e.data.pcm);
          }
          const effectiveRms = e.data.rawRms ?? e.data.rms ?? 0;
          // Seuil d'interruption ultra-sensible (0.025) : stoppe l'audio dès les premières syllabes
          if (effectiveRms >= 0.025 && speakingRef.current) {
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
        } else if (msg.type === 'brainstorm_mode') {
          setIsBrainstormMode(!!msg.active);
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
        // Reconnexion automatique (max 3 tentatives, backoff exponentiel)
        // Ne pas reconnecte si l'utilisateur a manuellement arrêté
        if (!stoppedRef.current && reconnectCountRef.current < 3) {
          const delay = Math.pow(2, reconnectCountRef.current) * 1000; // 1s, 2s, 4s
          reconnectCountRef.current++;
          setState('reconnecting');
          reconnectTimerRef.current = setTimeout(() => {
            if (!stoppedRef.current) {
              // Relancer uniquement la connexion WS (le stream micro est conservé)
              startListening();
            }
          }, delay);
        } else {
          setState('idle');
        }
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
      source.connect(analyser); // Direct mic source to analyser for user voice visualization!
      // Ne pas connecter analyser -> destination (évite larsen/écho)
    })().catch((err) => {
      startingRef.current = false; // Erreur : libérer le verrou
      setError(err.message || 'Erreur lors du démarrage');
      setState('error');
    });
  }, [playVoiceChunk, stopPlayback, cleanupSession, handleTranscript]);

  const stopAll = useCallback(() => {
    stoppedRef.current = true; // Arrêt volontaire : bloquer la reconnexion auto
    reconnectCountRef.current = 0;
    cleanupSession();
    setIsBrainstormMode(false); // Reset mode brainstorming !
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
    isBrainstormMode, // Return brainstorming mode state !
  };
}
