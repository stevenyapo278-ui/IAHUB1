import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Tag, Plus, Search, RefreshCw, Trash2, Pencil, Globe, ChevronRight, ChevronDown, FolderTree } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { flattenCategoryTree } from '../utils/categoryTree';
import ConfirmDialog from '../components/ConfirmDialog';

export default function Categories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', parentId: '' });
  const [editing, setEditing] = useState(null); // catégorie en cours de renommage/déplacement
  const [expanded, setExpanded] = useState(new Set()); // ids des nœuds dépliés
  const [pendingDelete, setPendingDelete] = useState(null);

  const canManage = hasPermission(user, 'tickets.manage');

  function loadCategories() {
    setLoading(true);
    api.get('/categories')
      .then(({ data }) => setCategories(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur chargement catégories'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadCategories(); }, []);

  // Arbre : catégories sans parent = racines ; enfants groupés par parentId
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

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api.post('/categories', { name: form.name.trim(), parentId: form.parentId ? Number(form.parentId) : null });
      toast.success(`Catégorie \"${form.name.trim()}\" créée`);
      setShowForm(false);
      setForm({ name: '', parentId: '' });
      loadCategories();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur création catégorie');
    }
  }

  async function handleRename(e) {
    e.preventDefault();
    if (!form.name.trim() || !editing) return;
    try {
      await api.patch( `/categories/${editing.id}`, { name: form.name.trim(), parentId: form.parentId ? Number(form.parentId) : null });
      toast.success(`Catégorie mise à jour`);
      setEditing(null);
      setForm({ name: '', parentId: '' });
      loadCategories();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur mise à jour catégorie');
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete( `/categories/${pendingDelete.id}`);
      toast.success(`Catégorie \"${pendingDelete.name}\" supprimée`);
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

  // Rendu récursif d'un nœud de l'arbre
  function renderNode(cat, depth) {
    const kids = categories.filter((c) => c.parentId != null && Number(c.parentId) === cat.id);
    const isOpen = expanded.has(cat.id);
    const hasKids = kids.length > 0;
    return (
      <div key={cat.id}>
        <div
          className="group flex items-center gap-2 px-3 py-2.5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest hover:border-amber-500/30 hover:shadow-sm transition-all"
          style={{ marginLeft: depth * 28 }}
        >
          <button
            onClick={() => hasKids && toggleExpand(cat.id)}
            className={`p-0.5 rounded-md transition-colors ${hasKids ? 'cursor-pointer text-on-surface/50 hover:bg-surface-container-high' : 'invisible'}`}
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          <div className={`p-1.5 rounded-lg shrink-0 ${cat.isCustom ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}>
            {cat.isCustom ? <Tag className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-on-surface truncate">{cat.name}</p>
            {hasKids && (
              <p className="text-[10px] text-on-surface-variant/70 font-medium">
                {kids.length} sous-catégorie(s)
              </p>
            )}
          </div>

          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${cat.isCustom
            ? 'bg-purple-500/10 text-purple-500 border-purple-500/20'
            : 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
            {cat.isCustom ? 'Locale' : 'Sync'}
          </span>

          {canManage && (
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => { setEditing(cat); setShowForm(false); setForm({ name: cat.name, parentId: cat.parentId != null ? String(cat.parentId) : '' }); }}
                title="Renommer / déplacer"
                className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:bg-surface-container-high cursor-pointer transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPendingDelete(cat)}
                title="Supprimer"
                className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {hasKids && isOpen && (
          <div className="mt-1.5 space-y-1.5">
            {kids.map((k) => renderNode(k, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-on-surface flex items-center gap-2">
            <Tag className="w-6 h-6 text-gold-400" /> Catégories
          </h1>
          <p className="text-sm text-on-surface/60 mt-1">
            {categories.length} catégorie(s) — arborescence : créez des sous-catégories pour affiner le classement des tickets
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', parentId: '' }); }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all"
            >
              <Plus className="w-4 h-4" /> Nouvelle catégorie
            </button>
          )}
        </div>
      </div>

      {/* Barre de recherche */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une catégorie..."
          className="w-full pl-9 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
        />
      </div>

      {/* Formulaire création / renommage (+ déplacement) */}
      {(showForm || editing) && (
        <form onSubmit={editing ? handleRename : handleCreate}
          className="mb-6 p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              required autoFocus placeholder="Nom de la catégorie *"
              className="flex-1 px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface/60 mb-1 flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5" />
              Catégorie parente {editing ? '(déplacer)' : '(optionnel)'}
            </label>
            <select
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            >
              <option value="">— Aucune (catégorie racine) —</option>
              {flatOptions
                .filter((o) => !editing || o.id !== editing.id) // on ne peut pas être son propre parent
                .map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); setForm({ name: '', parentId: '' }); }}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors">
              Annuler
            </button>
            <button type="submit"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all">
              <Plus className="w-4 h-4" /> {editing ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      )}

      {/* Liste */}
      {loading ? (
        <div className="text-center py-12 text-on-surface/40">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          Chargement...
        </div>
      ) : filtered && filtered.length === 0 ? (
        <div className="text-center py-12 text-on-surface/40">
          <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
          Aucune catégorie ne correspond à votre recherche
        </div>
      ) : filtered ? (
        <div className="space-y-1.5">
          {filtered.map((cat) => (
            <div key={cat.id}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest">
              <div className={`p-1.5 rounded-lg ${cat.isCustom ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}>
                {cat.isCustom ? <Tag className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
              </div>
              <p className="flex-1 text-sm font-semibold text-on-surface truncate">{cat.name}</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${cat.isCustom
                ? 'bg-purple-500/10 text-purple-500 border-purple-500/20'
                : 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
                {cat.isCustom ? 'Locale' : 'Sync'}
              </span>
              {canManage && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditing(cat); setShowForm(false); setForm({ name: cat.name, parentId: cat.parentId != null ? String(cat.parentId) : '' }); }}
                    title="Renommer / déplacer" className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:bg-surface-container-high cursor-pointer transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setPendingDelete(cat)} title="Supprimer"
                    className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 cursor-pointer transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : tree.length === 0 ? (
        <div className="text-center py-12 text-on-surface/40">
          <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
          Aucune catégorie. Créez-en une pour classer vos tickets.
        </div>
      ) : (
        <div className="space-y-1.5">
          {tree.map((root) => renderNode(root, 0))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer la catégorie"
        message={`Supprimer la catégorie \"${pendingDelete?.name}\" ? Les tickets existants conserveront leur libellé, seule la liste des choix sera mise à jour.${pendingDelete && childCount(pendingDelete.id) > 0 ? ` ⚠️ Cette catégorie a ${childCount(pendingDelete.id)} sous-catégorie(s) : déplacez-les ou supprimez-les d'abord.` : ''}`}
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
