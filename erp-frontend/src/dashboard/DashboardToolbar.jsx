import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Pencil, Plus, Download, X, Check,
  ChevronDown, RotateCcw, Trash2,
} from 'lucide-react';

const PERIODS = [
  { key: '7d', label: '7 jours', days: 7 },
  { key: '30d', label: '30 jours', days: 30 },
  { key: '90d', label: '3 mois', days: 90 },
  { key: '180d', label: '6 mois', days: 180 },
];

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-surface-container border border-outline-variant/30">
      {options.map((opt) => {
        const isActive = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              isActive
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function DashboardToolbar({
  dashboards = [],
  activeDashboardId,
  onSelectDashboard,
  onCreateDashboard,
  onRenameDashboard,
  onDeleteDashboard,
  isEditing,
  onToggleEdit,
  onAddWidget,
  onReset,
  resetting = false,
  activePeriod,
  onPeriodChange,
  onDownloadReport,
  reportLoading,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const dropdownRef = useRef(null);
  const editInputRef = useRef(null);

  const activeDashboard = dashboards.find((d) => d.id === activeDashboardId);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
        setEditingId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus l'input dès l'entrée en mode renommage
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startRename = (dashboard) => {
    setEditingId(dashboard.id);
    setEditName(dashboard.name);
  };

  const commitRename = () => {
    if (editingId && editName.trim() && editName.trim() !== dashboards.find((d) => d.id === editingId)?.name) {
      onRenameDashboard?.(editingId, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="p-4 sm:p-5 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: Dashboard selector + New dashboard */}
        <div className="flex items-center gap-2.5">
          {/* Dashboard dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container transition-colors text-sm font-semibold text-on-surface"
            >
              <LayoutDashboard className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate max-w-[180px]">
                {activeDashboard?.name || 'Sélectionner'}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-on-surface-variant transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 mt-1.5 w-64 rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl z-50 overflow-hidden"
                >
                  <div className="p-1 max-h-60 overflow-y-auto">
                    {dashboards.length === 0 ? (
                      <p className="text-xs text-on-surface-variant text-center py-4 px-3">
                        Aucun dashboard disponible
                      </p>
                    ) : (
                      dashboards.map((d) => (
                        editingId === d.id ? (
                          /* ── Mode renommage : input inline ── */
                          <div key={d.id} className="flex items-center gap-1.5 px-2 py-1.5">
                            <input
                              ref={editInputRef}
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename();
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              maxLength={60}
                              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-primary/40 bg-surface text-xs font-medium text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <button
                              type="button"
                              title="Enregistrer"
                              onClick={(e) => { e.stopPropagation(); commitRename(); }}
                              className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Annuler"
                              onClick={(e) => { e.stopPropagation(); setEditingId(null); }}
                              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          /* ── Ligne normale : sélection + renommer + supprimer ── */
                          <div
                            key={d.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              onSelectDashboard(d.id);
                              setDropdownOpen(false);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                onSelectDashboard(d.id);
                                setDropdownOpen(false);
                              }
                            }}
                            className={`group w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left cursor-pointer transition-colors ${
                              d.id === activeDashboardId
                                ? 'bg-primary/10 text-primary'
                                : 'text-on-surface hover:bg-surface-container-high'
                            }`}
                          >
                            <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                            <span className="text-xs font-medium truncate flex-1">{d.name}</span>
                            <span
                              className="hidden group-hover:flex items-center gap-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                title="Renommer"
                                onClick={(e) => { e.stopPropagation(); startRename(d); }}
                                className="p-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                title="Supprimer ce tableau de bord"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDropdownOpen(false);
                                  setEditingId(null);
                                  onDeleteDashboard?.(d.id);
                                }}
                                className="p-1 rounded-md text-on-surface-variant hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </span>
                            {d.id === activeDashboardId && (
                              <Check className="w-3.5 h-3.5 shrink-0 group-hover:hidden" />
                            )}
                          </div>
                        )
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* New dashboard button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCreateDashboard}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau</span>
          </motion.button>
        </div>

        {/* Right: Edit mode, Add widget, Period, Download */}
        <div className="flex items-center gap-2.5">
          {/* Edit mode badge */}
          <AnimatePresence>
            {isEditing && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase tracking-wider border border-blue-500/20"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Mode édition
              </motion.span>
            )}
          </AnimatePresence>

          {/* Add widget button (edit mode only) */}
          <AnimatePresence>
            {isEditing && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onAddWidget}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                Widget
              </motion.button>
            )}
          </AnimatePresence>

          {/* Edit mode toggle */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onToggleEdit}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all ${
              isEditing
                ? 'bg-primary text-on-primary shadow-sm shadow-primary/20'
                : 'border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {isEditing ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Terminé</span>
              </>
            ) : (
              <>
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Éditer</span>
              </>
            )}
          </motion.button>

          {/* Reset to default layout */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onReset}
            disabled={resetting || dashboards.length === 0}
            title="Restaurer le tableau de bord par défaut (remplace les widgets actuels)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{resetting ? 'Réinitialisation…' : 'Réinitialiser'}</span>
          </motion.button>

          {/* Period selector */}
          <SegmentedControl options={PERIODS} value={activePeriod} onChange={onPeriodChange} />

          {/* Download PDF */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onDownloadReport}
            disabled={reportLoading}
            className="px-3.5 py-2 rounded-xl bg-primary text-on-primary font-bold text-xs shadow-sm shadow-primary/20 hover:shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {reportLoading ? 'Génération...' : 'Rapport PDF'}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
