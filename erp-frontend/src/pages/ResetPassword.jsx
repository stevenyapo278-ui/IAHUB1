import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    publicApi.get(`/auth/reset-password/${token}`)
      .then(() => setValid(true))
      .catch((err) => setError(err.response?.data?.error || 'Lien invalide.'))
      .finally(() => setChecking(false));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (password !== confirmPassword) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setSubmitting(true);
    try {
      await publicApi.post(`/auth/reset-password/${token}`, { password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la réinitialisation.');
    } finally { setSubmitting(false); }
  }

  return (
    <main className="relative md:h-screen md:overflow-hidden bg-background antialiased selection:bg-primary/20 selection:text-primary">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ duration: 1 }}
        aria-hidden className="absolute inset-0 isolate -z-10 pointer-events-none"
      >
        <div className="absolute top-0 right-0 h-320 w-140 -translate-y-87.5 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,--theme(--color-foreground/.06)_0,hsla(0,0%,55%,.02)_50%,--theme(--color-foreground/.01)_80%)]" />
        <div className="absolute top-0 right-0 h-320 w-60 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)] [translate:5%_-50%]" />
        <div className="absolute top-0 right-0 h-320 w-60 -translate-y-87.5 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)]" />
      </motion.div>

      <div className="min-h-screen flex items-center justify-center px-6">
        <motion.main variants={containerVariants} initial="hidden" animate="visible" className="w-full max-w-[420px] mx-auto space-y-6">
          <motion.div variants={itemVariants} className="flex flex-col items-center text-center space-y-3">
            <motion.div initial={{ scale: 0.8, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.5, type: 'spring', bounce: 0.5 }}
              className="w-16 h-16 rounded-2xl btn-gradient flex items-center justify-center shadow-lg shadow-primary/20"
            >
              <span className="material-symbols-outlined text-white dark:text-[#0a0a0a] text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>lock_reset</span>
            </motion.div>
            <h1 className="font-bold text-3xl tracking-tight text-on-surface">Nouveau mot de passe</h1>
          </motion.div>

          <motion.div variants={itemVariants} className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 p-[28px] card-shadow">
            <AnimatePresence mode="wait">
              {checking && (
                <motion.div key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-6 gap-3"
                >
                  <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="material-symbols-outlined text-primary text-[28px]">sync</motion.span>
                  <p className="text-sm text-muted-foreground font-medium">Vérification du lien...</p>
                </motion.div>
              )}

              {!checking && !valid && (
                <motion.div key="invalid" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="border border-red-500/20 bg-red-500/5 text-red-500 p-5 rounded-xl flex items-start gap-3"
                >
                  <span className="material-symbols-outlined shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                  <div>
                    <p className="font-semibold text-sm">Lien invalide</p>
                    <p className="text-xs text-red-500/80 mt-1">{error}</p>
                  </div>
                </motion.div>
              )}

              {!checking && valid && done && (
                <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-5 rounded-xl"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    <p className="font-semibold text-sm">Mot de passe mis à jour !</p>
                  </div>
                  <p className="text-xs text-emerald-500/80 leading-relaxed">Redirection vers la page de connexion...</p>
                </motion.div>
              )}

              {!checking && valid && !done && (
                <motion.form key="form" className="space-y-4" onSubmit={handleSubmit}>
                  <AnimatePresence>
                    {error && (
                      <motion.div initial={{ opacity: 0, y: -8, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: 'auto' }}
                        exit={{ opacity: 0, y: -8, height: 0 }}
                        className="border border-red-500/20 bg-red-500/5 text-red-500 p-4 rounded-xl flex items-start gap-3 font-body-sm"
                      >
                        <span className="material-symbols-outlined text-error shrink-0">error</span>
                        <p className="text-xs">{error}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nouveau mot de passe</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground/70">
                        <span className="material-symbols-outlined text-[20px]">lock</span>
                      </div>
                      <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                        placeholder="Au moins 8 caractères"
                        className="w-full h-10 pl-10 bg-surface border border-outline-variant/60 rounded-xl font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder-on-surface-variant/40"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Confirmer le mot de passe</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground/70">
                        <span className="material-symbols-outlined text-[20px]">lock</span>
                      </div>
                      <input type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirmez votre mot de passe"
                        className="w-full h-10 pl-10 bg-surface border border-outline-variant/60 rounded-xl font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder-on-surface-variant/40"
                      />
                    </div>
                  </div>

                  <button type="submit" disabled={submitting}
                    className="w-full h-10 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <><span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span> Enregistrement...</>
                    ) : (
                      <><span>Valider</span><span className="material-symbols-outlined text-[18px]">check</span></>
                    )}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div variants={itemVariants} className="text-center">
            <Link to="/login" className="text-sm text-primary hover:underline transition-colors font-medium inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Retour à la connexion
            </Link>
          </motion.div>
        </motion.main>
      </div>
    </main>
  );
}

