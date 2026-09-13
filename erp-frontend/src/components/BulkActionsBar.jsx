import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export default function BulkActionsBar({ count, filteredCount, children, onClear }) {
  const label = filteredCount && filteredCount > count
    ? `${count} sélectionné${count > 1 ? 's' : ''} sur ${filteredCount.toLocaleString('fr-FR')}`
    : `${count} sélectionné${count > 1 ? 's' : ''}`;

  return (
    <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border border-border/30 bg-surface shadow-2xl shadow-black/20 max-w-full">
      <span className="text-xs font-bold text-muted-foreground pr-2 border-r border-border/30 mr-1 whitespace-nowrap">
        {label}
      </span>
      {children}
      <button onClick={onClear}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all">
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}
