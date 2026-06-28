import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '../../context/ThemeContext';

export default function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      theme={theme}
      richColors
      closeButton
      position="top-right"
      toastOptions={{
        duration: 4000,
        className: 'font-body-sm text-body-sm',
        style: {
          borderRadius: '12px',
          border: '1px solid var(--color-outline-variant)',
          boxShadow: '0 0 0 1px var(--color-outline-variant), 0 12px 24px -8px rgba(0,0,0,0.12)',
        },
      }}
      icons={{
        success: (
          <span className="material-symbols-outlined text-[18px] text-emerald-500" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
        ),
        error: (
          <span className="material-symbols-outlined text-[18px] text-red-500" style={{ fontVariationSettings: "'FILL' 1" }}>
            error
          </span>
        ),
        info: (
          <span className="material-symbols-outlined text-[18px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
            info
          </span>
        ),
        warning: (
          <span className="material-symbols-outlined text-[18px] text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>
            warning
          </span>
        ),
      }}
    />
  );
}
