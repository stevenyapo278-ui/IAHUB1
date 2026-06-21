import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

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
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-md antialiased">
      <main className="w-full max-w-[420px] mx-auto">
        <div className="flex flex-col items-center mb-xl text-center">
          <div className="w-16 h-16 bg-on-surface rounded-none flex items-center justify-center mb-md">
            <span className="material-symbols-outlined text-surface text-[32px]">lock_reset</span>
          </div>
          <h1 className="font-display-lg text-display-lg text-on-background mb-xs">Mot de passe oublié</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Entrez votre email professionnel pour recevoir un lien de réinitialisation.
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-none border border-outline-variant p-[24px]">
          {done ? (
            <div className="font-body-sm text-body-sm text-on-surface">
              Si cet email existe, un lien de réinitialisation a été envoyé. Vérifiez votre boîte de réception (et le dossier spam).
            </div>
          ) : (
            <form className="space-y-md" onSubmit={handleSubmit}>
              {error && (
                <div className="border border-outline-variant text-on-surface p-md rounded-none font-body-sm text-body-sm">{error}</div>
              )}
              <div>
                <label className="block font-label-md text-label-md text-on-surface mb-xs uppercase" htmlFor="email">
                  Email professionnel
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-[40px] px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-[40px] bg-on-surface hover:opacity-80 text-surface font-headline-sm text-headline-sm rounded-none disabled:opacity-60"
              >
                {submitting ? 'Envoi...' : 'Envoyer le lien'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-lg text-center">
          <Link to="/login" className="font-body-sm text-body-sm text-on-surface-variant hover:underline">
            Retour à la connexion
          </Link>
        </div>
      </main>
    </div>
  );
}
