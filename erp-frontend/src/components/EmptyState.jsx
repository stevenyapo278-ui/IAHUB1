import { cn } from '../lib/utils';

const ILLUSTRATIONS = {
  tickets: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
      <rect x="20" y="30" width="80" height="60" rx="8" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" fill="none" opacity="0.3" />
      <rect x="28" y="38" width="64" height="8" rx="4" fill="currentColor" opacity="0.1" />
      <rect x="28" y="52" width="48" height="6" rx="3" fill="currentColor" opacity="0.08" />
      <rect x="28" y="64" width="32" height="6" rx="3" fill="currentColor" opacity="0.06" />
      <circle cx="88" cy="82" r="18" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <path d="M82 82h12M88 76v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.15" />
    </svg>
  ),
  inbox: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
      <rect x="15" y="25" width="90" height="70" rx="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <path d="M15 75l30-15 15 15 15-15 30 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.15" />
      <circle cx="60" cy="45" r="6" fill="currentColor" opacity="0.08" />
      <rect x="42" y="55" width="36" height="4" rx="2" fill="currentColor" opacity="0.06" />
      <rect x="46" y="63" width="28" height="3" rx="1.5" fill="currentColor" opacity="0.04" />
    </svg>
  ),
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
      <circle cx="52" cy="52" r="22" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <line x1="68" y1="68" x2="86" y2="86" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.15" />
      <rect x="35" y="35" width="8" height="8" rx="4" fill="currentColor" opacity="0.04" />
      <rect x="50" y="35" width="8" height="8" rx="4" fill="currentColor" opacity="0.06" />
      <rect x="65" y="50" width="8" height="8" rx="4" fill="currentColor" opacity="0.04" />
    </svg>
  ),
  users: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
      <circle cx="45" cy="40" r="14" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <path d="M24 80c0-12 9.4-22 21-22h0c11.6 0 21 10 21 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.15" />
      <circle cx="78" cy="44" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.1" />
      <path d="M66 78c0-9 5.4-16 12-16h0c6.6 0 12 7 12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.1" />
      <circle cx="96" cy="50" r="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.06" />
    </svg>
  ),
  knowledge: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
      <rect x="25" y="20" width="50" height="70" rx="4" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <rect x="27" y="22" width="46" height="8" rx="2" fill="currentColor" opacity="0.06" />
      <rect x="27" y="34" width="46" height="4" rx="2" fill="currentColor" opacity="0.04" />
      <rect x="27" y="42" width="32" height="4" rx="2" fill="currentColor" opacity="0.04" />
      <rect x="27" y="50" width="40" height="4" rx="2" fill="currentColor" opacity="0.03" />
      <circle cx="82" cy="82" r="16" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <path d="M76 82h12M82 76v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.15" />
    </svg>
  ),
  settings: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
      <circle cx="60" cy="60" r="18" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <circle cx="60" cy="60" r="8" fill="currentColor" opacity="0.08" />
      <rect x="58" y="30" width="4" height="12" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="58" y="78" width="4" height="12" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="30" y="58" width="12" height="4" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="78" y="58" width="12" height="4" rx="2" fill="currentColor" opacity="0.1" />
      <line x1="44.5" y1="44.5" x2="34" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.08" />
      <line x1="75.5" y1="75.5" x2="86" y2="86" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.08" />
      <line x1="44.5" y1="75.5" x2="34" y2="86" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.08" />
      <line x1="75.5" y1="44.5" x2="86" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.08" />
    </svg>
  ),
  default: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
      <circle cx="60" cy="50" r="26" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
      <path d="M32 90c0-15.5 12.5-28 28-28s28 12.5 28 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.15" />
      <path d="M50 44l6 6 10-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.2" />
    </svg>
  ),
};

export default function EmptyState({
  icon = 'default',
  title = 'Aucune donnée',
  description = "Il n'y a encore rien à afficher ici.",
  action,
  className,
}) {
  const Illustration = ILLUSTRATIONS[icon] || ILLUSTRATIONS.default;

  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-16 px-6 text-center',
      'bg-surface-container-lowest border border-outline-variant/60 rounded-2xl',
      className
    )}>
      <div className="w-32 h-32 mb-6 text-on-surface-variant/40 dark:text-on-surface-variant/30" aria-hidden="true">
        {Illustration}
      </div>
      <h3 className="font-headline-md text-headline-md text-on-surface font-semibold mb-2">
        {title}
      </h3>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-sm mb-6 leading-relaxed">
        {description}
      </p>
      {action && (
        <div className="flex items-center gap-3">
          {action}
        </div>
      )}
    </div>
  );
}

export function EmptyStateInline({ icon = 'default', title, description, action, className }) {
  const Illustration = ILLUSTRATIONS[icon] || ILLUSTRATIONS.default;

  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-10 px-4 text-center',
      className
    )}>
      <div className="w-20 h-20 mb-4 text-on-surface-variant/30" aria-hidden="true">
        {Illustration}
      </div>
      <p className="font-body-md text-body-md text-on-surface font-medium mb-1">
        {title || 'Aucune donnée'}
      </p>
      {description && (
        <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs mb-4">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
