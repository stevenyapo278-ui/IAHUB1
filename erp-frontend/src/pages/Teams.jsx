import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import { Users, ShieldCheck, Ticket, Plus, RefreshCw, ChevronRight, Trash2, X, AlertTriangle, Mail, Layers, CheckCircle2, User } from 'lucide-react';
import SearchableMultiSelect from '../components/SearchableMultiSelect';

export default function Teams() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const canManageTeams = hasPermission(user, 'teams.manage');

  const [teams, setTeams] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [form, setForm] = useState({ name: '', category: '', groupEmail: '', defaultObserverIds: [] });
  const [groupEmailDraft, setGroupEmailDraft] = useState('');
  const [selectedObserverIds, setSelectedObserverIds] = useState([]);
  const [savingGroupEmail, setSavingGroupEmail] = useState(false);
  const [savingObservers, setSavingObservers] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [openTeamId, setOpenTeamId] = useState(null);
  const [openTeamDetail, setOpenTeamDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalError, setModalError] = useState('');

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
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/users')
      .then(({ data }) => setAllUsers(Array.isArray(data) ? data : (data.users || [])))
      .catch(() => {});
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

  function openCreateModal() {
    setForm({ name: '', category: '', groupEmail: '' });
    setModalError('');
    setShowCreateModal(true);
  }

  function askDelete(id) { setConfirmDeleteId(id); }

  async function saveGroupEmail(teamId) {
    setSavingGroupEmail(true); setError('');
    try {
      await api.patch(`/teams/${teamId}`, { groupEmail: groupEmailDraft });
      setOpenTeamDetail((prev) => ({ ...prev, groupEmail: groupEmailDraft }));
      load();
    } catch (err) { setError(err.response?.data?.error || "Erreur lors de l'enregistrement"); }
    finally { setSavingGroupEmail(false); }
  }

  async function saveDefaultObservers(teamId) {
    setSavingObservers(true);
    setError('');
    try {
      const { data } = await api.patch(`/teams/${teamId}`, { defaultObserverIds: selectedObserverIds });
      setOpenTeamDetail((prev) => ({ ...prev, defaultObservers: data.defaultObservers }));
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la sauvegarde des observateurs');
    } finally {
      setSavingObservers(false);
    }
  }

  function toggleObserverSelect(userId) {
    setSelectedObserverIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try { await api.delete(`/teams/${confirmDeleteId}`); load(); setConfirmDeleteId(null); }
    catch (err) { setError(err.response?.data?.error || 'Erreur lors de la suppression'); }
    finally { setDeleting(false); }
  }

  async function handleSyncGlpi() {
    setSyncing(true); setError(''); setSyncMessage('');
    try {
      const { data } = await api.post('/teams/sync-glpi');
      setSyncMessage(`${data.synced} équipe(s) et ${data.syncedCategories || 0} catégorie(s) synchronisée(s) depuis GLPI.`);
      load();
    } catch (err) { setError(err.response?.data?.error || 'Erreur lors de la synchronisation GLPI'); }
    finally { setSyncing(false); }
  }

  const totalMembers = teams.reduce((sum, t) => sum + t.members.length, 0);
  const totalTickets = teams.reduce((sum, t) => sum + t._count.tickets, 0);
  const maxTickets = Math.max(1, ...teams.map((t) => t._count.tickets));

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top Bar Sticky ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Équipes</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">
              Configuration des groupes de support, compétences et niveaux d'escalade
            </p>
          </div>
        </div>

        {/* Actions */}
        {canManageTeams && (
          <div className="flex items-center gap-2 ml-auto">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleSyncGlpi} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container text-xs font-semibold disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync GLPI'}</span>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-blue-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nouvelle équipe</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Bannières d'erreur ou d'information ───────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 lg:px-8 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
        {syncMessage && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 lg:px-8 py-2 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {syncMessage}
              <button onClick={() => setSyncMessage('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bento Stats Items ─────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 border-b border-outline-variant/15 bg-surface-container-low/20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-on-surface leading-none">{teams.length}</p>
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider mt-1">Total Équipes</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-on-surface leading-none">{totalMembers}</p>
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider mt-1">Membres Actifs</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <Ticket className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-on-surface leading-none">{totalTickets}</p>
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider mt-1">Tickets Traités</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Teams Table / List ────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-on-surface">Équipes actives ({teams.length})</h2>
        </div>

        <div className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest shadow-sm">
          {/* Header */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-b border-outline-variant/20 bg-surface-container-low/40 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
            <div className="w-8 shrink-0" />
            <div className="flex-1 min-w-0">Équipe</div>
            <div className="w-24 shrink-0 hidden sm:block text-center">Membres</div>
            <div className="w-36 shrink-0 hidden md:block">Tickets assignés</div>
            <div className="w-12 shrink-0 text-right" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-outline-variant/10">
            {teams.map((t) => {
              const isOpen = openTeamId === t.id;
              const percent = Math.round((t._count.tickets / maxTickets) * 100);

              return (
                <Fragment key={t.id}>
                  <div
                    onClick={() => toggleTeamDetail(t.id)}
                    className={`flex items-center gap-4 px-4 py-3.5 hover:bg-surface-container-low/50 transition-colors cursor-pointer group ${
                      isOpen ? 'bg-blue-500/5' : ''
                    }`}
                  >
                    {/* Expand icon */}
                    <div className="w-8 shrink-0 flex justify-center">
                      <ChevronRight className={`w-4 h-4 text-on-surface-variant transition-transform duration-200 ${isOpen ? 'rotate-90 text-blue-600 dark:text-blue-400' : ''}`} />
                    </div>

                    {/* Team info */}
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">
                        {t.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors truncate flex items-center gap-2">
                          {t.name}
                          {t.glpiGroupId && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white leading-none">GLPI</span>
                          )}
                        </p>
                        {t.category && (
                          <span className="text-[10px] text-on-surface-variant font-medium uppercase tracking-wider">{t.category}</span>
                        )}
                      </div>
                    </div>

                    {/* Members count */}
                    <div className="w-24 shrink-0 hidden sm:flex justify-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container border border-outline-variant/30 text-xs font-bold text-on-surface">
                        <Users className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                        {t.members.length}
                      </span>
                    </div>

                    {/* Tickets count progress */}
                    <div className="w-36 shrink-0 hidden md:block">
                      <div className="flex items-center justify-between text-[10px] font-bold text-on-surface-variant mb-1">
                        <span>{t._count.tickets} ticket{t._count.tickets !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden bg-surface-container border border-outline-variant/30">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full" style={{ width: `${percent}%` }} />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="w-12 shrink-0 flex justify-end">
                      {canManageTeams && (
                        <button
                          onClick={(e) => { e.stopPropagation(); askDelete(t.id); }}
                          className="p-1.5 rounded-lg text-on-surface-variant/40 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Open Detail view */}
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-surface-container-low/30 border-t border-outline-variant/10 px-6 py-4 space-y-4"
                      >
                        {loadingDetail ? (
                          <div className="flex items-center justify-center py-4 gap-2 text-on-surface-variant text-xs">
                            <RefreshCw className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                            Chargement des détails...
                          </div>
                        ) : openTeamDetail ? (
                          <div className="space-y-4">
                            {/* Group Email */}
                            <div className="flex items-center gap-3 bg-surface border border-outline-variant/30 rounded-xl p-3">
                              <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block">Email de groupe</span>
                                <input
                                  type="email"
                                  value={groupEmailDraft}
                                  onChange={e => setGroupEmailDraft(e.target.value)}
                                  placeholder="support-equipe@domaine.ci"
                                  className="w-full bg-transparent text-xs text-on-surface font-mono focus:outline-none"
                                />
                              </div>
                              {canManageTeams && (
                                <button
                                  onClick={() => saveGroupEmail(t.id)}
                                  disabled={savingGroupEmail || groupEmailDraft === (openTeamDetail.groupEmail || '')}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700 transition-all shrink-0"
                                >
                                  {savingGroupEmail ? '...' : 'Enregistrer'}
                                </button>
                              )}
                            </div>

                             {/* Members list */}
                            <div>
                              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">
                                Membres de l'équipe ({openTeamDetail.members?.length || 0})
                              </span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {openTeamDetail.members?.map(m => (
                                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-xl bg-surface border border-outline-variant/30">
                                    <div className="w-7 h-7 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                                      {m.fullName?.charAt(0)?.toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-on-surface truncate">{m.fullName}</p>
                                      <p className="text-[10px] text-on-surface-variant font-mono truncate">{m.email}</p>
                                    </div>
                                  </div>
                                ))}
                                {openTeamDetail.members?.length === 0 && (
                                  <p className="text-xs text-on-surface-variant italic col-span-full">Aucun membre dans cette équipe.</p>
                                )}
                              </div>
                            </div>

                            {/* Default Observers Configuration */}
                            <div className="pt-2 border-t border-outline-variant/20 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                                  <User className="w-3.5 h-3.5 text-purple-500" />
                                  Observateurs par défaut pour cette équipe ({selectedObserverIds.length})
                                </span>
                                {canManageTeams && (
                                  <button
                                    onClick={() => saveDefaultObservers(t.id)}
                                    disabled={savingObservers}
                                    className="px-3 py-1 rounded-lg bg-purple-600 text-white text-[11px] font-bold disabled:opacity-40 hover:bg-purple-700 transition-all shrink-0"
                                  >
                                    {savingObservers ? '...' : 'Enregistrer les observateurs'}
                                  </button>
                                )}
                              </div>
                              <p className="text-[11px] text-on-surface-variant">
                                Les observateurs configurés ici seront automatiquement ajoutés à tous les tickets associés à cette équipe (via l'IA ou formulaire).
                              </p>
                              <SearchableMultiSelect
                                options={allUsers}
                                selectedIds={selectedObserverIds}
                                onChange={(nextIds) => setSelectedObserverIds(nextIds)}
                                placeholder="Rechercher un observateur par nom ou email..."
                                labelKey="fullName"
                                valueKey="id"
                                subLabelKey="email"
                              />
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
        </div>
      </div>

      {/* ── Modal de Création d'équipe ───────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showCreateModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCreateModal(false)} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-blue-500/10"><Users className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                  <h3 className="text-sm font-bold text-on-surface">Créer une nouvelle équipe</h3>
                  <motion.button onClick={() => setShowCreateModal(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></motion.button>
                </div>
                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  {modalError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
                      {modalError}
                    </div>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom de l'équipe *</span>
                    <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="ex: Support Réseau Niveau 2"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                    <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                      placeholder="ex: Réseau, Infrastructure"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email de groupe</span>
                    <input type="email" value={form.groupEmail} onChange={e => setForm({ ...form, groupEmail: e.target.value })}
                      placeholder="equipe-reseau@domaine.ci"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                  </label>
                  <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant/30">
                    <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container">Annuler</button>
                    <button type="submit" className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-blue-500/20">Créer l'équipe</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <ConfirmDialog open={!!confirmDeleteId} title="Supprimer l'équipe"
        message="Supprimer définitivement cette équipe ? Cette action est irréversible."
        confirmLabel="Supprimer" danger loading={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />
    </div>
  );
}
