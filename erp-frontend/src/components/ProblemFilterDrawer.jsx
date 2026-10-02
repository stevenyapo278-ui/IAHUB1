import { SlidersHorizontal, CheckCircle2, Radio, Clock, Flame, UserX, UserMinus } from 'lucide-react';
import FormDrawer from './FormDrawer';
import SearchableSelect from './SearchableSelect';
import DateRangePicker from './ui/date-range-picker';

// ── ProblemFilterDrawer ──────────────────────────────────────────────────────
// Tiroir « Filtres avancés » de la vue Problèmes — miroir de TicketFilterDrawer.
const STATUS_OPTIONS = [
  { label: 'Tous les statuts', value: '' },
  { label: 'Ouverts (actifs)', value: 'OPEN_GROUP' },
  { label: 'Tous sauf clôturés', value: 'NOT_CLOSED' },
  { label: 'Clôturés (résolus + fermés)', value: 'CLOSED_GROUP' },
  { label: 'Nouveau', value: 'NEW' },
  { label: 'En cours', value: 'IN_PROGRESS' },
  { label: 'Attribué', value: 'ASSIGNED' },
  { label: 'Planifié', value: 'PLANNED' },
  { label: 'En attente', value: 'WAITING' },
  { label: 'Observé', value: 'OBSERVED' },
  { label: 'Résolu', value: 'SOLVED' },
  { label: 'Fermé', value: 'CLOSED' },
];

const QUICK_FILTERS = [
  { key: 'status', val: '', label: 'Tous les statuts', Icon: CheckCircle2 },
  { key: 'status', val: 'OPEN_GROUP', label: 'Ouverts', Icon: Radio },
  { key: 'status', val: 'NOT_CLOSED', label: 'Non clôturés', Icon: Clock },
  { key: 'status', val: 'SOLVED', label: 'Résolus', Icon: CheckCircle2 },
  { key: 'status', val: 'CLOSED', label: 'Fermés', Icon: Clock },
  { key: 'priority', val: 'P1', label: 'P1 critiques', Icon: Flame },
  { key: 'assignedToId', val: 'none', label: 'Non assignés', Icon: UserX },
  { key: 'requesterId', val: 'none', label: 'Sans demandeur', Icon: UserMinus },
];

export default function ProblemFilterDrawer({
  open,
  onClose,
  activeFilterCount,
  filters,
  onUpdate,
  onClear,
  teams,
  users,
  categories,
  searchQuery,
}) {
  const footer = (
    <>
      <button onClick={onClose} className="btn-secondary">
        Annuler
      </button>
      <button
        onClick={onClear}
        disabled={activeFilterCount === 0 && !searchQuery}
        className="btn-secondary disabled:opacity-40 disabled:pointer-events-none"
      >
        Réinitialiser
      </button>
      <button onClick={onClose} className="btn-primary">
        Appliquer
      </button>
    </>
  );

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="Filtres des problèmes"
      subtitle={activeFilterCount > 0 ? `${activeFilterCount} filtre${activeFilterCount > 1 ? 's' : ''} actif${activeFilterCount > 1 ? 's' : ''}` : 'Affinez la liste selon vos critères'}
      icon={SlidersHorizontal}
      iconColor="text-primary"
      size="md"
      footer={footer}
    >
      <div className="space-y-6">

        {/* Raccourcis */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface-variant mb-2">
            Raccourcis
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK_FILTERS.map(({ key, val, label, Icon }) => {
              const active = filters[key] === val;
              return (
                <button
                  key={`${key}-${val}`}
                  onClick={() => onUpdate(key, active ? '' : val)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-outline-variant/20" />

        {/* Critères */}
        <div className="space-y-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">
            Critères
          </p>

          <SearchableSelect
            value={filters.status}
            onChange={(v) => onUpdate('status', v)}
            options={STATUS_OPTIONS}
            placeholder="Statut"
            searchPlaceholder="Rechercher un statut…"
          />

          <SearchableSelect
            value={filters.priority}
            onChange={(v) => onUpdate('priority', v)}
            options={[
              { label: 'Toutes les priorités', value: '' },
              { label: 'P1 — Critique', value: 'P1' },
              { label: 'P2 — Haute', value: 'P2' },
              { label: 'P3 — Moyenne', value: 'P3' },
              { label: 'P4 — Basse', value: 'P4' },
            ]}
            placeholder="Priorité"
            searchPlaceholder="Rechercher…"
          />

          <SearchableSelect
            value={filters.category}
            onChange={(v) => onUpdate('category', v)}
            options={[
              { label: 'Toutes les catégories', value: '' },
              ...(categories || []).map((c) => ({ label: c.name, value: c.name })),
            ]}
            placeholder="Catégorie"
            searchPlaceholder="Rechercher une catégorie…"
          />

          <SearchableSelect
            value={filters.teamId}
            onChange={(v) => onUpdate('teamId', v)}
            options={[
              { label: 'Toutes les équipes', value: '' },
              ...(teams || []).map((t) => ({ label: t.name, value: String(t.id) })),
            ]}
            placeholder="Équipe"
            searchPlaceholder="Rechercher une équipe…"
          />

          <SearchableSelect
            value={filters.assignedToId}
            onChange={(v) => onUpdate('assignedToId', v)}
            options={[
              { label: 'Tout le monde', value: '' },
              { label: 'Non assigné', value: 'none' },
              ...(users || []).filter((u) => u.isActive !== false).map((u) => ({ label: u.fullName, value: String(u.id) })),
            ]}
            placeholder="Assigné à"
            searchPlaceholder="Rechercher un technicien…"
          />

          <SearchableSelect
            value={filters.requesterId}
            onChange={(v) => onUpdate('requesterId', v)}
            options={[
              { label: 'Tous les demandeurs', value: '' },
              { label: 'Sans demandeur', value: 'none' },
              ...(users || []).filter((u) => u.isActive !== false).map((u) => ({ label: u.fullName, value: String(u.id) })),
            ]}
            placeholder="Demandeur"
            searchPlaceholder="Rechercher un demandeur…"
          />
        </div>

        <div className="h-px bg-outline-variant/20" />

        {/* Période */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface-variant mb-3">
            Période (création)
          </p>
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
        </div>
      </div>
    </FormDrawer>
  );
}
