import { motion } from 'framer-motion';

export default function GaugeWidget({ value = 0, label, config }) {
  const strokeWidth = config?.strokeWidth || 10;
  const viewBoxSize = 120;
  const radius = (viewBoxSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));

  let color = '#10b981';
  if (clamped < 50) color = '#ef4444';
  else if (clamped < 75) color = '#f59e0b';

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`} className="w-full h-full max-w-[140px] max-h-[140px] -rotate-90">
        <circle
          cx={viewBoxSize / 2} cy={viewBoxSize / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          className="stroke-surface-container"
        />
        <motion.circle
          cx={viewBoxSize / 2} cy={viewBoxSize / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          stroke={color} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-on-surface">{Math.round(clamped)}%</span>
        {label && <span className="text-[10px] font-semibold text-on-surface-variant">{label}</span>}
      </div>
    </div>
  );
}
