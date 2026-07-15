import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { FloatingPaths } from '@/components/floating-paths';

/* ── Variants d'animation ──────────────────────────────────────────────────── */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.2 },
  },
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Email ou mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2 bg-background antialiased selection:bg-primary/20 selection:text-primary">
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* PANEL GAUCHE — Marque & Animation */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="relative hidden h-full flex-col border-r bg-zinc-950 p-10 lg:flex justify-between overflow-hidden"
      >
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />

        {/* Fond animé */}
        <div className="absolute inset-0">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>

        {/* Logo / Marque */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex items-center gap-2.5 z-10 text-white"
        >
          <motion.span
            initial={{ scale: 0.8, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.5, type: 'spring', bounce: 0.5, delay: 0.2 }}
            className="material-symbols-outlined text-primary text-[30px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            dashboard
          </motion.span>
          <span className="font-bold text-xl tracking-tight">ERP ITSM</span>
        </motion.div>

        {/* Tagline centrée */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="z-10 text-center max-w-md mx-auto"
        >
          <h2 className="text-3xl font-bold text-white tracking-tight mb-3">
            Gestion IT<br/>Intelligente
          </h2>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Plateforme ITSM nouvelle génération avec orchestration IA,
            synchronisation GLPI et automatisations avancées.
          </p>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="z-10 text-xs text-zinc-600"
        >
          &copy; {new Date().getFullYear()} ERP ITSM — Tous droits réservés
        </motion.p>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* PANEL DROIT — Formulaire de connexion */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="relative flex min-h-screen flex-col justify-center px-6 sm:px-12 lg:px-16"
      >
        {/* Effets de fond — radial gradients */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 1, delay: 0.3 }}
          aria-hidden
          className="absolute inset-0 isolate -z-10 opacity-60 contain-strict pointer-events-none"
        >
          <div className="absolute top-0 right-0 h-320 w-140 -translate-y-87.5 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,--theme(--color-foreground/.06)_0,hsla(0,0%,55%,.02)_50%,--theme(--color-foreground/.01)_80%)]" />
          <div className="absolute top-0 right-0 h-320 w-60 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)] [translate:5%_-50%]" />
          <div className="absolute top-0 right-0 h-320 w-60 -translate-y-87.5 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)]" />
        </motion.div>

        <motion.div
          className="mx-auto w-full max-w-[420px] space-y-6"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* ── En-tête ──────────────────────────────────────────────────────── */}
          <motion.div variants={itemVariants} className="flex flex-col items-center text-center space-y-2">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4, type: 'spring', bounce: 0.4 }}
              className="flex items-center gap-2 lg:hidden mb-2 text-on-surface"
            >
              <span className="material-symbols-outlined text-primary text-[28px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                dashboard
              </span>
              <span className="font-bold text-xl tracking-tight">ERP ITSM</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="font-bold text-3xl tracking-tight text-on-surface"
            >
              Connexion
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="text-sm text-muted-foreground"
            >
              Accédez à la console de gestion intelligente ERP ITSM
            </motion.p>
          </motion.div>

          {/* ── Carte formulaire (bento glass) ────────────────────────────────── */}
          <motion.div
            variants={cardVariants}
            className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 p-[28px] card-shadow"
          >
            <motion.form
              className="space-y-4"
              onSubmit={handleSubmit}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {/* ── Message d'erreur animé ────────────────────────────────────── */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    key="login-error"
                    initial={{ opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    id="login-error"
                    role="alert"
                    className="border border-red-500/20 bg-red-500/5 text-red-500 p-4 rounded-xl flex items-start gap-3 font-body-sm"
                  >
                    <span className="material-symbols-outlined text-red-500 shrink-0" style={{ fontSize: '20px' }}>warning</span>
                    <div>
                      <strong className="font-semibold text-sm">Échec de connexion</strong>
                      <p className="mt-0.5 text-xs text-red-500/80">{error}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Champ Email ────────────────────────────────────────────────── */}
              <motion.div variants={itemVariants} className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="email">
                  Identifiant / Email professionnel
                </label>
                <InputGroup className="h-10">
                  <InputGroupInput
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nom@entreprise.ci"
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <InputGroupAddon align="inline-start" aria-hidden="true">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>mail</span>
                  </InputGroupAddon>
                </InputGroup>
              </motion.div>

              {/* ── Champ Mot de passe ────────────────────────────────────────── */}
              <motion.div variants={itemVariants} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="password">
                    Mot de passe
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-primary hover:underline hover:text-primary/80 transition-colors font-medium"
                  >
                    Mot de passe oublié ?
                  </Link>
                </div>
                <InputGroup className="h-10">
                  <InputGroupInput
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Votre mot de passe"
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <InputGroupAddon align="inline-start" aria-hidden="true">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>lock</span>
                  </InputGroupAddon>
                </InputGroup>
              </motion.div>

              {/* ── Bouton de connexion animé ──────────────────────────────────── */}
              <motion.div variants={itemVariants}>
                <Button
                  className="w-full h-10 mt-6 transition-all duration-300 active:scale-[0.98] group"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined animate-spin" style={{ fontSize: '16px' }}>progress_activity</span>
                      Connexion en cours...
                    </motion.span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Se connecter
                      <motion.span
                        initial={{ x: 0 }}
                        whileHover={{ x: 3 }}
                        transition={{ duration: 0.2 }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
                      </motion.span>
                    </span>
                  )}
                </Button>
              </motion.div>
            </motion.form>
          </motion.div>

          {/* ── Footer ────────────────────────────────────────────────────────── */}
          <motion.p
            variants={itemVariants}
            className="mt-8 text-center text-xs text-muted-foreground/80 font-medium"
          >
            ERP ITSM &mdash; Système d'assistance et d'automatisations IA
          </motion.p>
        </motion.div>
      </motion.div>
    </main>
  );
}
