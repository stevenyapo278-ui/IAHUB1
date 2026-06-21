import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

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
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-md antialiased">
      <main className="w-full max-w-[420px] mx-auto">
        <div className="flex flex-col items-center mb-xl text-center">
          <div className="w-16 h-16 bg-on-surface rounded-none flex items-center justify-center mb-md">
            <span className="material-symbols-outlined text-surface text-[32px]">lock_reset</span>
          </div>
          <h1 className="font-display-lg text-display-lg text-on-background mb-xs">Nouveau mot de passe</h1>
        </div>

        <div className="bg-surface-container-lowest rounded-none border border-outline-variant p-[24px]">
          {checking && <p className="font-body-sm text-body-sm text-on-surface-variant">Vérification du lien...</p>}

          {!checking && !valid && (
            <div className="font-body-sm text-body-sm text-on-surface">{error}</div>
          )}

          {!checking && valid && done && (
            <div className="font-body-sm text-body-sm text-on-surface">
              Mot de passe mis à jour. Redirection vers la connexion...
            </div>
          )}

          {!checking && valid && !done && (
            <form className="space-y-md" onSubmit={handleSubmit}>
              {error && (
                <div className="border border-outline-variant text-on-surface p-md rounded-none font-body-sm text-body-sm">{error}</div>
              )}
              <div>
                <label className="block font-label-md text-label-md text-on-surface mb-xs uppercase">Nouveau mot de passe</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Au moins 8 caractères"
                  className="w-full h-[40px] px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                />
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface mb-xs uppercase">Confirmer le mot de passe</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-[40px] px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-[40px] bg-on-surface hover:opacity-80 text-surface font-headline-sm text-headline-sm rounded-none disabled:opacity-60"
              >
                {submitting ? 'Enregistrement...' : 'Valider le nouveau mot de passe'}
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
