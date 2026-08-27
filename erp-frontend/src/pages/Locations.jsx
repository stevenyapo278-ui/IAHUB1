import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Plus, X, Search, RefreshCw, Trash2, Globe,
  Building2, Mail, Check, AlertTriangle, Pencil
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
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
      loadLocations();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur mise à jour');
    }
  }

  const canManage = hasPermission(user, 'locations.manage') || ['ADMIN', 'HOTLINE'].includes(user?.role);

  const filtered = locations.filter((l) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [l.name, l.completename, l.town, l.building].some((f) => f?.toLowerCase().includes(q));
  });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-on-surface flex items-center gap-2">
            <MapPin className="w-6 h-6 text-amber-400" /> Lieux
          </h1>
          <p className="text-sm text-on-surface/60 mt-1">
            {locations.length} lieu(x) — les associations expéditeur↔lieu sont créées automatiquement
          </p>
        </div>
        {canManage && (
          <button onClick={openCreate}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all">
            <Plus className="w-4 h-4" /> Nouveau lieu
          </button>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un lieu..."
          className="w-full pl-9 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-on-surface/40">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          Chargement...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-on-surface/40">
          <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
          {search ? 'Aucun lieu ne correspond à votre recherche' : 'Aucun lieu. Créez-en un pour associer les demandeurs à leurs sites.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((loc) => (
            <div key={loc.id}
              className="relative group p-4 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest hover:border-amber-500/30 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1.5 rounded-lg ${loc.isCustom ? 'bg-purple-500/10 text-purple-500' : 'bg-amber-500/10 text-amber-500'}`}>
                    {loc.isCustom ? <Building2 className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">{loc.name}</p>
                    {loc.completename && loc.completename !== loc.name && (
                      <p className="text-xs text-on-surface/50 truncate">{loc.completename}</p>
                    )}
                  </div>
                </div>
                {!loc.isActive && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">Inactif</span>
                )}
              </div>

              {(loc.town || loc.building) && (
                <p className="text-xs text-on-surface/40 mb-2">
                  {[loc.building, loc.town, loc.country].filter(Boolean).join(' — ')}
                </p>
              )}

              <div className="flex items-center gap-3 text-xs text-on-surface/40">
                {loc._count?.requesterLinks > 0 && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" /> {loc._count.requesterLinks} demandeur(s)
                  </span>
                )}
              </div>

              {canManage && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(loc)} title="Modifier"
                    className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleToggleActive(loc.id, loc.isActive)}
                    title={loc.isActive ? 'Désactiver' : 'Activer'}
                    className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:bg-surface-container-high cursor-pointer transition-colors">
                    {loc.isActive ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => setPendingDelete(loc.id)} title="Supprimer"
                    className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
