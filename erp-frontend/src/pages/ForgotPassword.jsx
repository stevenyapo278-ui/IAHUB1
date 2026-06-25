import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 h-[42px] font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 w-full placeholder-on-surface-variant/40';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await publicApi.post('/auth/forgot-password', { email });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Une erreur est survenue.');
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
          <h1 className="font-display-lg text-display-lg text-on-background font-bold tracking-tight mb-xs">Mot de passe oublié</h1>
          <p className="font-body-md text-body-md text-on-surface-variant font-medium">
            Entrez votre email professionnel pour recevoir un lien de réinitialisation.
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 p-[28px] card-shadow">
          {done ? (
            <div className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-md rounded-xl font-body-sm font-semibold flex items-start gap-2">
              <span className="material-symbols-outlined shrink-0 mt-[2px] text-[18px]">check_circle</span>
              <div>
                <p>Lien envoyé !</p>
                <p className="font-normal text-emerald-500/80 mt-1">Si cet email existe, un lien de réinitialisation a été envoyé. Vérifiez votre boîte de réception (et le dossier spam).</p>
              </div>
            </div>
          ) : (
            <form className="space-y-md" onSubmit={handleSubmit}>
              {error && (
                <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl flex items-start gap-sm font-body-sm">
                  <span className="material-symbols-outlined text-error shrink-0">error</span>
                  <p>{error}</p>
                </div>
              )}
              <div className="space-y-xs">
                <label className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold" htmlFor="email">
                  Email professionnel
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-on-surface-variant/70">
                    <span className="material-symbols-outlined text-[20px]">mail</span>
                  </div>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ex: admin@prosuma.ci"
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
                    <span>Envoi en cours...</span>
                  </>
                ) : (
                  <>
                    <span>Envoyer le lien</span>
                    <span className="material-symbols-outlined text-[20px]">send</span>
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
