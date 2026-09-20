import { useRef, useEffect, useCallback } from 'react';

const BAR_COUNT = 32;
const MIN_BAR_HEIGHT = 2;

export default function VoiceVisualizer({ analyserNode, isActive, color = '#3b82f6', className = '' }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const barsRef = useRef(new Array(BAR_COUNT).fill(MIN_BAR_HEIGHT));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    let dataArray;
    if (analyserNode) {
      const bufferLength = analyserNode.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      analyserNode.getByteFrequencyData(dataArray);
    }

    const barWidth = (width / BAR_COUNT) * 0.7;
    const gap = (width / BAR_COUNT) * 0.3;
    const maxHeight = height * 0.9;

    for (let i = 0; i < BAR_COUNT; i++) {
      let targetHeight;
      if (dataArray) {
        const index = Math.floor((i / BAR_COUNT) * dataArray.length * 0.6);
        const value = dataArray[index] || 0;
        targetHeight = Math.max(MIN_BAR_HEIGHT, (value / 255) * maxHeight);
      } else if (isActive) {
        targetHeight = MIN_BAR_HEIGHT + Math.random() * maxHeight * 0.15;
      } else {
        targetHeight = MIN_BAR_HEIGHT;
      }

      barsRef.current[i] += (targetHeight - barsRef.current[i]) * 0.18;

      const x = i * (barWidth + gap) + gap / 2;
      const barH = barsRef.current[i];
      const y = (height - barH) / 2;

      const gradient = ctx.createLinearGradient(x, y, x, y + barH);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.5, color + 'cc');
      gradient.addColorStop(1, color + '44');

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, [analyserNode, isActive, color]);

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
