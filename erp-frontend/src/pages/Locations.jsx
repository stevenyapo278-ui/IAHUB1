import { useEffect, useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Plus, X, Search, RefreshCw, Trash2, Globe,
  Building2, Mail, Check, ChevronDown, ChevronRight, Pencil,
  Users, ArrowRightLeft, UserMinus, UserPlus, Clock
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';

const emptyForm = { name: '', completename: '', address: '', postcode: '', town: '', country: '', building: '', room: '' };

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

// ── Modal création/édition lieu ──────────────────────────────────────
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

// ── Modal détail d'un lieu (demandeurs + actions) ─────────────────────
function LocationDetailModal({ open, onClose, locationId, locations, canManage, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [requesters, setRequesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const loc = locations.find((l) => l.id === locationId);

  const loadRequesters = useCallback(() => {
    if (!locationId) return;
    setLoading(true);
    api.get(`/locations/${locationId}/requesters`)
      .then(({ data }) => { setDetail(data.location); setRequesters(data.requesters || []); })
      .catch(() => toast.error('Erreur chargement demandeurs'))
      .finally(() => setLoading(false));
  }, [locationId]);

  useEffect(() => { if (open && locationId) { loadRequesters(); setNewEmail(''); } }, [open, locationId, loadRequesters]);

  async function handleAdd() {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await api.post('/locations/requesters', { email: newEmail.trim(), glpiLocationId: locationId });
      toast.success(`Email « ${newEmail.trim()} » associé au lieu`);
      setNewEmail('');
      loadRequesters();
      onRefresh?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur association');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id, email) {
    setRemovingId(id);
    try {
      await api.delete(`/locations/requesters/${id}`);
      toast.success(`Association « ${email} » supprimée`);
      loadRequesters();
      onRefresh?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur suppression');
    } finally {
      setRemovingId(null);
    }
  }

  if (!open || !locationId) return null;
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
          className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-xl">
                <MapPin className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-on-surface">{loc?.name || detail?.name || 'Lieu'}</h2>
                <p className="text-[11px] text-on-surface-variant">{loc?.completename || detail?.completename || ''}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface/40 hover:text-on-surface cursor-pointer transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Infos du lieu */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {loc?.building && (
                <div className="px-3 py-2 rounded-xl bg-surface-container-high/50">
                  <p className="text-[9px] uppercase font-bold text-on-surface-variant tracking-wider">Bâtiment</p>
                  <p className="text-xs font-semibold text-on-surface">{loc.building}</p>
                </div>
              )}
              {loc?.town && (
                <div className="px-3 py-2 rounded-xl bg-surface-container-high/50">
                  <p className="text-[9px] uppercase font-bold text-on-surface-variant tracking-wider">Ville</p>
                  <p className="text-xs font-semibold text-on-surface">{loc.town}</p>
                </div>
              )}
              {loc?.country && (
                <div className="px-3 py-2 rounded-xl bg-surface-container-high/50">
                  <p className="text-[9px] uppercase font-bold text-on-surface-variant tracking-wider">Pays</p>
                  <p className="text-xs font-semibold text-on-surface">{loc.country}</p>
                </div>
              )}
              <div className="px-3 py-2 rounded-xl bg-surface-container-high/50">
                <p className="text-[9px] uppercase font-bold text-on-surface-variant tracking-wider">Demandeurs</p>
                <p className="text-xs font-semibold text-on-surface">{requesters.length}</p>
              </div>
            </div>

            {/* Ajouter un demandeur */}
            {canManage && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/30" />
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    placeholder="email@exemple.com"
                    className="w-full pl-9 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
                <button onClick={handleAdd} disabled={adding || !newEmail.trim()}
                  className="px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-amber-600 cursor-pointer transition-colors disabled:opacity-50 shrink-0">
                  {adding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  Associer
                </button>
              </div>
            )}

            {/* Liste des demandeurs */}
            {loading ? (
              <div className="text-center py-8 text-on-surface/40">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p className="text-xs">Chargement des demandeurs...</p>
              </div>
            ) : requesters.length === 0 ? (
              <div className="text-center py-8 text-on-surface/40">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Aucun demandeur associé à ce lieu.</p>
                <p className="text-[10px] text-on-surface/30 mt-1">Les associations se créent automatiquement lors de la résolution email par l'IA.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {requesters.map((r) => (
                  <div key={r.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface-container-high/30 hover:bg-surface-container-high/60 transition-colors group">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                        <Mail className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{r.email}</p>
                        <div className="flex items-center gap-2 text-[10px] text-on-surface-variant">
                          <span className="flex items-center gap-0.5">
                            <ArrowRightLeft className="w-2.5 h-2.5" />
                            {r.assignmentCount} ticket(s)
                          </span>
                          {r.lastUsedAt && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {new Date(r.lastUsedAt).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                          {r.assignedBy && (
                            <span className="text-on-surface/30">par {r.assignedBy.fullName}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {canManage && (
                      <button onClick={() => handleRemove(r.id, r.email)} disabled={removingId === r.id}
                        title="Dissocier"
                        className="p-1.5 rounded-lg text-on-surface/40 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                        {removingId === r.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-outline-variant/20 flex justify-end">
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors">
              Fermer
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ── Modal réassignation lors suppression ──────────────────────────────
function ReassignModal({ open, onClose, onConfirm, sourceLocation, locations, loading }) {
  const [targetId, setTargetId] = useState('');

  if (!open) return null;
  const otherLocations = locations.filter((l) => l.id !== sourceLocation?.id && l.isActive);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
          className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <ArrowRightLeft className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-on-surface">Réassigner les demandeurs</h2>
              <p className="text-[11px] text-on-surface-variant">
                Avant de supprimer « {sourceLocation?.name} », déplacez les demandeurs vers un autre lieu.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">Lieu cible</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
              className={inputCls + ' w-full'}>
              <option value="">— Choisir un lieu —</option>
              {otherLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.name} {l.town ? `(${l.town})` : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors">
              Annuler
            </button>
            <button onClick={() => onConfirm(Number(targetId))} disabled={!targetId || loading}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-2 hover:bg-amber-600 cursor-pointer transition-all disabled:opacity-50">
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
              {loading ? 'Déplacement...' : 'Déplacer et supprimer'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ── Composant principal ───────────────────────────────────────────────
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
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState(null);
  const [reassignData, setReassignData] = useState(null);
  const [reassigning, setReassigning] = useState(false);
  const PAGE_SIZE = 25;

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
        toast.success(`Lieu « ${form.name} » créé`);
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
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.requesterCount) {
        // Il reste des demandeurs → afficher le modal de réassignation
        setPendingDelete(null);
        setReassignData({ location: locations.find((l) => l.id === id), requesterCount: data.requesterCount });
      } else {
        toast.error(data?.error || 'Erreur suppression');
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleReassign(targetId) {
    if (!reassignData?.location || !targetId) return;
    setReassigning(true);
    try {
      const { data } = await api.post(`/locations/${reassignData.location.id}/reassign`, { targetLocationId: targetId });
      toast.success(`${data.moved} demandeur(s) déplacé(s) vers « ${data.target} » — ${data.ticketsUpdated} ticket(s) mis à jour`);
      // Maintenant supprimer le lieu source (plus de demandeurs = suppression autorisée)
      await api.delete(`/locations/${reassignData.location.id}`);
      setReassignData(null);
      loadLocations();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur réassignation');
    } finally {
      setReassigning(false);
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search]);

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
                {paginated.map((loc) => (
                  <tr
                    key={loc.id}
                    className="group border-b border-outline-variant/10 hover:bg-amber-500/5 transition-colors cursor-pointer"
                    onClick={() => setDetailId(loc.id)}
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
                          <button onClick={() => setDetailId(loc.id)} title="Demandeurs"
                            className="p-1.5 rounded-lg text-on-surface/60 hover:text-blue-500 hover:bg-blue-500/10 cursor-pointer transition-colors">
                            <Users className="w-3.5 h-3.5" />
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
            <Pagination page={page} totalPages={totalPages} total={filtered.length} label="lieux" onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      <LocationModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(emptyForm); }}
        onSave={handleSave}
        form={form} setForm={setForm}
        title={modalMode === 'edit' ? 'Modifier le lieu' : 'Nouveau lieu'}
        saving={saving}
      />

      <LocationDetailModal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        locationId={detailId}
        locations={locations}
        canManage={canManage}
        onRefresh={loadLocations}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer le lieu"
        message="Supprimer ce lieu ? Les demandeurs associés devront être réassignés."
        confirmLabel="Supprimer" danger
        onConfirm={() => handleDelete(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />

      <ReassignModal
        open={!!reassignData}
        onClose={() => setReassignData(null)}
        onConfirm={handleReassign}
        sourceLocation={reassignData?.location}
        locations={locations}
        loading={reassigning}
      />
    </div>
  );
}
