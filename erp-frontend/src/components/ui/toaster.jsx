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
          borderRadius: '18px',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow:
            '0 8px 32px -4px rgba(0,0,0,0.14), 0 2px 8px -2px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.2)',
          backdropFilter: 'blur(24px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
          padding: '14px 16px',
          minHeight: '56px',
          cursor: 'pointer',
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
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
