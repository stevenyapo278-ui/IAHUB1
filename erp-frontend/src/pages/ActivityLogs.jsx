import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useFilterParam } from '../hooks/useFilterParam';
import PageShell from '../components/PageShell';
import Pagination from '../components/Pagination';
import {
  Activity, Search, Filter, Calendar, RefreshCw, ChevronDown,
  Sparkles, Mail, Send, CheckCircle2, AlertTriangle, XCircle, Clock,
  FileText, ArrowUpRight, Bot, X, User
} from 'lucide-react';

const EVENT_META = {
  CREATED:                      { icon: Activity,         color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   label: 'Ticket créé' },
  STATUS_CHANGED:               { icon: RefreshCw,        color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20', label: 'Statut changé' },
  PRIORITY_CHANGED:             { icon: AlertTriangle,    color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20',  label: 'Priorité changée' },
  ASSIGNED:                     { icon: User,             color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', label: 'Assigné' },
  EMAIL_RECEIVED:               { icon: Mail,             color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', label: 'Email reçu' },
  EMAIL_SENT:                   { icon: Send,             color: 'text-emerald-600 dark:text-emerald-400',bg: 'bg-emerald-500/10',border: 'border-emerald-500/20',label: 'Email envoyé' },
  FOLLOWUP_ADDED:               { icon: FileText,         color: 'text-teal-600 dark:text-teal-400',   bg: 'bg-teal-500/10',   border: 'border-teal-500/20',   label: 'Suivi ajouté' },
  AI_ANALYZED:                  { icon: Sparkles,         color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20', label: 'IA - Analyse' },
  AI_DRAFT_GENERATED:           { icon: Bot,              color: 'text-cyan-600 dark:text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20',   label: 'IA - Brouillon généré' },
  AI_FOLLOWUP_DRAFT_GENERATED:  { icon: Bot,              color: 'text-sky-600 dark:text-sky-400',    bg: 'bg-sky-500/10',    border: 'border-sky-500/20',    label: 'IA - Brouillon suivi' },
  AI_CONVERSATION_ESCALATED:    { icon: AlertTriangle,    color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    label: 'IA - Escalade conversation' },
  KNOWLEDGE_CREATED:            { icon: FileText,         color: 'text-lime-600 dark:text-lime-400',   bg: 'bg-lime-500/10',   border: 'border-lime-500/20',   label: 'Article créé' },
  REOPENED:                     { icon: RefreshCw,        color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20',  label: 'Réouvert' },
  ESCALATED:                    { icon: AlertTriangle,    color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    label: 'Escalade' },
  REMINDER_SENT:                { icon: Clock,            color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', label: 'Relance envoyée' },
  CLOSED_AUTO:                  { icon: CheckCircle2,     color: 'text-slate-600 dark:text-zinc-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20',   label: 'Fermeture auto' },
  GLPI_SYNC_FAILED:             { icon: XCircle,          color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    label: 'Sync GLPI échouée' },
  APPROVED:                     { icon: CheckCircle2,     color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Approuvé' },
  REJECTED:                     { icon: XCircle,          color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    label: 'Rejeté' },
  NEEDS_HUMAN_REVIEW:           { icon: AlertTriangle,    color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10',  border: 'border-amber-500/20',  label: 'Revue humaine nécessaire' },
  MAJOR_INCIDENT_PROMOTED:      { icon: AlertTriangle,    color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    label: 'Incident majeur promu' },
  SPLIT_NEW_ISSUE:              { icon: ArrowUpRight,     color: 'text-blue-600 dark:text-blue-400',  bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   label: 'Scission nouveau ticket' },
  CREATED_FROM_SPLIT:           { icon: Activity,         color: 'text-blue-600 dark:text-blue-400',  bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   label: 'Créé depuis scission' },
  AI_AUTO_REPLY_IGNORED:        { icon: Bot,              color: 'text-slate-600 dark:text-zinc-400', bg: 'bg-slate-500/10',  border: 'border-slate-500/20',  label: 'IA - Reply ignoré' },
  AI_LOW_CONFIDENCE_CLOSE_SKIPPED: { icon: Bot,           color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', label: 'IA - Fermeture skip (conf faible)' },
  AI_LIFETIME_EXCEEDED:         { icon: Bot,              color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', label: 'IA - Durée de vie dépassée' },
  AI_SPLIT_LIMIT_REACHED:       { icon: Bot,              color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    label: 'IA - Limite scissions atteinte' },
};

const TYPE_OPTIONS = Object.keys(EVENT_META);
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export default function ActivityLogs() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [events, setEvents] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useFilterParam('type');
  const [actorFilter, setActorFilter] = useFilterParam('actor');
  const [searchFilter, setSearchFilter] = useFilterParam('search');
  const [startDate, setStartDate] = useFilterParam('startDate');
  const [endDate, setEndDate] = useFilterParam('endDate');
  const [pageSize, setPageSize] = useFilterParam('pageSize', '50');
  const [expandedId, setExpandedId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  function load(page = 1) {
    setLoading(true);
    const pageSizeNum = parseInt(pageSize, 10) || 50;
    const params = { page, pageSize: pageSizeNum };
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

  useEffect(() => { load(); }, [typeFilter, actorFilter, searchFilter, startDate, endDate, pageSize]);

  function applyFilters() { load(1); }

  function resetFilters() {
    setTypeFilter('');
    setActorFilter('');
    setSearchFilter('');
    setStartDate('');
    setEndDate('');
    setPageSize('50');
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

  const hasActiveFilters = typeFilter || actorFilter || searchFilter || startDate || endDate;

  return (
    <PageShell
      icon={Activity}
      iconColor="text-blue-400"
      title="Journal d'activité"
      subtitle={`${pagination.total} événement${pagination.total !== 1 ? 's' : ''} enregistrés`}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
              showFilters || hasActiveFilters
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                : 'btn-secondary'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filtres</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
            )}
          </button>
        </div>
      }
    >

      {/* ── Advanced Filters Strip ───────────────────────────────────────────── */}
      {/* Inline search (mobile) */}
      <div className="relative flex-1 max-w-xs sm:hidden mb-2">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
        <input
          type="text"
          placeholder="Rechercher..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
          className="input-katalyst pl-8 pr-8 py-2 text-xs"
        />
      </div>
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low/40 mb-4"
          >
            <div className="px-4 py-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <label className="field-label">
                  <span>Type d'événement</span>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="input-katalyst"
                  >
                    <option value="">Tous les types</option>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{EVENT_META[t]?.label || t}</option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  <span>Acteur</span>
                  <input
                    type="text"
                    value={actorFilter}
                    onChange={(e) => setActorFilter(e.target.value)}
                    placeholder="SYSTEM, AI, email..."
                    className="input-katalyst"
                  />
                </label>

                <label className="field-label">
                  <span>Du</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="input-katalyst"
                  />
                </label>

                <label className="field-label">
                  <span>Au</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="input-katalyst"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-outline-variant/15">
                <button
                  onClick={resetFilters}
                  className="text-xs font-medium text-on-surface-variant hover:text-on-surface underline underline-offset-2"
                >
                  Réinitialiser les filtres
                </button>
                <button onClick={applyFilters} className="btn-primary" style={{ padding: '0.375rem 0.875rem' }}>
                  Appliquer
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Stream List ──────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/20 bg-surface-container-low/40">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              Flux d'événements ({pagination.total})
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase">Lignes :</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value)}
                className="bg-surface border border-outline-variant/30 rounded-lg px-2 py-0.5 text-[10px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={String(s)}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Rows Stream */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-on-surface-variant">
              <RefreshCw className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
              <p className="text-xs italic">Chargement du journal...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-on-surface-variant">
              <Activity className="w-10 h-10 text-outline/30" />
              <p className="text-sm italic">Aucun événement trouvé.</p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10">
              {events.map((event) => {
                const meta = EVENT_META[event.type] || { icon: Activity, color: 'text-slate-600 dark:text-zinc-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20', label: event.type };
                const IconComponent = meta.icon;
                const isExpanded = expandedId === event.id;

                return (
                  <div key={event.id} className="group">
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : event.id)}
                      className={`flex items-center gap-3 px-4 py-3.5 hover:bg-surface-container-low/50 transition-colors cursor-pointer ${
                        isExpanded ? 'bg-surface-container-low/40' : ''
                      }`}
                    >
                      {/* Event Icon */}
                      <div className={`w-8 h-8 rounded-xl border shrink-0 flex items-center justify-center ${meta.bg} ${meta.border} ${meta.color}`}>
                        <IconComponent className="w-4 h-4" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-xs font-bold text-on-surface">{meta.label}</span>
                          {event.type.startsWith('AI_') && (
                            <span className="px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[9px] font-bold border border-purple-500/20">
                              IA Gemini
                            </span>
                          )}
                          {event.type === 'GLPI_SYNC_FAILED' && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[9px] font-bold border border-red-500/20">
                              Erreur Sync
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-on-surface-variant flex items-center gap-2 flex-wrap font-medium">
                          <span className="font-semibold text-on-surface">{event.actor}</span>
                          <span>·</span>
                          <span>{relativeTime(event.createdAt)}</span>
                          {event.ticketId && (
                            <>
                              <span>·</span>
                              <Link
                                to={`/tickets/${event.ticketId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-primary hover:underline font-bold inline-flex items-center gap-0.5"
                              >
                                <ArrowUpRight className="w-3 h-3" />
                                Ticket #{event.ticketId}
                              </Link>
                            </>
                          )}
                        </div>
                      </div>

                      <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>

                    {/* Expanded payload */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden bg-surface-container-low/30 border-t border-outline-variant/10 px-4 py-3 pl-14"
                        >
                          <div className="text-xs space-y-2">
                            <div className="flex flex-wrap gap-4 text-[11px] text-on-surface-variant font-medium">
                              <div><strong className="text-on-surface">Date exacte :</strong> {formatDate(event.createdAt)}</div>
                              {event.glpiTicketId && <div><strong className="text-on-surface">GLPI Ticket :</strong> #{event.glpiTicketId}</div>}
                            </div>

                            {event.payload && (
                              <div>
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Payload JSON</span>
                                <pre className={`p-3 rounded-xl border text-[11px] font-mono overflow-x-auto max-h-60 overflow-y-auto ${
                                  isDark ? 'bg-space-900 border-space-700 text-purple-200' : 'bg-slate-900 text-slate-100 border-slate-800'
                                }`}>
                                  {JSON.stringify(event.payload, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-outline-variant/20">
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                onPage={load}
              />
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
