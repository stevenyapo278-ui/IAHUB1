import { Component } from 'react';

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
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
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
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
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
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6 w-full text-left">
                <summary className="font-body-sm text-body-sm text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors">
                  Détails techniques
                </summary>
                <pre className="mt-2 p-3 bg-surface-container border border-outline-variant/60 rounded-xl text-xs text-on-surface-variant font-mono overflow-x-auto whitespace-pre-wrap">
                  {this.state.error.stack || this.state.error.message}
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
