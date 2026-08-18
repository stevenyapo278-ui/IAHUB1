import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, ListChecks, X, Save, Check } from 'lucide-react';
import api from '../../api/client';
import { useTheme } from '../../context/ThemeContext';

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Texte court' },
  { value: 'TEXTAREA', label: 'Texte long' },
  { value: 'NUMBER', label: 'Nombre' },
  { value: 'SELECT', label: 'Liste déroulante' },
  { value: 'DATE', label: 'Date' },
  { value: 'CHECKBOX', label: 'Case à cocher' },
];

const EMPTY_FORM = { label: '', type: 'TEXT', options: '', required: false, categoryId: '', position: 0 };

export default function CustomFieldsTab() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [fields, setFields] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = liste, 'new' = création, id = édition
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.get('/custom-fields')
      .then(({ data }) => setFields(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur de chargement des champs'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get('/glpi/categories').then(({ data }) => setCategories(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(field) {
    setEditing(field.id);
    setForm({
      label: field.label,
      type: field.type,
      options: field.type === 'SELECT' ? (field.options || []).map((o) => (typeof o === 'string' ? o : o.value)).join('\n') : '',
      required: field.required,
      categoryId: field.categoryId != null ? String(field.categoryId) : '',
      position: field.position ?? 0,
    });
  }

  function buildPayload() {
    const payload = {
      label: form.label.trim(),
      type: form.type,
      required: form.required,
      position: Number(form.position) || 0,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
    };
    if (form.type === 'SELECT') {
      const options = form.options.split('\n').map((s) => s.trim()).filter(Boolean);
      if (options.length === 0) { toast.error('Un champ liste doit avoir au moins une option (une par ligne)'); return null; }
      payload.options = options.map((v) => ({ value: v, label: v }));
    }
    return payload;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.label.trim()) return toast.error('Le libellé est obligatoire');
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.post('/custom-fields', payload);
        toast.success('Champ créé');
      } else {
        await api.patch(`/custom-fields/${editing}`, payload);
        toast.success('Champ mis à jour');
      }
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(field) {
    if (!window.confirm(`Supprimer le champ « ${field.label} » ? Les valeurs déjà saisies sur les tickets seront conservées mais plus affichées.`)) return;
    try {
      await api.delete(`/custom-fields/${field.id}`);
      toast.success('Champ supprimé');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  async function toggleActive(field) {
    try {
      await api.patch(`/custom-fields/${field.id}`, { isActive: !field.isActive });
      toast.success(field.isActive ? 'Champ désactivé' : 'Champ activé');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la bascule');
    }
  }

  const typeLabel = (t) => FIELD_TYPES.find((f) => f.value === t)?.label || t;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            Champs personnalisés
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">
            Définissez des champs supplémentaires rendus à la création d'un ticket, selon la catégorie
            (équivalent du plugin GLPI « Forms »). Un champ sans catégorie s'applique à tous les tickets.
          </p>
        </div>
        <button
          onClick={() => { setEditing('new'); setForm(EMPTY_FORM); }}
          className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" /> Nouveau champ
        </button>
      </div>

      {/* Formulaire création / édition */}
      {editing && (
        <form onSubmit={handleSave} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface/60 mb-1">Libellé *</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required placeholder="Ex. : Numéro de série, Site, Type de panne..."
                className="w-full px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface/60 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              >
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface/60 mb-1">Catégorie (vide = toutes)</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              >
                <option value="">— Toutes les catégories —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface/60 mb-1">Position</label>
                <input
                  type="number" min="0" value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
              <label className="flex items-center gap-2 pb-2.5 cursor-pointer select-none">
                <input
                  type="checkbox" checked={form.required}
                  onChange={(e) => setForm({ ...form, required: e.target.checked })}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-xs font-semibold text-on-surface">Requis</span>
              </label>
            </div>
          </div>

          {form.type === 'SELECT' && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface/60 mb-1">
                Options (une par ligne)
              </label>
              <textarea
                value={form.options}
                onChange={(e) => setForm({ ...form, options: e.target.value })}
                rows={3} placeholder={'Imprimante\nÉcran\nRéseau'}
                className="w-full px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors flex items-center gap-1.5">
              <X className="w-3.5 h-3.5" /> Annuler
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}

      {/* Liste des champs */}
      {loading ? (
        <div className="text-center py-8 text-on-surface/40 text-sm">Chargement...</div>
      ) : fields.length === 0 ? (
        <div className="text-center py-10 text-on-surface/40 border border-dashed border-outline-variant/40 rounded-2xl">
          <ListChecks className="w-10 h-10 mx-auto mb-2 opacity-30" />
          Aucun champ personnalisé défini. Créez-en un pour enrichir vos tickets.
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${isDark ? 'border-outline-variant/30 bg-surface-container-low/40' : 'border-slate-200 bg-white'}`}>
              <div className={`p-2 rounded-lg shrink-0 ${f.isActive ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                <ListChecks className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-on-surface truncate">{f.label}</p>
                  {f.required && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 uppercase tracking-wider">Requis</span>
                  )}
                  {!f.isActive && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant uppercase tracking-wider">Inactif</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-on-surface-variant">
                  <span className="font-semibold px-1.5 py-0.5 rounded bg-surface-container">{typeLabel(f.type)}</span>
                  <span>{f.category ? `Catégorie : ${f.category.name}` : 'Toutes les catégories'}</span>
                  {f.type === 'SELECT' && Array.isArray(f.options) && <span>{f.options.length} option(s)</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleActive(f)}
                  title={f.isActive ? 'Désactiver' : 'Activer'}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${f.isActive ? 'text-on-surface-variant hover:bg-surface-container' : 'text-primary hover:bg-primary/10'}`}
                >
                  {f.isActive ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                </button>
                <button onClick={() => startEdit(f)} title="Modifier"
                  className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container cursor-pointer transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(f)} title="Supprimer"
                  className="p-1.5 rounded-lg text-on-surface-variant hover:bg-red-500/10 hover:text-red-500 cursor-pointer transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
