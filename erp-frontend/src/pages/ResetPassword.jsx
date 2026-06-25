import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 h-[42px] font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 w-full placeholder-on-surface-variant/40';

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
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setSubmitting(true);
    try {
      await publicApi.post(`/auth/reset-password/${token}`, { password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la réinitialisation.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-md antialiased selection:bg-primary/20 selection:text-primary">
      <main className="w-full max-w-[420px] mx-auto space-y-md">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-gradient-to-tr from-primary to-indigo-600 rounded-2xl flex items-center justify-center mb-md shadow-lg shadow-primary/20 transition-transform duration-300 hover:scale-105">
            <span className="material-symbols-outlined text-white text-[32px]">lock_reset</span>
          </div>
          <h1 className="font-display-lg text-display-lg text-on-background font-bold tracking-tight mb-xs">Nouveau mot de passe</h1>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 p-[28px] card-shadow">
          {checking && (
            <div className="flex flex-col items-center justify-center py-md gap-sm">
              <span className="material-symbols-outlined animate-spin text-primary text-[28px]">sync</span>
              <p className="font-body-sm text-body-sm text-on-surface-variant font-medium">Vérification du lien...</p>
            </div>
          )}

          {!checking && !valid && (
            <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl flex items-start gap-sm font-body-sm font-semibold">
              <span className="material-symbols-outlined text-error shrink-0">error</span>
              <p>{error}</p>
            </div>
          )}

          {!checking && valid && done && (
            <div className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-md rounded-xl font-body-sm font-semibold flex items-start gap-2">
              <span className="material-symbols-outlined shrink-0 mt-[2px] text-[18px]">check_circle</span>
              <div>
                <p>Mot de passe mis à jour !</p>
                <p className="font-normal text-emerald-500/80 mt-1">Votre mot de passe a été modifié avec succès. Redirection vers la page de connexion...</p>
              </div>
            </div>
          )}

          {!checking && valid && !done && (
            <form className="space-y-md" onSubmit={handleSubmit}>
              {error && (
                <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl flex items-start gap-sm font-body-sm">
                  <span className="material-symbols-outlined text-error shrink-0">error</span>
                  <p>{error}</p>
                </div>
              )}
              <div className="space-y-xs">
                <label className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nouveau mot de passe</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-on-surface-variant/70">
                    <span className="material-symbols-outlined text-[20px]">lock</span>
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Au moins 8 caractères"
                    className={`${inputClass} pl-10`}
                  />
                </div>
              </div>
              <div className="space-y-xs">
                <label className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Confirmer le mot de passe</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-on-surface-variant/70">
                    <span className="material-symbols-outlined text-[20px]">lock</span>
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirmez votre mot de passe"
                    className={`${inputClass} pl-10`}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-[42px] bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                    <span>Enregistrement...</span>
                  </>
                ) : (
                  <>
                    <span>Valider le nouveau mot de passe</span>
                    <span className="material-symbols-outlined text-[20px]">check</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        <div className="text-center">
          <Link to="/login" className="font-body-sm text-body-sm text-primary hover:text-primary-hover hover:underline transition-colors font-medium flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Retour à la connexion
          </Link>
        </div>
      </main>
    </div>
  );
}

