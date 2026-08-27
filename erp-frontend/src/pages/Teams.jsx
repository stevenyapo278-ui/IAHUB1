import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import { Users, ShieldCheck, Ticket, Plus, RefreshCw, Trash2, X, AlertTriangle, Mail, Check, Layers, Save } from 'lucide-react';
import RemoteUserMultiSelect from '../components/RemoteUserMultiSelect';

export default function Teams() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const canManageTeams = hasPermission(user, 'teams.manage');

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');

  // ── Modal création ────────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', category: '', groupEmail: '' });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Modal détail/édition ──────────────────────────────────────────
  const [detailModal, setDetailModal] = useState(null); // null | team object loaded from API
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailDraft, setDetailDraft] = useState({ name: '', category: '', groupEmail: '', defaultObserverIds: [] });

  function load() {
    api.get('/teams')
      .then(({ data }) => setTeams(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // ── Ouvrir le modal détail ────────────────────────────────────────
  async function openDetail(teamId) {
    setDetailModal(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/teams/${teamId}`);
      setDetailModal(data);
      setDetailDraft({
        name: data.name || '',
        category: data.category || '',
        groupEmail: data.groupEmail || '',
        defaultObserverIds: (data.defaultObservers || []).map((o) => o.id),
      });
    } catch (err) {
      setDetailError(err.response?.data?.error || "Erreur lors du chargement de l'équipe");
      toast.error(err.response?.data?.error || "Erreur lors du chargement");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailModal(null);
    setDetailDraft({ name: '', category: '', groupEmail: '', defaultObserverIds: [] });
    setDetailError('');
  }

  // ── Sauvegarder l'équipe (depuis le modal détail) ─────────────────
  async function saveDetail() {
    if (!detailModal) return;
    if (!detailDraft.name.trim()) { setDetailError('Le nom est requis'); return; }
    setDetailSaving(true);
    setDetailError('');
    try {
      const { data } = await api.patch(`/teams/${detailModal.id}`, {
        name: detailDraft.name.trim(),
        category: detailDraft.category.trim() || null,
        groupEmail: detailDraft.groupEmail.trim() || null,
        defaultObserverIds: detailDraft.defaultObserverIds,
      });
      setDetailModal(data);
      toast.success(`Équipe « ${data.name} » enregistrée`);
      load();
    } catch (err) {
      const msg = err.response?.data?.error || "Erreur lors de l'enregistrement";
      setDetailError(msg);
      toast.error(msg);
    } finally {
      setDetailSaving(false);
    }
  }

  // ── Création ──────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const { data } = await api.post('/teams', createForm);
      toast.success(`Équipe « ${data.name} » créée`);
      setCreateForm({ name: '', category: '', groupEmail: '' });
      setShowCreateModal(false);
      load();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la création';
      setCreateError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  // ── Suppression ───────────────────────────────────────────────────
  function askDelete(id) { setConfirmDeleteId(id); }
  async function handleDelete() {
    if (!confirmDeleteId) return;
    const team = teams.find(t => t.id === confirmDeleteId);
    setDeleting(true);
    try {
      await api.delete(`/teams/${confirmDeleteId}`);
      toast.success(`Équipe « ${team?.name || ''} » supprimée`);
      load();
      setConfirmDeleteId(null);
      closeDetail();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la suppression';
      toast.error(msg);
      setError(msg);
    } finally {
      setDeleting(false);
    }
  }

  const totalMembers = teams.reduce((sum, t) => sum + t.members.length, 0);
  const totalTickets = teams.reduce((sum, t) => sum + t._count.tickets, 0);

  const filtered = teams.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [t.name, t.category].some((f) => f?.toLowerCase().includes(q));
  });

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Équipes</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">{teams.length} équipes · {totalMembers} membres · {totalTickets} tickets ouverts</p>
          </div>
        </div>
        {canManageTeams && (
          <div className="flex items-center gap-2 ml-auto">
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => { setShowCreateModal(true); setCreateError(''); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-blue-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nouvelle équipe</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 lg:px-8 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 border-b border-outline-variant/15 bg-surface-container-low/20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total Équipes', value: teams.length, icon: Users, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
            { label: 'Membres Actifs', value: totalMembers, icon: ShieldCheck, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
            { label: 'Tickets Ouverts', value: totalTickets, icon: Ticket, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl ${s.bg} border flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-on-surface leading-none">{s.value}</p>
                  <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider mt-1">{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-3">
        <div className="relative max-w-md">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une équipe..."
            className="w-full pl-4 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>
      </div>

      {/* ── Teams Cards ──────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 pb-6">
        {loading ? (
          <div className="text-center py-12 text-on-surface/40">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            Chargement...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-on-surface/40">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            {search ? 'Aucune équipe ne correspond à votre recherche' : 'Aucune équipe. Créez-en une !'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((t) => (
              <motion.div
                key={t.id}
                whileHover={{ scale: 1.01, y: -2 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => openDetail(t.id)}
                className="relative group p-4 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest hover:border-blue-500/30 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface truncate flex items-center gap-1.5">
                        {t.name}
                        {t.category && <span className="text-[10px] text-on-surface-variant font-normal">· {t.category}</span>}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-on-surface/50 mt-3">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" /> {t.members.length} membre{t.members.length > 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <Ticket className="w-3 h-3" /> {t._count.tickets} ouvert{t._count.tickets > 1 ? 's' : ''}
                  </span>
                  {t.defaultObservers?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> {t.defaultObservers.length} obs.
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-2 h-1.5 rounded-full overflow-hidden bg-surface-container border border-outline-variant/30">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (t._count.tickets / Math.max(1, ...teams.map(x => x._count.tickets))) * 100)}%` }} />
                </div>

                {/* Actions hover */}
                {canManageTeams && (
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); openDetail(t.id); }}
                      title="Modifier"
                      className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer transition-colors">
                      <Save className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); askDelete(t.id); }}
                      title="Supprimer"
                      className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── MODAL DÉTAIL / ÉDITION ────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {detailModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeDetail}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
                  <div className="p-1.5 rounded-lg bg-blue-500/10"><Layers className="w-4 h-4 text-blue-600" /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-on-surface truncate">{detailModal.name}</h3>
                    <p className="text-[10px] text-on-surface-variant font-medium">{detailModal.members?.length || 0} membres · {detailModal._count?.tickets || 0} tickets ouverts</p>
                  </div>
                  {canManageTeams && (
                    <button onClick={() => askDelete(detailModal.id)}
                      className="p-2 rounded-xl text-on-surface/40 hover:text-red-500 hover:bg-red-500/10 transition-all" title="Supprimer l'équipe">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <motion.button onClick={closeDetail} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                {/* Loading */}
                {detailLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-on-surface-variant text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                    Chargement des détails...
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* Error */}
                    {detailError && (
                      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs font-medium flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{detailError}
                      </div>
                    )}

                    {/* Champs éditables */}
                    {canManageTeams && (
                      <div className="space-y-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom de l'équipe *</span>
                          <input value={detailDraft.name} onChange={e => setDetailDraft({ ...detailDraft, name: e.target.value })}
                            className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                          <input value={detailDraft.category} onChange={e => setDetailDraft({ ...detailDraft, category: e.target.value })}
                            placeholder="ex: Réseau, Infrastructure"
                            className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                            <Mail className="w-3 h-3" /> Email de groupe
                          </span>
                          <input type="email" value={detailDraft.groupEmail} onChange={e => setDetailDraft({ ...detailDraft, groupEmail: e.target.value })}
                            placeholder="support-equipe@domaine.ci"
                            className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface font-mono placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                        </label>
                      </div>
                    )}

                    {/* Read-only si pas de permission */}
                    {!canManageTeams && (
                      <div className="space-y-2 text-xs">
                        {detailModal.category && (
                          <div className="flex items-center gap-2">
                            <span className="text-on-surface-variant font-medium">Catégorie :</span>
                            <span className="text-on-surface font-semibold">{detailModal.category}</span>
                          </div>
                        )}
                        {detailModal.groupEmail && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-3 h-3 text-blue-500" />
                            <span className="text-on-surface font-mono">{detailModal.groupEmail}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Membres */}
                    <div>
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 mb-2">
                        <Users className="w-3.5 h-3.5 text-blue-500" />
                        Membres ({detailModal.members?.length || 0})
                      </span>
                      <div className="space-y-1.5">
                        {detailModal.members?.map(m => (
                          <div key={m.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-surface border border-outline-variant/30">
                            <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 font-bold text-[11px] flex items-center justify-center shrink-0">
                              {m.fullName?.charAt(0)?.toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-on-surface truncate">{m.fullName}</p>
                              <p className="text-[10px] text-on-surface-variant font-mono truncate">{m.email}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                m.activeTicketCount > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'
                              }`}>
                                {m.activeTicketCount || 0} ticket{(m.activeTicketCount || 0) > 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        ))}
                        {detailModal.members?.length === 0 && (
                          <p className="text-xs text-on-surface-variant italic py-2">Aucun membre dans cette équipe.</p>
                        )}
                      </div>
                    </div>

                    {/* Observateurs par défaut */}
                    <div className="pt-3 border-t border-outline-variant/20">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 mb-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-purple-500" />
                        Observateurs par défaut ({detailDraft.defaultObserverIds.length})
                      </span>
                      <p className="text-[10px] text-on-surface-variant/70 mb-2">
                        Les observateurs reçoivent une notification quand un ticket est assigné à cette équipe.
                      </p>
                      <RemoteUserMultiSelect
                        selectedIds={detailDraft.defaultObserverIds}
                        onChange={(nextIds) => setDetailDraft({ ...detailDraft, defaultObserverIds: nextIds })}
                        placeholder="Rechercher un observateur..."
                        disabled={!canManageTeams}
                      />
                    </div>
                  </div>
                )}

                {/* Footer */}
                {canManageTeams && (
                  <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/30 shrink-0">
                    <button onClick={closeDetail}
                      className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-all">
                      Annuler
                    </button>
                    <button onClick={saveDetail} disabled={detailSaving}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md disabled:opacity-40 hover:shadow-lg transition-all flex items-center gap-1.5">
                      {detailSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      {detailSaving ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>, document.body
      )}

      {/* ── MODAL CRÉATION ───────────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showCreateModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCreateModal(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-blue-500/10"><Users className="w-4 h-4 text-blue-600" /></div>
                  <h3 className="text-sm font-bold text-on-surface">Nouvelle équipe</h3>
                  <motion.button onClick={() => setShowCreateModal(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></motion.button>
                </div>
                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  {createError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs font-medium">{createError}</div>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom *</span>
                    <input required value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="ex: Support Réseau"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                    <input value={createForm.category} onChange={e => setCreateForm({ ...createForm, category: e.target.value })}
                      placeholder="ex: Réseau, Infrastructure"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email de groupe</span>
                    <input type="email" value={createForm.groupEmail} onChange={e => setCreateForm({ ...createForm, groupEmail: e.target.value })}
                      placeholder="equipe@domaine.ci"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                  </label>
                  <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant/30">
                    <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container">Annuler</button>
                    <button type="submit" disabled={creating} className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md disabled:opacity-40 flex items-center gap-1.5">
                      {creating && <RefreshCw className="w-3 h-3 animate-spin" />}
                      Créer
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>, document.body
      )}

      <ConfirmDialog open={!!confirmDeleteId} title="Supprimer l'équipe"
        message="Supprimer définitivement cette équipe ? Cette action est irréversible."
        confirmLabel="Supprimer" danger loading={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />
    </div>
  );
}
