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
      gap={10}
      toastOptions={{
        duration: 5000,
        className: 'group-toast',
        style: {
          borderRadius: '16px',
          border: '1px solid var(--color-outline-variant)',
          boxShadow: '0 8px 32px -4px rgba(0,0,0,0.18), 0 2px 8px -2px rgba(0,0,0,0.08)',
          backdropFilter: 'blur(16px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.6)',
          padding: '12px 14px',
          minHeight: '52px',
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        },
      }}
      icons={{
        success: (
          <span className="material-symbols-outlined text-emerald-500" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
        ),
        error: (
          <span className="material-symbols-outlined text-red-500" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>
            error
          </span>
        ),
        info: (
          <span className="material-symbols-outlined text-primary" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>
            info
          </span>
        ),
        warning: (
          <span className="material-symbols-outlined text-amber-500" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>
            warning
          </span>
        ),
      }}
    />
  );
}
