import { Toaster as SonnerToaster } from 'sonner';
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// ─── Toaster global ─────────────────────────────────────────────────────────
// Rail discret arrimé en haut à droite, sous l'en-tête applicatif (h-14 = 56px).
// Moins envahissant que l'ancienne pile en bas à droite :
//  - 3 cartes visibles max (au lieu de 5), les suivantes attendent leur tour
//  - largeur et hauteur réduites, ombre plus douce
//  - le bouton de fermeture n'apparaît qu'au survol (CSS)
//  - durée de vie courte par défaut, les toasts temps réel surchargent la leur
export default function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      theme={theme}
      closeButton
      expand={false}
      visibleToasts={3}
      position="top-right"
      offset={68}
      mobileOffset={64}
      gap={8}
      duration={4000}
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--color-surface-container-lowest)',
          color: 'var(--color-on-surface)',
          border: '1px solid color-mix(in srgb, var(--color-outline-variant) 80%, transparent)',
          borderRadius: '14px',
          boxShadow: '0 10px 28px -14px rgba(0, 0, 0, 0.28), 0 2px 8px -4px rgba(0, 0, 0, 0.1)',
          padding: '9px 12px',
          fontSize: '12.5px',
          lineHeight: 1.35,
          fontFamily: 'inherit',
          cursor: 'pointer',
          width: '332px',
          maxWidth: 'calc(100vw - 24px)',
        },
      }}
      icons={{
        success: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />,
        error: <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
        info: <Info className="w-4 h-4 text-primary shrink-0" />,
        warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
      }}
    />
  );
}
