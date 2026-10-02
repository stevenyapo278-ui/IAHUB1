import { motion } from 'framer-motion';
import {
  CheckCircle2, Radio, Flame, SlidersHorizontal, X, Search, UserX, UserMinus, Clock,
} from 'lucide-react';
import DateRangePicker from './ui/date-range-picker';

// ── ProblemFilterBar ──────────────────────────────────────────────────────────
// Barre de filtres rapide toujours visible au-dessus du tableau des problèmes.
// Miroir de TicketFilterBar (vue Tickets) : recherche, puces de filtres rapides,
// plage de dates, bouton « Filtres avancés » et puces des filtres actifs.
const QUICK_TOGGLES = [
  { key: 'status', val: 'OPEN_GROUP', label: 'Ouverts', Icon: Radio },
  { key: 'status', val: 'NOT_CLOSED', label: 'Non clôturés', Icon: CheckCircle2 },
  { key: 'status', val: 'SOLVED', label: 'Résolus', Icon: CheckCircle2 },
  { key: 'status', val: 'CLOSED', label: 'Fermés', Icon: Clock },
  { key: 'priority', val: 'P1', label: 'P1', Icon: Flame },
  { key: 'assignedToId', val: 'none', label: 'Non assignés', Icon: UserX },
  { key: 'requesterId', val: 'none', label: 'Sans demandeur', Icon: UserMinus },
];

const STATUS_LABELS = {
  OPEN_GROUP: 'Ouverts',
  NOT_CLOSED: 'Non clôturés',
  CLOSED_GROUP: 'Clôturés',
  NEW: 'Nouveau',
  IN_PROGRESS: 'En cours',
  ASSIGNED: 'Attribué',
  PLANNED: 'Planifié',
  WAITING: 'En attente',
  OBSERVED: 'Observé',
  SOLVED: 'Résolu',
  CLOSED: 'Fermé',
};

// Un filtre statut peut être un statut simple ou une liste CSV (groupes)
function statusLabel(value) {
  return String(value).split(',').map((s) => STATUS_LABELS[s.trim()] || s.trim()).join(' + ');
}

function shortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ProblemFilterBar({
  filters,
  onUpdate,
  onClear,
  onOpenDrawer,
  activeFilterCount,
  teams,
  users,
  searchQuery,
  onSearchChange,
  onClearSearch,
  searchInputRef,
}) {
  const userLabel = (value, fallback) => {
    if (value === 'none') return fallback;
    const found = users?.find((u) => String(u.id) === String(value));
    return found?.fullName || `#${value}`;
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 shrink-0">
      <div className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
      {/* ── Ligne 1 : recherche + puces rapides + période + filtres avancés ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Recherche (debounce côté page) */}
        <div className="relative shrink-0 mr-1 flex-1 sm:flex-initial">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery || ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="Rechercher (#N°, titre, description, demandeur, assigné...)"
            className="w-full sm:w-80 md:w-96 pl-8 pr-7 py-1.5 text-xs bg-surface border border-outline-variant/60 rounded-xl text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {searchQuery && (
            <button
              onClick={onClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-on-surface-variant/60 hover:text-on-surface"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filtres rapides */}
        {QUICK_TOGGLES.map(({ key, val, label, Icon }) => {
          const active = filters[key] === val;
          return (
            <button
              key={`${key}-${val}`}
              onClick={() => onUpdate(key, active ? '' : val)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                active
                  ? 'bg-primary/10 text-primary border-primary/30 shadow-xs'
                  : 'bg-surface border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}

        <div className="w-px h-4 bg-outline-variant/30 mx-1 shrink-0" />

        {/* Période de création */}
        <DateRangePicker
          value={{
            from: filters.dateFrom ? new Date(filters.dateFrom) : null,
            to: filters.dateTo ? new Date(filters.dateTo) : null,
          }}
          onChange={({ from, to }) => {
            onUpdate('dateFrom', from ? from.toISOString().slice(0, 10) : '');
            onUpdate('dateTo', to ? to.toISOString().slice(0, 10) : '');
          }}
          presets={false}
        />

        <div className="w-px h-4 bg-outline-variant/30 mx-1 shrink-0" />

        {/* Filtres avancés */}
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

      {/* ── Ligne 2 : puces des filtres actifs (retirables) ── */}
      {activeFilterCount > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center gap-1.5 mt-2 pt-2 border-t border-outline-variant/15 flex-wrap"
        >
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest shrink-0">
            Appliqués :
          </span>

          {filters.status && (
            <ActiveChip label={statusLabel(filters.status)} onRemove={() => onUpdate('status', '')} />
          )}
          {filters.priority && (
            <ActiveChip label={filters.priority} onRemove={() => onUpdate('priority', '')} />
          )}
          {filters.category && (
            <ActiveChip label={filters.category} onRemove={() => onUpdate('category', '')} />
          )}
          {filters.teamId && (
            <ActiveChip
              label={teams?.find((t) => String(t.id) === String(filters.teamId))?.name || `Équipe #${filters.teamId}`}
              onRemove={() => onUpdate('teamId', '')}
            />
          )}
          {filters.assignedToId && (
            <ActiveChip
              label={userLabel(filters.assignedToId, 'Non assigné')}
              onRemove={() => onUpdate('assignedToId', '')}
            />
          )}
          {filters.requesterId && (
            <ActiveChip
              label={userLabel(filters.requesterId, 'Sans demandeur')}
              onRemove={() => onUpdate('requesterId', '')}
            />
          )}
          {(filters.dateFrom || filters.dateTo) && (
            <ActiveChip
              label={`Période${filters.dateFrom ? ` du ${shortDate(filters.dateFrom)}` : ''}${filters.dateTo ? ` au ${shortDate(filters.dateTo)}` : ''}`}
              onRemove={() => { onUpdate('dateFrom', ''); onUpdate('dateTo', ''); }}
            />
          )}
          {searchQuery && (
            <ActiveChip label={`"${searchQuery}"`} onRemove={onClearSearch} />
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
