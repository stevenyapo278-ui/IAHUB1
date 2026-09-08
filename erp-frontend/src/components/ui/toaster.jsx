import { Toaster as SonnerToaster } from 'sonner';
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export default function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      theme={theme}
      closeButton
      expand={false}
      visibleToasts={5}
      position="bottom-right"
      gap={8}
      toastOptions={{
        duration: 5000,
        style: {
          background: 'var(--color-surface)',
          color: 'var(--color-on-surface)',
          border: '1px solid var(--color-outline-variant)',
          borderRadius: '16px',
          boxShadow: '0 12px 36px -4px rgba(0, 0, 0, 0.22), 0 4px 12px -2px rgba(0, 0, 0, 0.08)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          padding: '12px 14px',
          fontSize: '13px',
          fontFamily: 'inherit',
          cursor: 'pointer',
        },
      }}
      icons={{
        success: <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />,
        error: <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />,
        info: <Info className="w-5 h-5 text-primary shrink-0" />,
        warning: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />,
      }}
    />
  );
}
