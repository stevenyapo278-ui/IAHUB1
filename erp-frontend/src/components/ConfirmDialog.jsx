export default function ConfirmDialog({
  open,
  title = 'Confirmer',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-none shadow-xl max-w-sm w-full p-lg">
        <h3 className="font-headline-sm text-headline-sm text-on-background mb-2">{title}</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-6">{message}</p>
        <div className="flex justify-end gap-sm">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-none border border-outline-variant text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-none border font-body-sm text-body-sm font-semibold transition-all disabled:opacity-50 ${
              danger
                ? 'border-error/30 text-error hover:bg-error/5'
                : 'border-outline-variant bg-on-surface text-surface hover:opacity-80'
            }`}
          >
            {loading ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
