import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import { Users, ShieldCheck, Ticket, Plus, RefreshCw, Trash2, X, AlertTriangle, Mail, Check, Pencil, User, Layers } from 'lucide-react';
import RemoteUserMultiSelect from '../components/RemoteUserMultiSelect';

export default function Teams() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { autonomousMode } = useSystemSettings();
  const canManageTeams = hasPermission(user, 'teams.manage');

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', category: '', groupEmail: '' });
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [openTeamId, setOpenTeamId] = useState(null);
  const [openTeamDetail, setOpenTeamDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalError, setModalError] = useState('');
  const [groupEmailDraft, setGroupEmailDraft] = useState('');
  const [selectedObserverIds, setSelectedObserverIds] = useState([]);
  const [savingGroupEmail, setSavingGroupEmail] = useState(false);
  const [savingObservers, setSavingObservers] = useState(false);
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [search, setSearch] = useState('');

  async function toggleTeamDetail(teamId) {
    if (openTeamId === teamId) {
      setOpenTeamId(null);
      setOpenTeamDetail(null);
      return;
    }
    setOpenTeamId(teamId);
    setLoadingDetail(true);
    try {
      const { data } = await api.get(`/teams/${teamId}`);
      setOpenTeamDetail(data);
      setGroupEmailDraft(data.groupEmail || '');
      setSelectedObserverIds((data.defaultObservers || []).map((o) => o.id));
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors du chargement de l'équipe");
    } finally {
      setLoadingDetail(false);
    }
  }

  function load() {
    api.get('/teams')
      .then(({ data }) => setTeams(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setModalError('');
    try {
      await api.post('/teams', form);
      setForm({ name: '', category: '', groupEmail: '' });
      setShowCreateModal(false);
      load();
    } catch (err) {
      setModalError(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  function askDelete(id) { setConfirmDeleteId(id); }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try { await api.delete(`/teams/${confirmDeleteId}`); load(); setConfirmDeleteId(null); }
    catch (err) { setError(err.response?.data?.error || 'Erreur lors de la suppression'); }
    finally { setDeleting(false); }
  }

  async function saveGroupEmail(teamId) {
    setSavingGroupEmail(true); setError('');
    try {
      await api.patch(`/teams/${teamId}`, { groupEmail: groupEmailDraft });
      setOpenTeamDetail((prev) => ({ ...prev, groupEmail: groupEmailDraft }));
    } catch (err) { setError(err.response?.data?.error || "Erreur lors de l'enregistrement"); }
    finally { setSavingGroupEmail(false); }
  }

  async function saveDefaultObservers(teamId) {
    setSavingObservers(true); setError('');
    try {
      const { data } = await api.patch(`/teams/${teamId}`, { defaultObserverIds: selectedObserverIds });
      setOpenTeamDetail((prev) => ({ ...prev, defaultObservers: data.defaultObservers }));
    } catch (err) { setError(err.response?.data?.error || 'Erreur lors de la sauvegarde des observateurs'); }
    finally { setSavingObservers(false); }
  }

  function startEditName(team) {
    setEditingNameId(team.id);
    setEditingName(team.name);
  }

  async function saveEditName(id) {
    if (!editingName.trim()) return;
    try {
      await api.patch(`/teams/${id}`, { name: editingName.trim() });
      toast.success('Nom mis à jour');
      setEditingNameId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
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
              onClick={() => { setShowCreateModal(true); setModalError(''); }}
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
              <div key={s.label} className={`p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex items-center gap-4`}>
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
            {filtered.map((t) => {
              const isOpen = openTeamId === t.id;
              return (
                <Fragment key={t.id}>
                  <div
                    onClick={() => toggleTeamDetail(t.id)}
                    className={`relative group p-4 rounded-2xl border transition-all cursor-pointer ${
                      isOpen
                        ? 'border-blue-500/50 bg-blue-500/5 shadow-md'
                        : 'border-outline-variant/20 bg-surface-container-lowest hover:border-blue-500/30 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          {editingNameId === t.id ? (
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <input value={editingName} onChange={e => setEditingName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveEditName(t.id); if (e.key === 'Escape') setEditingNameId(null); }}
                                autoFocus
                                className="bg-surface border border-outline-variant/60 rounded-lg px-2 py-0.5 text-sm font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 w-40" />
                              <button onClick={() => saveEditName(t.id)} className="p-0.5 text-emerald-500 hover:text-emerald-600"><Check className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setEditingNameId(null)} className="p-0.5 text-on-surface-variant hover:text-on-surface"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <p className="text-sm font-semibold text-on-surface truncate flex items-center gap-1.5">
                              {t.name}
                              {t.category && <span className="text-[10px] text-on-surface-variant font-normal">· {t.category}</span>}
                            </p>
                          )}
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
                    </div>

                    {/* Progress bar */}
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden bg-surface-container border border-outline-variant/30">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (t._count.tickets / Math.max(1, ...teams.map(x => x._count.tickets))) * 100)}%` }} />
                    </div>

                    {/* Actions */}
                    {canManageTeams && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); startEditName(t); }}
                          title="Modifier le nom"
                          className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); askDelete(t.id); }}
                          title="Supprimer"
                          className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Detail panel */}
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="col-span-full overflow-hidden bg-surface-container-low/30 border-t border-outline-variant/10 px-6 py-4 space-y-4 rounded-b-2xl"
                      >
                        {loadingDetail ? (
                          <div className="flex items-center justify-center py-4 gap-2 text-on-surface-variant text-xs">
                            <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                            Chargement des détails...
                          </div>
                        ) : openTeamDetail ? (
                          <div className="space-y-4">
                            {/* Group Email */}
                            <div className="flex items-center gap-3 bg-surface border border-outline-variant/30 rounded-xl p-3">
                              <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block">Email de groupe</span>
                                <input type="email" value={groupEmailDraft} onChange={e => setGroupEmailDraft(e.target.value)}
                                  placeholder="support-equipe@domaine.ci"
                                  className="w-full bg-transparent text-xs text-on-surface font-mono focus:outline-none" />
                              </div>
                              {canManageTeams && (
                                <button onClick={() => saveGroupEmail(t.id)}
                                  disabled={savingGroupEmail || groupEmailDraft === (openTeamDetail.groupEmail || '')}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700 transition-all shrink-0">
                                  {savingGroupEmail ? '...' : 'Enregistrer'}
                                </button>
                              )}
                            </div>

                            {/* Members */}
                            <div>
                              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">
                                Membres ({openTeamDetail.members?.length || 0})
                              </span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {openTeamDetail.members?.map(m => (
                                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-xl bg-surface border border-outline-variant/30">
                                    <div className="w-7 h-7 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 font-bold text-[10px] flex items-center justify-center shrink-0">
                                      {m.fullName?.charAt(0)?.toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-on-surface truncate">{m.fullName}</p>
                                      <p className="text-[10px] text-on-surface-variant font-mono truncate">{m.email}</p>
                                    </div>
                                  </div>
                                ))}
                                {openTeamDetail.members?.length === 0 && (
                                  <p className="text-xs text-on-surface-variant italic col-span-full">Aucun membre.</p>
                                )}
                              </div>
                            </div>

                            {/* Default Observers */}
                            <div className="pt-2 border-t border-outline-variant/20 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                                  <User className="w-3.5 h-3.5 text-purple-500" />
                                  Observateurs par défaut ({selectedObserverIds.length})
                                </span>
                                {canManageTeams && (
                                  <button onClick={() => saveDefaultObservers(t.id)} disabled={savingObservers}
                                    className="px-3 py-1 rounded-lg bg-purple-600 text-white text-[11px] font-bold disabled:opacity-40 hover:bg-purple-700 transition-all shrink-0">
                                    {savingObservers ? '...' : 'Enregistrer'}
                                  </button>
                                )}
                              </div>
                              <RemoteUserMultiSelect selectedIds={selectedObserverIds} onChange={(nextIds) => setSelectedObserverIds(nextIds)}
                                placeholder="Rechercher un observateur..." />
                            </div>
                          </div>
                        ) : null}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal Création ───────────────────────────────────────────────── */}
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
                  {modalError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs font-medium">{modalError}</div>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom *</span>
                    <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="ex: Support Réseau"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                    <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                      placeholder="ex: Réseau, Infrastructure"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email de groupe</span>
                    <input type="email" value={form.groupEmail} onChange={e => setForm({ ...form, groupEmail: e.target.value })}
                      placeholder="equipe@domaine.ci"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                  </label>
                  <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant/30">
                    <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container">Annuler</button>
                    <button type="submit" className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md">Créer</button>
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
