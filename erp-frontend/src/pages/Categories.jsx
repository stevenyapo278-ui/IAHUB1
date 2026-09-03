import { useEffect, useMemo, useState, useRef } from 'react';
import { toast } from 'sonner';
import { Tag, Plus, Search, RefreshCw, Trash2, Pencil, Globe, FolderTree, ChevronRight, ChevronLeft, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { flattenCategoryTree } from '../utils/categoryTree';
import ConfirmDialog from '../components/ConfirmDialog';
import DataGrid from '../components/DataGrid';
import FormDrawer from '../components/FormDrawer';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function PaginationButtons({ page, totalPages, onPageChange }) {
  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const r = [];
    r.push(1);
    if (page > 3) r.push('...');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) r.push(i);
    if (page < totalPages - 2) r.push('...');
    r.push(totalPages);
    return r;
  }, [page, totalPages]);

  const btnBase = 'h-10 min-w-[40px] flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95';
  const btnEnabled = 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface';
  const btnDisabled = 'text-on-surface-variant/30 cursor-not-allowed';
  const btnActive = 'bg-primary text-on-primary shadow-sm shadow-primary/20';

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onPageChange(1)} disabled={page <= 1}
        className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}>
        <ChevronsLeft className="w-4 h-4" />
      </button>
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}
        className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="w-8 h-10 flex items-center justify-center text-xs text-on-surface-variant/30">…</span>
        ) : (
          <button key={p} onClick={() => onPageChange(p)}
            className={`${btnBase} px-1 ${p === page ? btnActive : btnEnabled}`}>
            {p}
          </button>
        )
      )}
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
        className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}>
        <ChevronRight className="w-4 h-4" />
      </button>
      <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}
        className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}>
        <ChevronsRight className="w-4 h-4" />
      </button>
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

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

export default function Categories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingCat, setEditingCat] = useState(null);
  const [form, setForm] = useState({ name: '', parentId: '' });
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission(user, 'tickets.manage');

  function loadCategories() {
    setLoading(true);
    api.get('/categories')
      .then(({ data }) => setCategories(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur chargement catégories'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadCategories(); }, []);

  const tree = useMemo(() => {
    const byParent = new Map();
    for (const c of categories) {
      const pid = c.parentId == null ? null : Number(c.parentId);
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(c);
    }
    const sort = (list) => list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    for (const list of byParent.values()) sort(list);
    return sort(byParent.get(null) || []);
  }, [categories]);

  const flatOptions = useMemo(() => flattenCategoryTree(categories), [categories]);

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    return categories.filter((c) => c.name?.toLowerCase().includes(search.toLowerCase()));
  }, [categories, search]);

  useEffect(() => { setPage(1); }, [search]);

  function openCreate() {
    setModalMode('create');
    setEditingCat(null);
    setForm({ name: '', parentId: '' });
    setModalOpen(true);
  }

  function openEdit(cat) {
    setModalMode('edit');
    setEditingCat(cat);
    setForm({ name: cat.name, parentId: cat.parentId != null ? String(cat.parentId) : '' });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingCat(null);
    setForm({ name: '', parentId: '' });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), parentId: form.parentId ? Number(form.parentId) : null };
      if (modalMode === 'edit' && editingCat) {
        await api.patch(`/categories/${editingCat.id}`, payload);
        toast.success('Catégorie mise à jour');
      } else {
        await api.post('/categories', payload);
        toast.success(`Catégorie « ${form.name.trim()} » créée`);
      }
      closeModal();
      loadCategories();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur enregistrement catégorie');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete(`/categories/${pendingDelete.id}`);
      toast.success(`Catégorie « ${pendingDelete.name} » supprimée`);
      setPendingDelete(null);
      loadCategories();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur suppression catégorie');
      setPendingDelete(null);
    }
  }

  function childCount(id) {
    return categories.filter((c) => c.parentId != null && Number(c.parentId) === id).length;
  }

  const tableRows = useMemo(() => {
    const rows = [];
    function walk(nodes, depth, parentName) {
      for (const cat of nodes) {
        rows.push({ ...cat, depth, parentName, createdByName: cat.createdBy?.fullName || '' });
        const kids = categories.filter((c) => c.parentId != null && Number(c.parentId) === cat.id);
        if (kids.length) walk(kids, depth + 1, cat.name);
      }
    }
    const toShow = filtered || tree;
    walk(toShow, 0, null);
    return rows;
  }, [categories, tree, filtered]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const paginatedRows = tableRows.slice((page - 1) * pageSize, page * pageSize);

  const columnDefs = useMemo(() => {
    const cols = [
      {
        field: 'name', headerName: 'Nom', flex: 1.5, minWidth: 200,
        cellRenderer: (params) => (
          <div className="flex items-center gap-2" style={{ paddingLeft: (params.data.depth || 0) * 20 }}>
            {(params.data.depth || 0) > 0 && <ChevronRight className="w-3 h-3 text-on-surface/30 shrink-0" />}
            <div className={`p-1 rounded-md shrink-0 ${params.data.isCustom ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}>
              {params.data.isCustom ? <Tag className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
            </div>
            <span className="text-sm font-semibold text-on-surface truncate">{params.value}</span>
          </div>
        ),
      },
      {
        field: 'parentName', headerName: 'Parent', width: 150,
        cellRenderer: (params) => (
          <span className="text-xs text-on-surface-variant">
            {params.value || <span className="italic text-on-surface/30">—</span>}
          </span>
        ),
      },
      {
        field: 'isCustom', headerName: 'Source', width: 100,
        cellRenderer: (params) => (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${params.value
            ? 'bg-purple-500/10 text-purple-500 border-purple-500/20'
            : 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
            {params.value ? 'Locale' : 'Sync'}
          </span>
        ),
      },
      {
        field: 'childCount', headerName: 'Sous-catégories', width: 140,
        valueGetter: (params) => childCount(params.data.id),
        cellRenderer: (params) => (
          <span className="text-xs text-on-surface-variant font-medium">
            {params.value > 0 ? `${params.value} sous-cat.` : '—'}
          </span>
        ),
      },
      {
        field: 'createdAt', headerName: 'Créé le', width: 120,
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant font-mono">{formatDate(params.value)}</span>,
        comparator: (a, b) => (a ? new Date(a).getTime() : 0) - (b ? new Date(b).getTime() : 0),
      },
      {
        field: 'createdByName', headerName: 'Créé par', width: 130,
        valueGetter: (params) => params.data.createdBy?.fullName || '',
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant">{params.value || '—'}</span>,
      },
    ];

    if (canManage) {
      cols.push({
        field: 'actions', headerName: '', width: 80, sortable: false, filter: false,
        cellRenderer: (params) => (
          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); openEdit(params.data); }} title="Modifier"
              className="p-1.5 rounded-lg text-on-surface/60 hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setPendingDelete(params.data); }} title="Supprimer"
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-500/10 rounded-lg">
            <Tag className="w-4 h-4 text-amber-500" />
          </div>
          <h1 className="text-sm font-bold text-on-surface whitespace-nowrap">Catégories</h1>
          <span className="text-[11px] text-on-surface-variant font-medium tabular-nums">
            {categories.length}
          </span>
        </div>
        {canManage && (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shadow-sm cursor-pointer">
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouvelle catégorie</span>
          </button>
        )}
      </div>

      {/* Search + Refresh */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une catégorie..."
            className={`${inputCls} w-full pl-9`}
          />
        </div>
        <button onClick={loadCategories}
          className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── TABLE ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative overflow-auto">
        <div className="mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4">
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
            <DataGrid
              columns={columnDefs}
              rowData={paginatedRows}
              loading={loading}
              rowSelection={canManage ? 'single' : undefined}
              onRowClick={(data) => canManage && openEdit(data)}
              pagination={false}
              noRowsText={search ? 'Aucune catégorie ne correspond à votre recherche' : 'Aucune catégorie. Créez-en une !'}
              className="rounded-2xl overflow-hidden"
            />
          </div>
        </div>
      </div>

      {/* ── PAGINATION ──────────────────────────────────────────────────────── */}
      {tableRows.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-outline-variant/20 bg-surface shrink-0">
          <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
            <span className="font-medium tabular-nums">
              {Math.min((page - 1) * pageSize + 1, tableRows.length)}–{Math.min(page * pageSize, tableRows.length)} sur {tableRows.length}
            </span>
            <div className="w-px h-3.5 bg-outline-variant/40" />
            <select value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-outline-variant/40 bg-surface text-on-surface cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all">
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
            </select>
          </div>
          <PaginationButtons page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* ── FormDrawer Création / Édition ────────────────────────────────── */}
      <FormDrawer
        open={modalOpen}
        onClose={closeModal}
        title={modalMode === 'edit' ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
        subtitle={modalMode === 'edit' && editingCat ? editingCat.name : null}
        icon={modalMode === 'edit' ? Pencil : Plus}
        iconColor="text-amber-400"
        size="md"
        footer={
          <>
            <button type="button" onClick={closeModal} className="btn-secondary">
              Annuler
            </button>
            <button onClick={handleSubmit} disabled={saving || !form.name.trim()} className="btn-primary">
              {saving ? (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                modalMode === 'edit' ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />
              )}
              {saving ? 'Enregistrement...' : modalMode === 'edit' ? 'Enregistrer' : 'Créer'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="field-label">
            <span>Nom de la catégorie *</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required autoFocus placeholder="ex: Réseau, Sécurité, Infrastructure"
              className="input-katalyst"
            />
          </label>
          <label className="field-label">
            <span className="flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5" />
              Catégorie parente {modalMode === 'edit' ? '(déplacer)' : '(optionnel)'}
            </span>
            <select
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              className="input-katalyst cursor-pointer"
            >
              <option value="">— Aucune (catégorie racine) —</option>
              {flatOptions
                .filter((o) => modalMode !== 'edit' || !editingCat || o.id !== editingCat.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
            </select>
          </label>
        </form>
      </FormDrawer>

      {/* ── Confirm Delete ──────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer la catégorie"
        message={`Supprimer la catégorie « ${pendingDelete?.name} » ? Les tickets existants conserveront leur libellé.${pendingDelete && childCount(pendingDelete.id) > 0 ? ` ⚠️ Cette catégorie a ${childCount(pendingDelete.id)} sous-catégorie(s) : déplacez-les ou supprimez-les d'abord.` : ''}`}
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
