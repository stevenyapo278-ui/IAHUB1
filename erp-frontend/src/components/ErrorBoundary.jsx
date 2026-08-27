import { Component } from 'react';

const RELOAD_FLAG = '__chunk_reload_pending';

const ERROR_ILLUSTRATION = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
    <circle cx="60" cy="50" r="26" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
    <path d="M55 42l10 10M65 42l-10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.25" />
    <path d="M32 90c0-15.5 12.5-28 28-28s28 12.5 28 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.15" />
  </svg>
);

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, reloading: false };
  }

  static getDerivedStateFromError(error) {
    const msg = String(error?.message || error || '');

    // Détecter les erreurs de chunks Vite périmés → auto-reload sans afficher l'erreur
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Loading chunk') ||
      msg.includes('Cannot find module') ||
      msg.includes('is not defined') ||
      msg.includes('is not a function')
    ) {
      // Anti-boucle : un seul reload par onglet
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        // Petit délai pour laisser le temps au flag d'être écrit
        setTimeout(() => window.location.reload(), 100);
        return { hasError: false, error: null, reloading: true };
      }
      sessionStorage.removeItem(RELOAD_FLAG);
    }

    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Si on est en mode reload, ne pas logger
    if (this.state.reloading) return;
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    // Mode rechargement : afficher un écran de chargement le temps du reload
    if (this.state.reloading) {
      return (
        <div className="flex items-center justify-center min-h-[400px] p-6">
          <div className="flex flex-col items-center text-center max-w-md">
            <div className="w-16 h-16 mb-4 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <h2 className="font-headline-md text-headline-md font-semibold mb-2 text-on-surface">
              Mise à jour en cours…
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
              L'application se recharge automatiquement.
            </p>
          </div>
        </div>
      );
    }

    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[400px] p-6">
          <div className="flex flex-col items-center text-center max-w-md">
            <div className="w-32 h-32 mb-6 text-error/30" aria-hidden="true">
              {ERROR_ILLUSTRATION}
            </div>
            <h2 className="font-headline-md text-headline-md font-semibold mb-2 text-on-surface">
              Une erreur est survenue
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6 leading-relaxed">
              Un problème inattendu a été rencontré. Vous pouvez réessayer ou contacter un administrateur.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={this.handleReset}
                className="px-5 py-2.5 rounded-xl btn-gradient font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
              >
                Réessayer
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="px-5 py-2.5 rounded-xl border border-outline-variant/60 text-on-surface font-semibold hover:bg-surface-container-high transition-all duration-300 text-body-sm"
              >
                Accueil
              </button>
            </div>
            {this.state.error && (
              <details className="mt-6 w-full text-left" open>
                <summary className="font-body-sm text-body-sm text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors font-bold">
                  Détails techniques de l'erreur
                </summary>
                <pre className="mt-2 p-3 bg-surface-container border border-red-500/30 rounded-xl text-xs text-red-600 dark:text-red-400 font-mono overflow-x-auto whitespace-pre-wrap text-left">
                  {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
