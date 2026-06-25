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
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-md antialiased selection:bg-primary/20 selection:text-primary">
      <main className="w-full max-w-[420px] mx-auto space-y-md">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-gradient-to-tr from-primary to-indigo-600 rounded-2xl flex items-center justify-center mb-md shadow-lg shadow-primary/20 transition-transform duration-300 hover:scale-105">
            <span className="material-symbols-outlined text-white text-[32px] fill-1">
              dashboard
            </span>
          </div>
          <h1 className="font-display-lg text-display-lg text-on-background font-bold tracking-tight mb-xs">ERP ITSM</h1>
          <p className="font-body-md text-body-md text-on-surface-variant font-medium">Console de gestion intelligente</p>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 p-[28px] card-shadow">
          <form className="space-y-md" onSubmit={handleSubmit}>
            {error && (
              <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl flex items-start gap-sm font-body-sm">
                <span className="material-symbols-outlined text-error shrink-0">error</span>
                <div className="font-body-sm text-body-sm">
                  <strong className="font-semibold">Échec de connexion</strong>
                  <p className="mt-0.5 text-red-500/80">{error}</p>
                </div>
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
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="superadmin@prosuma.ci"
                  className="bg-surface border border-outline-variant/60 rounded-xl pl-10 pr-3.5 py-2 h-[42px] font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 w-full placeholder-on-surface-variant/40"
                />
              </div>
            </div>

            <div className="space-y-xs">
              <div className="flex items-center justify-between">
                <label className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold" htmlFor="password">
                  Mot de passe
                </label>
                <Link to="/forgot-password" className="font-body-sm text-body-sm text-primary hover:text-primary-hover hover:underline transition-colors font-medium">
                  Mot de passe oublié ?
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-on-surface-variant/70">
                  <span className="material-symbols-outlined text-[20px]">lock</span>
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
                  className="bg-surface border border-outline-variant/60 rounded-xl pl-10 pr-3.5 py-2 h-[42px] font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 w-full placeholder-on-surface-variant/40"
                />
              </div>
            </div>

            <div className="pt-sm">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-[42px] bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                    <span>Connexion en cours...</span>
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

        <div className="text-center">
          <p className="font-body-sm text-body-sm text-on-surface-variant/80 font-medium">
            ERP ITSM &mdash; Système d'assistance et d'automatisations IA
          </p>
        </div>
      </main>
    </div>
  );
}

