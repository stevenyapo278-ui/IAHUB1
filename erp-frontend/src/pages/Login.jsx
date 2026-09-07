import { lazy, useEffect, useState, Suspense } from 'react';

const VARIANTS = [
  { id: 'classic', loader: () => import('./login/LoginClassic') },
  { id: 'split', loader: () => import('./login/LoginSplitShowcase') },
  { id: 'hero', loader: () => import('./login/LoginHeroGradient') },
  { id: 'minimal', loader: () => import('./login/LoginMinimalCard') },
];

const COMPONENT_CACHE = {};

function getVariantComponent(id) {
  if (!COMPONENT_CACHE[id]) {
    const v = VARIANTS.find((x) => x.id === id);
    if (!v) return null;
    COMPONENT_CACHE[id] = lazy(v.loader);
  }
  return COMPONENT_CACHE[id];
}

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function resolveFallbackVariant() {
  const now = new Date();
  const seed = getDayOfYear(now) + now.getFullYear() * 366;
  return VARIANTS[seed % VARIANTS.length].id;
}

function getForcedVariant() {
  const forced = new URLSearchParams(window.location.search).get('design');
  if (forced && VARIANTS.some((v) => v.id === forced)) return forced;
  return null;
}

export default function Login() {
  const [resolvedId, setResolvedId] = useState(() => getForcedVariant());

  useEffect(() => {
    if (resolvedId) return;

    const controller = new AbortController();
    const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/+$/, '');
    const url = apiBase.endsWith('/api') ? `${apiBase}/auth/login-theme` : `${apiBase}/api/auth/login-theme`;

    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const id = data?.resolvedVariant;
        setResolvedId(id && VARIANTS.some((v) => v.id === id) ? id : resolveFallbackVariant());
      })
      .catch(() => setResolvedId(resolveFallbackVariant()));

    return () => controller.abort();
  }, []);

  if (!resolvedId) {
    return (
      <main className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" aria-hidden="true" />
          <span className="text-xs font-medium text-on-surface-variant">Chargement...</span>
        </div>
      </main>
    );
  }

  const Variant = getVariantComponent(resolvedId);
  if (!Variant) return null;
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-surface flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" aria-hidden="true" />
            <span className="text-xs font-medium text-on-surface-variant">Chargement...</span>
          </div>
        </main>
      }
    >
      <Variant />
    </Suspense>
  );
}
