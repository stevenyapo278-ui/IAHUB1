import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-md antialiased selection:bg-surface-container-high selection:text-on-surface">
      <main className="w-full max-w-[420px] mx-auto">
        <div className="flex flex-col items-center mb-xl text-center">
          <div className="w-16 h-16 bg-on-surface rounded-none flex items-center justify-center mb-md">
            <span className="material-symbols-outlined text-surface text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              dashboard
            </span>
          </div>
          <h1 className="font-display-lg text-display-lg text-on-background mb-xs">ERP ITSM</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Management Console</p>
        </div>

        <div className="bg-surface-container-lowest rounded-none border border-outline-variant p-[24px]">
          <form className="space-y-md" onSubmit={handleSubmit}>
            {error && (
              <div className="border border-outline-variant text-on-surface p-md rounded-none flex items-start space-x-sm">
                <span className="material-symbols-outlined text-error shrink-0">error</span>
                <div className="font-body-sm text-body-sm mt-[2px]">
                  <strong>Échec de connexion</strong>
                  <p className="mt-xs text-on-surface-variant">{error}</p>
                </div>
              </div>
            )}

            <div>
              <label className="block font-label-md text-label-md text-on-surface mb-xs uppercase" htmlFor="email">
                Email professionnel
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-sm flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-outline">mail</span>
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="superadmin@prosuma.ci"
                  className="w-full h-[40px] pl-[36px] pr-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md placeholder-outline transition-shadow duration-200 focus:outline-none focus:border-on-surface"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-xs">
                <label className="block font-label-md text-label-md text-on-surface uppercase" htmlFor="password">
                  Mot de passe
                </label>
                <Link to="/forgot-password" className="font-body-sm text-body-sm text-on-surface-variant hover:underline">
                  Mot de passe oublié ?
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-sm flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-outline">lock</span>
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-[40px] pl-[36px] pr-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md placeholder-outline transition-shadow duration-200 focus:outline-none focus:border-on-surface"
                />
              </div>
            </div>

            <div className="pt-sm">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-[40px] bg-on-surface hover:opacity-80 text-surface font-headline-sm text-headline-sm rounded-none flex items-center justify-center space-x-xs transition-colors duration-200 active:translate-y-[1px] focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                    <span>Connexion...</span>
                  </>
                ) : (
                  <>
                    <span>Se connecter</span>
                    <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-lg text-center">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            ERP ITSM &mdash; Console de gestion interne
          </p>
        </div>
      </main>
    </div>
  );
}
