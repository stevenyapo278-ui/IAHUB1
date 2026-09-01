import { motion } from 'framer-motion';
import {
  CheckCircle2, Radio, User, UserX, Flag, Sparkles, Flame, SlidersHorizontal,
  X,
} from 'lucide-react';

// ── TicketFilterBar ──────────────────────────────────────────────────────────
// Barre de filtres rapide toujours visible au-dessus du tableau.
// Affiche des raccourcis cliquables (toggle) pour les filtres les plus courants,
// les filtres actifs en tant que chips supprimables, et un bouton "Filtres avancés"
// qui ouvre le drawer existant.
const QUICK_TOGGLES = [
  { key: 'status', val: 'OPEN_GROUP', label: 'Ouverts', Icon: Radio },
  { key: 'status', val: 'CLOSED_GROUP', label: 'Clôturés', Icon: CheckCircle2 },
  { key: 'status', val: 'NOT_CLOSED', label: 'Non clôturés', Icon: CheckCircle2 },
  { key: 'priority', val: 'P1', label: 'P1', Icon: Flame },
  { key: 'mine', val: 'true', label: 'Mes tickets', Icon: User },
  { key: 'assignedToId', val: 'none', label: 'Non assignés', Icon: UserX },
  { key: 'aiProcessed', val: 'true', label: 'Traité IA', Icon: Sparkles },
  { key: 'closeSuggested', val: 'true', label: 'Clôture sugg.', Icon: Flag },
];

const STATUS_LABELS = {
  'NOT_CLOSED': 'Non clôturés',
  'OPEN_GROUP': 'Ouverts',
  'CLOSED_GROUP': 'Clôturés',
  'NEW': 'Nouveau',
  'OPEN': 'En cours',
  'PLANNED': 'Planifié',
  'PENDING': 'En attente',
  'SOLVED': 'Résolu',
  'CLOSED': 'Fermé',
};

export default function TicketFilterBar({
  filters,
  onUpdate,
  onClear,
  onOpenDrawer,
  activeFilterCount,
  teams,
  users,
  searchQuery,
  onClearSearch,
}) {
  return (
    <div className="px-4 sm:px-6 py-2 border-b border-outline-variant/20 bg-surface-container-lowest shrink-0">
      {/* ── Row 1 : Quick toggle chips ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {QUICK_TOGGLES.map(({ key, val, label, Icon }) => {
          const active = filters[key] === val;
          return (
            <button
              key={`${key}-${val}`}
              onClick={() => onUpdate(key, active ? '' : val)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                active
                  ? 'bg-primary/10 text-primary border-primary/30 shadow-sm'
                  : 'bg-transparent border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface hover:border-outline-variant/50'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}

        {/* Separator */}
        <div className="w-px h-4 bg-outline-variant/30 mx-1 shrink-0" />

        {/* Advanced filter button */}
        <button
          onClick={onOpenDrawer}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
            activeFilterCount > 0
              ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
              : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
          }`}
        >
          <SlidersHorizontal className="w-3 h-3" />
          Filtres avancés
          {activeFilterCount > 0 && (
            <span className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-primary text-white text-[8px] font-black">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Row 2 : Active filter chips (removable) ── */}
      {activeFilterCount > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-center gap-1.5 mt-2 pt-2 border-t border-outline-variant/15 flex-wrap"
        >
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest shrink-0">
            Appliqués :
          </span>

          {filters.status && (
            <ActiveChip
              label={STATUS_LABELS[filters.status] || filters.status}
              onRemove={() => onUpdate('status', '')}
            />
          )}
          {filters.priority && (
            <ActiveChip label={filters.priority} onRemove={() => onUpdate('priority', '')} />
          )}
          {filters.source && (
            <ActiveChip
              label={filters.source === 'glpi' ? 'GLPI' : 'ERP'}
              onRemove={() => onUpdate('source', '')}
            />
          )}
          {filters.teamId && (
            <ActiveChip
              label={teams.find(t => String(t.id) === filters.teamId)?.name || `Équipe #${filters.teamId}`}
              onRemove={() => onUpdate('teamId', '')}
            />
          )}
          {filters.category && (
            <ActiveChip label={filters.category} onRemove={() => onUpdate('category', '')} />
          )}
          {filters.assignedToId && (
            <ActiveChip
              label={filters.assignedToId === 'none' ? 'Non assigné' : users.find(u => String(u.id) === filters.assignedToId)?.fullName || `#${filters.assignedToId}`}
              onRemove={() => onUpdate('assignedToId', '')}
            />
          )}
          {filters.mine && (
            <ActiveChip label="Mes tickets" onRemove={() => onUpdate('mine', '')} />
          )}
          {filters.aiProcessed && (
            <ActiveChip label="Traité IA" onRemove={() => onUpdate('aiProcessed', '')} />
          )}
          {filters.approvalStatus && (
            <ActiveChip
              label={`Approbation : ${filters.approvalStatus}`}
              onRemove={() => onUpdate('approvalStatus', '')}
            />
          )}
          {filters.closeSuggested && (
            <ActiveChip label="Clôture suggérée" onRemove={() => onUpdate('closeSuggested', '')} />
          )}
          {searchQuery && (
            <ActiveChip
              label={`"${searchQuery}"`}
              onRemove={onClearSearch}
            />
          )}

          <button
            onClick={onClear}
            className="shrink-0 text-[10px] font-bold text-on-surface-variant hover:text-red-500 transition-colors flex items-center gap-0.5 whitespace-nowrap ml-1"
          >
            <X className="w-2.5 h-2.5" /> Tout effacer
          </button>
        </motion.div>
      )}
    </div>
  );
}

function ActiveChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/40 text-[11px] font-medium text-on-surface whitespace-nowrap shrink-0">
      {label}
      <button onClick={onRemove} className="p-0.5 rounded-full hover:bg-outline-variant/30 transition-colors">
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}
