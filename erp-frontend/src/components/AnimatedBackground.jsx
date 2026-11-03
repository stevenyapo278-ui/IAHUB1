import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import ChristmasEffects from './ChristmasEffects';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

/** Lit les prefs Noël depuis le localStorage */
function readXmasPrefs() {
  if (typeof window === 'undefined') return { active: false, color: '#0067ff', speed: 1 };
  try {
    const raw = localStorage.getItem('xmas_prefs_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        active: parsed.active ?? false,
        color: parsed.color ?? '#0067ff',
        speed: parsed.speed ?? 1,
      };
    }
  } catch { /* ignore */ }
  return { active: false, color: '#0067ff', speed: 1 };
}

export default function AnimatedBackground() {
  const [xmasPrefs, setXmasPrefs] = useState(readXmasPrefs);
  // null = pas encore chargé, false = admin n'a pas forcé, true = admin force
  const [adminForced, setAdminForced] = useState(null);

  // Charge le réglage admin au montage (endpoint public, sans token)
  useEffect(() => {
    fetch(`${API_BASE}/system-settings/public`)
      .then((r) => r.json())
      .then((data) => setAdminForced(!!data.xmasForceEnabled))
      .catch(() => setAdminForced(false));
  }, []);

  // Réagit aux changements du toggle personnel (même onglet ou autre onglet)
  useEffect(() => {
    const onStorage = () => setXmasPrefs(readXmasPrefs());
    window.addEventListener('storage', onStorage);
    window.addEventListener('xmas-prefs-changed', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('xmas-prefs-changed', onStorage);
    };
  }, []);

  // L'admin force = tout le monde voit les animations, peu importe la préférence perso
  const isActive = adminForced === true || xmasPrefs.active;

  return (
    <>
      {/* ── Effets Noël ─────────────────────────────────────────────────────────
          Rendu EN DEHORS du wrapper -z-10 pour être visible par-dessus le fond
          de page. z-index 1 = au-dessus du contenu, bien en dessous des modales
          (z-index 50+) et du header (z-30). pointer-events-none = non-cliquable.  */}
      {isActive && (
        <div
          className="pointer-events-none fixed inset-0 overflow-hidden"
          style={{ zIndex: 1 }}
        >
          <ChristmasEffects color={xmasPrefs.color} speed={xmasPrefs.speed} />
        </div>
      )}

      {/* ── Fond animé (dégradés subtils) — reste en arrière-plan ── */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <motion.div
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
          className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, var(--color-primary) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <motion.div
          animate={{ x: [0, -50, 0], y: [0, 40, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
          className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, var(--color-secondary) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>
    </>
  );
}


