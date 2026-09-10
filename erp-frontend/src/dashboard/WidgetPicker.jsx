import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Search, Check, Plus,
  BarChart3, TrendingUp, Activity, Sparkles, Users, Clock,
  PieChart, Layers, Gauge, Radar, ListChecks, Target, Zap,
  ShieldCheck, Ticket, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { WIDGET_CATALOG } from './widgetCatalog';

const ICON_MAP = {
  BarChart3,
  TrendingUp,
  Activity,
  Sparkles,
  Users,
  Clock,
  PieChart,
  Layers,
  Gauge,
  Radar,
  ListChecks,
  Target,
  Zap,
  ShieldCheck,
  Ticket,
  AlertTriangle,
  CheckCircle2,
};

const CATEGORY_ORDER = ['KPIs', 'Graphiques', 'Tableaux', 'Données'];

export default function WidgetPicker({ open, onClose, onSelect, existingWidgets = [] }) {
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const filtered = WIDGET_CATALOG.filter((w) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.category.toLowerCase().includes(q)
      );
    });

    const groups = {};
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter((w) => w.category === cat);
      if (items.length > 0) groups[cat] = items;
    }
    return groups;
  }, [search]);

  const isAdded = (type) => existingWidgets.includes(type);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-[91] w-[420px] max-w-[90vw] flex flex-col bg-surface border-l border-border shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary text-primary-foreground">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Ajouter un widget</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {WIDGET_CATALOG.length} widgets disponibles
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 shrink-0 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Rechercher un widget..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-surface-container text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              </div>
            </div>

            {/* Widget list */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {Object.keys(grouped).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Search className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-sm font-medium">Aucun widget trouvé</p>
                  <p className="text-[11px] mt-1">Essayez un autre terme de recherche</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {CATEGORY_ORDER.map((cat) => {
                    const items = grouped[cat];
                    if (!items) return null;
                    return (
                      <div key={cat}>
                        <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                          {cat}
                        </h3>
                        <div className="space-y-1.5">
                          {items.map((widget) => {
                            const IconComp = ICON_MAP[widget.icon] || BarChart3;
                            const added = isAdded(widget.type);
                            return (
                              <motion.button
                                key={widget.type}
                                whileHover={{ scale: added ? 1 : 1.01 }}
                                whileTap={{ scale: added ? 1 : 0.99 }}
                                onClick={() => {
                                  if (!added) onSelect(widget.type);
                                }}
                                disabled={added}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                                  added
                                    ? 'bg-surface-container/50 border-border/50 opacity-60 cursor-not-allowed'
                                    : 'bg-surface-container-low border-border hover:border-primary/40 hover:bg-surface-container cursor-pointer'
                                }`}
                              >
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                  added ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                                }`}>
                                  <IconComp className="w-4.5 h-4.5" />
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-foreground truncate">
                                      {widget.name}
                                    </span>
                                    {added && (
                                      <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-wider">
                                        <Check className="w-2.5 h-2.5" />
                                        Ajouté
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-muted-foreground block truncate">
                                    {widget.description}
                                  </span>
                                </div>
                                {!added && (
                                  <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                                )}
                              </motion.button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
