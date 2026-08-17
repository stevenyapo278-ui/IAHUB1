import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Tag, Plus, X, Search, RefreshCw, Trash2, Pencil, Globe } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';

export default function Categories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '' });
  const [editing, setEditing] = useState(null); // catégorie en cours de renommage
  const [pendingDelete, setPendingDelete] = useState(null);

  const canManage = hasPermission(user, 'glpi.manage');

  function loadCategories() {
    setLoading(true);
    api.get('/glpi/categories')
      .then(({ data }) => setCategories(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur chargement catégories'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadCategories(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api.post('/glpi/categories', { name: form.name.trim() });
      toast.success(`Catégorie "${form.name.trim()}" créée`);
      setShowForm(false);
      setForm({ name: '' });
      loadCategories();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur création catégorie');
    }
  }

  async function handleRename(e) {
    e.preventDefault();
    if (!form.name.trim() || !editing) return;
    try {
      await api.patch(`/glpi/categories/${editing.id}`, { name: form.name.trim() });
      toast.success(`Catégorie renommée en "${form.name.trim()}"`);
      setEditing(null);
      setForm({ name: '' });
      loadCategories();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur renommage catégorie');
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete(`/glpi/categories/${pendingDelete.id}`);
      toast.success(`Catégorie "${pendingDelete.name}" supprimée`);
      setPendingDelete(null);
      loadCategories();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur suppression catégorie');
      setPendingDelete(null);
    }
  }

  const filtered = categories.filter((c) => {
    if (!search.trim()) return true;
    return c.name?.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-on-surface flex items-center gap-2">
            <Tag className="w-6 h-6 text-gold-400" /> Catégories
          </h1>
          <p className="text-sm text-on-surface/60 mt-1">
            {categories.length} catégorie(s) — utilisées pour classer les tickets et déclencher l'auto-assignation
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '' }); }}
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

      {/* Formulaire création / renommage */}
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
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); setForm({ name: '' }); }}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors">
              Annuler
            </button>
            <button type="submit"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all">
              <Plus className="w-4 h-4" /> {editing ? 'Renommer' : 'Créer'}
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
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-on-surface/40">
          <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
          {search ? 'Aucune catégorie ne correspond à votre recherche' : 'Aucune catégorie. Créez-en une pour classer vos tickets.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((cat) => (
            <div key={cat.id}
              className="relative group p-4 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest hover:border-amber-500/30 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1.5 rounded-lg ${cat.isCustom ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}>
                    {cat.isCustom ? <Tag className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  </div>
                  <p className="text-sm font-semibold text-on-surface truncate">{cat.name}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${cat.isCustom
                  ? 'bg-purple-500/10 text-purple-500 border-purple-500/20'
                  : 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
                  {cat.isCustom ? 'Locale' : 'GLPI'}
                </span>
              </div>

              {canManage && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditing(cat); setShowForm(false); setForm({ name: cat.name }); }}
                    title="Renommer"
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
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer la catégorie"
        message={`Supprimer la catégorie "${pendingDelete?.name}" ? Les tickets existants conserveront leur libellé, seule la liste des choix sera mise à jour.`}
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
