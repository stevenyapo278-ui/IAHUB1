import { useEffect, useRef, useState } from 'react';

export default function VoiceVisualizer({ isActive, className = '' }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const [bars, setBars] = useState(new Array(20).fill(0));

  useEffect(() => {
    if (!isActive) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      setBars(new Array(20).fill(0));
      return;
    }

    let cancelled = false;

    async function startVisualization() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function animate() {
          if (cancelled) return;
          analyser.getByteFrequencyData(dataArray);

          // Take 20 bars from the frequency data
          const step = Math.floor(dataArray.length / 20);
          const newBars = [];
          for (let i = 0; i < 20; i++) {
            const val = dataArray[i * step] || 0;
            newBars.push(val / 255); // Normalize 0-1
          }
          setBars(newBars);

          animFrameRef.current = requestAnimationFrame(animate);
        }

        animate();
      } catch (err) {
        console.warn('VoiceVisualizer: microphone access denied', err);
      }
    }

    startVisualization();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [isActive]);

  return (
    <div className={`flex items-center justify-center gap-[3px] h-8 ${className}`}>
      {bars.map((height, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-primary transition-all duration-75"
          style={{
            height: `${Math.max(4, height * 32)}px`,
            opacity: 0.4 + height * 0.6,
          }}
        />
      ))}
    </div>
  );
}
