import { useRef, useEffect, useCallback } from 'react';

export default function VoiceVisualizer({ analyserNode, isActive, state = 'idle', color = '#3b82f6', className = '' }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const timeRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(cx, cy) * 0.75;

    // Récupérer le niveau audio en temps réel
    let audioLevel = 0;
    if (analyserNode) {
      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserNode.getByteFrequencyData(dataArray);

      // Moyenne des fréquences pour calculer l'amplitude d'agitation
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      audioLevel = sum / bufferLength / 255; // Normalisé de 0 à 1
    } else if (isActive) {
      // Simulation douce si actif sans micro
      audioLevel = 0.05 + Math.sin(timeRef.current * 0.05) * 0.03;
    }

    // Incrémenter le temps selon l'état pour faire pulser/tourner plus ou moins vite
    let timeSpeed = 0.04;
    if (state === 'thinking') timeSpeed = 0.09;      // Tourbillonne vite en réflexion
    else if (state === 'speaking') timeSpeed = 0.06;  // Vif et dansant en parole
    else if (state === 'listening') timeSpeed = 0.05; // Réactif et ondulant en écoute

    timeRef.current += timeSpeed + audioLevel * 0.15; // Agitation supplémentaire basée sur le son

    // Définir les palettes de couleurs par couches selon l'état
    let layers = [];
    if (state === 'thinking') {
      layers = [
        { color: 'rgba(244, 114, 182, 0.4)', scale: 1.0, speedMult: 1.0, waveCount: 5, waveAmp: 25 }, // Rose
        { color: 'rgba(167, 139, 250, 0.35)', scale: 0.9, speedMult: -1.2, waveCount: 4, waveAmp: 20 }, // Violet
        { color: 'rgba(236, 72, 153, 0.25)', scale: 0.8, speedMult: 1.5, waveCount: 6, waveAmp: 15 }, // Magenta
      ];
    } else if (state === 'error') {
      layers = [
        { color: 'rgba(248, 113, 113, 0.45)', scale: 1.0, speedMult: 0.3, waveCount: 3, waveAmp: 8 },  // Rouge
        { color: 'rgba(239, 68, 68, 0.3)', scale: 0.95, speedMult: -0.5, waveCount: 4, waveAmp: 6 },
      ];
    } else if (state === 'listening' || state === 'speaking') {
      // Mode actif de dialogue : Orbe bleu/violet et cyan
      layers = [
        { color: 'rgba(96, 165, 250, 0.4)', scale: 1.0, speedMult: 1.0, waveCount: 4, waveAmp: 18 + audioLevel * 70 },  // Bleu ciel
        { color: 'rgba(167, 139, 250, 0.35)', scale: 0.88, speedMult: -0.8, waveCount: 5, waveAmp: 14 + audioLevel * 55 }, // Violet
        { color: 'rgba(34, 211, 238, 0.25)', scale: 0.78, speedMult: 1.3, waveCount: 3, waveAmp: 10 + audioLevel * 45 },  // Cyan
      ];
    } else {
      // Mode tranquille (idle, connecting)
      layers = [
        { color: 'rgba(96, 165, 250, 0.35)', scale: 0.9, speedMult: 0.5, waveCount: 3, waveAmp: 10 },
        { color: 'rgba(167, 139, 250, 0.25)', scale: 0.82, speedMult: -0.6, waveCount: 4, waveAmp: 8 },
      ];
    }

    // Dessiner chaque couche de fluide de l'orbe
    layers.forEach((layer) => {
      ctx.beginPath();

      const baseRadius = maxRadius * layer.scale;
      const t = timeRef.current * layer.speedMult;

      for (let angle = 0; angle <= Math.PI * 2; angle += 0.05) {
        // Formule organique pour générer des oscillations sinusoïdales lissées autour d'un cercle
        const offset = Math.sin(angle * layer.waveCount + t) * layer.waveAmp
                     + Math.cos(angle * (layer.waveCount - 1) - t * 0.7) * (layer.waveAmp * 0.4);

        const r = baseRadius + offset;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);

        if (angle === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.closePath();
      ctx.fillStyle = layer.color;
      ctx.fill();
    });

    // Ajouter un petit cœur lumineux central pour donner de la profondeur 3D
    const glowGradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, maxRadius * 0.5);
    let glowColor = 'rgba(255, 255, 255, 0.8)';
    if (state === 'thinking') glowColor = 'rgba(255, 200, 240, 0.9)';
    else if (state === 'error') glowColor = 'rgba(255, 180, 180, 0.8)';

    glowGradient.addColorStop(0, glowColor);
    glowGradient.addColorStop(0.3, color + '55');
    glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, maxRadius * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = glowGradient;
    ctx.fill();

    animFrameRef.current = requestAnimationFrame(draw);
  }, [analyserNode, isActive, state, color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    });
    resizeObserver.observe(canvas);

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      resizeObserver.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
