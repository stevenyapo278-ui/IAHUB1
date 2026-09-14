import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, FileSpreadsheet, FileCode2, FileText, Download,
  Check, ChevronDown, Filter, Columns3, SlidersHorizontal,
} from 'lucide-react';

const FORMATS = [
  { id: 'xlsx', label: 'Excel', ext: '.xlsx', icon: FileSpreadsheet, color: 'text-emerald-600', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', desc: 'Tableur complet' },
  { id: 'csv', label: 'CSV', ext: '.csv', icon: FileSpreadsheet, color: 'text-teal-600', bg: 'bg-teal-500/10', ring: 'ring-teal-500/30', desc: 'Separateur point-virgule' },
  { id: 'json', label: 'JSON', ext: '.json', icon: FileCode2, color: 'text-blue-600', bg: 'bg-blue-500/10', ring: 'ring-blue-500/30', desc: 'Données brutes structurées' },
  { id: 'pdf', label: 'PDF', ext: '.pdf', icon: FileText, color: 'text-rose-600', bg: 'bg-rose-500/10', ring: 'ring-rose-500/30', desc: 'Rapport formaté' },
];

const ALL_COLUMNS = [
  { key: 'numero', label: 'N° ticket' },
  { key: 'title', label: 'Titre' },
  { key: 'status', label: 'Statut' },
  { key: 'priority', label: 'Priorité' },
  { key: 'category', label: 'Catégorie' },
  { key: 'assignedTo', label: 'Assigné à' },
  { key: 'team', label: 'Équipe' },
  { key: 'requester', label: 'Demandeur' },
  { key: 'location', label: 'Lieu' },
  { key: 'observers', label: 'Observateurs' },
  { key: 'source', label: 'Source' },
  { key: 'createdAt', label: 'Date ouverture' },
  { key: 'updatedAt', label: 'Dernière MAJ' },
  { key: 'solvedAt', label: 'Date résolution' },
  { key: 'closedAt', label: 'Date fermeture' },
];

const FILTER_LABELS = {
  status: 'Statut',
  priority: 'Priorité',
  category: 'Catégorie',
  teamId: 'Équipe',
  assignedToId: 'Assigné à',
  source: 'Source',
  origin: 'Origine',
  approvalStatus: 'Approbation IA',
  aiProcessed: 'Traité par IA',
  closeSuggested: 'Fermeture suggérée',
  mine: 'Mes tickets',
  dateFrom: 'Date début',
  dateTo: 'Date fin',
};

export default function ExportModal({ open, onClose, onExport, filters = {}, searchQuery = '', totalFiltered = 0 }) {
  const [format, setFormat] = useState('xlsx');
  const [scope, setScope] = useState('filtered'); // 'filtered' | 'all'
  const [selectedCols, setSelectedCols] = useState(() => new Set(
    ALL_COLUMNS.filter((c) => ['numero', 'title', 'status', 'priority', 'assignedTo', 'requester', 'createdAt', 'updatedAt'].includes(c.key)).map((c) => c.key)
  ));
  const [showColumns, setShowColumns] = useState(true);
  const [exporting, setExporting] = useState(false);

  const activeFilters = useMemo(() => {
    const entries = [];
    for (const [key, label] of Object.entries(FILTER_LABELS)) {
      const v = filters[key];
      if (v !== undefined && v !== '' && v !== null) {
        entries.push({ key, label, value: v });
      }
    }
    if (searchQuery) entries.push({ key: 'search', label: 'Recherche', value: `"${searchQuery}"` });
    return entries;
  }, [filters, searchQuery]);

  const hasActiveFilters = activeFilters.length > 0;

  function toggleCol(key) {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllCols() {
    if (selectedCols.size === ALL_COLUMNS.length) setSelectedCols(new Set());
    else setSelectedCols(new Set(ALL_COLUMNS.map((c) => c.key)));
  }

  async function handleExport() {
    setExporting(true);
    try {
      await onExport({
        format,
        scope,
        columns: [...selectedCols],
      });
      onClose();
    } finally {
      setExporting(false);
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={exporting ? undefined : onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Download className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Exporter les tickets</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {totalFiltered.toLocaleString('fr-FR')} ticket{totalFiltered > 1 ? 's' : ''} dans la sélection
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={exporting}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5 max-h-[65vh] overflow-y-auto">
              {/* Format selection */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5 block">
                  Format
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {FORMATS.map((f) => {
                    const active = format === f.id;
                    return (
                      <motion.button
                        key={f.id}
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setFormat(f.id)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                          active
                            ? `${f.bg} ${f.ring} ring-2 border-transparent`
                            : 'border-border/40 hover:border-border bg-surface-container-low'
                        }`}
                      >
                        <f.icon className={`w-5 h-5 ${active ? f.color : 'text-muted-foreground'}`} />
                        <span className={`text-[11px] font-bold ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {f.label}
                        </span>
                        <span className="text-[9px] text-muted-foreground/60">{f.ext}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Scope */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5 block">
                  Données à exporter
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setScope('filtered')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left cursor-pointer ${
                      scope === 'filtered'
                        ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border/40 hover:border-border bg-surface-container-low'
                    }`}
                  >
                    <SlidersHorizontal className={`w-4 h-4 shrink-0 ${scope === 'filtered' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div>
                      <div className={`text-xs font-semibold ${scope === 'filtered' ? 'text-foreground' : 'text-muted-foreground'}`}>
                        Filtres actuels
                      </div>
                      <div className="text-[10px] text-muted-foreground/70">
                        {totalFiltered.toLocaleString('fr-FR')} tickets
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left cursor-pointer ${
                      scope === 'all'
                        ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border/40 hover:border-border bg-surface-container-low'
                    }`}
                  >
                    <Download className={`w-4 h-4 shrink-0 ${scope === 'all' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div>
                      <div className={`text-xs font-semibold ${scope === 'all' ? 'text-foreground' : 'text-muted-foreground'}`}>
                        Tout exporter
                      </div>
                      <div className="text-[10px] text-muted-foreground/70">
                        Ignorer les filtres
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Active filters summary */}
              {scope === 'filtered' && hasActiveFilters && (
                <div className="p-3 rounded-xl bg-surface-container-low border border-border/40">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Filter className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Filtres actifs
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeFilters.map((f) => (
                      <span
                        key={f.key}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/8 text-primary text-[10px] font-semibold"
                      >
                        {f.label}: {f.value}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Columns */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowColumns(!showColumns)}
                  className="flex items-center gap-2 mb-2.5 cursor-pointer group"
                >
                  <Columns3 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Colonnes à inclure
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 ml-1">
                    ({selectedCols.size}/{ALL_COLUMNS.length})
                  </span>
                  <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${showColumns ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {showColumns && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <button
                          type="button"
                          onClick={toggleAllCols}
                          className="text-[10px] text-primary hover:text-primary/80 font-semibold cursor-pointer"
                        >
                          {selectedCols.size === ALL_COLUMNS.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {ALL_COLUMNS.map((col) => {
                          const active = selectedCols.has(col.key);
                          return (
                            <button
                              key={col.key}
                              type="button"
                              onClick={() => toggleCol(col.key)}
                              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                                active
                                  ? 'bg-primary/8 text-foreground'
                                  : 'text-muted-foreground hover:bg-surface-container-low'
                              }`}
                            >
                              <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-all ${
                                active
                                  ? 'bg-primary border-primary text-white'
                                  : 'border-border/60'
                              }`}>
                                {active && <Check className="w-2.5 h-2.5" />}
                              </span>
                              <span className="text-xs font-medium truncate">{col.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface-container-low/50">
              <button
                type="button"
                onClick={onClose}
                disabled={exporting}
                className="px-4 py-2 rounded-xl border border-border bg-surface text-foreground text-xs font-semibold hover:bg-surface-container-low transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleExport}
                disabled={exporting || selectedCols.size === 0}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-sm shadow-primary/20 hover:shadow-md transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {exporting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Génération...
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Exporter ({FORMATS.find((f) => f.id === format)?.ext})
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
