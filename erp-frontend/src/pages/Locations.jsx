import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Plus, X, Search, RefreshCw, Trash2, Globe,
  Building2, Mail, Check, ChevronLeft, ChevronRight, ChevronDown, Pencil,
  Users, ArrowRightLeft, UserMinus, UserPlus, Clock, CheckCircle2
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import DataGrid from '../components/DataGrid';
import FormDrawer from '../components/FormDrawer';

function PaginationButtons({ page, totalPages, onPageChange }) {
  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const r = [1];
    if (page > 3) r.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) r.push(i);
    if (page < totalPages - 2) r.push('...');
    r.push(totalPages);
    return r;
  }, [page, totalPages]);

  const btn = 'h-10 min-w-[40px] flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95';
  const on = 'text-muted-foreground hover:bg-surface-muted hover:text-foreground';
  const off = 'text-muted-foreground/30 cursor-not-allowed';
  const active = 'bg-primary text-primary-foreground shadow-sm shadow-primary/20';

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onPageChange(1)} disabled={page <= 1} className={`${btn} px-1.5 ${page <= 1 ? off : on}`}>
        <ChevronsLeft className="w-4 h-4" />
      </button>
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className={`${btn} px-1.5 ${page <= 1 ? off : on}`}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      {pages.map((p, i) => p === '...' ? (
        <span key={`dots-${i}`} className="w-8 h-10 flex items-center justify-center text-xs text-muted-foreground/40">…</span>
      ) : (
        <button key={p} onClick={() => onPageChange(p)} className={`${btn} px-1 ${p === page ? active : on}`}>{p}</button>
      ))}
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className={`${btn} px-1.5 ${page >= totalPages ? off : on}`}>
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

const ChevronsLeft = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>
  </svg>
);

const emptyForm = { name: '', completename: '', address: '', postcode: '', town: '', country: '', building: '', room: '' };

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

// ── Drawer création/édition lieu ──────────────────────────────────────
function LocationModal({ open, onClose, onSave, form, setForm, title, saving, isEdit }) {
  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={isEdit ? form.name : null}
      icon={isEdit ? Pencil : Plus}
      iconColor="text-amber-400"
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Annuler
          </button>
          <button onClick={onSave} disabled={saving || !form.name.trim()} className="btn-primary">
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="field-label sm:col-span-2">
            <span>Nom du lieu *</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
              placeholder="ex: Siège Abidjan, Entrepôt San Pédro" className="input-katalyst" />
          </label>
          <label className="field-label sm:col-span-2">
            <span>Nom complet (hiérarchique)</span>
            <input value={form.completename} onChange={(e) => setForm({ ...form, completename: e.target.value })}
              placeholder="ex: Côte d'Ivoire > Abidjan > Plateau" className="input-katalyst" />
          </label>
          <label className="field-label">
            <span>Ville</span>
            <input value={form.town} onChange={(e) => setForm({ ...form, town: e.target.value })}
              placeholder="Ville" className="input-katalyst" />
          </label>
          <label className="field-label">
            <span>Pays</span>
            <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder="Pays" className="input-katalyst" />
          </label>
          <label className="field-label sm:col-span-2">
            <span>Adresse</span>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Adresse" className="input-katalyst" />
          </label>
          <label className="field-label">
            <span>Code postal</span>
            <input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })}
              placeholder="Code postal" className="input-katalyst" />
          </label>
          <label className="field-label">
            <span>Bâtiment</span>
            <input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })}
              placeholder="Bâtiment" className="input-katalyst" />
          </label>
          <label className="field-label sm:col-span-2">
            <span>Salle</span>
            <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}
              placeholder="Salle" className="input-katalyst" />
          </label>
        </div>
      </form>
    </FormDrawer>
  );
}

// ── Modal détail d'un lieu (demandeurs + actions) ─────────────────────
function LocationDetailModal({ open, onClose, locationId, locations, canManage, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [requesters, setRequesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [potentialRequesters, setPotentialRequesters] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
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

  useEffect(() => { if (open && locationId) { loadRequesters(); setSelectedEmail(''); setSelectedLabel(''); setSearchInput(''); } }, [open, locationId, loadRequesters]);

  // Recherche de demandeurs potentiels
  useEffect(() => {
    if (!showDropdown) return;
    setSearching(true);
    const timeout = setTimeout(() => {
      api.get(`/locations/potential-requesters?search=${encodeURIComponent(searchInput)}`)
        .then(({ data }) => setPotentialRequesters(data))
        .catch(() => setPotentialRequesters([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timeout);
  }, [searchInput, showDropdown]);

  function handleSelectRequester(r) {
    setSelectedEmail(r.email);
    setSelectedLabel(`${r.label} (${r.email})`);
    setSearchInput('');
    setShowDropdown(false);
  }

  async function handleAdd() {
    if (!selectedEmail.trim()) return;
    setAdding(true);
    try {
      await api.post('/locations/requesters', { email: selectedEmail.trim(), glpiLocationId: locationId });
      toast.success(`« ${selectedLabel || selectedEmail} » associé au lieu`);
      setSelectedEmail('');
      setSelectedLabel('');
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
              <div className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/30" />
                    {selectedEmail ? (
                      <div className="w-full pl-9 pr-9 py-2 rounded-xl border border-amber-500/40 bg-amber-500/5 text-sm text-on-surface flex items-center gap-2">
                        <span className="truncate">{selectedLabel || selectedEmail}</span>
                        <button onClick={() => { setSelectedEmail(''); setSelectedLabel(''); }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 hover:text-on-surface cursor-pointer">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => { setSearchInput(e.target.value); setShowDropdown(true); }}
                        onFocus={() => setShowDropdown(true)}
                        placeholder="Rechercher un utilisateur ou demandeur..."
                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                    )}
                  </div>
                  <button onClick={handleAdd} disabled={adding || !selectedEmail.trim()}
                    className="px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-amber-600 cursor-pointer transition-colors disabled:opacity-50 shrink-0">
                    {adding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    Associer
                  </button>
                </div>
                {/* Dropdown résultats */}
                {showDropdown && !selectedEmail && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface-container-lowest border border-outline-variant/60 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                      {searching ? (
                        <div className="p-3 text-center text-xs text-on-surface-variant">
                          <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />
                          Recherche...
                        </div>
                      ) : potentialRequesters.length === 0 ? (
                        <div className="p-3 text-center text-xs text-on-surface-variant italic">
                          Aucun résultat — tapez un email pour associer manuellement
                        </div>
                      ) : (
                        potentialRequesters.map((r) => (
                          <button key={r.email}
                            onClick={() => handleSelectRequester(r)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-container transition-colors text-left cursor-pointer">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white ${
                              r.type === 'user' ? 'bg-sky-600' : 'bg-emerald-600'
                            }`}>
                              {r.type === 'user' ? 'U' : 'E'}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-on-surface truncate">{r.label}</p>
                              <p className="text-[10px] text-on-surface-variant truncate">{r.email} · {r.subLabel}</p>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              r.type === 'user' ? 'bg-sky-500/10 text-sky-400' : 'bg-emerald-500/10 text-emerald-400'
                            }`}>
                              {r.type === 'user' ? 'ERP' : 'Email'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
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
  const [detailId, setDetailId] = useState(null);
  const [reassignData, setReassignData] = useState(null);
  const [reassigning, setReassigning] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('locations_page_size') || '25'));

  const total = useMemo(() => {
    if (!search.trim()) return locations.length;
    const q = search.toLowerCase();
    return locations.filter((l) => [l.name, l.completename, l.town, l.building, l.country].some((f) => f?.toLowerCase().includes(q))).length;
  }, [locations, search]);
  const totalPages = Math.ceil(total / pageSize) || 1;

  const filteredLocations = useMemo(() => {
    let list = locations;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((l) => [l.name, l.completename, l.town, l.building, l.country].some((f) => f?.toLowerCase().includes(q)));
    }
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [locations, search, page, pageSize]);

  function loadLocations() {
    setLoading(true);
    api.get('/locations')
      .then(({ data }) => setLocations(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur chargement lieux'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadLocations(); }, []);
  useEffect(() => { setPage(1); }, [search]);

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
      await api.delete(`/locations/${reassignData.location.id}`);
      setReassignData(null);
      loadLocations();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur réassignation');
    } finally {
      setReassigning(false);
    }
  }

  const canManage = hasPermission(user, 'locations.manage') || ['ADMIN', 'HOTLINE'].includes(user?.role);

  const stats = useMemo(() => {
    const towns = new Set(locations.map((l) => l.town).filter(Boolean)).size;
    const buildings = new Set(locations.map((l) => l.building).filter(Boolean)).size;
    return [
      { label: 'Total', value: locations.length, icon: MapPin, color: 'text-amber-400', bg: 'bg-amber-500/10' },
      { label: 'Villes', value: towns, icon: Globe, color: 'text-blue-400', bg: 'bg-blue-500/10' },
      { label: 'Bâtiments', value: buildings, icon: Building2, color: 'text-purple-400', bg: 'bg-purple-500/10' },
      { label: 'Actifs', value: locations.filter((l) => l.isActive !== false).length, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    ];
  }, [locations]);

  const columnDefs = useMemo(() => {
    const cols = [
      {
        field: 'name', headerName: 'Lieu', flex: 1.5, minWidth: 180,
        cellRenderer: (params) => (
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-amber-500/10 text-amber-500 shrink-0">
              <MapPin className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-on-surface truncate block">{params.value}</span>
              {params.data.completename && (
                <span className="text-[10px] text-on-surface-variant truncate block">{params.data.completename}</span>
              )}
            </div>
          </div>
        ),
      },
      {
        field: 'town', headerName: 'Ville / Bâtiment', width: 160,
        valueGetter: (params) => [params.data.town, params.data.building].filter(Boolean).join(' · ') || '—',
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant">{params.value}</span>,
      },
      {
        field: 'country', headerName: 'Pays', width: 120,
        cellRenderer: (params) => <span className="text-xs text-on-surface-variant">{params.value || '—'}</span>,
      },
      {
        field: 'requesterCount', headerName: 'Demandeurs', width: 120,
        valueGetter: (params) => params.data._count?.requesters ?? params.data.requesters?.length ?? 0,
        cellRenderer: (params) => <span className="text-xs font-semibold text-on-surface">{params.value}</span>,
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
            <button onClick={(e) => { e.stopPropagation(); setPendingDelete(params.data.id); }} title="Supprimer"
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
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
          <h1 className="text-sm font-bold text-on-surface whitespace-nowrap">Lieux</h1>
          <span className="text-[11px] text-on-surface-variant font-medium tabular-nums">
            {total > 0 && `${total}`}
          </span>
        </div>
        {canManage && (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shadow-sm cursor-pointer">
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau lieu</span>
          </button>
        )}
      </div>

      {/* ── STATS ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 sm:px-6 py-3 shrink-0">
        {[
          { label: 'Total', value: total, color: 'text-on-surface' },
          { label: 'Villes', value: new Set(locations.map((l) => l.town).filter(Boolean)).size, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Bâtiments', value: new Set(locations.map((l) => l.building).filter(Boolean)).size, color: 'text-purple-600 dark:text-purple-400' },
          { label: 'Actifs', value: locations.filter((l) => l.isActive !== false).length, color: 'text-emerald-600 dark:text-emerald-400' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-on-surface-variant">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── SEARCH + REFRESH ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/30" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un lieu..."
            className={`${inputCls} w-full pl-9`}
          />
        </div>
        <button onClick={loadLocations}
          className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative overflow-auto">
        <div className="mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4">
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
            <DataGrid
              columns={columnDefs}
              rowData={filteredLocations}
              loading={loading}
              onRowClick={(data) => setDetailId(data.id)}
              pagination={false}
              noRowsText={search ? 'Aucun lieu ne correspond à votre recherche' : 'Aucun lieu. Créez-en un !'}
              className="rounded-2xl overflow-hidden"
            />
          </div>
        </div>
      </div>

      {/* ── PAGINATION ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium tabular-nums">
            {total > 0
              ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} sur ${total.toLocaleString('fr-FR')}`
              : '0 résultat'}
          </span>
          <div className="w-px h-3.5 bg-border/40" />
          <select value={pageSize}
            onChange={(e) => { const v = Number(e.target.value); setPageSize(v); localStorage.setItem('locations_page_size', String(v)); setPage(1); }}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
        <PaginationButtons page={page} totalPages={Math.max(totalPages, 1)} onPageChange={setPage} />
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}
      <LocationModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(emptyForm); }}
        onSave={handleSave}
        form={form} setForm={setForm}
        title={modalMode === 'edit' ? 'Modifier le lieu' : 'Nouveau lieu'}
        isEdit={modalMode === 'edit'}
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
