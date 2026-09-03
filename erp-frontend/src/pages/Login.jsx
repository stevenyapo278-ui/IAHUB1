import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { FloatingPaths } from '@/components/floating-paths';
import AnimatedBackground from '@/components/AnimatedBackground';
import {
  ShieldCheck, Zap, RefreshCw, Sun, Moon, ArrowRight,
  Lock, Mail, Eye, EyeOff, CheckCircle2, AlertTriangle, Sparkles
} from 'lucide-react';

/* ── Variants d'animation ──────────────────────────────────────────────────── */
const containerVariants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

const itemVariants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

const cardVariants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, getLastLocation } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = await login(email.trim(), password);
      const redirectParam = searchParams.get('redirect');
      const lastFromStorage = getLastLocation();
      const target =
        (redirectParam && decodeURIComponent(redirectParam)) ||
        lastFromStorage ||
        '/';
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Identifiant ou mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2 bg-surface antialiased selection:bg-primary/20 selection:text-primary">
      <AnimatedBackground />

      {/* Bouton de bascule de Thème (Fixe en haut à droite) */}
      <div className="absolute top-4 right-4 z-50">
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          className="theme-toggle-btn p-2.5 rounded-2xl bg-surface-container-lowest/90 border border-outline-variant/40 text-on-surface shadow-md backdrop-blur-md hover:bg-surface-container transition-all flex items-center gap-2 text-xs font-bold"
        >
          <span className="relative w-4 h-4 shrink-0" aria-hidden="true">
            <span className={`theme-toggle-icon ${theme === 'dark' ? 'active' : ''}`}>
              <Sun className="w-4 h-4 text-amber-400" />
            </span>
            <span className={`theme-toggle-icon ${theme !== 'dark' ? 'active' : ''}`}>
              <Moon className="w-4 h-4 text-indigo-600" />
            </span>
          </span>
          <span className="hidden sm:inline">
            {theme === 'dark' ? 'Mode Clair' : 'Mode Sombre'}
          </span>
        </motion.button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* PANEL GAUCHE — Branding & Pépites Fonctionnelles */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="relative hidden h-full flex-col border-r border-outline-variant/20 bg-zinc-950 p-10 lg:flex justify-between overflow-hidden"
      >
        {/* Gradients ambiants d'arrière-plan */}
        <div className="absolute inset-0 bg-gradient-to-b from-blue-950/20 via-zinc-950 to-black/60" />
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />

        {/* Fond vectoriel animé */}
        <div className="absolute inset-0 opacity-40">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>

        {/* Header Marque + Status Badge */}
        <div className="flex items-center justify-between z-10">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex items-center gap-3 text-white"
          >
            <div className="p-2.5 rounded-2xl logo-gradient shadow-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-white block">ERP ITSM</span>
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block">AI HUB PLATFORM</span>
            </div>
          </motion.div>

          <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Services IA & GLPI Opérationnels
          </span>
        </div>

        {/* Tagline & Cartes d'Atouts */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="z-10 text-left max-w-lg space-y-6"
        >
          <div className="space-y-2">
            <h2 className="text-3xl lg:text-4xl font-black text-white tracking-tight leading-tight">
              Gestion IT Nouvelle Génération & IA
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed font-normal">
              Plateforme d'assistance unifiée avec qualification Hotline différée, prédictions d'apprentissage IA et synchronisation GLPI en temps réel.
            </p>
          </div>

          {/* Liste à puces d'atouts visuels */}
          <div className="space-y-3 pt-2">
            {[
              { icon: ShieldCheck, title: 'Validation Hotline GLPI', desc: 'Contrôle complet avant création officielle dans GLPI' },
              { icon: Zap,          title: 'IA & Réponses Automatiques', desc: 'Brouillons intelligents Gemini et suggestions de triage' },
              { icon: RefreshCw,    title: 'Synchro Bi-directionnelle', desc: 'Mise à jour en temps réel des tickets et pièces jointes' },
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.4 + idx * 0.1 }}
                  className="flex items-center gap-3.5 p-3 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur-md"
                >
                  <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">{item.title}</h4>
                    <p className="text-[11px] text-zinc-400">{item.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Footer Panel Gauche */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="z-10 flex items-center justify-between text-xs text-zinc-500 border-t border-zinc-900 pt-4"
        >
          <span>&copy; {new Date().getFullYear()} ERP ITSM — Tous droits réservés</span>
          <span className="font-mono text-[10px] text-zinc-600">v2.4.0 • Enterprise Edition</span>
        </motion.div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* PANEL DROIT — Formulaire de Connexion Premium */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="relative flex min-h-screen flex-col justify-center px-6 sm:px-12 lg:px-16"
      >
        {/* Halos de lumière radiale */}
        <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute bottom-1/4 left-1/4 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl" />
        </div>

        <motion.div
          className="mx-auto w-full max-w-[420px] space-y-6"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* En-tête du formulaire */}
          <motion.div variants={itemVariants} className="flex flex-col items-center text-center space-y-2">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4, type: 'spring', bounce: 0.4 }}
              className="flex items-center gap-2.5 lg:hidden mb-2 text-on-surface"
            >
              <div className="p-2 rounded-xl bg-primary text-on-primary shadow-md">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="font-black text-xl tracking-tight">ERP ITSM</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="font-black text-3xl tracking-tight text-on-surface"
            >
              Connexion
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="text-xs font-medium text-on-surface-variant max-w-sm"
            >
              Accédez à votre console de gestion ITSM & d'automatisation IA
            </motion.p>
          </motion.div>

          {/* Carte glassmorphism */}
          <motion.div
            variants={cardVariants}
            className="bg-surface-container-lowest/90 backdrop-blur-md rounded-3xl border border-outline-variant/40 p-7 shadow-xl shadow-surface-container-high/20"
          >
            <form className="space-y-4" onSubmit={handleSubmit}>
              {/* Message d'erreur animé */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    key="login-error"
                    initial={{ opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 p-3 rounded-xl flex items-start gap-3 text-xs"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                    <div>
                      <strong className="font-bold block">Échec de connexion</strong>
                      <span className="opacity-90">{error}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Champ Email */}
              <motion.div variants={itemVariants} className="space-y-1.5">
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant" htmlFor="email">
                  Email ou identifiant AD
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
                  <input
                    id="email"
                    name="email"
                    type="text"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nom@entreprise.ci ou identifiant AD"
                    className="w-full bg-surface border border-outline-variant/40 rounded-xl pl-10 pr-4 py-2.5 text-xs text-on-surface font-medium placeholder-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                  />
                </div>
              </motion.div>

              {/* Champ Mot de passe */}
              <motion.div variants={itemVariants} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant" htmlFor="password">
                    Mot de passe
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline transition-colors font-bold"
                  >
                    Oublié ?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-surface border border-outline-variant/40 rounded-xl pl-10 pr-10 py-2.5 text-xs text-on-surface font-medium placeholder-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 hover:text-on-surface transition-colors p-1"
                    aria-label={showPassword ? 'Masquer' : 'Afficher'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </motion.div>

              {/* Bouton de connexion */}
              <motion.div variants={itemVariants} className="pt-2">
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl btn-primary font-extrabold text-xs shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Connexion en cours...</span>
                    </>
                  ) : (
                    <>
                      <span>Se connecter</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </motion.button>
              </motion.div>
            </form>
          </motion.div>

          {/* Footer & Aide */}
          <motion.div variants={itemVariants} className="text-center space-y-2">
            <p className="text-[11px] text-on-surface-variant font-medium">
              Besoin d'un compte ou d'une réinitialisation ?{' '}
              <span className="text-on-surface font-bold">Contactez l'équipe IT Hotline</span>
            </p>
          </motion.div>
        </motion.div>
      </motion.div>
    </main>
  );
}

