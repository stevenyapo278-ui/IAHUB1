import { motion } from 'framer-motion';
import { CheckCircle2, ShieldCheck, Zap, RefreshCw } from 'lucide-react';
import { AuthThemeToggle, LoginFormCard, RotatingWord, TrustBadge } from './LoginForm';

/* ── Volet gauche de la carte hero : dégradé brand + atouts (style Katalyst hero) ── */
function HeroPanel() {
  return (
    <div className="relative flex flex-col justify-between gap-10 overflow-hidden rounded-t-3xl bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-white lg:rounded-l-3xl lg:rounded-tr-none sm:p-10">
      {/* Blobs lumineux */}
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />

      <div className="relative z-10">
        <h2 className="text-3xl font-black leading-tight tracking-tight xl:text-4xl">
          Votre support IT,{' '}
          <RotatingWord words={['sans friction', 'piloté par l’IA', 'toujours disponible']} />
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-white/80">
          Une plateforme unique pour les demandeurs, la hotline et les techniciens — avec l'IA au cœur du cycle de vie des tickets.
        </p>
      </div>

      <ul className="relative z-10 space-y-3">
        {[
          { icon: ShieldCheck, label: 'Approbation Hotline centralisée' },
          { icon: Zap, label: 'Réponses IA suggérées en un clic' },
          { icon: RefreshCw, label: 'Traçabilité & suivis en temps réel' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex items-center gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Icon className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              {item.label}
            </li>
          );
        })}
      </ul>

      <div className="relative z-10 flex items-center gap-2 text-sm text-white/80">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <TrustBadge light suffix="tickets résolus" />
      </div>
    </div>
  );
}

/* ── Variante 2 — Carte hero flottante à deux volets (style Katalyst "hero") ── */
export default function LoginHeroGradient() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-muted/30 px-5 pb-10 pt-16 sm:pt-20 antialiased selection:bg-primary/20 selection:text-primary">
      {/* Halo lumineux d'ambiance */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-blue-500/10 to-transparent blur-3xl"
      />

      <AuthThemeToggle />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-4xl"
      >
        <div className="grid overflow-hidden rounded-3xl border border-outline-variant/40 bg-surface shadow-2xl lg:grid-cols-2">
          <HeroPanel />
          <div className="flex items-center justify-center p-6 sm:p-10">
            <LoginFormCard
              title="Bon retour"
              subtitle="Connectez-vous pour retrouver vos tickets et votre assistant IA"
            />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-on-surface-variant">
          © {new Date().getFullYear()} ERP ITSM — AI Hub Platform
        </p>
      </motion.div>
    </main>
  );
}
