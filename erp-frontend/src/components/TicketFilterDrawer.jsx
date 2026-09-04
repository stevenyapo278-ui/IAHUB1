import { SlidersHorizontal, User, Sparkles, Flag, Plus, Bookmark, Trash2, Calendar, CheckCircle2, Radio, Flame, UserX } from 'lucide-react';
import FormDrawer from './FormDrawer';
import SearchableSelect from './SearchableSelect';

const QUICK_FILTERS = [
  { key: 'status', val: '', label: 'Tous les statuts', Icon: CheckCircle2 },
  { key: 'status', val: 'OPEN_GROUP', label: 'Ouverts', Icon: Radio },
  { key: 'status', val: 'CLOSED_GROUP', label: 'Clôturés', Icon: CheckCircle2 },
  { key: 'mine', val: 'true', label: 'Mes tickets', Icon: User },
  { key: 'closeSuggested', val: 'true', label: 'Clôture suggérée', Icon: Flag },
  { key: 'aiProcessed', val: 'true', label: 'Traité IA', Icon: Sparkles },
  { key: 'priority', val: 'P1', label: 'P1 Critiques', Icon: Flame },
  { key: 'assignedToId', val: 'none', label: 'Non assignés', Icon: UserX },
];

export default function TicketFilterDrawer({
  open, onClose, activeFilterCount, filters, onUpdate, onClear, teams, users,
  flatCategories, savedViews, onSaveView, onRestoreView, onDeleteSavedView,
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
      title="Filtres des tickets"
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
            options={[
              { label: 'Tous les statuts', value: '' },
              { label: 'Tous sauf clôturés (défaut)', value: 'NOT_CLOSED' },
              { label: 'Ouverts (actifs)', value: 'OPEN_GROUP' },
              { label: 'Clôturés / résolus', value: 'CLOSED_GROUP' },
              { label: 'Nouveau', value: 'NEW' },
              { label: 'En cours', value: 'OPEN' },
              { label: 'Planifié', value: 'PLANNED' },
              { label: 'En attente', value: 'PENDING' },
              { label: 'Résolu', value: 'SOLVED' },
              { label: 'Fermé', value: 'CLOSED' },
            ]}
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
            value={filters.source}
            onChange={(v) => onUpdate('source', v)}
            options={[
              { label: 'Toutes les sources', value: '' },
              { label: 'Internes ERP', value: 'erp' },
            ]}
            placeholder="Source"
            searchPlaceholder="Rechercher…"
          />

          <SearchableSelect
            value={filters.category}
            onChange={(v) => onUpdate('category', v)}
            options={[
              { label: 'Toutes les catégories', value: '' },
              ...flatCategories.map((o) => ({ label: o.label, value: o.name })),
            ]}
            placeholder="Catégorie"
            searchPlaceholder="Rechercher une catégorie…"
          />

          <SearchableSelect
            value={filters.teamId}
            onChange={(v) => onUpdate('teamId', v)}
            options={[
              { label: 'Toutes les équipes', value: '' },
              ...teams.map((t) => ({ label: t.name, value: String(t.id) })),
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
              ...users.filter((u) => u.isActive).map((u) => ({ label: u.fullName, value: String(u.id) })),
            ]}
            placeholder="Assigné à"
            searchPlaceholder="Rechercher un technicien…"
          />

          <SearchableSelect
            value={filters.approvalStatus}
            onChange={(v) => onUpdate('approvalStatus', v)}
            options={[
              { label: 'Toutes', value: '' },
              { label: 'En attente Hotline', value: 'PENDING' },
              { label: 'Approuvés', value: 'APPROVED' },
              { label: 'Rejetés', value: 'REJECTED' },
            ]}
            placeholder="Approbation"
            searchPlaceholder="Rechercher…"
          />
        </div>

        <div className="h-px bg-outline-variant/20" />

        {/* Dates */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface-variant mb-3">
            Période
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Du</label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                <input
                  type="date"
                  value={filters.dateFrom || ''}
                  onChange={(e) => onUpdate('dateFrom', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-surface border border-outline-variant/60 rounded-xl text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Au</label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                <input
                  type="date"
                  value={filters.dateTo || ''}
                  onChange={(e) => onUpdate('dateTo', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-surface border border-outline-variant/60 rounded-xl text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-outline-variant/20" />

        {/* Filtres booléens */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface-variant mb-3">
            Options
          </p>
          <div className="space-y-2">
            {[
              { key: 'mine', label: 'Mes tickets', desc: 'Tickets assignés à moi', Icon: User },
              { key: 'aiProcessed', label: 'Traité par IA', desc: "Tickets analysés par l'IA", Icon: Sparkles },
              { key: 'closeSuggested', label: 'Clôture suggérée', desc: "Clôture proposée par l'IA", Icon: Flag },
            ].map(({ key, label, desc, Icon }) => {
              const active = filters[key] === 'true';
              return (
                <button
                  key={key}
                  onClick={() => onUpdate(key, active ? '' : 'true')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer text-left ${
                    active
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  <div className={`p-1.5 rounded-lg ${active ? 'bg-primary/20' : 'bg-surface-container-high'}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{label}</p>
                    <p className={`text-[10px] mt-0.5 ${active ? 'text-primary/70' : 'text-on-surface-variant/60'}`}>{desc}</p>
                  </div>
                  <div className={`w-8 h-5 rounded-full transition-all flex items-center ${active ? 'bg-primary/30 justify-end' : 'bg-outline-variant/30 justify-start'}`}>
                    <div className={`w-4 h-4 rounded-full mx-0.5 transition-all ${active ? 'bg-primary' : 'bg-on-surface-variant/40'}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-outline-variant/20" />

        {/* Vues sauvegardées */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">
              Vues sauvegardées
            </p>
            <button
              onClick={onSaveView}
              className="flex items-center gap-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Enregistrer
            </button>
          </div>
          {savedViews.length === 0 ? (
            <p className="text-xs text-on-surface-variant/50 italic py-2">
              Aucune vue sauvegardée pour le moment.
            </p>
          ) : (
            <div className="space-y-1">
              {savedViews.map((v) => (
                <div
                  key={v.name}
                  className="group flex items-center gap-1 rounded-xl px-2.5 py-2 hover:bg-surface-container-high transition-colors"
                >
                  <button
                    onClick={() => { onRestoreView(v); onClose(); }}
                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-on-surface-variant/40 shrink-0" />
                    <span className="truncate text-[13px] font-medium text-on-surface group-hover:text-on-surface transition-colors">
                      {v.name}
                    </span>
                  </button>
                  <button
                    onClick={() => onDeleteSavedView(v.name)}
                    aria-label={`Supprimer la vue ${v.name}`}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-on-surface-variant/40 hover:text-red-500 transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </FormDrawer>
  );
}
