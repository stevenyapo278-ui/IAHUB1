import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Ticket,
  Radio,
  Clock,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Info,
  ArrowDown,
  Sparkles,
  Table,
  LayoutGrid,
  RefreshCw,
  Download,
  FileSpreadsheet,
  FileCode2,
  Plus,
  X,
  Search,
  User,
  Users,
  MapPin,
  Tag,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  KanbanSquare,
  ListChecks,
  Boxes,
  Calendar,
  CheckSquare,
  GripVertical,
  Settings2,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import { flattenCategoryTree } from '../utils/categoryTree';
import EmptyState from '../components/EmptyState';
import TicketCoverflowCarousel from '../components/TicketCoverflowCarousel';
import KanbanBoard from '../components/KanbanBoard';
import SearchableSelect from '../components/SearchableSelect';
import TicketFilterDrawer from '../components/TicketFilterDrawer';
import SearchableMultiSelect from '../components/SearchableMultiSelect';
import RemoteUserSelect from '../components/RemoteUserSelect';
import RemoteUserMultiSelect from '../components/RemoteUserMultiSelect';
import SlaBadge from '../components/SlaBadge';
import DataGrid from '../components/DataGrid';
import {
  STATUS_OPTIONS, STATUS_LABELS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS, URGENCY_IMPACT_OPTIONS,
  STATUS_CONFIG,
} from '../constants/tickets';

// Vue par défaut « à la GLPI » : tous les statuts sont visibles (NEW, OPEN,
// PLANNED, PENDING, SOLVED…) sauf les tickets CLOSE — notamment ceux fermés
// automatiquement après 3 jours. Un statut présent dans l'URL (?status=SOLVED…)
// prime toujours, et « Tous les statuts » dans le panneau restaure la vue complète.
const DEFAULT_STATUS_FILTER = 'NOT_CLOSED';

const EMPTY_FORM = {  title: '',
  content: '',
  openedAt: '',
  dueDate: '',
  type: 'INCIDENT',
  category: '',
  status: 'NEW',
  source: 'Direct',
  urgency: 'MEDIUM',
  impact: 'MEDIUM',
  priority: 'P3',
  externalId: '',
  locationId: '',
  teamId: '',
  assignedToId: '',
  requesterId: '',
  observerIds: [],
  assetIds: [],
  requiresApproval: false,
};

function HighlightText({ text, query }) {
  if (!query || !text) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = String(text).split(regex);
  return <>{parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-amber-300/40 text-on-surface rounded-sm px-0.5">{part}</mark> : part
  )}</>;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatDateTimeShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

// ── Priority dot config ──────────────────────────────────────────────────────
const PRIORITY_DOT = {
  P1: { color: 'bg-red-500',    label: 'P1', text: 'text-red-500'    },
  P2: { color: 'bg-orange-400', label: 'P2', text: 'text-orange-400' },
  P3: { color: 'bg-amber-400',  label: 'P3', text: 'text-amber-400'  },
  P4: { color: 'bg-emerald-500',label: 'P4', text: 'text-emerald-500'},
};

function PriorityDot({ priority, showLabel = false }) {
  const conf = PRIORITY_DOT[priority] || PRIORITY_DOT.P4;
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0" title={`Priorité ${conf.label}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${conf.color}`} />
      {showLabel && <span className={`text-[11px] font-bold tabular-nums ${conf.text}`}>{conf.label}</span>}
    </span>
  );
}

function StatusPill({ status }) {
  const conf = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${conf.bg}`}>
      <conf.Icon className="w-3 h-3 shrink-0" />
      {conf.label}
    </span>
  );
}

function Avatar({ name, colorClass = 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20' }) {
  if (!name) return null;
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-[10px] font-bold shrink-0 ${colorClass}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

// ── AG Grid cell renderers ───────────────────────────────────────────────────
function PriorityRenderer({ data }) {
  if (!data) return null;
  return <PriorityDot priority={data.priority} />;
}

function TicketInfoRenderer({ data, context }) {
  if (!data) return null;
  const { debouncedSearch } = context || {};
  return (
    <div className="flex flex-col justify-center h-full py-1 min-w-0 w-full overflow-hidden leading-snug">
      {/* Row 1: ID + Title + Badges */}
      <div className="flex items-center gap-1.5 min-w-0 w-full overflow-hidden">
        <Link
          to={`/tickets/${data.id}`}
          onClick={(e) => e.stopPropagation()}
          className={`font-mono text-xs font-extrabold tabular-nums shrink-0 hover:underline ${PRIORITY_DOT[data.priority]?.text || 'text-on-surface-variant'}`}
        >
          #{data.id}
        </Link>
        <Link
          to={`/tickets/${data.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-bold text-on-surface hover:text-primary transition-colors truncate min-w-0 flex-1 overflow-hidden"
        >
          <HighlightText text={data.title} query={debouncedSearch} />
        </Link>
        {data.aiProcessed && (
          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-extrabold bg-purple-500/15 text-purple-600 dark:text-purple-400 shrink-0">
            IA
          </span>
        )}
        {data.glpiTicketId && (
          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-surface-container text-on-surface-variant shrink-0">
            GLPI
          </span>
        )}
      </div>
      {/* Row 2: Category · Location */}
      {(data.category || data.glpiLocationName) && (
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-on-surface-variant font-medium min-w-0 w-full overflow-hidden truncate">
          {data.category && <span className="truncate max-w-[140px]">{data.category}</span>}
          {data.glpiLocationName && (
            <span className="flex items-center gap-0.5 truncate max-w-[140px]">
              <MapPin className="w-3 h-3 shrink-0 text-amber-500/70" />
              {data.glpiLocationName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StatusRenderer({ data, context }) {
  if (!data) return null;
  const { canAssign, handleQuickStatusChange, STATUS_OPTIONS: opts, STATUS_LABELS: labels } = context || {};
  if (canAssign) {
    return (
      <div className="flex items-center h-full w-full">
        <select
          value={data.status}
          onChange={(e) => handleQuickStatusChange?.(data.id, e.target.value, e)}
          className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-outline-variant/40 bg-surface text-on-surface cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all w-full max-w-[125px] truncate"
        >
          {(opts || STATUS_OPTIONS).map(s => <option key={s} value={s}>{(labels || STATUS_LABELS)[s] || s}</option>)}
        </select>
      </div>
    );
  }
  return <StatusPill status={data.status} />;
}

function AssigneeRenderer({ data }) {
  if (!data) return null;
  const assignee = data.assignedTo;
  if (!assignee) return <span className="text-sm text-muted-foreground/60 italic">Non assigné</span>;
  return (
    <div className="flex h-full items-center gap-2.5">
      <Avatar name={assignee.fullName} />
      <span className="text-sm font-medium text-foreground truncate">{assignee.fullName}</span>
    </div>
  );
}

function RequesterRenderer({ data }) {
  if (!data) return null;
  const reqName = data.requester?.fullName || data.sourceName || data.sourceEmail;
  if (!reqName) return <span className="text-sm text-muted-foreground/60 italic">—</span>;
  return (
    <div className="flex h-full items-center gap-2.5">
      <Avatar name={reqName} colorClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" />
      <span className="text-sm font-medium text-foreground truncate">{reqName}</span>
    </div>
  );
}

function LocationRenderer({ data }) {
  if (!data) return null;
  if (!data.glpiLocationName) return <span className="text-sm text-muted-foreground/60 italic">—</span>;
  return (
    <div className="flex h-full items-center gap-2">
      <MapPin className="w-3.5 h-3.5 shrink-0 text-amber-500/60" />
      <span className="text-sm font-medium text-foreground truncate">{data.glpiLocationName}</span>
    </div>
  );
}

function ObserverRenderer({ data }) {
  if (!data) return null;
  const observers = data.observers;
  if (!observers || observers.length === 0) return <span className="text-sm text-muted-foreground/60 italic">—</span>;
  return (
    <div className="flex h-full items-center gap-1.5 flex-wrap">
      {observers.slice(0, 2).map((o) => (
        <span key={o.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] font-semibold">
          <Eye className="w-3 h-3" />
          {o.fullName}
        </span>
      ))}
      {observers.length > 2 && (
        <span className="text-[10px] text-muted-foreground font-medium">+{observers.length - 2}</span>
      )}
    </div>
  );
}

function DateCellRenderer({ value, titlePrefix }) {
  if (!value) return <span className="text-sm text-muted-foreground/40">—</span>;
  return (
    <span className="text-sm font-medium tabular-nums text-muted-foreground" title={`${titlePrefix} ${new Date(value).toLocaleString('fr-FR')}`}>
      {formatDateShort(value)}
    </span>
  );
}

function ActionsRenderer({ data, context }) {
  if (!data) return null;
  const { canDelete, askDeleteOne } = context || {};
  const btnCls = "inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground";
  return (
    <div className="flex h-full items-center gap-1">
      {canDelete && (
        <button type="button" aria-label="Supprimer" className={btnCls}
          onClick={(e) => { e.stopPropagation(); askDeleteOne?.(data.id); }}>
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <Link
        to={`/tickets/${data.id}`}
        aria-label="Voir"
        className={btnCls}
        onClick={(e) => e.stopPropagation()}
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="mx-4 sm:mx-6 lg:mx-8 mb-4 rounded-2xl border border-border/30 bg-surface overflow-hidden animate-pulse">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border/20 bg-surface-muted/50">
            {[...Array(7)].map((_, i) => (
              <th key={i} className="px-3 py-2.5">
                <div className="h-2.5 rounded bg-border/20 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...Array(12)].map((_, row) => (
            <tr key={row} className="border-b border-border/10">
              <td className="px-3 py-2.5 w-6"><div className="h-2.5 w-2.5 rounded-full bg-border/20" /></td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-10 rounded bg-border/20" />
                  <div className="h-3 w-28 rounded bg-border/15" />
                </div>
              </td>
              <td className="px-3 py-2.5"><div className="h-5 w-14 rounded-md bg-border/15" /></td>
              <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><div className="h-5 w-5 rounded-full bg-border/15" /><div className="h-2.5 w-16 rounded bg-border/15" /></div></td>
              <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><div className="h-5 w-5 rounded-full bg-border/15" /><div className="h-2.5 w-14 rounded bg-border/15" /></div></td>
              <td className="px-3 py-2.5"><div className="h-2.5 w-16 rounded bg-border/15" /></td>
              <td className="px-3 py-2.5"><div className="h-2.5 w-16 rounded bg-border/15" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaginationButtons({ page, totalPages, onPageChange }) {
  const [jumpValue, setJumpValue] = useState('');
  const jumpRef = useRef(null);

  const pages = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const result = [];
    result.push(1);
    if (page > 3) result.push('...');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) result.push(i);
    if (page < totalPages - 2) result.push('...');
    result.push(totalPages);
    return result;
  }, [page, totalPages]);

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onPageChange(Math.max(1, page - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onPageChange(Math.min(totalPages, page + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onPageChange(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      onPageChange(totalPages);
    }
  }

  function handleJump(e) {
    e.preventDefault();
    const val = parseInt(jumpValue, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages && val !== page) {
      onPageChange(val);
    }
    setJumpValue('');
    jumpRef.current?.blur();
  }

  const btnBase = 'h-10 min-w-[40px] flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95';
  const btnEnabled = 'text-muted-foreground hover:bg-surface-muted hover:text-foreground';
  const btnDisabled = 'text-muted-foreground/30 cursor-not-allowed';
  const btnActive = 'bg-primary text-primary-foreground shadow-sm shadow-primary/20';

  return (
    <div className="flex items-center gap-2" onKeyDown={handleKeyDown} role="navigation" aria-label="Pagination">
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="Première page"
          className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Page précédente"
          className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="w-8 h-10 flex items-center justify-center text-xs text-muted-foreground/40">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p}`}
              aria-current={p === page ? 'page' : undefined}
              className={`${btnBase} px-1 ${p === page ? btnActive : btnEnabled}`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Page suivante"
          className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          aria-label="Dernière page"
          className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>

      {/* Jump-to */}
      <form onSubmit={handleJump} className="flex items-center gap-1.5 ml-2">
        <span className="text-[11px] text-muted-foreground">→</span>
        <input
          ref={jumpRef}
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          placeholder={`1–${totalPages}`}
          className="w-16 h-8 px-2 text-[11px] text-center font-semibold bg-surface border border-border/40 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
        />
      </form>
    </div>
  );
}

function ColumnConfigPanel({ columns, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all"
        title="Configurer les colonnes"
      >
        <Settings2 className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full pt-1 z-40">
            <div className="rounded-xl border border-border/30 bg-surface shadow-xl p-2 min-w-[200px]">
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Colonnes</p>
              {columns.map((col) => (
                <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-foreground hover:bg-surface-muted cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={() => {
                      const next = columns.map((c) => c.key === col.key ? { ...c, visible: !c.visible } : c);
                      onChange(next);
                      localStorage.setItem('tickets_columns', JSON.stringify(next));
                    }}
                    className="accent-primary w-3.5 h-3.5 rounded"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function loadColumnConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('tickets_columns'));
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.filter((c) => c.key !== 'priority');
    }
  } catch {}
  return [
    { key: 'ticket', label: 'Ticket', visible: true },
    { key: 'status', label: 'Statut', visible: true },
    { key: 'assignedTo', label: 'Assigné', visible: true },
    { key: 'requester', label: 'Demandeur', visible: true },
    { key: 'location', label: 'Lieu', visible: true },
    { key: 'observers', label: 'Observateurs', visible: true },
    { key: 'createdAt', label: 'Ouvert', visible: true },
    { key: 'updatedAt', label: 'Modifié', visible: true },
  ];
}

function isDueOverdue(t) {
  if (!t.dueDate) return false;
  if (['SOLVED', 'CLOSED'].includes(t.status)) return false;
  return new Date(t.dueDate) < new Date();
}

function StatPill({ color, count, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold transition-all hover:scale-105 active:scale-95"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      <span className={`w-1.5 h-1.5 rounded-full`} style={{ backgroundColor: color }} />
      {count} {label}
    </button>
  );
}

function FormField({ label, children, error }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">{label}</label>
      {children}
      {error && <p className="mt-1 text-[10px] font-semibold text-red-500">{error}</p>}
    </div>
  );
}

const FIELD_CLS = "w-full px-3 py-2 text-sm bg-surface border border-outline-variant/30 rounded-xl text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all";

// ── ChevronsRight icon (small) ───────────────────────────────────────────────
function ChevronsLeft({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" />
    </svg>
  );
}
function ChevronsRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 17 5-5-5-5" /><path d="m13 17 5-5-5-5" />
    </svg>
  );
}

export default function Tickets() {
  const { user } = useAuth();
  const { autonomousMode } = useSystemSettings();
  const canAssign = hasPermission(user, 'tickets.assign') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canApprove = hasPermission(user, 'tickets.approve') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canDelete = hasPermission(user, 'tickets.delete') || user?.role === 'SUPERADMIN';
  const canBulkDelete = hasPermission(user, 'tickets.bulkDelete') || user?.role === 'SUPERADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [serverStats, setServerStats] = useState({ open: 0, pending: 0, resolved: 0, p1: 0, p2: 0, ai: 0, unassigned: 0 });
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const flatCategories = useMemo(() => flattenCategoryTree(categories), [categories]);
  const [refreshing, setRefreshing] = useState(false);
  const isFirstLoad = useRef(true);

  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [viewMode, setViewMode] = useState(() => localStorage.getItem('tickets_view_mode') || 'table');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'createdAt');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sortOrder') || 'desc');

  const savedViewsKey = user ? `tickets_saved_views_${user.id}` : null;
  const [savedViews, setSavedViews] = useState(() => {
    try { return savedViewsKey ? JSON.parse(localStorage.getItem(savedViewsKey) || '[]') : []; } catch { return []; }
  });

  function persistSavedViews(views) {
    setSavedViews(views);
    if (savedViewsKey) localStorage.setItem(savedViewsKey, JSON.stringify(views));
  }

  function saveCurrentView() {
    if (!savedViewsKey) return;
    const name = window.prompt('Nom de la vue à enregistrer :');
    if (!name) return;
    const view = { name, filters: { ...filters }, search: searchQuery, sortBy, sortOrder };
    const existing = savedViews.findIndex((v) => v.name === name);
    const next = existing >= 0 ? savedViews.map((v, i) => (i === existing ? view : v)) : [...savedViews, view];
    persistSavedViews(next);
    toast.success(`Vue « ${name} » enregistrée`);
  }

  function restoreView(view) {
    setFilters(view.filters || {});
    setSearchQuery(view.search || '');
    setDebouncedSearch(view.search || '');
    setSortBy(view.sortBy || 'createdAt');
    setSortOrder(view.sortOrder || 'desc');
    setPage(1);
    toast.success(`Vue « ${view.name} » appliquée`);
  }

  function deleteSavedView(name) {
    persistSavedViews(savedViews.filter((v) => v.name !== name));
    toast.success('Vue supprimée');
  }

  const [filters, setFilters] = useState({
    status: searchParams.get('status') ?? DEFAULT_STATUS_FILTER,
    approvalStatus: searchParams.get('approvalStatus') || '',
    priority: searchParams.get('priority') || '',
    source: searchParams.get('source') || '',
    category: searchParams.get('category') || '',
    teamId: searchParams.get('teamId') || '',
    assignedToId: searchParams.get('assignedToId') || '',
    mine: searchParams.get('mine') || '',
    aiProcessed: searchParams.get('aiProcessed') || '',
    closeSuggested: searchParams.get('closeSuggested') || '',
    dateFrom: searchParams.get('dateFrom') || '',
    dateTo: searchParams.get('dateTo') || '',
  });

  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachment, setAttachment] = useState(null);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [assetOptions, setAssetOptions] = useState([]);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page');
    return p ? parseInt(p, 10) : 1;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(() => {
    const s = localStorage.getItem('tickets_page_size');
    return s ? parseInt(s, 10) : 50;
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const debounceRef = useRef(null);
  const [columns, setColumns] = useState(loadColumnConfig);

  function changeViewMode(mode) {
    setViewMode(mode);
    localStorage.setItem('tickets_view_mode', mode);
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (sortBy && sortBy !== 'createdAt') params.set('sortBy', sortBy);
    if (sortOrder && sortOrder !== 'desc') params.set('sortOrder', sortOrder);
    if (page && page !== 1) params.set('page', String(page));
    Object.entries(filters).forEach(([k, v]) => {
      if (k === 'status') {
        if (v) params.set(k, v);
      } else if (v) {
        params.set(k, v);
      }
    });
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, sortBy, sortOrder, filters, page]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const showSelectionColumn = canBulkDelete || canAssign;

  function updateFilter(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
  }

  // ── Visibility set for column config
  const visibleKeys = useMemo(() => {
    const set = new Set(['priority']);
    for (const c of columns) {
      if (c.visible) set.add(c.key);
    }
    return set;
  }, [columns]);

  function clearFilters() {
    setFilters({ status: '', priority: '', source: '', category: '', teamId: '', assignedToId: '', mine: '', aiProcessed: '', approvalStatus: '', closeSuggested: '', dateFrom: '', dateTo: '' });
    setSearchQuery('');
    setDebouncedSearch('');
    setSortBy('createdAt');
    setSortOrder('desc');
    setPage(1);
  }

  const loadTickets = useCallback(function loadTickets(isManualRefresh = false) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isManualRefresh) {
      setRefreshing(true);
    } else if (isFirstLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    const params = { page, limit: pageSize, sortBy, sortOrder };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.category) params.category = filters.category;
    if (filters.teamId) params.teamId = filters.teamId;
    if (filters.assignedToId) params.assignedToId = filters.assignedToId;
    if (filters.mine) params.mine = filters.mine;
    if (filters.aiProcessed) params.aiProcessed = filters.aiProcessed;
    if (filters.approvalStatus) params.approvalStatus = filters.approvalStatus;
    if (filters.closeSuggested) params.closeSuggested = filters.closeSuggested;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/tickets', { params, signal: controller.signal })
      .then(({ data }) => {
        setTickets(data.items);
        setTotalPages(data.pages);
        setTotalCount(data.total);
        if (data.stats) setServerStats(data.stats);
        setSelectedIds([]);
        if (isManualRefresh) toast.success('Tickets rafraîchis');
        if (!isFirstLoad.current && tableContainerRef.current) {
          tableContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      })
      .catch((err) => {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        setError(err.response?.data?.error || 'Erreur de chargement');
      })
      .finally(() => {
        isFirstLoad.current = false;
        setLoading(false);
        setRefreshing(false);
      });
  }, [page, pageSize, sortBy, sortOrder, filters, debouncedSearch]);

  const refreshTicketsSilently = useCallback(function refreshTicketsSilently() {
    const params = { page, limit: pageSize, sortBy, sortOrder };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.category) params.category = filters.category;
    if (filters.teamId) params.teamId = filters.teamId;
    if (filters.assignedToId) params.assignedToId = filters.assignedToId;
    if (filters.mine) params.mine = filters.mine;
    if (filters.aiProcessed) params.aiProcessed = filters.aiProcessed;
    if (filters.approvalStatus) params.approvalStatus = filters.approvalStatus;
    if (filters.closeSuggested) params.closeSuggested = filters.closeSuggested;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/tickets', { params }).then(({ data }) => { setTickets(data.items); setTotalPages(data.pages); setTotalCount(data.total); if (data.stats) setServerStats(data.stats); }).catch(() => {});
  }, [page, pageSize, sortBy, sortOrder, filters, debouncedSearch]);

  useEffect(() => { loadTickets(); }, [filters, page, pageSize, debouncedSearch, sortBy, sortOrder]);
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') refreshTicketsSilently();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [filters, debouncedSearch, sortBy, sortOrder]);

  const tableContainerRef = useRef(null);
  const abortRef = useRef(null);
  const searchInputRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleSelect(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }
  function toggleSelectAll() {
    setSelectedIds((ids) => (ids.length === tickets.length ? [] : tickets.map((t) => t.id)));
  }

  const [bulkChanges, setBulkChanges] = useState({ status: '', priority: '', assignedToId: '' });
  const [bulkUpdating, setBulkUpdating] = useState(false);

  async function handleBulkUpdate() {
    const payload = { ids: selectedIds };
    if (bulkChanges.status) payload.status = bulkChanges.status;
    if (bulkChanges.priority) payload.priority = bulkChanges.priority;
    if (bulkChanges.assignedToId) payload.assignedToId = Number(bulkChanges.assignedToId);
    if (Object.keys(payload).length === 1) return toast.error('Choisissez une modification à appliquer');
    setBulkUpdating(true);
    try {
      const { data } = await api.post('/tickets/bulk-update', payload);
      toast.success(`${data.updatedCount}/${data.total} ticket(s) mis à jour`);
      if (data.failures?.length > 0) toast.error(`${data.failures.length} ticket(s) en échec`);
      setBulkChanges({ status: '', priority: '', assignedToId: '' });
      setSelectedIds([]);
      loadTickets();
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'opération groupée");
    } finally {
      setBulkUpdating(false);
    }
  }

  async function exportAll(fmt = 'csv') {
    const params = {};
    for (const key of ['status', 'priority', 'category', 'teamId', 'assignedToId', 'mine', 'approvalStatus', 'source', 'aiProcessed', 'closeSuggested']) {
      const v = filters[key];
      if (v !== undefined && v !== '' && v !== null) params[key] = v;
    }
    if (debouncedSearch) params.search = debouncedSearch;
    params.sortBy = sortBy; params.sortOrder = sortOrder; params.format = fmt;
    try {
      const res = await api.get('/tickets/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets_export_${new Date().toISOString().slice(0, 10)}.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Export ${fmt.toUpperCase()} généré`);
    } catch {
      toast.error("Échec de l'export");
    }
  }

  const handleQuickStatusChange = useCallback(async (ticketId, newStatus, e) => {
    if (e) e.stopPropagation();
    try {
      await api.patch(`/tickets/${ticketId}`, { status: newStatus });
      toast.success(`Statut : ${newStatus}`);
      refreshTicketsSilently();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec mise à jour statut');
    }
  }, []);

  const [confirmDelete, setConfirmDelete] = useState(null);
  const askDeleteOne = useCallback((id) => { setConfirmDelete({ mode: 'one', id }); }, []);
  function askDeleteSelected() { if (selectedIds.length > 0) setConfirmDelete({ mode: 'bulk' }); }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    setDeleting(true); setError('');
    try {
      if (confirmDelete.mode === 'one') {
        await api.delete(`/tickets/${confirmDelete.id}`);
        toast.success('Ticket supprimé');
      } else {
        await api.post('/tickets/bulk-delete', { ids: selectedIds });
        toast.success(`${selectedIds.length} ticket(s) supprimé(s)`);
      }
      loadTickets(); setConfirmDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    api.get('/locations').then(({ data }) => setLocations(data)).catch(() => {});
    api.get('/glpi/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/glpi/users').then(({ data }) => setGlpiUsers(data)).catch(() => {});
    api.get('/ticket-templates').then(({ data }) => setTemplates(data)).catch(() => {});
    api.get('/assets', { params: { pageSize: 200 } })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : (data.assets || []);
        setAssetOptions(list.map((a) => ({ id: a.id, label: a.name, subLabel: [a.serialNumber, a.inventoryNumber, a.model].filter(Boolean).join(' — ') || undefined })));
      }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canAssign) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : (data.users || []))).catch(() => {});
  }, [canAssign]);

  useEffect(() => {
    const cat = flatCategories.find((c) => c.name === form.category);
    const params = cat ? { categoryId: cat.id } : {};
    api.get('/custom-fields', { params })
      .then(({ data }) => {
        const active = (data || []).filter((f) => f.isActive);
        setCustomFieldDefs(active);
        setCustomValues((prev) => {
          const ids = new Set(active.map((f) => String(f.id)));
          const next = {};
          for (const [k, v] of Object.entries(prev)) if (ids.has(k)) next[k] = v;
          return next;
        });
      }).catch(() => setCustomFieldDefs([]));
  }, [form.category]);

  async function handleCreate(e) {
    e.preventDefault(); setError(''); setCreating(true);
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === 'observerIds') { if (value.length > 0) payload.append('observerIds', JSON.stringify(value)); return; }
        if (key === 'assetIds') { if (value.length > 0) payload.append('assetIds', JSON.stringify(value)); return; }
        if (value !== '' && value !== undefined && value !== null) payload.append(key, value);
      });
      if (Object.keys(customValues).length > 0) payload.append('customFields', JSON.stringify(customValues));
      if (attachment) payload.append('attachment', attachment);
      await api.post('/tickets', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Ticket créé');
      setForm(EMPTY_FORM); setCustomValues({}); setAttachment(null); setShowForm(false); setSearchParams({});
      loadTickets();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  }

  function toggleForm() {
    setShowForm((v) => !v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (next.get('new') === '1') next.delete('new'); else next.set('new', '1');
      return next;
    });
  }

  function applyTemplate(templateId) {
    setSelectedTemplate(templateId);
    if (!templateId) return;
    const t = templates.find((x) => String(x.id) === String(templateId));
    if (!t) return;
    setForm((prev) => ({ ...prev, title: t.title || prev.title, content: t.content || prev.content, priority: t.priority || prev.priority, category: t.category || prev.category, type: t.type || prev.type, urgency: t.urgency || prev.urgency, impact: t.impact || prev.impact }));
    toast.success(`Modèle « ${t.name} » appliqué`);
  }

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => { if (e.key === 'Escape') toggleForm(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const activeFilterCount = [
    filters.status, filters.priority, filters.source, filters.category,
    filters.teamId, filters.assignedToId, filters.mine, filters.aiProcessed,
    filters.approvalStatus, filters.closeSuggested, filters.dateFrom, filters.dateTo,
  ].filter(Boolean).length;

  // ── AG Grid column definitions (Katalyst pinned style) ─────────────────────
  const agGridContext = useMemo(() => ({
    debouncedSearch,
    canAssign,
    canDelete,
    handleQuickStatusChange,
    askDeleteOne,
    navigate,
    STATUS_OPTIONS,
    STATUS_LABELS,
  }), [debouncedSearch, canAssign, canDelete, handleQuickStatusChange, askDeleteOne, navigate]);

  const gridColumnDefs = useMemo(() => {
    const cols = [];

    if (showSelectionColumn) {
      cols.push({
        headerCheckboxSelection: true,
        checkboxSelection: true,
        width: 48,
        pinned: 'left',
        suppressMenu: true,
        resizable: false,
        sortable: false,
        filter: false,
        suppressMovable: true,
      });
    }

    if (visibleKeys.has('ticket')) {
      cols.push({
        field: 'title',
        headerName: 'TICKET',
        flex: 2,
        minWidth: 280,
        cellRenderer: TicketInfoRenderer,
        valueFormatter: (p) => p.data?.title || '',
      });
    }

    if (visibleKeys.has('status')) {
      cols.push({
        field: 'status',
        headerName: 'STATUT',
        width: 160,
        cellRenderer: StatusRenderer,
      });
    }

    if (visibleKeys.has('assignedTo')) {
      cols.push({
        field: 'assignedTo',
        headerName: 'ASSIGNÉ',
        width: 180,
        cellRenderer: AssigneeRenderer,
        valueGetter: (p) => p.data?.assignedTo?.fullName || '',
      });
    }

    if (visibleKeys.has('requester')) {
      cols.push({
        field: 'requester',
        headerName: 'DEMANDEUR',
        width: 180,
        cellRenderer: RequesterRenderer,
        valueGetter: (p) => p.data?.requester?.fullName || p.data?.sourceName || '',
      });
    }

    if (visibleKeys.has('location')) {
      cols.push({
        field: 'location',
        headerName: 'LIEU',
        width: 160,
        cellRenderer: LocationRenderer,
        valueGetter: (p) => p.data?.glpiLocationName || '',
      });
    }

    if (visibleKeys.has('observers')) {
      cols.push({
        field: 'observers',
        headerName: 'OBSERVATEURS',
        width: 200,
        cellRenderer: ObserverRenderer,
        valueGetter: (p) => (p.data?.observers || []).map((o) => o.fullName).join(', '),
      });
    }

    if (visibleKeys.has('createdAt')) {
      cols.push({
        field: 'createdAt',
        headerName: 'OUVERT',
        width: 120,
        valueFormatter: (p) => formatDateShort(p.value),
      });
    }

    if (visibleKeys.has('updatedAt')) {
      cols.push({
        field: 'updatedAt',
        headerName: 'MODIFIÉ',
        width: 120,
        valueFormatter: (p) => formatDateShort(p.value),
      });
    }

    // Actions column — pinned right (always visible)
    cols.push({
      headerName: '',
      width: 80,
      pinned: 'right',
      cellRenderer: ActionsRenderer,
      sortable: false,
      filter: false,
      suppressMenu: true,
      resizable: false,
      suppressMovable: true,
    });

    return cols;
  }, [visibleKeys, showSelectionColumn]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full min-w-0 gap-0">

      {/* ── COMPACT HEADER ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Ticket className="w-4 h-4 text-primary shrink-0" />
          <h1 className="text-sm font-bold text-foreground whitespace-nowrap">Tickets</h1>
          <span className="text-[11px] text-muted-foreground font-medium tabular-nums">
            {totalCount > 0 && `${totalCount}`}
          </span>
        </div>

        <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative group">
            <button className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all" title="Exporter">
              <FileSpreadsheet className="w-4 h-4" />
            </button>
            <div className="absolute right-0 top-full pt-1 z-30 hidden group-hover:block">
              <div className="rounded-xl border border-border/30 bg-surface shadow-xl p-1.5 min-w-[180px]">
                <button onClick={() => exportAll('xlsx')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-foreground hover:bg-surface-muted transition-colors cursor-pointer text-left">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" /> Exporter tout (XLSX)
                </button>
                <button onClick={() => exportAll('csv')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-foreground hover:bg-surface-muted transition-colors cursor-pointer text-left">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" /> Exporter tout (CSV)
                </button>
                <button onClick={() => exportAll('json')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-foreground hover:bg-surface-muted transition-colors cursor-pointer text-left">
                  <FileCode2 className="w-3.5 h-3.5 text-blue-500" /> Exporter tout (JSON)
                </button>
              </div>
            </div>
          </div>

          <button onClick={() => loadTickets(true)} disabled={refreshing}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all disabled:opacity-40" title="Rafraîchir">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <div className="flex items-center p-0.5 rounded-lg border border-border/30 bg-surface-muted gap-0.5">
            {[
              { mode: 'table', Icon: Table, label: 'Tableau' },
              { mode: 'grid', Icon: LayoutGrid, label: 'Grille' },
              { mode: 'carousel', Icon: Sparkles, label: 'Carousel' },
              { mode: 'kanban', Icon: KanbanSquare, label: 'Kanban' },
            ].map(({ mode, Icon, label }) => (
              <button key={mode} onClick={() => changeViewMode(mode)} title={label}
                className={`p-1.5 rounded-md transition-all ${viewMode === mode ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>

          {viewMode === 'table' && (
            <ColumnConfigPanel columns={columns} onChange={setColumns} />
          )}

          <button onClick={() => setFilterPanelOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              activeFilterCount > 0
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'border-border/30 text-muted-foreground hover:text-foreground hover:bg-surface-muted'
            }`}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Filtres</span>
            {activeFilterCount > 0 && (
              <span className="min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>

          <button onClick={toggleForm}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shadow-sm">
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau</span>
          </button>
        </div>
      </div>

      {/* ── STATS BAR ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 sm:px-6 py-3 shrink-0">
        {[
          { label: 'Total', value: totalCount, color: 'text-on-surface' },
          { label: 'Ouverts', value: serverStats.open, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Résolus', value: serverStats.resolved, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Fermés', value: serverStats.pending, color: 'text-slate-600 dark:text-slate-400' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-on-surface-variant">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <div ref={tableContainerRef} className="flex-1 min-h-0 relative flex flex-col">
        {error && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} className="p-1 hover:bg-red-500/20 rounded cursor-pointer"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {refreshing && !loading && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-surface border border-border/30 shadow-md text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin" /> Mise à jour...
            </div>
          </div>
        )}

        {loading ? (
          <TableSkeleton />
        ) : viewMode === 'carousel' ? (
          <TicketCoverflowCarousel tickets={tickets} isDark={isDark} />
        ) : viewMode === 'kanban' ? (
          <KanbanBoard
            tickets={tickets} canAssign={canAssign}
            onStatusChange={(ticket, newStatus) => handleQuickStatusChange(ticket.id, newStatus)}
          />
        ) : viewMode === 'grid' ? (
          /* ── GRID VIEW ── */
          <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {tickets.map((t) => (
                <motion.div key={t.id} initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className="rounded-xl border border-border/25 bg-surface hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group relative overflow-hidden p-4 flex flex-col gap-3">
                  <div className={`absolute top-0 left-0 right-0 h-0.5 ${
                    t.priority === 'P1' ? 'bg-red-500' : t.priority === 'P2' ? 'bg-orange-400' :
                    t.priority === 'P3' ? 'bg-amber-400' : 'bg-emerald-500'
                  }`} />
                  <div className="flex items-start justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5">
                      <PriorityDot priority={t.priority} />
                      <span className="text-[11px] font-mono text-muted-foreground">#{t.id}</span>
                    </div>
                    <StatusPill status={t.status} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-2">
                      <HighlightText text={t.title} query={debouncedSearch} />
                    </p>
                    {t.category && (
                      <span className="mt-1 inline-block text-[10px] font-medium text-muted-foreground bg-surface-muted px-2 py-0.5 rounded-full">
                        {t.category}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-auto">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {t.glpiLocationName && <><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[100px]">{t.glpiLocationName}</span></>}
                    </div>
                    {t.assignedTo ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar name={t.assignedTo.fullName} />
                        <span className="text-[11px] font-medium text-foreground truncate max-w-[80px]">{t.assignedTo.fullName}</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/60 italic">Non assigné</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {tickets.length === 0 && (
              <div className="col-span-full py-16">
                <EmptyState icon="tickets" title="Aucun ticket trouvé" description="Modifie les filtres ou crée un nouveau ticket." />
              </div>
            )}
          </div>
        ) : (
          /* ── TABLE VIEW (AG Grid with pinned columns — Katalyst style) ── */
          <div className="flex-1 min-h-0 mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4 flex flex-col">
            <div className="flex-1 min-h-0 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden flex flex-col">
              <DataGrid
                columns={gridColumnDefs}
                rowData={tickets}
                context={agGridContext}
                rowSelection={showSelectionColumn ? 'multiple' : undefined}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                pagination={false}
                loading={false}
                animateRows={true}
                headerHeight={44}
                rowHeight={60}
                suppressRowClickSelection={!!showSelectionColumn}
                onRowClick={(data) => navigate(`/tickets/${data.id}`)}
                noRowsText="Aucun ticket trouvé"
                className="rounded-2xl overflow-hidden flex-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── BULK ACTIONS BAR ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-border/30 bg-surface shadow-2xl shadow-black/20">
            <span className="text-xs font-bold text-muted-foreground pr-2 border-r border-border/30 mr-1">
              {selectedIds.length} sélectionné{selectedIds.length > 1 ? 's' : ''}
            </span>
            {canAssign && (
              <>
                <select value={bulkChanges.status} onChange={(e) => setBulkChanges((b) => ({ ...b, status: e.target.value }))}
                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none">
                  <option value="">Statut…</option>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={bulkChanges.priority} onChange={(e) => setBulkChanges((b) => ({ ...b, priority: e.target.value }))}
                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none">
                  <option value="">Priorité…</option>
                  {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={bulkChanges.assignedToId} onChange={(e) => setBulkChanges((b) => ({ ...b, assignedToId: e.target.value }))}
                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none max-w-[120px]">
                  <option value="">Assigner…</option>
                  <option value="none">Non assigné</option>
                  {users.filter((u) => u.isActive).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                </select>
                <button onClick={handleBulkUpdate} disabled={bulkUpdating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50">
                  <CheckSquare className="w-3.5 h-3.5" />
                  {bulkUpdating ? 'Application…' : 'Appliquer'}
                </button>
              </>
            )}
            {canBulkDelete && (
              <button onClick={askDeleteSelected} disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            )}
            <button onClick={() => { setSelectedIds([]); setBulkChanges({ status: '', priority: '', assignedToId: '' }); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PAGINATION ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium tabular-nums">
            {totalCount > 0
              ? `${Math.min((page - 1) * pageSize + 1, totalCount)}–${Math.min(page * pageSize, totalCount)} sur ${totalCount.toLocaleString('fr-FR')}`
              : '0 résultat'}
          </span>
          <div className="w-px h-3.5 bg-border/40" />
          <select value={pageSize}
            onChange={(e) => { const v = Number(e.target.value); setPageSize(v); localStorage.setItem('tickets_page_size', String(v)); setPage(1); }}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
        <PaginationButtons page={page} totalPages={Math.max(totalPages, 1)} onPageChange={setPage} />
      </div>

      {/* ── DRAWER DE FILTRES ────────────────────────────────────────────────── */}
      <TicketFilterDrawer
        key="tickets-filter-drawer"
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        activeFilterCount={activeFilterCount}
        filters={filters} onUpdate={updateFilter} onClear={clearFilters}
        teams={teams} users={users} flatCategories={flatCategories}
        autonomousMode={autonomousMode}
        savedViews={savedViews} onSaveView={saveCurrentView}
        onRestoreView={restoreView} onDeleteSavedView={deleteSavedView}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        setDebouncedSearch={setDebouncedSearch} setPage={setPage}
      />

      {/* ── CREATE TICKET MODAL ──────────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showForm && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={toggleForm} className="fixed inset-0 bg-black/60 backdrop-blur-sm cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.97, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 12 }} transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }}
                className={`relative max-w-3xl w-full rounded-2xl border p-6 sm:p-7 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col z-10 ${
                  isDark ? 'bg-surface border-border/40 text-foreground' : 'bg-white border-slate-200 text-slate-900'
                }`}>
                <div className="flex items-center justify-between pb-4 border-b border-border/20 mb-5 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-primary/10 rounded-lg">
                      <Plus className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">Nouveau ticket d'assistance</h3>
                      <p className="text-[11px] text-muted-foreground">Remplissez les informations ci-dessous.</p>
                    </div>
                  </div>
                  <button type="button" onClick={toggleForm}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleCreate} className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {error && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{error}</span>
                      <button type="button" onClick={() => setError('')} className="p-0.5 hover:bg-red-500/20 rounded"><X className="w-3 h-3" /></button>
                    </div>
                  )}

                  {templates.length > 0 && (
                    <FormField label="Modèle (pré-remplissage)">
                      <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)} className={FIELD_CLS}>
                        <option value="">— Aucun modèle —</option>
                        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}</option>)}
                      </select>
                    </FormField>
                  )}

                  <FormField label="Titre *">
                    <input type="text" required value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="ex: Problème d'impression ou accès réseau..." className={FIELD_CLS} />
                  </FormField>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Catégorie">
                      <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={FIELD_CLS}>
                        <option value="">Sélectionner une catégorie</option>
                        {flatCategories.map((o) => <option key={o.id} value={o.name}>{o.label}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Priorité">
                      <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={FIELD_CLS}>
                        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p} — {p === 'P1' ? 'Critique' : p === 'P2' ? 'Haute' : p === 'P3' ? 'Moyenne' : 'Basse'}</option>)}
                      </select>
                    </FormField>
                  </div>

                  {customFieldDefs.length > 0 && (
                    <div className="rounded-xl border border-dashed border-primary/25 bg-primary/5 p-4 space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
                        <ListChecks className="w-3.5 h-3.5" /> Informations complémentaires
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {customFieldDefs.map((f) => {
                          const key = String(f.id);
                          const set = (v) => setCustomValues((prev) => ({ ...prev, [key]: v }));
                          return (
                            <div key={f.id} className={f.type === 'TEXTAREA' ? 'sm:col-span-2' : ''}>
                              <FormField label={<>{f.label} {f.required && <span className="text-red-500">*</span>}</>}>
                                {f.type === 'TEXT' && <input type="text" value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={FIELD_CLS} />}
                                {f.type === 'TEXTAREA' && <textarea rows={3} value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={`${FIELD_CLS} resize-none`} />}
                                {f.type === 'NUMBER' && <input type="number" value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={FIELD_CLS} />}
                                {f.type === 'DATE' && <input type="date" value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={FIELD_CLS} />}
                                {f.type === 'CHECKBOX' && (
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={!!customValues[key]} onChange={(e) => set(e.target.checked ? 'true' : '')} className="accent-primary w-4 h-4" />
                                    <span className="text-sm text-foreground">{customValues[key] === 'true' ? 'Oui' : 'Non'}</span>
                                  </label>
                                )}
                                {f.type === 'SELECT' && (
                                  <select value={customValues[key] || ''} onChange={(e) => set(e.target.value)} className={`${FIELD_CLS} cursor-pointer`}>
                                    <option value="">— Sélectionner —</option>
                                    {(f.options || []).map((o) => {
                                      const v = typeof o === 'string' ? o : o.value;
                                      const l = typeof o === 'string' ? o : o.label;
                                      return <option key={v} value={v}>{l}</option>;
                                    })}
                                  </select>
                                )}
                              </FormField>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label="Type de demande">
                      <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={FIELD_CLS}>
                        {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Source de la demande">
                      <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={FIELD_CLS}>
                        {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </FormField>
                    {locations.length > 0 && (
                      <FormField label="Lieu / Emplacement">
                        <SearchableSelect options={locations} value={form.locationId}
                          onChange={(val) => setForm({ ...form, locationId: val })}
                          placeholder="Rechercher un lieu GLPI..." searchPlaceholder="Rechercher un lieu..." />
                      </FormField>
                    )}
                    {canAssign && teams.length > 0 && (
                      <FormField label="Équipe assignée">
                        <select value={form.teamId} onChange={(e) => {
                          const selectedTeam = teams.find((t) => String(t.id) === e.target.value);
                          const teamObserverIds = (selectedTeam?.defaultObservers || []).map((o) => o.id);
                          setForm({ ...form, teamId: e.target.value, assignedToId: '', observerIds: teamObserverIds });
                        }} className={FIELD_CLS}>
                          <option value="">— Aucune équipe —</option>
                          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </FormField>
                    )}
                    {canAssign && users.length > 0 && (
                      <FormField label="Assigné à">
                        <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })} className={FIELD_CLS}>
                          <option value="">— Non assigné —</option>
                          {users.filter((u) => u.isActive).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                        </select>
                      </FormField>
                    )}
                  </div>

                  <FormField label="Demandeur">
                    <RemoteUserSelect value={form.requesterId} onChange={(val) => setForm({ ...form, requesterId: val })}
                      glpiUsers={glpiUsers} placeholder="Rechercher un demandeur..." />
                  </FormField>

                  <FormField label="Observateurs">
                    <RemoteUserMultiSelect value={form.observerIds} onChange={(vals) => setForm({ ...form, observerIds: vals })}
                      users={users} glpiUsers={glpiUsers} placeholder="Rechercher un observateur..." />
                  </FormField>

                  {assetOptions.length > 0 && (
                    <FormField label="Assets liés">
                      <SearchableMultiSelect options={assetOptions} value={form.assetIds}
                        onChange={(vals) => setForm({ ...form, assetIds: vals })}
                        placeholder="Rechercher un asset..." />
                    </FormField>
                  )}

                  <FormField label="Description">
                    <textarea rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
                      placeholder="Décrivez le problème..." className={`${FIELD_CLS} resize-none`} />
                  </FormField>

                  <FormField label="Pièce jointe">
                    <input type="file" onChange={(e) => setAttachment(e.target.files?.[0] || null)} className="text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:cursor-pointer" />
                  </FormField>

                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/20">
                    <button type="button" onClick={toggleForm}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-surface-muted transition-colors">
                      Annuler
                    </button>
                    <button type="submit" disabled={creating}
                      className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm">
                      {creating ? 'Création…' : 'Créer le ticket'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── CONFIRM DELETE ───────────────────────────────────────────────────── */}
      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.mode === 'one' ? 'Supprimer ce ticket ?' : `Supprimer ${selectedIds.length} ticket(s) ?`}
          message="Cette action est irréversible."
          confirmLabel="Supprimer"
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
          loading={deleting}
          danger
        />
      )}
    </div>
  );
}
