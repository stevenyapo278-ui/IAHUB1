import { useEffect, useMemo, useState, useRef } from 'react';
import { toast } from 'sonner';
import { Tag, Plus, Search, RefreshCw, Trash2, Pencil, Globe, FolderTree, ChevronRight, ChevronLeft, X, Ticket, FileSpreadsheet, FileDown, Loader2 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { flattenCategoryTree } from '../utils/categoryTree';
import ConfirmDialog from '../components/ConfirmDialog';
import LinkedTicketsDrawer from '../components/LinkedTicketsDrawer';
import exportFile from '../utils/exportFile';
import DataGrid from '../components/DataGrid';
import FormDrawer from '../components/FormDrawer';
import PaginationButtons from '../components/PaginationButtons';

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function Categories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [ticketCounts, setTicketCounts] = useState({});
  const [ticketsCat, setTicketsCat] = useState(null);
  const [pageSize, setPageSize] = useState(50);
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

    // Nombre de tickets par catégorie (sous-catégories incluses) — affiché en colonne
    // et rappelé dans la boîte de suppression pour mesurer l'impact.
    api.get('/categories/counts')
      .then(({ data }) => setTicketCounts(data || {}))
      .catch(() => setTicketCounts({}));
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
    const roots = [...(byParent.get(null) || [])];

    // Récupérer les orphelins (parentId pointe vers un parent absent ou circulaire)
    const visited = new Set();
    const walk = (nodes) => {
      for (const n of nodes) {
        if (visited.has(n.id)) continue;
        visited.add(n.id);
        const kids = byParent.get(n.id);
        if (kids?.length) walk(kids);
      }
    };
    walk(roots);
    const orphans = categories.filter((c) => !visited.has(c.id));
    if (orphans.length) {
      sort(orphans);
      roots.push(...orphans);
    }

    return roots;
  }, [categories]);

  const flatOptions = useMemo(() => flattenCategoryTree(categories), [categories]);

  const filteredTree = useMemo(() => {
    if (!search.trim()) return null;
    const term = search.toLowerCase();
    const matched = categories.filter((c) => c.name?.toLowerCase().includes(term));
    if (matched.length === 0) return [];

    const catMap = new Map(categories.map((c) => [c.id, c]));
    const matchedIds = new Set(matched.map((c) => c.id));
    const visibleIds = new Set(matchedIds);

    for (const cat of matched) {
      let current = cat;
      const seen = new Set([cat.id]);
      while (current.parentId != null) {
        const parentId = Number(current.parentId);
        if (visibleIds.has(parentId) || seen.has(parentId)) break;
        seen.add(parentId);
        visibleIds.add(parentId);
        current = catMap.get(parentId);
        if (!current) break;
      }
    }

    const childrenMap = new Map();
    for (const c of categories) {
      if (c.parentId != null) {
        const pid = Number(c.parentId);
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid).push(c);
      }
    }
    function addDescendants(id, ancestors) {
      const kids = childrenMap.get(id);
      if (!kids) return;
      for (const kid of kids) {
        if (ancestors.has(kid.id)) continue;
        visibleIds.add(kid.id);
        addDescendants(kid.id, new Set([...ancestors, kid.id]));
      }
    }
    for (const id of matchedIds) addDescendants(id, new Set([id]));

    const byParent = new Map();
    for (const c of categories) {
      if (!visibleIds.has(c.id)) continue;
      const pid = c.parentId == null ? null : Number(c.parentId);
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(c);
    }
    const sortFn = (list) => list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    for (const list of byParent.values()) sortFn(list);
    return sortFn(byParent.get(null) || []);
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

  function pluralTickets(n) {
    return n <= 0 ? 'Aucun ticket' : n === 1 ? '1 ticket' : `${n} tickets`;
  }

  function openTickets(cat) {
    setTicketsCat(cat);
  }

  // Extraction du tableau affiché (colonnes de la grille, recherche incluse)
  async function exportTable(format) {
    setExporting(format);
    try {
      await exportFile({
        url: '/categories/export',
        params: { format, ...(search.trim() ? { search: search.trim() } : {}) },
        fallbackName: `categories_${new Date().toISOString().slice(0, 10)}.${format}`,
      });
      toast.success(`Export ${format.toUpperCase()} du tableau généré`);
    } catch {
      toast.error("Échec de l'export");
    } finally {
      setExporting(null);
    }
  }

  function childCount(id) {
    return categories.filter((c) => c.parentId != null && Number(c.parentId) === id).length;
  }

  const tableRows = useMemo(() => {
    const rows = [];
    const visited = new Set();
    function walk(nodes, depth, parentName) {
      for (const cat of nodes) {
        if (visited.has(cat.id)) continue;
        visited.add(cat.id);
        rows.push({ ...cat, depth, parentName, createdByName: cat.createdBy?.fullName || '' });
        const kids = categories.filter((c) => c.parentId != null && Number(c.parentId) === cat.id);
        if (kids.length) walk(kids, depth + 1, cat.name);
      }
    }
    const toShow = filteredTree || tree;
    walk(toShow, 0, null);
    return rows;
  }, [categories, tree, filteredTree]);

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
        field: 'ticketCount', headerName: 'Tickets', width: 110,
        valueGetter: (params) => ticketCounts[params.data.id] ?? 0,
        comparator: (a, b) => a - b,
        cellRenderer: (params) => (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openTickets(params.data); }}
            title={params.value > 0 ? 'Voir les tickets de cette catégorie' : 'Aucun ticket rattaché'}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
              params.value > 0
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25 hover:bg-blue-500/20'
                : 'bg-surface-container text-on-surface-variant border-outline-variant hover:bg-surface-container-high'
            }`}
          >
            <Ticket className="w-3 h-3" />
            {params.value}
          </button>
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
  }, [canManage, ticketCounts]);

  function deleteMessage() {
    if (!pendingDelete) return '';
    const n = ticketCounts[pendingDelete.id] ?? 0;
    const kids = childCount(pendingDelete.id);
    let msg = `Supprimer la catégorie « ${pendingDelete.name} » ? `;
    msg += n === 1
      ? '1 ticket y est rattaché (sous-catégories incluses) : aucun ticket ne sera supprimé, il conservera son libellé mais la catégorie disparaîtra des sélecteurs.'
      : n > 1
        ? `${n} tickets y sont rattachés (sous-catégories incluses) : aucun ticket ne sera supprimé, ils conserveront leur libellé mais la catégorie disparaîtra des sélecteurs.`
        : 'Aucun ticket n\'est rattaché : les tickets existants conserveront leur libellé.';
    if (kids === 1) msg += " ⚠️ 1 sous-catégorie sera détachée (elle deviendra une catégorie racine) : déplacez-la d'abord.";
    else if (kids > 1) msg += ` ⚠️ ${kids} sous-catégories seront détachées (elles deviendront des catégories racines) : déplacez-les d'abord.`;
    return msg;
  }

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
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => exportTable('xlsx')}
            disabled={exporting !== null || tableRows.length === 0}
            title="Exporter le tableau des catégories en Excel"
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-outline-variant text-on-surface-variant text-xs font-bold hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            {exporting === 'xlsx' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            <span className="hidden sm:inline">XLSX</span>
          </button>
          <button
            type="button"
            onClick={() => exportTable('csv')}
            disabled={exporting !== null || tableRows.length === 0}
            title="Exporter le tableau des catégories en CSV"
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-outline-variant text-on-surface-variant text-xs font-bold hover:border-teal-500 hover:text-teal-600 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
        <button onClick={loadCategories}
          className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── TABLE ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <div className="flex-1 min-h-0 mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4 flex flex-col">
          <div className="flex-1 min-h-0 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden flex flex-col">
            <DataGrid
              storageKey="categories"
              columns={columnDefs}
              rowData={paginatedRows}
              loading={loading}
              rowSelection={canManage ? 'single' : undefined}
              onRowClick={(data) => canManage && openEdit(data)}
              pagination={false}
              noRowsText={search ? 'Aucune catégorie ne correspond à votre recherche' : 'Aucune catégorie. Créez-en une !'}
              className="rounded-2xl overflow-hidden flex-1"
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

      {/* ── Tickets rattachés à la catégorie ────────────────────────────── */}
      <LinkedTicketsDrawer
        open={!!ticketsCat}
        onClose={() => setTicketsCat(null)}
        endpoint={ticketsCat ? `/categories/${ticketsCat.id}/tickets` : null}
        title={`Tickets — ${ticketsCat?.name || ''}`}
        subtitle={ticketsCat ? pluralTickets(ticketCounts[ticketsCat.id] ?? 0) : null}
        note={ticketsCat ? `Compte global (catégorie « ${ticketsCat.name} » et ses sous-catégories), corbeille et tickets en attente/rejetés exclus.` : null}
      />

      {/* ── Confirm Delete ──────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer la catégorie"
        message={deleteMessage()}
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
