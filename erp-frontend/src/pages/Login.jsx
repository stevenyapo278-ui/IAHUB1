import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { FloatingPaths } from '@/components/floating-paths';
import { MailIcon, LockIcon, ArrowRightIcon, RefreshCwIcon, AlertTriangleIcon } from 'lucide-react';

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
      {/* Left panel (Hidden on small screens) */}
      <div className="relative hidden h-full flex-col border-r bg-zinc-950 p-10 lg:flex justify-between">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
        
        <div className="flex items-center gap-2 z-10 text-white">
          <span className="material-symbols-outlined text-primary text-[28px] fill-1">dashboard</span>
          <span className="font-bold text-xl tracking-tight">ERP ITSM</span>
        </div>

        <div className="absolute inset-0">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>

      {/* Right panel */}
      <div className="relative flex min-h-screen flex-col justify-center px-6 sm:px-12 lg:px-16">
        {/* Top Shades background effects */}
        <div aria-hidden className="absolute inset-0 isolate -z-10 opacity-60 contain-strict pointer-events-none">
          <div className="absolute top-0 right-0 h-320 w-140 -translate-y-87.5 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,--theme(--color-foreground/.06)_0,hsla(0,0%,55%,.02)_50%,--theme(--color-foreground/.01)_80%)]" />
          <div className="absolute top-0 right-0 h-320 w-60 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)] [translate:5%_-50%]" />
          <div className="absolute top-0 right-0 h-320 w-60 -translate-y-87.5 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)]" />
        </div>

        <div className="mx-auto w-full max-w-[420px] space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="flex items-center gap-2 lg:hidden mb-2 text-on-surface">
              <span className="material-symbols-outlined text-primary text-[28px] fill-1">dashboard</span>
              <span className="font-bold text-xl tracking-tight">ERP ITSM</span>
            </div>
            <h1 className="font-bold text-3xl tracking-tight text-on-surface">
              Connexion
            </h1>
            <p className="text-sm text-muted-foreground">
              Accédez à la console de gestion intelligente ERP ITSM
            </p>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 p-[28px] card-shadow">
            <form className="space-y-4" onSubmit={handleSubmit}>
              {error && (
                <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-4 rounded-xl flex items-start gap-3 font-body-sm animate-in fade-in slide-in-from-top-1 duration-200">
                  <AlertTriangleIcon className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
                  <div>
                    <strong className="font-semibold text-sm">Échec de connexion</strong>
                    <p className="mt-0.5 text-xs text-red-500/80">{error}</p>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
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
                    placeholder="superadmin@prosuma.ci"
                  />
                  <InputGroupAddon align="inline-start">
                    <MailIcon className="h-4 w-4" />
                  </InputGroupAddon>
                </InputGroup>
              </div>

              <div className="space-y-1.5">
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
                    placeholder="••••••••"
                  />
                  <InputGroupAddon align="inline-start">
                    <LockIcon className="h-4 w-4" />
                  </InputGroupAddon>
                </InputGroup>
              </div>

              <Button className="w-full h-10 mt-6" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <RefreshCwIcon className="h-4 w-4 animate-spin mr-2" />
                    Connexion en cours...
                  </>
                ) : (
                  <>
                    Se connecter
                    <ArrowRightIcon className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground/80 font-medium">
            ERP ITSM &mdash; Système d'assistance et d'automatisations IA
          </p>
        </div>
      </div>
    </main>
  );
}
