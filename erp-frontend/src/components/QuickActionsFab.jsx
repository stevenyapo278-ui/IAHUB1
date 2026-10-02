import { useNavigate } from 'react-router-dom';

// Menu « actions rapides » du rail flottant (vue pure : le déclencheur, la position
// et la fermeture sont gérés par FloatingDock.jsx, la liste par config/quickActions.js).
export default function QuickActionsMenu({ actions, style, onClose }) {
  const navigate = useNavigate();

  const run = (action) => {
    onClose();
    if (action.shortcut) {
      // Ouvre la recherche globale : GlobalSearch écoute Ctrl+K
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      return;
    }
    navigate(action.to);
  };

  return (
    <div
      style={style}
      role="menu"
      aria-label="Actions rapides"
      className="hidden md:block fixed z-40 w-56 rounded-2xl border border-outline-variant
        bg-surface-container-lowest shadow-2xl overflow-hidden"
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          onClick={() => run(action)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left
            hover:bg-surface-container-high transition-colors group"
        >
          <span className="w-8 h-8 shrink-0 rounded-lg bg-surface-container flex items-center justify-center">
            <action.icon className="w-4 h-4 text-primary" aria-hidden />
          </span>
          <span className="flex-1 text-xs font-medium text-on-surface group-hover:text-primary truncate">
            {action.label}
          </span>
          {action.shortcut && (
            <span className="text-[10px] font-semibold text-on-surface-variant border border-outline-variant rounded px-1 py-0.5">
              {action.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
