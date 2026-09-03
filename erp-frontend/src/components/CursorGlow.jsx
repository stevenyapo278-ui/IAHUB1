import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';

const SPRING_CONFIG = { stiffness: 120, damping: 20 };

export default function CursorGlow() {
  const { layoutSettings } = useTheme();
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);
  const springX = useSpring(cursorX, SPRING_CONFIG);
  const springY = useSpring(cursorY, SPRING_CONFIG);
  const glowRef = useRef(null);

  useEffect(() => {
    if (!layoutSettings.cursorGlow) return;

    function handleMove(e) {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
    }

    window.addEventListener('mousemove', handleMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMove);
  }, [layoutSettings.cursorGlow, cursorX, cursorY]);

  if (!layoutSettings.cursorGlow) return null;

  return (
    <motion.div
      ref={glowRef}
      className="fixed pointer-events-none z-[9999]"
      style={{
        x: springX,
        y: springY,
        translateX: '-50%',
        translateY: '-50%',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, var(--skin-primary) 0%, transparent 70%)',
        opacity: 0.06,
        filter: 'blur(40px)',
      }}
    />
  );
}
