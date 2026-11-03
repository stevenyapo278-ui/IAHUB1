import { useEffect, useRef, useMemo } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';

const SPRING_CONFIG = { stiffness: 120, damping: 20 };

export default function CursorGlow() {
  const { layoutSettings, theme } = useTheme();

  // Couleur de la lueur : selon le skin actif (ou une valeur par défaut).
  // On lit les variables CSS directement pour s'adapter au skin choisi.
  const glowColor = useMemo(() => {
    if (typeof window === 'undefined') return '#0067ff';
    const root = document.documentElement;
    const skin = root.getAttribute('data-skin') || 'default';
    const vars = {
      default: '#0067ff',
      bento: '#ff5a1f',
      aqua: '#1597a5',
      lime: '#9ccc1f',
      lilac: '#6d5ba6',
      prism: '#6d28d9',
      midnight: '#4f5bd5',
      ocean: '#0a84ff',
      graphite: '#2b2b30',
      emerald: '#059669',
      amber: '#f59e0b',
      coral: '#ff6b5e',
      console: '#15803d',
    };
    const base = vars[skin] || '#0067ff';
    // Pour le thème clair/sombre, on choisit la couleur la plus lumineuse
    if (theme === 'dark') {
      return base;
    }
    return base;
  }, [theme]);

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
        background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
        opacity: 0.10,
        filter: 'blur(40px)',
      }}
    />
  );
}
