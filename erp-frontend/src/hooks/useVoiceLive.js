import { useState, useRef, useEffect, useCallback } from 'react';

export function useVoiceLive() {
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const workletRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const nextStartRef = useRef(0);
  const activeSourcesRef = useRef([]);
  const speakingRef = useRef(false);
  const readyRef = useRef(false);
  const replyTextRef = useRef('');
  const mutedRef = useRef(false);

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
    const startAt = Math.max(nextStartRef.current, now);
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

  const startListening = useCallback(() => {
    cleanupSession();
    setError(null);
    setTranscript('');
    setReply('');
    replyTextRef.current = '';
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
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
        workletNode.port.onmessage = (e) => {
          if (readyRef.current && ws.readyState === WebSocket.OPEN && e.data.pcm) {
            ws.send(e.data.pcm);
          }
          if (e.data.rms >= 0.02 && speakingRef.current) {
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
          if (msg.role === 'user') {
            setTranscript(msg.text);
            setState('thinking');
          } else if (msg.role === 'assistant') {
            replyTextRef.current += msg.text;
            setReply(replyTextRef.current);
            if (!speakingRef.current) setState('speaking');
          }
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

      source.connect(workletNode);
      workletNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    })().catch((err) => {
      setError(err.message || 'Erreur lors du démarrage');
      setState('error');
    });
  }, [playVoiceChunk, stopPlayback, cleanupSession]);

  const stopAll = useCallback(() => {
    cleanupSession();
    setState('idle');
  }, [cleanupSession]);

  useEffect(() => () => stopAll(), [stopAll]);

  return {
    state,
    transcript,
    reply,
    error,
    isSupported,
    isMuted,
    analyserNode: analyserRef.current,
    startListening,
    stopAll,
    toggleMute,
  };
}
