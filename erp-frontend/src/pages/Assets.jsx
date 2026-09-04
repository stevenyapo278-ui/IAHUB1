import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Boxes, Plus, Search, RefreshCw, Trash2, Pencil, X, Check,
  Monitor, Printer, Network, Package, Phone, HelpCircle,
  AlertTriangle, CheckCircle2, ShieldAlert, ChevronLeft, ChevronRight, Filter,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import DataGrid from '../components/DataGrid';
import FormDrawer from '../components/FormDrawer';

const TYPE_META = {
  COMPUTER: { label: 'Ordinateur', icon: Monitor, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  PRINTER: { label: 'Imprimante', icon: Printer, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  NETWORK: { label: 'Réseau', icon: Network, color: 'text-teal-400', bg: 'bg-teal-500/10' },
  SOFTWARE: { label: 'Logiciel', icon: Package, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  PHONE: { label: 'Téléphone', icon: Phone, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  OTHER: { label: 'Autre', icon: HelpCircle, color: 'text-on-surface-variant', bg: 'bg-surface-container' },
};

const STATUS_META = {
  IN_USE: { label: 'En service', color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  STOCK: { label: 'En stock', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  BROKEN: { label: 'En panne', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  OUT_OF_SERVICE: { label: 'Hors service', color: 'text-on-surface-variant', bg: 'bg-surface-container', border: 'border-slate-500/20' },
};

const EMPTY_FORM = {
  name: '', assetType: 'COMPUTER', serialNumber: '', inventoryNumber: '', status: 'IN_USE',
  manufacturer: '', model: '', locationId: '', ownerId: '', teamId: '', purchaseDate: '', warrantyEnd: '', notes: '',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function PaginationButtons({ page, totalPages, onPageChange }) {
  const [jumpValue, setJumpValue] = useState('');
  const jumpRef = useRef(null);

  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const r = [1];
    if (page > 3) r.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) r.push(i);
    if (page < totalPages - 2) r.push('...');
    r.push(totalPages);
    return r;
  }, [page, totalPages]);

  function handleJump(e) {
    e.preventDefault();
    const val = parseInt(jumpValue, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages && val !== page) {
      onPageChange(val);
    }
    setJumpValue('');
    jumpRef.current?.blur();
  }

  const btn = 'h-10 min-w-[40px] flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95';
  const on = 'text-muted-foreground hover:bg-surface-muted hover:text-foreground';
  const off = 'text-muted-foreground/30 cursor-not-allowed';
  const active = 'bg-primary text-primary-foreground shadow-sm shadow-primary/20';

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="Première page"
        className={`${btn} px-1.5 ${page <= 1 ? off : on}`}><ChevronsLeft className="w-4 h-4" /></button>
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Page précédente"
        className={`${btn} px-1.5 ${page <= 1 ? off : on}`}><ChevronLeft className="w-4 h-4" /></button>
      {pages.map((p, i) => p === '...' ? (
        <span key={`dots-${i}`} className="w-8 h-10 flex items-center justify-center text-xs text-muted-foreground/40">…</span>
      ) : (
        <button key={p} onClick={() => onPageChange(p)} aria-label={`Page ${p}`} aria-current={p === page ? 'page' : undefined}
          className={`${btn} px-1 ${p === page ? active : on}`}>{p}</button>
      ))}
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} aria-label="Page suivante"
        className={`${btn} px-1.5 ${page >= totalPages ? off : on}`}><ChevronRight className="w-4 h-4" /></button>
      <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} aria-label="Dernière page"
        className={`${btn} px-1.5 ${page >= totalPages ? off : on}`}><ChevronsRight className="w-4 h-4" /></button>
      <form onSubmit={handleJump} className="flex items-center gap-1.5 ml-2">
        <span className="text-[11px] text-muted-foreground">→</span>
        <input ref={jumpRef} type="number" min={1} max={totalPages} value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)} placeholder={`1–${totalPages}`}
          className="w-16 h-8 px-2 text-[11px] text-center font-semibold bg-surface border border-border/40 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
      </form>
    </div>
  );
}

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

export default function Assets() {
  const { user } = useAuth();
  const { autonomousMode } = useSystemSettings();
  const [assets, setAssets] = useState([]);
  const [locations, setLocations] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [pageSize, setPageSize] = useState(() => {
    const s = localStorage.getItem('assets_page_size');
    return s ? parseInt(s, 10) : 25;
  });
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const canManage = hasPermission(user, 'assets.manage');

  function loadAssets() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (typeFilter) params.set('assetType', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/assets?${params}&pageSize=200`)
      .then(({ data }) => setAssets(Array.isArray(data) ? data : (data.assets || [])))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur chargement inventaire'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAssets();
    api.get('/glpi/locations').then(({ data }) => setLocations(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : (data.users || []))).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(Array.isArray(data) ? data : (data.teams || []))).catch(() => {});
  }, [search, typeFilter, statusFilter]);

  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter]);

  async function handleSync() {
    setSyncing(true);
    try {
      const { data } = await api.post('/assets/sync-glpi');
      toast.success(`${data.synced} équipement(s) synchronisé(s) depuis GLPI`);
      loadAssets();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur sync GLPI');
    } finally {
      setSyncing(false);
    }
  }

  function openCreate() {
    setModalMode('create');
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(asset) {
    setModalMode('edit');
    setEditingId(asset.id);
    setForm({
      name: asset.name, assetType: asset.assetType, serialNumber: asset.serialNumber || '',
      inventoryNumber: asset.inventoryNumber || '', status: asset.status,
      manufacturer: asset.manufacturer || '', model: asset.model || '',
      locationId: asset.glpiLocation ? String(asset.glpiLocation.id) : '',
      ownerId: asset.owner ? String(asset.owner.id) : '',
      teamId: asset.team ? String(asset.team.id) : '',
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.slice(0, 10) : '',
      warrantyEnd: asset.warrantyEnd ? asset.warrantyEnd.slice(0, 10) : '',
      notes: asset.notes || '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Le nom est obligatoire');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), assetType: form.assetType, serialNumber: form.serialNumber || null,
        inventoryNumber: form.inventoryNumber || null, status: form.status,
        manufacturer: form.manufacturer || null, model: form.model || null,
        locationId: form.locationId ? Number(form.locationId) : null,
        ownerId: form.ownerId ? Number(form.ownerId) : null,
        teamId: form.teamId ? Number(form.teamId) : null,
        purchaseDate: form.purchaseDate || null, warrantyEnd: form.warrantyEnd || null,
        notes: form.notes || null,
      };
      if (modalMode === 'edit' && editingId) {
        await api.patch(`/assets/${editingId}`, payload);
        toast.success('Équipement mis à jour');
      } else {
        await api.post('/assets', payload);
        toast.success('Équipement créé');
      }
      closeModal();
      loadAssets();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSingle(asset) {
    if (!window.confirm(`Supprimer l'équipement « ${asset.name} » ?`)) return;
    try {
      await api.delete(`/assets/${asset.id}`);
      toast.success('Équipement supprimé');
      loadAssets();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      await api.post('/assets/bulk-delete', { ids: selectedIds });
      toast.success(`${selectedIds.length} équipement(s) supprimé(s)`);
      setSelectedIds([]);
      setPendingBulkDelete(false);
      loadAssets();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setBulkDeleting(false);
    }
  }

  const statusMeta = (s) => STATUS_META[s] || STATUS_META.OUT_OF_SERVICE;
  const typeMeta = (t) => TYPE_META[t] || TYPE_META.OTHER;

  const isWarrantyExpiring = (asset) => {
    if (!asset.warrantyEnd) return false;
    const days = (new Date(asset.warrantyEnd) - new Date()) / 86400000;
    return days >= 0 && days <= 60;
  };

  const inService = useMemo(() => assets.filter((a) => a.status === 'IN_USE').length, [assets]);
  const broken = useMemo(() => assets.filter((a) => a.status === 'BROKEN').length, [assets]);
  const expiringWarranty = useMemo(() => assets.filter(isWarrantyExpiring).length, [assets]);

  const total = assets.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paginatedAssets = assets.slice((page - 1) * pageSize, page * pageSize);

  const columnDefs = useMemo(() => {
    const cols = [
      {
        field: 'name', headerName: 'Nom', flex: 1.5, minWidth: 180,
        cellRenderer: (params) => {
          const tm = typeMeta(params.data.assetType);
          const Icon = tm.icon;
          return (
            <div className="flex items-center gap-2">
              <div className={`p-1 rounded-md shrink-0 ${tm.bg} ${tm.color}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <span className="text-sm font-semibold text-on-surface truncate block">{params.value}</span>
                {(params.data.serialNumber || params.data.inventoryNumber) && (
                  <span className="text-[10px] text-on-surface/50 font-mono truncate block">{params.data.inventoryNumber || params.data.serialNumber}</span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        field: 'assetType', headerName: 'Type', width: 120,
        cellRenderer: (params) => {
          const tm = typeMeta(params.value);
          return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tm.bg} ${tm.color}`}>{tm.label}</span>;
        },
      },
      {
        field: 'status', headerName: 'Statut', width: 140,
        cellRenderer: (params) => {
          const sm = statusMeta(params.value);
          const expiring = isWarrantyExpiring(params.data);
          return (
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sm.bg} ${sm.color} border ${sm.border}`}>{sm.label}</span>
              {expiring && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-0.5">
                  <AlertTriangle className="w-2.5 h-2.5" /> Garantie ≤60j
                </span>
              )}
            </div>
          );
        },
      },
      {
        field: 'serialNumber', headerName: 'N° série', width: 130,
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant font-mono">{params.value || '—'}</span>,
      },
      {
        field: 'manufacturer', headerName: 'Constructeur', width: 150,
        valueGetter: (params) => [params.data.manufacturer, params.data.model].filter(Boolean).join(' ') || '—',
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant">{params.value}</span>,
      },
      {
        field: 'location', headerName: 'Lieu', width: 130,
        valueGetter: (params) => params.data.glpiLocation?.name || '',
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant truncate block max-w-[120px]">{params.value || '—'}</span>,
      },
      {
        field: 'owner', headerName: 'Propriétaire', width: 130,
        valueGetter: (params) => params.data.owner?.fullName || '',
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant truncate block max-w-[100px]">{params.value || '—'}</span>,
      },
      {
        field: 'warrantyEnd', headerName: 'Garantie', width: 110,
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant font-mono">{fmtDate(params.value)}</span>,
        comparator: (a, b) => (a || '').localeCompare(b || ''),
      },
    ];

    if (canManage) {
      cols.push({
        field: 'actions', headerName: '', width: 80, sortable: false, filter: false,
        cellRenderer: (params) => (
          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); openEdit(params.data); }} title="Modifier"
              className="p-1.5 rounded-lg text-on-surface/60 hover:text-blue-500 hover:bg-blue-500/10 cursor-pointer transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleDeleteSingle(params.data); }} title="Supprimer"
              className="p-1.5 rounded-lg text-on-surface/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      });
    }

    return cols;
  }, [canManage]);

  return (
    <div className="flex flex-col h-full w-full min-w-0 gap-0">
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <Boxes className="w-4 h-4 text-blue-500 shrink-0" />
          <h1 className="text-sm font-bold text-on-surface whitespace-nowrap">Inventaire</h1>
          <span className="text-[11px] text-on-surface-variant font-medium tabular-nums">
            {total > 0 && `${total}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!autonomousMode && canManage && (
            <button onClick={handleSync} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/60 text-on-surface-variant text-xs font-semibold hover:bg-surface-container-high cursor-pointer transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync GLPI</span>
            </button>
          )}
          {canManage && (
            <button onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shadow-sm cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nouvel équipement</span>
            </button>
          )}
        </div>
      </div>

      {/* ── STATS ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 sm:px-6 py-3 shrink-0">
        {[
          { label: 'Total', value: total, color: 'text-on-surface' },
          { label: 'En service', value: inService, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'En panne', value: broken, color: 'text-red-600 dark:text-red-400' },
          { label: 'Garantie ≤60j', value: expiringWarranty, color: 'text-amber-600 dark:text-amber-400' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-on-surface-variant">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── SEARCH + FILTERS ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un équipement..."
            className={`${inputCls} w-full pl-9`}
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 rounded-xl border text-sm font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
            showFilters || typeFilter || statusFilter
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filtres
        </button>
        <button onClick={loadAssets}
          className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── FILTERS PANEL ──────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="bg-surface-container rounded-xl p-3 flex flex-wrap gap-3 items-center mx-4 sm:mx-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant font-medium">Type :</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className={`${inputCls} py-1.5 text-xs pr-8`}>
              <option value="">Tous</option>
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant font-medium">Statut :</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className={`${inputCls} py-1.5 text-xs pr-8`}>
              <option value="">Tous</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {(typeFilter || statusFilter) && (
            <button onClick={() => { setTypeFilter(''); setStatusFilter(''); }}
              className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
              <X className="w-3 h-3" /> Effacer
            </button>
          )}
        </div>
      )}

      {/* ── BULK ACTION BAR ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mx-4 sm:mx-6 mb-3"
          >
            <div className="px-4 py-2.5 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5">
              <span className="text-[11px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {selectedIds.length} sélectionné(s)
              </span>
              <button onClick={() => setSelectedIds([])}
                className="text-[10px] font-bold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
                Tout désélectionner
              </button>
              <button onClick={() => setPendingBulkDelete(true)}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-bold hover:bg-red-500/20 cursor-pointer transition-colors">
                <Trash2 className="w-3 h-3" />
                Supprimer ({selectedIds.length})
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <div className="flex-1 min-h-0 mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4 flex flex-col">
          <div className="flex-1 min-h-0 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden flex flex-col">
            <DataGrid
              columns={columnDefs}
              rowData={paginatedAssets}
              loading={loading}
              rowSelection={canManage ? 'multiple' : undefined}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowClick={(data) => canManage && openEdit(data)}
              pagination={false}
              noRowsText={search || typeFilter || statusFilter ? 'Aucun équipement ne correspond à vos critères' : 'Aucun équipement. Créez-en un ou synchronisez GLPI.'}
              className="rounded-2xl overflow-hidden flex-1"
            />
          </div>
        </div>
      </div>

      {/* ── PAGINATION ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium tabular-nums">
            {total > 0
              ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} sur ${total.toLocaleString('fr-FR')}`
              : '0 résultat'}
          </span>
          <div className="w-px h-3.5 bg-border/40" />
          <select value={pageSize}
            onChange={(e) => { const v = Number(e.target.value); setPageSize(v); localStorage.setItem('assets_page_size', String(v)); setPage(1); }}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
        <PaginationButtons page={page} totalPages={Math.max(totalPages, 1)} onPageChange={setPage} />
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}
      <FormDrawer
        open={modalOpen}
        onClose={closeModal}
        title={modalMode === 'edit' ? "Modifier l'équipement" : 'Nouvel équipement'}
        subtitle={modalMode === 'edit' ? form.name : null}
        icon={modalMode === 'edit' ? Pencil : Plus}
        iconColor="text-blue-400"
        size="lg"
        footer={
          <>
            <button type="button" onClick={closeModal} className="btn-secondary">Annuler</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim()} className="btn-primary">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {saving ? 'Enregistrement...' : modalMode === 'edit' ? 'Mettre à jour' : 'Créer'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="field-label">
              <span>Nom *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                placeholder="Nom de l'équipement" className="input-katalyst" />
            </label>
            <label className="field-label">
              <span>Type</span>
              <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} className="input-katalyst">
                {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>Statut</span>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-katalyst">
                {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>N° de série</span>
              <input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                placeholder="N° de série" className="input-katalyst" />
            </label>
            <label className="field-label">
              <span>N° d'inventaire</span>
              <input value={form.inventoryNumber} onChange={(e) => setForm({ ...form, inventoryNumber: e.target.value })}
                placeholder="N° d'inventaire" className="input-katalyst" />
            </label>
            <label className="field-label">
              <span>Constructeur</span>
              <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                placeholder="Constructeur" className="input-katalyst" />
            </label>
            <label className="field-label">
              <span>Modèle</span>
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="Modèle" className="input-katalyst" />
            </label>
            <label className="field-label">
              <span>Lieu</span>
              <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className="input-katalyst">
                <option value="">— Lieu —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.completename || l.name}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>Propriétaire</span>
              <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className="input-katalyst">
                <option value="">— Propriétaire —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>Équipe</span>
              <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className="input-katalyst">
                <option value="">— Équipe —</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>Date d'achat</span>
              <input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className="input-katalyst" />
            </label>
            <label className="field-label">
              <span>Fin de garantie</span>
              <input type="date" value={form.warrantyEnd} onChange={(e) => setForm({ ...form, warrantyEnd: e.target.value })} className="input-katalyst" />
            </label>
            <label className="field-label sm:col-span-2">
              <span>Notes</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notes" className="input-katalyst resize-none" />
            </label>
          </div>
        </form>
      </FormDrawer>

      {/* ── CONFIRM BULK DELETE ─────────────────────────────────────────────── */}
      <ConfirmDialog
        open={pendingBulkDelete}
        title="Supprimer les équipements"
        message={`Supprimer ${selectedIds.length} équipement(s) ? Les liens vers les tickets seront aussi supprimés.`}
        confirmLabel={`Supprimer (${selectedIds.length})`} danger loading={bulkDeleting}
        onConfirm={handleBulkDelete}
        onCancel={() => setPendingBulkDelete(false)}
      />
    </div>
  );
}
