import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Plus, X, Search, RefreshCw, Trash2, Globe,
  Building2, Mail, Check, ChevronDown, ChevronRight, Pencil
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';

const emptyForm = { name: '', completename: '', address: '', postcode: '', town: '', country: '', building: '', room: '' };

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function LocationModal({ open, onClose, onSave, form, setForm, title, saving }) {
  if (!open) return null;
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
          className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <MapPin className="w-5 h-5 text-amber-500" /> {title}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface/40 hover:text-on-surface cursor-pointer transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
              placeholder="Nom du lieu *" className={inputCls} />
            <input value={form.completename} onChange={(e) => setForm({ ...form, completename: e.target.value })}
              placeholder="Nom complet (hiérarchique)" className={inputCls} />
            <input value={form.town} onChange={(e) => setForm({ ...form, town: e.target.value })}
              placeholder="Ville" className={inputCls} />
            <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder="Pays" className={inputCls} />
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Adresse" className={inputCls} />
            <input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })}
              placeholder="Code postal" className={inputCls} />
            <input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })}
              placeholder="Bâtiment" className={inputCls} />
            <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}
              placeholder="Salle" className={inputCls} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors">
              Annuler
            </button>
            <button onClick={onSave} disabled={saving || !form.name.trim()}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default function Locations() {
  const { user } = useAuth();
  const { autonomousMode } = useSystemSettings();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  function loadLocations() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('active', 'true');
    if (search.trim()) params.set('search', search.trim());
    api.get(`/locations?${params}`)
      .then(({ data }) => setLocations(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur chargement lieux'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadLocations(); }, [search]);

  function openCreate() {
    setModalMode('create');
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(loc) {
    setModalMode('edit');
    setEditingId(loc.id);
    setForm({
      name: loc.name || '', completename: loc.completename || '',
      address: loc.address || '', postcode: loc.postcode || '',
      town: loc.town || '', country: loc.country || '',
      building: loc.building || '', room: loc.room || '',
    });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (modalMode === 'edit' && editingId) {
        await api.patch(`/locations/${editingId}`, form);
        toast.success('Lieu mis à jour');
      } else {
        await api.post('/locations', form);
        toast.success(`Lieu "${form.name}" créé`);
      }
      setModalOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      loadLocations();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setDeleting(true);
    try {
      await api.delete(`/locations/${id}`);
      toast.success('Lieu supprimé');
      setPendingDelete(null);
      loadLocations();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleActive(id, isActive) {
    try {
      await api.patch(`/locations/${id}`, { isActive: !isActive });
      toast.success(isActive ? 'Lieu désactivé' : 'Lieu activé');
      loadLocations();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur mise à jour');
    }
  }

  const canManage = hasPermission(user, 'locations.manage') || ['ADMIN', 'HOTLINE'].includes(user?.role);

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    let list = locations;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((l) => [l.name, l.completename, l.town, l.building, l.country].some((f) => f?.toLowerCase().includes(q)));
    }
    list = [...list].sort((a, b) => {
      let va = a[sortBy] || '', vb = b[sortBy] || '';
      if (sortBy === '_count') { va = a._count?.requesterLinks || 0; vb = b._count?.requesterLinks || 0; }
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [locations, search, sortBy, sortDir]);

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
            <MapPin className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Lieux</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">{locations.length} lieu(x) — associations expéditeur↔lieu automatiques</p>
          </div>
        </div>
        {canManage && (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all">
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau lieu</span>
          </button>
        )}
      </div>

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-3">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un lieu..."
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
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-on-surface/40">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            {search ? 'Aucun lieu ne correspond à votre recherche' : 'Aucun lieu. Créez-en un !'}
          </div>
        ) : (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant/20 bg-surface-container-low/50">
                  <SortHeader col="name">Nom</SortHeader>
                  <SortHeader col="completename">Nom complet</SortHeader>
                  <SortHeader col="building">Bâtiment</SortHeader>
                  <SortHeader col="town">Ville</SortHeader>
                  <SortHeader col="country">Pays</SortHeader>
                  <SortHeader col="_count">Demandeurs</SortHeader>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Statut
                  </th>
                  {canManage && <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((loc) => (
                  <tr
                    key={loc.id}
                    className="group border-b border-outline-variant/10 hover:bg-amber-500/5 transition-colors cursor-pointer"
                    onClick={() => canManage && openEdit(loc)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded-md shrink-0 ${loc.isCustom ? 'bg-purple-500/10 text-purple-500' : 'bg-amber-500/10 text-amber-500'}`}>
                          {loc.isCustom ? <Building2 className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-sm font-semibold text-on-surface truncate">{loc.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant">{loc.completename || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant">{loc.building || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant">{loc.town || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant">{loc.country || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-on-surface-variant font-medium">
                        {loc._count?.requesterLinks > 0 ? (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3 text-on-surface/40" /> {loc._count.requesterLinks}
                          </span>
                        ) : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {loc.isActive ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-bold">Actif</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-bold">Inactif</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => openEdit(loc)} title="Modifier"
                            className="p-1.5 rounded-lg text-on-surface/60 hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleToggleActive(loc.id, loc.isActive)}
                            title={loc.isActive ? 'Désactiver' : 'Activer'}
                            className="p-1.5 rounded-lg text-on-surface/60 hover:bg-surface-container-high cursor-pointer transition-colors">
                            {loc.isActive ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => setPendingDelete(loc.id)} title="Supprimer"
                            className="p-1.5 rounded-lg text-on-surface/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LocationModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(emptyForm); }}
        onSave={handleSave}
        form={form} setForm={setForm}
        title={modalMode === 'edit' ? 'Modifier le lieu' : 'Nouveau lieu'}
        saving={saving}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer le lieu"
        message="Supprimer ce lieu ? Les associations demandeur↔lieu seront également supprimées."
        confirmLabel="Supprimer" danger
        onConfirm={() => handleDelete(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
