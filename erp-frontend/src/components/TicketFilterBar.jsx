import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2, Radio, User, UserX, Flag, Sparkles, Flame, SlidersHorizontal,
  X, Search, Users, CornerDownLeft, Hash,
} from 'lucide-react';
import DateRangePicker from './ui/date-range-picker';
import api from '../api/client';

// ── TicketFilterBar ──────────────────────────────────────────────────────────
// Barre de filtres rapide toujours visible au-dessus du tableau.
const QUICK_TOGGLES = [
  { key: 'status', val: 'OPEN_GROUP',  label: 'Ouverts',      Icon: Radio },
  { key: 'status', val: 'CLOSED_GROUP',label: 'Clôturés',     Icon: CheckCircle2 },
  { key: 'status', val: 'NOT_CLOSED',  label: 'Non clôturés', Icon: CheckCircle2 },
  { key: 'priority', val: 'P1',        label: 'P1',           Icon: Flame },
  { key: 'assignedToId', val: 'none',  label: 'Non assignés', Icon: UserX },
  { key: 'aiProcessed', val: 'true',   label: 'Traité IA',    Icon: Sparkles },
  { key: 'closeSuggested', val: 'true',label: 'Clôture sugg.',Icon: Flag },
];

const STATUS_LABELS = {
  'NOT_CLOSED':      'Non clôturés',
  'OPEN_GROUP':      'Ouverts',
  'PENDING_GROUP':   'En attente',
  'CLOSED_GROUP':    'Clôturés',
  'NEW':             'Nouveau',
  'OPEN':            'En cours',
  'PLANNED':         'Planifié',
  'PENDING':         'En attente',
  'WAITING_FOR_USER':'En attente demandeur',
  'SOLVED':          'Résolu',
  'CLOSED':          'Fermé',
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
  onSearchChange,
  onClearSearch,
  searchInputRef,
  // Contexte utilisateur pour les filtres personnalisés
  currentUser,
  // Compteurs de facettes (/tickets/facets) — ignorés si absents
  facets,
  // Navigation vers le détail d'un ticket (suggestions)
  onSelectTicket,
}) {
  // ── Suggestions de recherche (autocomplétion) ──
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const suggestionsRef = useRef(null);
  const suggestionsTimerRef = useRef(null);
  const skipNextFetchRef = useRef(false);

  // Fetch suggestions avec debounce (300 ms)
  useEffect(() => {
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
    if (suggestionsTimerRef.current) clearTimeout(suggestionsTimerRef.current);
    const q = (searchQuery || '').trim();
    if (q.length < 2) { setSuggestions([]); setSuggestionsOpen(false); return; }
    suggestionsTimerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/tickets/search-suggestions', { params: { q } });
        setSuggestions(data.items || []);
        setSuggestionsOpen(true);
        setActiveSuggestion(-1);
      } catch { setSuggestions([]); }
    }, 300);
    return () => clearTimeout(suggestionsTimerRef.current);
  }, [searchQuery]);

  // Fermer au clic extérieur
  useEffect(() => {
    if (!suggestionsOpen) return;
    function onClick(e) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) setSuggestionsOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [suggestionsOpen]);

  function selectSuggestion(t) {
    skipNextFetchRef.current = true;
    setSuggestionsOpen(false);
    if (onSelectTicket) onSelectTicket(t.id);
  }

  function handleSuggestionKeyDown(e) {
    if (!suggestionsOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setSuggestionsOpen(false);
    }
  }

  // Compteur d'un quick toggle : ignore le filtre de sa propre dimension (côté serveur)
  const quickCount = (key, val) => {
    if (!facets) return undefined;
    if (key === 'priority') return facets.priority?.[val];
    if (key === 'status') return facets.groups?.[val] ?? facets.status?.[val];
    if (key === 'assignedToId' && val === 'none') return facets.flags?.unassigned;
    if (key === 'aiProcessed') return facets.flags?.aiProcessed;
    if (key === 'closeSuggested') return facets.flags?.closeSuggested;
    return undefined;
  };
  // Équipe du technicien connecté (si applicable)
  const myTeam = currentUser?.role === 'TECHNICIAN' && currentUser?.teamId
    ? teams?.find((t) => t.id === currentUser.teamId)
    : null;

  // Le filtre "Mon équipe" est actif quand teamId = mon équipe
  const myTeamActive = myTeam && String(filters.teamId) === String(myTeam.id);
  // Le filtre "Mes tickets" est actif
  const mineActive = filters.mine === 'true';

  return (
    <div className="px-4 sm:px-6 lg:px-8 shrink-0">
      <div className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
      {/* ── Row 1 : Search + Quick toggle chips + Advanced filters ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Live Search Input + Suggestions */}
        <div className="relative shrink-0 mr-1 flex-1 sm:flex-initial" ref={suggestionsRef}>
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 z-10" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery || ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setSuggestionsOpen(true); }}
            onKeyDown={handleSuggestionKeyDown}
            placeholder="Rechercher (#ID, titre, demandeur, assigné, lieu, équipe...) ⌘K"
            className="w-full sm:w-80 md:w-96 pl-8 pr-7 py-1.5 text-xs bg-surface border border-outline-variant/60 rounded-xl text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {searchQuery && (
            <button
              onClick={onClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-on-surface-variant/60 hover:text-on-surface z-10"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          {/* Dropdown suggestions */}
          {suggestionsOpen && suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-full sm:w-80 md:w-96 max-h-80 overflow-y-auto bg-surface border border-outline-variant/50 rounded-xl shadow-lg z-50 py-1">
              {suggestions.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectSuggestion(t)}
                  onMouseEnter={() => setActiveSuggestion(i)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors cursor-pointer ${
                    i === activeSuggestion ? 'bg-primary/10' : 'hover:bg-surface-container-high'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5 mt-0.5 shrink-0 text-on-surface-variant/50" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-on-surface truncate">
                      <span className="text-primary">#{t.id}</span> {t.title}
                    </p>
                    <p className="text-[10px] text-on-surface-variant truncate mt-0.5">
                      {[t.requester?.fullName, t.assignedTo?.fullName, t.team?.name, t.category].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className={`shrink-0 mt-0.5 w-2 h-2 rounded-full ${
                    t.priority === 'P1' ? 'bg-red-500' : t.priority === 'P2' ? 'bg-orange-400' : t.priority === 'P3' ? 'bg-blue-400' : 'bg-gray-300'
                  }`} title={t.priority} />
                </button>
              ))}
              <div className="border-t border-outline-variant/30 mt-1 pt-1.5 px-3 flex items-center gap-1.5 text-[10px] text-on-surface-variant/60">
                <CornerDownLeft className="w-3 h-3" /> ouvrir · <span className="font-mono">↑↓</span> naviguer · <span className="font-mono">Entrée</span> ouvrir
              </div>
            </div>
          )}
        </div>

        {/* ── Filtres contextuels TECHNICIAN ── */}
        {currentUser?.role === 'TECHNICIAN' && (
          <>
            {/* Séparateur visuel */}
            <div className="w-px h-4 bg-outline-variant/30 shrink-0" />

            {/* Mes tickets */}
            <button
              onClick={() => onUpdate('mine', mineActive ? '' : 'true')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                mineActive
                  ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 shadow-xs'
                  : 'bg-surface border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
              title="Voir seulement les tickets qui me sont assignés ou que j'ai créés"
            >
              <User className="w-3 h-3" />
              Mes tickets
            </button>

            {/* Mon équipe — affiché seulement si le technicien appartient à une équipe */}
            {myTeam && (
              <button
                onClick={() => onUpdate('teamId', myTeamActive ? '' : String(myTeam.id))}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer shrink-0 ${
                  myTeamActive
                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30 shadow-xs'
                    : 'bg-surface border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                }`}
                title={`Voir seulement les tickets de mon équipe : ${myTeam.name}`}
              >
                <Users className="w-3 h-3" />
                {myTeam.name}
              </button>
            )}

            <div className="w-px h-4 bg-outline-variant/30 shrink-0" />
          </>
        )}

        {/* ── Filtres rapides généraux ── */}
        {QUICK_TOGGLES.map(({ key, val, label, Icon }) => {
          const active = filters[key] === val;
          const count = quickCount(key, val);
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
              {count !== undefined && (
                <span className={`ml-0.5 px-1 py-px rounded-md text-[10px] font-bold tabular-nums ${
                  active ? 'bg-primary/15 text-primary' : 'bg-surface-muted text-on-surface-variant/70'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        {/* Separator */}
        <div className="w-px h-4 bg-outline-variant/30 mx-1 shrink-0" />

        {/* Date range picker */}
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
          {filters.origin && (
            <ActiveChip
              label={{ MANUAL: 'Manuel', PORTAIL: 'Portail', EMAIL: 'Email', CHATBOT: 'Chatbot' }[filters.origin] || filters.origin}
              onRemove={() => onUpdate('origin', '')}
            />
          )}
          {filters.teamId && (
            <ActiveChip
              label={teams?.find(t => String(t.id) === filters.teamId)?.name || `Équipe #${filters.teamId}`}
              onRemove={() => onUpdate('teamId', '')}
            />
          )}
          {filters.category && (
            <ActiveChip label={filters.category} onRemove={() => onUpdate('category', '')} />
          )}
          {filters.assignedToId && (
            <ActiveChip
              label={filters.assignedToId === 'none' ? 'Non assigné' : users?.find(u => String(u.id) === filters.assignedToId)?.fullName || `#${filters.assignedToId}`}
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
          {filters.slaBreached && (
            <ActiveChip label="SLA dépassé" onRemove={() => onUpdate('slaBreached', '')} />
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
