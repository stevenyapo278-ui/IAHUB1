import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { LoginFormCard } from './LoginForm';
import LinkedParticlesBackground from './LinkedParticlesBackground';

/* ── Variante 4 — Particules liées (WebGPU) : scène 3D plein écran + carte ── */
export default function LoginParticles() {
  // Variante exclusivement sombre : pas de bascule de thème, la classe .dark (portée par
  // <html>, cf. ThemeContext) est forcée pendant le séjour sur cette page puis restaurée.
  useEffect(() => {
    const el = document.documentElement;
    const wasDark = el.classList.contains('dark');
    el.classList.add('dark');
    return () => {
      if (!wasDark) el.classList.remove('dark');
    };
  }, []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07090d] px-5 py-20 antialiased selection:bg-primary/20 selection:text-primary">
      {/* Scène WebGPU (repli CSS animé hors WebGPU / mouvement réduit) */}
      <LinkedParticlesBackground />

      {/* Vignette : lisibilité de la carte sur les bords */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(4,6,10,0.8)_100%)]"
      />

      {/* Marque */}
      <div className="absolute left-5 top-5 z-20 sm:left-6 sm:top-6">
        <div className="inline-flex items-center gap-3 text-white">
          <div className="p-2.5 rounded-2xl logo-gradient shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-lg tracking-tight text-white block leading-tight">ERP ITSM</span>
            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest block leading-tight">
              AI Hub Platform
            </span>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex w-full justify-center"
      >
        <LoginFormCard
          title="Espace connexion"
          subtitle="Un seul accès pour vos tickets, votre inventaire et votre assistant IA"
          footer={
            <p className="text-[11px] text-white/45 font-medium">
              Plateforme sécurisée — connexions journalisées et surveillées
            </p>
          }
        />
      </motion.div>

      <p className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-[10px] font-medium tracking-wide text-white/30">
        Particules liées en temps réel — WebGPU
      </p>
    </main>
  );
}
