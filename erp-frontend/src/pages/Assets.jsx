import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Boxes, Plus, Search, RefreshCw, Trash2, Pencil, X,
  Monitor, Printer, Network, Package, Phone, HelpCircle,
  AlertTriangle, Calendar, MapPin, User, Check, CheckCircle2
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';

const TYPE_META = {
  COMPUTER: { label: 'Ordinateur', icon: Monitor, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  PRINTER: { label: 'Imprimante', icon: Printer, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  NETWORK: { label: 'Réseau', icon: Network, color: 'text-teal-400', bg: 'bg-teal-500/10' },
  SOFTWARE: { label: 'Logiciel', icon: Package, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  PHONE: { label: 'Téléphone', icon: Phone, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  OTHER: { label: 'Autre', icon: HelpCircle, color: 'text-slate-400', bg: 'bg-slate-500/10' },
};

const STATUS_META = {
  IN_USE: { label: 'En service', color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  STOCK: { label: 'En stock', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  BROKEN: { label: 'En panne', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  OUT_OF_SERVICE: { label: 'Hors service', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
};

const EMPTY_FORM = {
  name: '', assetType: 'COMPUTER', serialNumber: '', inventoryNumber: '', status: 'IN_USE',
  manufacturer: '', model: '', locationId: '', ownerId: '', teamId: '', purchaseDate: '', warrantyEnd: '', notes: '',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

const inputCls = 'w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

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
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

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

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    let list = [...assets].sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
        case 'assetType': va = (a.assetType || '').toLowerCase(); vb = (b.assetType || '').toLowerCase(); break;
        case 'status': va = (a.status || '').toLowerCase(); vb = (b.status || '').toLowerCase(); break;
        case 'manufacturer': va = (a.manufacturer || '').toLowerCase(); vb = (b.manufacturer || '').toLowerCase(); break;
        case 'location': va = (a.glpiLocation?.name || '').toLowerCase(); vb = (b.glpiLocation?.name || '').toLowerCase(); break;
        case 'owner': va = (a.owner?.fullName || '').toLowerCase(); vb = (b.owner?.fullName || '').toLowerCase(); break;
        case 'warrantyEnd': va = a.warrantyEnd || ''; vb = b.warrantyEnd || ''; break;
        default: va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [assets, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter]);

  function SortHeader({ col, children }) {
    const active = sortBy === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none transition-colors ${active ? 'text-blue-600' : 'text-on-surface-variant hover:text-on-surface'}`}
      >
        <span className="inline-flex items-center gap-1">
          {children}
        </span>
      </th>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <Boxes className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Inventaire</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">{assets.length} équipement(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button onClick={openCreate}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all">
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nouvel équipement</span>
            </button>
          )}
          {!autonomousMode && canManage && (
            <button onClick={handleSync} disabled={syncing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-outline-variant/40 text-on-surface-variant text-xs font-semibold hover:bg-surface-container transition-all disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync GLPI</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Search + Filters ────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, n° de série..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all">
          <option value="">Tous les types</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* ── Bulk action bar ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-red-500/20 bg-red-500/5"
          >
            <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3">
              <span className="text-[11px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {selectedIds.length} sélectionné(s)
              </span>
              <button onClick={() => setSelectedIds([])}
                className="text-[10px] font-bold text-on-surface-variant hover:text-on-surface transition-colors">
                Tout désélectionner
              </button>
              <button onClick={() => setPendingBulkDelete(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-xs font-semibold hover:bg-red-500/15 transition-all ml-auto">
                <Trash2 className="w-3 h-3" />
                Supprimer ({selectedIds.length})
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tableau ─────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 pb-6">
        {loading ? (
          <div className="text-center py-12 text-on-surface/40">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            Chargement...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-on-surface/40">
            <Boxes className="w-12 h-12 mx-auto mb-3 opacity-30" />
            {search || typeFilter || statusFilter ? 'Aucun équipement ne correspond à vos critères' : 'Aucun équipement. Créez-en un ou synchronisez GLPI.'}
          </div>
        ) : (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant/20 bg-surface-container-low/50">
                  {canManage && (
                    <th className="px-3 py-2.5 w-10">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && selectedIds.length === filtered.length}
                        onChange={() => setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map(a => a.id))}
                        className="w-3.5 h-3.5 cursor-pointer accent-blue-600 rounded"
                      />
                    </th>
                  )}
                  <SortHeader col="name">Nom</SortHeader>
                  <SortHeader col="assetType">Type</SortHeader>
                  <SortHeader col="status">Statut</SortHeader>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">N° série</th>
                  <SortHeader col="manufacturer">Constructeur</SortHeader>
                  <SortHeader col="location">Lieu</SortHeader>
                  <SortHeader col="owner">Propriétaire</SortHeader>
                  <SortHeader col="warrantyEnd">Garantie</SortHeader>
                  {canManage && <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginated.map((asset) => {
                  const tm = typeMeta(asset.assetType);
                  const sm = statusMeta(asset.status);
                  const Icon = tm.icon;
                  const expiring = isWarrantyExpiring(asset);
                  return (
                    <tr
                      key={asset.id}
                      className="group border-b border-outline-variant/10 hover:bg-blue-500/5 transition-colors cursor-pointer"
                      onClick={() => canManage && openEdit(asset)}
                    >
                      {canManage && (
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(asset.id)}
                            onChange={() => setSelectedIds(ids => ids.includes(asset.id) ? ids.filter(i => i !== asset.id) : [...ids, asset.id])}
                            className="w-3.5 h-3.5 cursor-pointer accent-blue-600 rounded"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className={`p-1 rounded-md shrink-0 ${tm.bg} ${tm.color}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-on-surface truncate block">{asset.name}</span>
                            {(asset.serialNumber || asset.inventoryNumber) && (
                              <span className="text-[10px] text-on-surface/50 font-mono truncate block">{asset.inventoryNumber || asset.serialNumber}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tm.bg} ${tm.color}`}>{tm.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sm.bg} ${sm.color} border ${sm.border}`}>{sm.label}</span>
                          {expiring && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-0.5">
                              <AlertTriangle className="w-2.5 h-2.5" /> Garantie ≤60j
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-on-surface-variant font-mono">{asset.serialNumber || '—'}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-on-surface-variant">{[asset.manufacturer, asset.model].filter(Boolean).join(' ') || '—'}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-on-surface-variant truncate block max-w-[120px]">{asset.glpiLocation?.name || '—'}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-on-surface-variant truncate block max-w-[100px]">{asset.owner?.fullName || '—'}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-on-surface-variant font-mono">{fmtDate(asset.warrantyEnd)}</span>
                      </td>
                      {canManage && (
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => openEdit(asset)} title="Modifier"
                              className="p-1.5 rounded-lg text-on-surface/60 hover:text-blue-500 hover:bg-blue-500/10 cursor-pointer transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDeleteSingle(asset)} title="Supprimer"
                              className="p-1.5 rounded-lg text-on-surface/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>            </table>
            <Pagination page={page} totalPages={totalPages} total={filtered.length} label="équipements" onPageChange={setPage} />
          </div>
        )}
      </div>


      {/* ── Modal Création / Édition ────────────────────────────────────── */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closeModal}
              className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20 sticky top-0 bg-surface z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-blue-500/10">
                    {modalMode === 'edit' ? <Pencil className="w-4 h-4 text-blue-600 dark:text-blue-400" /> : <Plus className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-on-surface">
                      {modalMode === 'edit' ? 'Modifier l\'équipement' : 'Nouvel équipement'}
                    </h2>
                    {modalMode === 'edit' && <p className="text-[11px] text-on-surface-variant">{form.name}</p>}
                  </div>
                </div>
                <motion.button onClick={closeModal} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                  <X className="w-4 h-4" />
                </motion.button>
              </div>

              {/* Body */}
              <form onSubmit={handleSave} className="px-5 py-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom *</span>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                      placeholder="Nom de l'équipement" className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Type</span>
                    <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} className={inputCls}>
                      {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Statut</span>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                      {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">N° de série</span>
                    <input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                      placeholder="N° de série" className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">N° d'inventaire</span>
                    <input value={form.inventoryNumber} onChange={(e) => setForm({ ...form, inventoryNumber: e.target.value })}
                      placeholder="N° d'inventaire" className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Constructeur</span>
                    <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                      placeholder="Constructeur" className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Modèle</span>
                    <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                      placeholder="Modèle" className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Lieu</span>
                    <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className={inputCls}>
                      <option value="">— Lieu —</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.completename || l.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Propriétaire</span>
                    <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className={inputCls}>
                      <option value="">— Propriétaire —</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Équipe</span>
                    <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className={inputCls}>
                      <option value="">— Équipe —</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Date d'achat</span>
                    <input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Fin de garantie</span>
                    <input type="date" value={form.warrantyEnd} onChange={(e) => setForm({ ...form, warrantyEnd: e.target.value })} className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Notes</span>
                    <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="Notes" className={`${inputCls} resize-none`} />
                  </label>
                </div>
              </form>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/20 bg-surface-container-low/40 sticky bottom-0">
                <button type="button" onClick={closeModal}
                  className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors">
                  Annuler
                </button>
                <button onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 transition-all disabled:opacity-50">
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {saving ? 'Enregistrement...' : modalMode === 'edit' ? 'Mettre à jour' : 'Créer'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Confirm Bulk Delete ──────────────────────────────────────────── */}
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
