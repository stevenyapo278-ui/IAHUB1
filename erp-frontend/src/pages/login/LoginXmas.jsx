import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music2, VolumeX } from 'lucide-react';
import XmasScene from '../../components/XmasScene';
import { AuthThemeToggle, LoginFormCard } from './LoginForm';

/**
 * Variante « noel » de la page de connexion.
 *
 * Reprend la scène de `sapin-de-noel.html` (ciel étoilé, sapin procédural,
 * guirlandes, cadeaux, neige, étincelles au survol) comme décor, avec le
 * formulaire de connexion standard à droite. La berceuse générée en Web Audio
 * reste optionnelle : elle ne démarre qu'au clic sur « Musique » (politique
 * d'autoplay des navigateurs).
 */
export default function LoginXmas() {
  const sceneRef = useRef(null);
  const [musicOn, setMusicOn] = useState(false);
  const [musicUnavailable, setMusicUnavailable] = useState(false);

  const handleSceneReady = useCallback((api) => {
    sceneRef.current = api;
  }, []);

  function toggleMusic() {
    const api = sceneRef.current;
    if (!api) return;
    if (musicOn) {
      api.stopMusic();
      setMusicOn(false);
      return;
    }
    const ok = api.startMusic();
    if (!ok) {
      setMusicUnavailable(true);
      return;
    }
    setMusicOn(true);
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-surface antialiased lg:block lg:bg-[#04070f]">
      {/* Décor : bandeau en haut sur mobile, moitié gauche en desktop */}
      <div className="relative h-[40vh] min-h-[240px] shrink-0 lg:absolute lg:inset-y-0 lg:left-0 lg:right-1/2 lg:h-auto lg:min-h-0">
        <XmasScene className="h-full w-full" title onReady={handleSceneReady} />
        {/* Fondu vers la surface : la carte ne chevauche jamais la scène sur mobile */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-surface lg:hidden"
        />
      </div>

      <AuthThemeToggle />

      {/* Berceuse optionnelle : démarrage explicite au clic */}
      <button
        type="button"
        onClick={toggleMusic}
        aria-pressed={musicOn}
        title={musicUnavailable ? 'Audio indisponible sur cet appareil' : musicOn ? 'Couper la musique' : 'Jouer la musique de Noël'}
        className={`absolute left-4 top-4 z-30 inline-flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-bold shadow-md backdrop-blur-md transition-all ${
          musicOn
            ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
            : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
        }`}
      >
        {musicOn ? <VolumeX className="h-4 w-4" /> : <Music2 className="h-4 w-4" />}
        <span className="hidden sm:inline">{musicUnavailable ? 'Audio indisponible' : 'Musique'}</span>
      </button>

      {/* Panneau de connexion */}
      <div className="relative z-10 flex flex-1 items-center justify-center bg-surface px-5 py-10 lg:ml-auto lg:min-h-screen lg:w-1/2 lg:flex-none lg:border-l lg:border-white/5 lg:px-10 lg:py-14">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[420px]"
        >
          <LoginFormCard
            title="Joyeux Noël"
            subtitle="Connectez-vous pour retrouver vos tickets et votre assistant IA"
            footer={
              <p className="text-[11px] font-medium text-on-surface-variant">
                Toute l'équipe IT vous souhaite de belles fêtes ✦
              </p>
            }
          />

          <p className="mt-6 text-center text-[11px] text-on-surface-variant/80">
            © {new Date().getFullYear()} ERP ITSM — AI Hub Platform
          </p>
        </motion.div>
      </div>
    </main>
  );
}
