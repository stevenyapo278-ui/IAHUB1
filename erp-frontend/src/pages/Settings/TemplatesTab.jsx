import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Pencil, Trash2, FileText, X, Check } from 'lucide-react';
import api from '../../api/client';
import SearchableSelect from '../../components/SearchableSelect';
import { PRIORITY_OPTIONS, TYPE_OPTIONS, URGENCY_IMPACT_OPTIONS, SOURCE_OPTIONS, SOURCE_LABELS } from '../../constants/tickets';

const EMPTY_FORM = {
  name: '', description: '', title: '', content: '',
  priority: 'P3', category: '', type: 'INCIDENT', source: '', urgency: 'MEDIUM', impact: 'MEDIUM',
  locationId: '', teamId: '', assignedToId: '', dueDate: '', requiresApproval: false,
};

export default function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = liste, 'new' = création, id = édition
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.get('/ticket-templates')
      .then(({ data }) => setTemplates(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur de chargement des modèles'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(data)).catch(() => {});
    api.get('/locations').then(({ data }) => setLocations(data)).catch(() => {});
  }, []);

  const locationOptions = useMemo(
    () => locations.map((l) => ({
      value: String(l.id),
      label: l.completename || l.name,
      subLabel: [l.town, l.address].filter(Boolean).join(' — '),
    })),
    [locations]
  );

  const userOptions = useMemo(
    () => users.filter((u) => u.isActive !== false).map((u) => ({
      value: String(u.id),
      label: u.fullName || u.email,
      subLabel: u.role || undefined,
    })),
    [users]
  );

  function startEdit(template) {
    setEditing(template.id);
    setForm({
      name: template.name, description: template.description || '', title: template.title, content: template.content,
      priority: template.priority || 'P3', category: template.category || '', type: template.type || 'INCIDENT',
      source: template.source || '', urgency: template.urgency || 'MEDIUM', impact: template.impact || 'MEDIUM',
      locationId: template.locationId || '', teamId: template.teamId || '', assignedToId: template.assignedToId || '',
      dueDate: template.dueDate ? template.dueDate.substring(0, 10) : '', requiresApproval: template.requiresApproval || false,
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.title.trim() || !form.content.trim()) return toast.error('Nom, titre et contenu sont obligatoires');
    setSaving(true);
    try {
      const payload = {
        ...form,
        locationId: form.locationId ? Number(form.locationId) : null,
        teamId: form.teamId ? Number(form.teamId) : null,
        assignedToId: form.assignedToId ? Number(form.assignedToId) : null,
        dueDate: form.dueDate || null,
      };
      if (editing === 'new') {
        await api.post('/ticket-templates', payload);
        toast.success('Modèle créé');
      } else {
        await api.patch(`/ticket-templates/${editing}`, payload);
        toast.success('Modèle mis à jour');
      }
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(template) {
    if (!window.confirm(`Supprimer le modèle « ${template.name} » ?`)) return;
    try {
      await api.delete(`/ticket-templates/${template.id}`);
      toast.success('Modèle supprimé');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  async function toggleActive(template) {
    try {
      await api.patch(`/ticket-templates/${template.id}`, { isActive: !template.isActive });
      toast.success(template.isActive ? 'Modèle désactivé' : 'Modèle activé');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification');
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-on-surface">Modèles de tickets</h3>
          <p className="text-[11px] text-on-surface-variant">
            Modèles réutilisables pour créer des tickets plus vite (incidents récurrents, demandes standard…).
          </p>
        </div>
        {editing === null && (
          <button
            onClick={() => { setEditing('new'); setForm(EMPTY_FORM); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nouveau modèle
          </button>
        )}
      </div>

      {editing !== null ? (
        <form onSubmit={handleSave} className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-primary">
              {editing === 'new' ? 'Créer un modèle' : 'Modifier le modèle'}
            </h4>
            <button type="button" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className={inputCls} placeholder="Nom du modèle *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} placeholder="Description (optionnelle)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <input className={inputCls} placeholder="Titre du ticket *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className={`${inputCls} min-h-[110px] resize-y`} placeholder="Contenu du ticket *" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Priorité</span>
              <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Type</span>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Urgence</span>
              <select className={inputCls} value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
                {URGENCY_IMPACT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Impact</span>
              <select className={inputCls} value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}>
                {URGENCY_IMPACT_OPTIONS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Source</span>
              <select className={inputCls} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                <option value="">—</option>
                {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Équipe assignée</span>
              <select className={inputCls} value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                <option value="">—</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Assigné à</span>
              <SearchableSelect
                options={userOptions}
                value={form.assignedToId ? String(form.assignedToId) : ''}
                onChange={(val) => setForm({ ...form, assignedToId: val })}
                placeholder="— Non assigné —"
                searchPlaceholder="Rechercher par nom..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Lieu</span>
              <SearchableSelect
                options={locationOptions}
                value={form.locationId ? String(form.locationId) : ''}
                onChange={(val) => setForm({ ...form, locationId: val })}
                placeholder="— Aucun lieu —"
                searchPlaceholder="Rechercher un lieu..."
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Échéance</span>
              <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Approbation</span>
              <select className={inputCls} value={form.requiresApproval ? 'true' : 'false'} onChange={(e) => setForm({ ...form, requiresApproval: e.target.value === 'true' })}>
                <option value="false">Non requis</option>
                <option value="true">Requise (Hotline)</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Catégorie</span>
            <input className={inputCls} placeholder="Catégorie (optionnel)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }} className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all cursor-pointer">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-on-primary hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm divide-y divide-outline-variant/20">
          {loading ? (
            <p className="p-6 text-xs text-on-surface-variant text-center">Chargement…</p>
          ) : templates.length === 0 ? (
            <p className="p-6 text-xs text-on-surface-variant italic text-center">Aucun modèle. Créez-en un pour accélérer la création de tickets.</p>
          ) : (
            templates.map((t) => (
              <div key={t.id} className={`p-4 flex items-center gap-3 ${t.isActive ? '' : 'opacity-50'}`}>
                <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-on-surface">{t.name}</span>
                    {t.priority && (
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${t.priority === 'P1' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : t.priority === 'P2' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>{t.priority}</span>
                    )}
                    {t.category && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">{t.category}</span>
                    )}
                    {t.teamId && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400">
                        {teams.find((tm) => tm.id === t.teamId)?.name || `Équipe #${t.teamId}`}
                      </span>
                    )}
                    {t.assignedToId && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        {users.find((u) => u.id === t.assignedToId)?.fullName || `User #${t.assignedToId}`}
                      </span>
                    )}
                    {t.requiresApproval && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">Approbation</span>
                    )}
                    {!t.isActive && <span className="text-[9px] font-bold text-on-surface-variant uppercase">Inactif</span>}
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">{t.title}{t.description ? ` — ${t.description}` : ''}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleActive(t)} title={t.isActive ? 'Désactiver' : 'Activer'} className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => startEdit(t)} title="Modifier" className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(t)} title="Supprimer" className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
