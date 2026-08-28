import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Tag, Plus, Search, RefreshCw, Trash2, Pencil, Globe, FolderTree, ChevronRight, ChevronDown, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { flattenCategoryTree } from '../utils/categoryTree';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function creatorName(cat) {
  return cat.createdBy?.fullName || '—';
}

export default function Categories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
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

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

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
      toast.success(`Catégorie « ${pendingDelete.name } » supprimée`);
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

    rows.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt') { va = va ? new Date(va).getTime() : 0; vb = vb ? new Date(vb).getTime() : 0; }
      else if (sortBy === 'createdByName') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
      else if (sortBy === 'parentName') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
      else { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [categories, tree, filtered, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const paginatedRows = tableRows.slice((page - 1) * pageSize, page * pageSize);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, sortBy, sortDir, pageSize]);

  function SortHeader({ col, children }) {
    const active = sortBy === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none transition-colors ${active ? 'text-amber-600' : 'text-on-surface-variant hover:text-on-surface'}`}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {active && (sortDir === 'asc' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
        </span>
      </th>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-amber-500/10 rounded-lg">
            <Tag className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Catégories</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">{categories.length} catégorie(s) · arborescence de tickets</p>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nouvelle catégorie</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-3">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une catégorie..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>
      </div>

      {/* ── Tableau ─────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 pb-6">
        {loading ? (
          <div className="text-center py-12 text-on-surface/40">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            Chargement...
          </div>
        ) : tableRows.length === 0 ? (
          <div className="text-center py-12 text-on-surface/40">
            <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
            {search ? 'Aucune catégorie ne correspond à votre recherche' : 'Aucune catégorie. Créez-en une !'}
          </div>
        ) : (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant/20 bg-surface-container-low/50">
                  <SortHeader col="name">Nom</SortHeader>
                  <SortHeader col="parentName">Parent</SortHeader>
                  <SortHeader col="isCustom">Source</SortHeader>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Sous-catégories
                  </th>
                  <SortHeader col="createdAt">Créé le</SortHeader>
                  <SortHeader col="createdByName">Créé par</SortHeader>
                  {canManage && <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((cat) => (
                  <tr
                    key={cat.id}
                    className="group border-b border-outline-variant/10 hover:bg-amber-500/5 transition-colors cursor-pointer"
                    onClick={() => canManage && openEdit(cat)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2" style={{ paddingLeft: cat.depth * 20 }}>
                        {cat.depth > 0 && <ChevronRight className="w-3 h-3 text-on-surface/30 shrink-0" />}
                        <div className={`p-1 rounded-md shrink-0 ${cat.isCustom ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}>
                          {cat.isCustom ? <Tag className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-sm font-semibold text-on-surface truncate">{cat.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant">
                        {cat.parentName || <span className="italic text-on-surface/30">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${cat.isCustom
                        ? 'bg-purple-500/10 text-purple-500 border-purple-500/20'
                        : 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
                        {cat.isCustom ? 'Locale' : 'Sync'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant font-medium">
                        {childCount(cat.id) > 0 ? `${childCount(cat.id)} sous-cat.` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant font-mono">{formatDate(cat.createdAt)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant">{creatorName(cat)}</span>
                    </td>
                    {canManage && (
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => openEdit(cat)}
                            title="Modifier"
                            className="p-1.5 rounded-lg text-on-surface/60 hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setPendingDelete(cat)}
                            title="Supprimer"
                            className="p-1.5 rounded-lg text-on-surface/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={tableRows.length} label="catégories" onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
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
              className="relative w-full max-w-md rounded-2xl border border-outline-variant/30 bg-surface shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/10">
                    {modalMode === 'edit' ? <Pencil className="w-4 h-4 text-amber-600 dark:text-amber-400" /> : <Plus className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-on-surface">
                      {modalMode === 'edit' ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
                    </h2>
                    {modalMode === 'edit' && editingCat && (
                      <p className="text-[11px] text-on-surface-variant">{editingCat.name}</p>
                    )}
                  </div>
                </div>
                <motion.button
                  onClick={closeModal}
                  whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>

              {/* Body */}
              <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom de la catégorie *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required autoFocus placeholder="ex: Réseau, Sécurité, Infrastructure"
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                    <FolderTree className="w-3.5 h-3.5" />
                    Catégorie parente {modalMode === 'edit' ? '(déplacer)' : '(optionnel)'}
                  </span>
                  <select
                    value={form.parentId}
                    onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
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

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/20 bg-surface-container-low/40">
                <button
                  type="button" onClick={closeModal}
                  className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || !form.name.trim()}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    modalMode === 'edit' ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />
                  )}
                  {saving ? 'Enregistrement...' : modalMode === 'edit' ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
