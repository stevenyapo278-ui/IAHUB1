import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../api/client';

/**
 * Hook assistant vocal complet.
 * Workflow : record → STT → chat → TTS → play
 *
 * States :
 *  - idle       : prêt
 *  - listening  : enregistrement en cours
 *  - transcribing: envoi audio → STT
 *  - thinking   : chatbot traite le message
 *  - speaking   : lecture de la réponse audio
 *  - error      : erreur
 */
export function useVoiceAssistant({ onMessage, voiceName = 'Kore' } = {}) {
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState(null);
  const [isSupported, setIsSupported] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const audioElementRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const speakReplyRef = useRef(null);

  onMessageRef.current = onMessage;

  useEffect(() => {
    setIsSupported(
      typeof window !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }, []);

  const stopAll = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  // ── Démarrer l'enregistrement ──────────────────────────────────────
  const startListening = useCallback(async () => {
    try {
      setError(null);
      setTranscript('');
      setReply('');

      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000,
        });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        processAudio(audioBlob, mimeType);
      };

      recorder.start(50);
      setState('listening');
    } catch (err) {
      console.error('[voice] startListening error:', err);
      setError('Impossible d\'accéder au micro. Vérifiez les permissions.');
      setState('error');
    }
  }, []);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setState('transcribing');
  }, []);

  // ── Pipeline audio ─────────────────────────────────────────────────
  async function processAudio(audioBlob, mimeType) {
    try {
      setState('transcribing');
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('mimeType', mimeType);

      const sttRes = await api.post('/voice/stt', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 15000,
      });

      const text = sttRes.data.text?.trim();
      if (!text) {
        setError('Aucun texte détecté. Parlez plus fort.');
        setState('idle');
        return;
      }
      setTranscript(text);

      setState('thinking');
      const onMsg = onMessageRef.current;
      if (!onMsg) {
        setState('idle');
        return;
      }

      const replyText = await onMsg(text);
      if (!replyText || typeof replyText !== 'string') {
        setState('idle');
        return;
      }

      setReply(replyText);
      setState('speaking');

      // TTS lancé en arrière-plan — ne bloque plus le pipeline
      speakReplyRef.current?.(replyText).catch((err) => {
        console.error('[voice] speakReply error:', err);
        setError('Erreur synthèse vocale');
        setState('error');
      });
    } catch (err) {
      console.error('[voice] processAudio error:', err);
      const msg = err.response?.data?.error || err.message || 'Erreur inconnue';
      setError(`Erreur : ${msg}`);
      setState('error');
    }
  }

  // ── TTS ────────────────────────────────────────────────────────────
  const speakReply = useCallback(async (text) => {
    if (!text) return;

    try {
      const ttsRes = await api.post('/voice/tts', {
        text: text.substring(0, 3000),
        voiceName,
      }, { timeout: 30000 });

      const { audio: audioBase64, sampleRate = 24000 } = ttsRes.data;

      const pcmBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
      const int16 = new Int16Array(pcmBytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const wavBlob = pcmToWav(float32, sampleRate);
      const audioUrl = URL.createObjectURL(wavBlob);

      return new Promise((resolve) => {
        const audio = new Audio(audioUrl);
        audioElementRef.current = audio;

        const cleanup = () => {
          URL.revokeObjectURL(audioUrl);
          audioElementRef.current = null;
        };

        audio.onended = () => {
          cleanup();
          setState('idle');
          resolve();
        };

        audio.onerror = () => {
          cleanup();
          setError('Erreur lecture audio');
          setState('error');
          resolve();
        };

        audio.play().catch(err => {
          console.error('[voice] play error:', err);
          cleanup();
          setError('Autoplay bloqué. Cliquez sur la page puis réessayez.');
          setState('error');
          resolve();
        });
      });
    } catch (err) {
      console.error('[voice] speakReply error:', err);
      setError('Erreur synthèse vocale');
      setState('error');
    }
  }, [voiceName]);

  speakReplyRef.current = speakReply;

  const toggle = useCallback(() => {
    if (state === 'listening') {
      stopListening();
    } else if (state === 'idle' || state === 'error') {
      startListening();
    }
  }, [state, startListening, stopListening]);

  return {
    state,
    transcript,
    reply,
    error,
    isSupported,
    analyser: analyserRef.current,
    startListening,
    stopListening,
    speakReply,
    setReply,
    toggle,
    stopAll,
  };
}

// ── Utilitaire WAV ───────────────────────────────────────────────────
function pcmToWav(float32Array, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = float32Array.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
