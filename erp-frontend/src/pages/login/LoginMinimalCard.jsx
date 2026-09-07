import { motion } from 'framer-motion';
import { AuthThemeToggle, BrandLogo, LoginFormCard } from './LoginForm';

/* ── Variante 3 — Minimaliste centrée (style Katalyst "card" : anneaux concentriques) ── */
export default function LoginMinimalCard() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-5 py-20 antialiased selection:bg-primary/20 selection:text-primary">
      {/* Anneaux concentriques décoratifs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[42vmin] w-[42vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/10" />
        <div className="absolute left-1/2 top-1/2 h-[66vmin] w-[66vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/[0.06]" />
        <div className="absolute left-1/2 top-1/2 h-[92vmin] w-[92vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/[0.04]" />
      </div>

      {/* Marque en haut à gauche */}
      <div className="absolute left-5 top-5 z-20 sm:left-6 sm:top-6">
        <BrandLogo />
      </div>

      <AuthThemeToggle />

      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex w-full justify-center"
      >
        <LoginFormCard
          title="Espace connexion"
          subtitle="Un seul accès pour vos tickets, votre inventaire et votre assistant IA"
          footer={
            <p className="text-[11px] text-on-surface-variant/80 font-medium">
              Plateforme sécurisée — connexions journalisées et surveillées
            </p>
          }
        />
      </motion.div>
    </main>
  );
}
