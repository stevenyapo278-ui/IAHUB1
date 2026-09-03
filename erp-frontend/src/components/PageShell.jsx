/**
 * PageShell — Composant racine standardisé pour toutes les pages de l'application.
 *
 * Remplace le pattern "flex flex-col min-h-screen + sticky top-0 border-b ..."
 * dupliqué dans chaque page. Garantit une cohérence visuelle totale.
 *
 * Props :
 *   icon        : composant Lucide
 *   iconColor   : classe Tailwind couleur de l'icône (ex: 'text-blue-400')
 *   iconBg      : classe Tailwind fond de la bulle (ex: 'bg-blue-500/10') — auto-calculé si absent
 *   title       : string
 *   subtitle    : string | ReactNode
 *   actions     : ReactNode — boutons et contrôles en haut à droite
 *   children    : ReactNode — contenu principal de la page
 *   noPadding   : bool — retire le padding du contenu (pour DataGrids plein-largeur)
 *   className   : string — classes additionnelles sur le conteneur enfant
 */
export default function PageShell({
  icon: Icon,
  iconColor = 'text-primary',
  iconBg,
  title,
  subtitle,
  actions,
  children,
  noPadding = false,
  className = '',
}) {
  // Auto-calcule le bg de la bulle depuis la couleur d'icône si non fourni
  const bubbleBg = iconBg || deriveBubbleBg(iconColor);

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Sticky Top Header ─────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 shrink-0 border-b backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 flex-wrap"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-surface-container-lowest) 95%, transparent)',
          borderColor: 'color-mix(in srgb, var(--color-outline-variant) 30%, transparent)',
        }}
      >
        {/* Titre + Icône */}
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className={`p-2 rounded-xl shrink-0 ${bubbleBg}`}>
              <Icon className={`w-5 h-5 ${iconColor}`} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-base font-bold truncate" style={{ color: 'var(--color-on-surface)', fontFamily: 'Inter, sans-serif' }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] font-medium truncate" style={{ color: 'var(--color-on-surface-variant)' }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Actions droite */}
        {actions && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {actions}
          </div>
        )}
      </div>

      {/* ── Contenu Principal ─────────────────────────────────────────── */}
      <div
        className={`flex-1 ${noPadding ? '' : 'px-4 sm:px-6 lg:px-8 py-6'} ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Dérive la classe CSS du fond de bulle depuis la couleur d'icône.
 * Ex: 'text-blue-400' → 'bg-blue-500/10'
 */
function deriveBubbleBg(iconColor) {
  const map = {
    'text-blue-400': 'bg-blue-500/10',
    'text-blue-600': 'bg-blue-500/10',
    'text-emerald-400': 'bg-emerald-500/10',
    'text-emerald-600': 'bg-emerald-500/10',
    'text-amber-400': 'bg-amber-500/10',
    'text-amber-600': 'bg-amber-500/10',
    'text-purple-400': 'bg-purple-500/10',
    'text-purple-600': 'bg-purple-500/10',
    'text-indigo-400': 'bg-indigo-500/10',
    'text-indigo-600': 'bg-indigo-500/10',
    'text-teal-400': 'bg-teal-500/10',
    'text-teal-600': 'bg-teal-500/10',
    'text-rose-400': 'bg-rose-500/10',
    'text-rose-600': 'bg-rose-500/10',
    'text-orange-400': 'bg-orange-500/10',
    'text-cyan-400': 'bg-cyan-500/10',
    'text-slate-400': 'bg-surface-container',
    'text-gray-400': 'bg-gray-500/10',
    'text-primary': 'bg-primary/10',
  };
  return map[iconColor] || 'bg-primary/10';
}
