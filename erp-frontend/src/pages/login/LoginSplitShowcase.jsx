import { motion } from 'framer-motion';
import {
  ShieldCheck, Zap, RefreshCw, CheckCircle2, Sparkles,
} from 'lucide-react';
import { FloatingPaths } from '@/components/floating-paths';
import { AuthThemeToggle, BrandLogo, LoginFormCard, RotatingWord, TrustBadge } from './LoginForm';

/* ── Panneau showcase (style Katalyst "split") : fond sombre + atouts + citation ── */
function ShowcasePanel() {
  return (
    <div className="relative flex h-full flex-col justify-between gap-10 overflow-hidden bg-zinc-950 p-8 sm:p-10 xl:p-14">
      {/* Ambiance */}
      <div className="absolute inset-0 bg-gradient-to-b from-blue-950/20 via-zinc-950 to-black/60" />
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute inset-0 opacity-40">
        <FloatingPaths position={1} />
        <FloatingPaths position={-1} />
      </div>

      {/* Marque */}
      <div className="relative z-10 flex items-center gap-3">
        <div className="p-2.5 rounded-2xl logo-gradient shadow-lg">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <span className="font-extrabold text-lg tracking-tight text-white block leading-tight">ERP ITSM</span>
          <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest block leading-tight">AI Hub Platform</span>
        </div>
      </div>

      {/* Titre rotatif + atouts */}
      <div className="relative z-10 max-w-md">
        <h2 className="text-3xl xl:text-4xl font-black tracking-tight text-white leading-tight">
          La gestion IT{' '}
          <RotatingWord
            className="text-blue-400"
            words={['augmentée par l’IA', 'en temps réel', 'sans friction']}
          />
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          Plateforme d'assistance unifiée : qualification Hotline différée, prédictions d'apprentissage IA et synchronisation GLPI en temps réel.
        </p>
        <ul className="mt-8 space-y-3">
          {[
            { icon: ShieldCheck, label: 'Validation Hotline avant création GLPI' },
            { icon: Zap, label: 'Brouillons IA & triage intelligent des emails' },
            { icon: RefreshCw, label: 'Synchro bi-directionnelle temps réel' },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.li
                key={item.label}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.3 + idx * 0.1 }}
                className="flex items-center gap-3 text-sm text-zinc-100"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
                  <Icon className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                {item.label}
              </motion.li>
            );
          })}
        </ul>

        {/* Citation + bandeau de confiance (style Katalyst) */}
        <motion.figure
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.55 }}
          className="mt-10 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-5 shadow-sm backdrop-blur-sm"
        >
          <blockquote className="text-sm leading-relaxed text-zinc-200">
            « Les tickets arrivent qualifiés dans GLPI sans qu'on touche à rien. La hotline valide, l'IA rédige, tout le monde gagne du temps. »
          </blockquote>
          <figcaption className="mt-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 font-bold text-xs">
              MK
            </div>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold text-white">Maya K.</span>
              <span className="truncate text-xs text-zinc-400">Responsable Hotline IT</span>
            </span>
          </figcaption>
        </motion.figure>
        <div className="mt-4">
          <TrustBadge light suffix="tickets traités" />
        </div>
      </div>

      <p className="relative z-10 text-xs text-zinc-500">
        © {new Date().getFullYear()} ERP ITSM — Tous droits réservés
      </p>
    </div>
  );
}

/* ── Variante 1 — Split showcase (proche du design actuel, structure Katalyst) ── */
export default function LoginSplitShowcase() {
  return (
    <main className="relative grid min-h-screen lg:grid-cols-[1fr_34rem] xl:grid-cols-[1fr_38rem] bg-surface antialiased selection:bg-primary/20 selection:text-primary">
      <AuthThemeToggle />

      {/* Panneau showcase (desktop uniquement) */}
      <div className="relative hidden lg:block">
        <ShowcasePanel />
      </div>

      {/* Colonne formulaire */}
      <div className="relative flex min-h-screen flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute bottom-1/4 left-1/4 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl" />
        </div>

        <div className="relative z-10 hidden lg:block mb-8">
          <BrandLogo />
        </div>

        <LoginFormCard
          title="Connexion"
          subtitle="Accédez à votre console de gestion ITSM & d'automatisation IA"
        />
      </div>
    </main>
  );
}
