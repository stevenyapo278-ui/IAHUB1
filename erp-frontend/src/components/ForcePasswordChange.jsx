import { useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

// Overlay bloquant affiché par-dessus toute l'application tant que user.mustChangePassword est
// vrai (ex: après une réinitialisation par un admin) — force le changement avant de pouvoir
// continuer à utiliser l'application.
export default function ForcePasswordChange() {
  const { clearMustChangePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      clearMustChangePassword();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du changement de mot de passe.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center z-50 p-md">
      <div className="w-full max-w-[420px] bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-md">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-surface">Changement de mot de passe requis</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">
            Votre mot de passe a été réinitialisé. Définissez-en un nouveau pour continuer.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low font-body-sm text-body-sm">{error}</div>}

          <div>
            <label className="block font-label-md text-label-md text-on-surface mb-xs uppercase">Mot de passe temporaire actuel</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full h-[40px] px-sm border border-outline-variant bg-surface text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
            />
          </div>
          <div>
            <label className="block font-label-md text-label-md text-on-surface mb-xs uppercase">Nouveau mot de passe</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Au moins 8 caractères"
              className="w-full h-[40px] px-sm border border-outline-variant bg-surface text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
            />
          </div>
          <div>
            <label className="block font-label-md text-label-md text-on-surface mb-xs uppercase">Confirmer le nouveau mot de passe</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full h-[40px] px-sm border border-outline-variant bg-surface text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
            />
          </div>

          <div className="flex gap-sm pt-sm">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 h-[40px] bg-on-surface hover:opacity-80 text-surface font-headline-sm text-headline-sm rounded-none disabled:opacity-60"
            >
              {submitting ? 'Enregistrement...' : 'Valider'}
            </button>
            <button
              type="button"
              onClick={logout}
              className="h-[40px] px-md border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
            >
              Déconnexion
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
