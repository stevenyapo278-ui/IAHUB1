import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { useFilterParam } from '../hooks/useFilterParam';
import PageShell from '../components/PageShell';
import Pagination from '../components/Pagination';
import {
  Activity, Search, Filter, Calendar, RefreshCw, ChevronDown,
  Shield, UserPlus, UserMinus, Settings, Trash2, Edit3,
  AlertTriangle, Globe, Key, Mail, Bot, FileText, LogIn, LogOut,
  X, HardDrive, MapPin, Briefcase, Lock
} from 'lucide-react';

const ACTION_META = {
  USER_CREATED:           { icon: UserPlus,     color: 'text-emerald-600',  label: 'Utilisateur créé' },
  USER_UPDATED:           { icon: Edit3,        color: 'text-blue-600',     label: 'Utilisateur modifié' },
  USER_DELETED:           { icon: UserMinus,    color: 'text-red-600',      label: 'Utilisateur supprimé' },
  USER_PASSWORD_RESET:    { icon: Lock,         color: 'text-amber-600',    label: 'Mot de passe réinitialisé' },
  USER_REGISTERED:        { icon: UserPlus,     color: 'text-teal-600',     label: 'Inscription' },
  USER_LOGIN:             { icon: LogIn,        color: 'text-indigo-600',   label: 'Connexion' },

  TEAM_CREATED:           { icon: Briefcase,    color: 'text-cyan-600',     label: 'Équipe créée' },
  TEAM_UPDATED:           { icon: Edit3,        color: 'text-cyan-600',     label: 'Équipe modifiée' },
  TEAM_DELETED:           { icon: Trash2,       color: 'text-red-600',      label: 'Équipe supprimée' },
  TEAMS_SYNCED_FROM_GLPI: { icon: RefreshCw,    color: 'text-purple-600',   label: 'Équipes synchronisées GLPI' },

  LOCATION_CREATED:       { icon: MapPin,       color: 'text-orange-600',   label: 'Lieu créé' },
  LOCATION_UPDATED:       { icon: Edit3,        color: 'text-orange-600',   label: 'Lieu modifié' },
  LOCATION_DEACTIVATED:   { icon: MapPin,       color: 'text-red-600',      label: 'Lieu désactivé' },
  LOCATION_PUSHED_TO_GLPI:{ icon: Globe,        color: 'text-sky-600',      label: 'Lieu poussé GLPI' },
  LOCATIONS_SYNCED_FROM_GLPI: { icon: RefreshCw, color: 'text-sky-600',     label: 'Lieux synchronisés GLPI' },

  PERMISSION_GROUP_CREATED:   { icon: Shield,   color: 'text-violet-600',   label: 'Groupe permissions créé' },
  PERMISSION_GROUP_UPDATED:   { icon: Edit3,    color: 'text-violet-600',   label: 'Groupe permissions modifié' },
  PERMISSION_GROUP_DELETED:   { icon: Trash2,   color: 'text-red-600',      label: 'Groupe permissions supprimé' },
  PERMISSION_GROUP_ASSIGNED:  { icon: Shield,   color: 'text-indigo-600',   label: 'Permissions assignées' },

  SYSTEM_SETTINGS_UPDATED:{ icon: Settings,     color: 'text-slate-600',    label: 'Paramètres modifiés' },
  ADVANCED_SETTINGS_UPDATED:{ icon: Settings,   color: 'text-red-600',      label: 'Paramètres avancés modifiés' },

  EMAIL_ACCOUNT_CREATED:  { icon: Mail,         color: 'text-rose-600',     label: 'Compte email créé' },
  EMAIL_ACCOUNT_DELETED:  { icon: Trash2,       color: 'text-rose-600',     label: 'Compte email supprimé' },

  AI_PROVIDER_CREATED:    { icon: Bot,          color: 'text-purple-600',   label: 'Provider IA créé' },
  AI_PROVIDER_DELETED:    { icon: Trash2,       color: 'text-red-600',      label: 'Provider IA supprimé' },
  AI_MODEL_CREATED:       { icon: Bot,          color: 'text-cyan-600',     label: 'Modèle IA créé' },
  AI_KEY_CREATED:         { icon: Key,          color: 'text-amber-600',    label: 'Clé API IA créée' },

  KNOWLEDGE_DOCUMENT_UPLOADED: { icon: FileText, color: 'text-lime-600',    label: 'Document uploadé' },
  KNOWLEDGE_DOCUMENT_DELETED:  { icon: Trash2,   color: 'text-red-600',     label: 'Document supprimé' },

  GLPI_TICKETS_SYNCED:    { icon: RefreshCw,    color: 'text-blue-600',     label: 'Tickets GLPI synchronisés' },
  GLPI_LOCATIONS_SYNCED:  { icon: Globe,        color: 'text-teal-600',     label: 'Lieux GLPI synchronisés' },
  GLPI_USERS_SYNCED:      { icon: RefreshCw,    color: 'text-purple-600',   label: 'Utilisateurs GLPI synchronisés' },

  PROMPT_TEMPLATE_UPDATED:{ icon: Edit3,        color: 'text-yellow-600',   label: 'Prompt modifié' },
  N8N_WORKFLOW_CREATED:   { icon: Bot,          color: 'text-blue-600',     label: 'Workflow n8n créé' },
};

const ACTION_OPTIONS = Object.keys(ACTION_META).sort();

// Domaines métier pour le filtre par famille d'actions
const DOMAIN_OPTIONS = [
  { value: 'UTILISATEURS', label: '👤 Utilisateurs & connexions' },
  { value: 'EQUIPES', label: '👥 Équipes' },
  { value: 'LIEUX', label: '📍 Lieux' },
  { value: 'DROITS', label: '🔐 Groupes de droits' },
  { value: 'SYSTEME', label: '⚙️ Paramètres système' },
  { value: 'EMAIL_IA', label: '🤖 Email & IA' },
  { value: 'CONNAISSANCES', label: '📚 Base de connaissances' },
  { value: 'GLPI', label: '🔄 Synchronisations GLPI' },
];

// Types de cible les plus courants (détectés dynamiquement dans les logs)
const TARGET_TYPE_OPTIONS = ['User', 'Team', 'PermissionGroup', 'Location', 'Ticket', 'SystemSettings', 'EmailAccount', 'AiProvider', 'KnowledgeDocument', 'PromptTemplate', 'N8nWorkflow'];

const QUICK_RANGES = [
  { value: '1', label: '24h' },
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
];

function rangeToStartDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - Number(days));
  return d.toISOString().slice(0, 10);
}

export default function AuditLogs({ embedded = false } = {}) {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useFilterParam('action');
  const [domainFilter, setDomainFilter] = useFilterParam('domain');
  const [targetTypeFilter, setTargetTypeFilter] = useFilterParam('targetType');
  const [targetIdFilter, setTargetIdFilter] = useFilterParam('targetId');
  const [actorFilter, setActorFilter] = useFilterParam('actor');
  const [searchFilter, setSearchFilter] = useFilterParam('search');
  const [startDate, setStartDate] = useFilterParam('startDate');
  const [endDate, setEndDate] = useFilterParam('endDate');
  const [orderFilter, setOrderFilter] = useFilterParam('order', 'desc');
  const [pageSize, setPageSize] = useFilterParam('pageSize', '50');
  const [quickRange, setQuickRange] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  function load(page = 1) {
    setLoading(true);
    const pageSizeNum = parseInt(pageSize, 10) || 50;
    const params = { page, pageSize: pageSizeNum, order: orderFilter };
    if (actionFilter) params.action = actionFilter;
    if (domainFilter) params.domain = domainFilter;
    if (targetTypeFilter) params.targetType = targetTypeFilter;
    if (targetIdFilter) params.targetId = targetIdFilter;
    if (actorFilter) params.actor = actorFilter;
    if (searchFilter) params.search = searchFilter;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    api.get('/audit-logs', { params })
      .then(({ data }) => {
        setLogs(data.logs);
        setPagination(data.pagination);
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [actionFilter, domainFilter, targetTypeFilter, targetIdFilter, actorFilter, searchFilter, startDate, endDate, orderFilter, pageSize]);

  function applyFilters() { load(1); }

  function resetFilters() {
    setActionFilter('');
    setDomainFilter('');
    setTargetTypeFilter('');
    setTargetIdFilter('');
    setActorFilter('');
    setSearchFilter('');
    setStartDate('');
    setEndDate('');
    setOrderFilter('desc');
    setPageSize('50');
    setQuickRange('');
  }

  function applyQuickRange(days) {
    setQuickRange(days);
    setStartDate(days ? rangeToStartDate(days) : '');
    setEndDate('');
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

  const hasActiveFilters = actionFilter || domainFilter || targetTypeFilter || targetIdFilter || actorFilter || searchFilter || startDate || endDate || orderFilter === 'asc';

  const view = (
    <PageShell
      hideHeader={embedded}
      fill={embedded}
      icon={Shield}
      iconColor="text-amber-400"
      title="Audit système"
      subtitle={`${pagination.total} action${pagination.total !== 1 ? 's' : ''} enregistrée${pagination.total !== 1 ? 's' : ''}`}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
              showFilters || hasActiveFilters
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                : 'btn-secondary'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filtres</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
        </div>
      }
    >

      {/* ── Filters Strip ──────────────────────────────────────────────── */}
      {/* Barre outils inline — indispensable en mode embarqué (hub) où l'en-tête PageShell
          est masqué : sans elle, ni la recherche ni le bouton Filtres ne seraient accessibles. */}
      {embedded && (
        <div className="flex items-center gap-2 mb-3 flex-wrap px-4 sm:px-6 lg:px-8 pt-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input
              type="text"
              placeholder="Rechercher (cible, acteur, action)..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              className="input-katalyst pl-8 pr-8 py-2 text-xs w-full"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
              showFilters || hasActiveFilters
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                : 'btn-secondary'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filtres</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
        </div>
      )}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low/40 mb-4 shrink-0"
          >
            <div className="px-4 py-3 space-y-3">
              {/* Périodes rapides */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mr-1">Période :</span>
                {QUICK_RANGES.map(({ value, label }) => (
                  <button key={value} onClick={() => applyQuickRange(quickRange === value ? '' : value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                      quickRange === value
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                        : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/50'
                    }`}>
                    {label}
                  </button>
                ))}
                <span className="text-[10px] text-on-surface-variant/50 ml-1">(ou dates personnalisées ci-dessous)</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <label className="field-label">
                  <span>Domaine</span>
                  <select
                    value={domainFilter}
                    onChange={(e) => { setDomainFilter(e.target.value); setActionFilter(''); }}
                    className="input-katalyst"
                  >
                    <option value="">Tous domaines</option>
                    {DOMAIN_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  <span>Action précise</span>
                  <select
                    value={actionFilter}
                    onChange={(e) => { setActionFilter(e.target.value); setDomainFilter(''); }}
                    className="input-katalyst"
                  >
                    <option value="">Toutes les actions</option>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>{ACTION_META[a]?.label || a}</option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  <span>Type de cible</span>
                  <select
                    value={targetTypeFilter}
                    onChange={(e) => setTargetTypeFilter(e.target.value)}
                    className="input-katalyst"
                  >
                    <option value="">Tous les types</option>
                    {TARGET_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  <span>N° de cible</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetIdFilter}
                    onChange={(e) => setTargetIdFilter(e.target.value.replace(/\D/g, ''))}
                    placeholder="ex : 12"
                    className="input-katalyst"
                  />
                </label>

                <label className="field-label">
                  <span>Acteur</span>
                  <input
                    type="text"
                    value={actorFilter}
                    onChange={(e) => setActorFilter(e.target.value)}
                    placeholder="Email de l'acteur..."
                    className="input-katalyst"
                  />
                </label>

                <label className="field-label">
                  <span>Ordre</span>
                  <select
                    value={orderFilter}
                    onChange={(e) => setOrderFilter(e.target.value)}
                    className="input-katalyst"
                  >
                    <option value="desc">Plus récents d'abord</option>
                    <option value="asc">Plus anciens d'abord</option>
                  </select>
                </label>

                <label className="field-label">
                  <span>Du</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setQuickRange(''); }}
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
                <button onClick={resetFilters} className="text-xs font-medium text-on-surface-variant hover:text-on-surface underline underline-offset-2">
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

      {/* ── Main Stream List ────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 lg:px-8 py-6">
        <div className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest flex flex-col flex-1 min-h-0 min-w-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/20 bg-surface-container-low/40">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              Flux d'audit ({pagination.total})
            </span>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-on-surface-variant">
              <RefreshCw className="w-6 h-6 text-amber-600 animate-spin" />
              <p className="text-xs italic">Chargement de l'audit...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-on-surface-variant">
              <Shield className="w-10 h-10 text-outline/30" />
              <p className="text-sm italic">Aucune action trouvée.</p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10 overflow-y-auto flex-1 min-h-0">
              {logs.map((entry) => {
                const meta = ACTION_META[entry.action] || { icon: Activity, color: 'text-slate-600', label: entry.action };
                const IconComponent = meta.icon;
                const isExpanded = expandedId === entry.id;

                return (
                  <div key={entry.id} className="group">
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className={`flex items-center gap-3 px-4 py-3.5 hover:bg-surface-container-low/50 transition-colors cursor-pointer ${
                        isExpanded ? 'bg-surface-container-low/40' : ''
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-xl border shrink-0 flex items-center justify-center bg-${meta.color.replace('text-', '')}/10 border-${meta.color.replace('text-', '')}/20 ${meta.color}`}>
                        <IconComponent className="w-4 h-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-xs font-bold text-on-surface">{meta.label}</span>
                          {entry.targetLabel && (
                            <span className="text-[10px] text-on-surface-variant font-mono bg-surface-container px-1.5 py-0.5 rounded-md">
                              {entry.targetLabel}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-on-surface-variant flex items-center gap-2 flex-wrap font-medium">
                          <span className="font-semibold text-on-surface">{entry.actorEmail || 'SYSTEM'}</span>
                          <span>·</span>
                          <span>{relativeTime(entry.createdAt)}</span>
                          {entry.targetType && (
                            <>
                              <span>·</span>
                              <span className="text-primary">{entry.targetType}#{entry.targetId}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>

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
                              <div><strong className="text-on-surface">Action :</strong> <code className="font-mono bg-surface-container px-1 py-0.5 rounded">{entry.action}</code></div>
                              <div><strong className="text-on-surface">Date exacte :</strong> {formatDate(entry.createdAt)}</div>
                              {entry.targetType && <div><strong className="text-on-surface">Type cible :</strong> {entry.targetType}#{entry.targetId}</div>}
                              {entry.ipAddress && <div><strong className="text-on-surface">IP :</strong> {entry.ipAddress}</div>}
                            </div>

                            {entry.metadata && (
                              <div>
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Métadonnées</span>
                                <pre className="bg-slate-900 text-slate-100 p-3 rounded-xl border border-slate-800 text-[11px] font-mono overflow-x-auto max-h-60 overflow-y-auto">
                                  {JSON.stringify(entry.metadata, null, 2)}
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

          {/* Pagination — fixe en bas du conteneur (même disposition que le tableau des tickets) */}
          {pagination.total > 0 && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              label="actions"
              onPageChange={(p) => load(p)}
              pageSize={parseInt(pageSize, 10) || 50}
              onPageSizeChange={(s) => { setPageSize(String(s)); }}
              className="shrink-0"
            />
          )}
        </div>
      </div>
    </PageShell>
  );

  // Mode embarqué (hub Journal & Audit) : la page fournit déjà le padding et l'en-tête
  if (embedded) {
    return <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">{view}</div>;
  }
  return view;
}
