import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import {
  Mail, Lock, Eye, EyeOff, RefreshCw, ArrowRight, AlertTriangle,
  Sun, Moon, Sparkles,
} from 'lucide-react';

/* ── Logique de connexion partagée par tous les designs ────────────────────── */
export function useLoginFlow() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, getLastLocation } = useAuth();
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

  return { email, setEmail, password, setPassword, error, loading, handleSubmit };
}

/* ── Bouton de bascule de thème (fixe en haut à droite, tous designs) ─────── */
export function AuthThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
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
        <span className="hidden sm:inline">{theme === 'dark' ? 'Mode Clair' : 'Mode Sombre'}</span>
      </motion.button>
    </div>
  );
}

/* ── Logo de marque réutilisable ───────────────────────────────────────────── */
export function BrandLogo({ stacked = false }) {
  return (
    <div className={`inline-flex ${stacked ? 'flex-col items-center gap-2' : 'items-center gap-3'} text-on-surface`}>
      <div className="p-2.5 rounded-2xl logo-gradient shadow-lg">
        <Sparkles className="w-5 h-5 text-white" />
      </div>
      <div className={stacked ? 'text-center' : ''}>
        <span className="font-extrabold text-lg tracking-tight text-on-surface block leading-tight">ERP ITSM</span>
        <span className="text-[9px] font-bold text-primary uppercase tracking-widest block leading-tight">AI Hub Platform</span>
      </div>
    </div>
  );
}

/* ── Mot rotatif (inspiré du composant RotatingWord de Katalyst) ───────────── */
export function RotatingWord({ words, className = '' }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!words?.length) return undefined;
    const timer = setInterval(() => setIndex((v) => (v + 1) % words.length), 2600);
    return () => clearInterval(timer);
  }, [words.length]);

  if (!words?.length) return null;

  return (
    <span className={`relative inline-grid overflow-hidden align-bottom ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={index}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="col-start-1 row-start-1 whitespace-nowrap"
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ── Formulaire de connexion (carte) partagé par tous les designs ──────────── */
export function LoginFormCard({ title, subtitle, footer }) {
  const { email, setEmail, password, setPassword, error, loading, handleSubmit } = useLoginFlow();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-[420px]"
    >
      <div className="bg-surface-container-lowest/90 backdrop-blur-md rounded-3xl border border-outline-variant/40 p-7 shadow-xl shadow-surface-container-high/20">
        <div className="flex flex-col items-center text-center space-y-1.5 mb-6">
          <div className="lg:hidden mb-1">
            <BrandLogo stacked />
          </div>
          <h1 className="font-black text-2xl tracking-tight text-on-surface">{title}</h1>
          {subtitle && <p className="text-xs font-medium text-on-surface-variant max-w-sm">{subtitle}</p>}
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
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

          {/* Email */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant" htmlFor="login-email">
              Email ou identifiant AD
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
              <input
                id="login-email"
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
          </div>

          {/* Mot de passe */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant" htmlFor="login-password">
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
              <input
                id="login-password"
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
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-1">
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
          </div>
        </form>
      </div>

      <div className="text-center mt-4 space-y-1">
        {footer}
        <p className="text-[11px] text-on-surface-variant font-medium">
          Besoin d'un compte ou d'une réinitialisation ?{' '}
          <span className="text-on-surface font-bold">Contactez l'équipe IT Hotline</span>
        </p>
      </div>
    </motion.div>
  );
}

/* ── Étoiles de rating (bandeau de confiance Katalyst) ─────────────────────── */
export function TrustBadge({ light = false, suffix = 'tickets résolus' }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${light ? 'text-on-primary/80' : 'text-on-surface-variant'}`}>
      <div className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <svg key={i} viewBox="0 0 20 20" className={`w-4 h-4 ${i < 4 ? 'fill-amber-400 text-amber-400' : 'fill-amber-400/40 text-amber-400/40'}`}>
            <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
          </svg>
        ))}
      </div>
      <span className={`font-semibold ${light ? 'text-on-primary' : 'text-on-surface'}`}>4.9</span>
      <span aria-hidden="true">·</span>
      <span><span className={`font-semibold ${light ? 'text-on-primary' : 'text-on-surface'}`}>12k+</span> {suffix}</span>
    </div>
  );
}
