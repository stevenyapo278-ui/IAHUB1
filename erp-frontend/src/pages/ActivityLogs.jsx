import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../api/client';

const EVENT_META = {
  CREATED:                      { icon: 'add_task',          color: '#3b82f6', label: 'Ticket créé' },
  STATUS_CHANGED:               { icon: 'sync_alt',          color: '#8b5cf6', label: 'Statut changé' },
  PRIORITY_CHANGED:             { icon: 'priority_high',     color: '#f59e0b', label: 'Priorité changée' },
  ASSIGNED:                     { icon: 'person_pin',        color: '#6366f1', label: 'Assigné' },
  EMAIL_RECEIVED:               { icon: 'mail',              color: '#f97316', label: 'Email reçu' },
  EMAIL_SENT:                   { icon: 'send',              color: '#10b981', label: 'Email envoyé' },
  FOLLOWUP_ADDED:               { icon: 'note_add',          color: '#14b8a6', label: 'Suivi ajouté' },
  AI_ANALYZED:                  { icon: 'psychology',        color: '#a855f7', label: 'IA - Analyse' },
  AI_DRAFT_GENERATED:           { icon: 'draft',             color: '#06b6d4', label: 'IA - Brouillon généré' },
  AI_FOLLOWUP_DRAFT_GENERATED:  { icon: 'forum',             color: '#0ea5e9', label: 'IA - Brouillon suivi' },
  AI_CONVERSATION_ESCALATED:    { icon: 'warning',           color: '#ef4444', label: 'IA - Escalade conversation' },
  KNOWLEDGE_CREATED:            { icon: 'library_books',     color: '#84cc16', label: 'Article créé' },
  REOPENED:                     { icon: 'replay',            color: '#f59e0b', label: 'Réouvert' },
  ESCALATED:                    { icon: 'escalator_warning', color: '#dc2626', label: 'Escalade' },
  REMINDER_SENT:                { icon: 'notifications',     color: '#eab308', label: 'Relance envoyée' },
  CLOSED_AUTO:                  { icon: 'auto_delete',       color: '#6b7280', label: 'Fermeture auto' },
  SPLIT_NEW_ISSUE:              { icon: 'call_split',        color: '#ec4899', label: 'Scission - Nouveau ticket' },
  CREATED_FROM_SPLIT:           { icon: 'call_merge',        color: '#f43f5e', label: 'Créé depuis scission' },
  AI_LOW_CONFIDENCE_CLOSE_SKIPPED:  { icon: 'block',        color: '#9ca3af', label: 'IA - Fermeture ignorée (confiance faible)' },
  AI_LOW_CONFIDENCE_REOPEN_SKIPPED: { icon: 'block',        color: '#9ca3af', label: 'IA - Réouverture ignorée (confiance faible)' },
  AI_AUTO_REPLY_IGNORED:        { icon: 'auto_delete',       color: '#a1a1aa', label: 'IA - Réponse auto ignorée' },
  AI_LIFETIME_EXCEEDED:         { icon: 'timer_off',         color: '#ef4444', label: 'IA - Durée de vie dépassée' },
  AI_SPLIT_LIMIT_REACHED:       { icon: 'call_split',        color: '#f97316', label: 'IA - Limite scissions atteinte' },
  NEEDS_HUMAN_REVIEW:           { icon: 'contact_support',   color: '#eab308', label: 'Revue humaine nécessaire' },
  GLPI_SYNC_FAILED:             { icon: 'sync_problem',      color: '#dc2626', label: 'Sync GLPI échouée' },
};

const TYPE_OPTIONS = Object.keys(EVENT_META);

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export default function ActivityLogs() {
  const [events, setEvents] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [expandedId, setExpandedId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  function load(page = 1) {
    setLoading(true);
    const params = { page, pageSize };
    if (typeFilter) params.type = typeFilter;
    if (actorFilter) params.actor = actorFilter;
    if (searchFilter) params.search = searchFilter;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    api.get('/logs', { params })
      .then(({ data }) => {
        setEvents(data.events);
        setPagination(data.pagination);
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [pageSize]);

  function applyFilters() { load(1); }

  function resetFilters() {
    setTypeFilter('');
    setActorFilter('');
    setSearchFilter('');
    setStartDate('');
    setEndDate('');
    setPageSize(50);
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'à l\'instant';
    if (mins < 60) return `il y a ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `il y a ${days}j`;
    return formatDate(iso);
  }

  function countByType() {
    const counts = {};
    events.forEach((e) => {
      counts[e.type] = (counts[e.type] || 0) + 1;
    });
    return counts;
  }

  const typeCounts = countByType();

  const hasActiveFilters = typeFilter || actorFilter || searchFilter || startDate || endDate;

  return (
    <div className="p-lg flex flex-col gap-lg">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background font-bold">Journal d'activité</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Tous les événements de la plateforme, y compris les interactions IA.
          </p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border font-body-sm text-body-sm font-semibold transition-all duration-300 ${
            showFilters || hasActiveFilters
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-outline-variant/60 text-on-surface hover:bg-surface-container-low'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">filter_list</span>
          Filtres
          {hasActiveFilters && (
            <span className="bg-primary text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              !
            </span>
          )}
        </button>
      </header>

      {showFilters && (
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Type d'événement</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">Tous les types</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{EVENT_META[t]?.label || t}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Acteur</label>
              <input
                type="text"
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                placeholder="SYSTEM, AI, email..."
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Recherche ticket</label>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="N° ou titre..."
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Du</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Au</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-outline-variant/40">
            <div className="flex items-center gap-2">
              <label className="font-label-md text-label-md text-on-surface-variant">Lignes/page :</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-1.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={resetFilters}
                className="px-4 py-2 rounded-xl border border-outline-variant/60 text-on-surface font-body-sm hover:bg-surface-container-low transition-colors"
              >
                Réinitialiser
              </button>
              <button
                onClick={applyFilters}
                className="px-4 py-2 rounded-xl bg-primary text-white font-body-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
              >
                Appliquer
              </button>
            </div>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
            const meta = EVENT_META[type] || { icon: 'event', color: '#6b7280', label: type };
            return (
              <button
                key={type}
                onClick={() => { setTypeFilter(type === typeFilter ? '' : type); applyFilters(); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                  typeFilter === type
                    ? 'border-primary bg-primary/10 text-primary shadow-sm'
                    : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-low'
                }`}
                style={typeFilter !== type ? {} : { borderColor: meta.color, color: meta.color }}
              >
                <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                {meta.label}
                <span className="ml-0.5 opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow overflow-hidden">
        <div className="p-md border-b border-outline-variant/40 bg-surface-container-low/20 flex justify-between items-center">
          <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
            Événements
          </span>
          <span className="text-on-surface-variant text-xs font-mono-sm bg-surface-container border border-outline-variant/50 px-2.5 py-0.5 rounded-full font-medium">
            {pagination.total}
          </span>
        </div>

        {loading ? (
          <div className="p-xl text-center text-on-surface-variant">
            <span className="material-symbols-outlined text-[32px] animate-spin block mx-auto mb-2">sync</span>
            Chargement...
          </div>
        ) : events.length === 0 ? (
          <div className="p-xl text-center text-on-surface-variant font-body-md text-body-md italic">
            Aucun événement trouvé.
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/40">
            {events.map((event) => {
              const meta = EVENT_META[event.type] || { icon: 'event', color: '#6b7280', label: event.type };
              const isExpanded = expandedId === event.id;

              return (
                <div key={event.id}>
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    className="flex items-center gap-3 p-md hover:bg-surface-container-low/40 transition-colors cursor-pointer"
                  >
                    <span
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                    >
                      <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-body-sm text-body-sm text-on-surface font-semibold">{meta.label}</span>
                        {event.type.startsWith('AI_') && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-primary/10 text-primary border border-primary/20">IA</span>
                        )}
                        {event.type === 'GLPI_SYNC_FAILED' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-error/10 text-error border border-error/20">Erreur</span>
                        )}
                      </div>
                      <div className="text-body-sm text-on-surface-variant mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{event.actor}</span>
                        <span className="text-outline-variant">·</span>
                        <span>{relativeTime(event.createdAt)}</span>
                        {event.ticketId && (
                          <>
                            <span className="text-outline-variant">·</span>
                            <Link
                              to={`/tickets/${event.ticketId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-primary hover:underline font-semibold inline-flex items-center gap-0.5"
                            >
                              <span className="material-symbols-outlined text-[12px]">confirmation_number</span>
                              #{event.ticketId}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>

                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant transition-transform duration-200"
                      style={{ transform: isExpanded ? 'rotate(180deg)' : '' }}>
                      expand_more
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="px-md pb-md pl-[4.25rem] text-body-sm text-on-surface-variant space-y-2">
                      <div className="flex gap-6 flex-wrap">
                        {event.glpiTicketId && (
                          <div>
                            <span className="font-semibold text-on-surface">GLPI :</span> #{event.glpiTicketId}
                          </div>
                        )}
                        <div>
                          <span className="font-semibold text-on-surface">Acteur :</span> {event.actor}
                        </div>
                        <div>
                          <span className="font-semibold text-on-surface">Date :</span> {formatDate(event.createdAt)}
                        </div>
                        {event.payload && (
                          <div>
                            <span className="font-semibold text-on-surface">Payload :</span>
                          </div>
                        )}
                      </div>
                      {event.payload && (
                        <pre className="bg-surface border border-outline-variant/60 rounded-xl p-3 text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-md border-t border-outline-variant/40 bg-surface-container-low/20">
            <span className="text-body-sm text-on-surface-variant">
              Page {pagination.page} / {pagination.totalPages} ({pagination.total} événements)
            </span>
            <div className="flex gap-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => load(pagination.page - 1)}
                className="px-3 py-1.5 rounded-lg border border-outline-variant/60 text-on-surface font-body-sm disabled:opacity-40 hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] align-middle">chevron_left</span>
                Précédent
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => load(pagination.page + 1)}
                className="px-3 py-1.5 rounded-lg border border-outline-variant/60 text-on-surface font-body-sm disabled:opacity-40 hover:bg-surface-container-low transition-colors"
              >
                Suivant
                <span className="material-symbols-outlined text-[16px] align-middle">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
