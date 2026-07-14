import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

export default function Teams() {
  const { user } = useAuth();
  const canManageTeams = hasPermission(user, 'teams.manage');
  const [teams, setTeams] = useState([]);
  const [form, setForm] = useState({ name: '', category: '', groupEmail: '' });
  const [groupEmailDraft, setGroupEmailDraft] = useState('');
  const [savingGroupEmail, setSavingGroupEmail] = useState(false);
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
    <motion.div className="p-lg space-y-lg" variants={containerVariants} initial="hidden" animate="visible">
      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <motion.header variants={itemVariants} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Équipes</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Configuration des groupes de support et niveaux d'escalade.</p>
        </div>
        {canManageTeams && (
          <div className="flex flex-wrap gap-2 items-center">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white btn-gradient font-body-sm text-body-sm font-semibold transition-all shadow-md shadow-primary/20 hover:shadow-lg whitespace-nowrap cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>
              Nouvelle équipe
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleSyncGlpi} disabled={syncing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant text-on-surface bg-surface-container-lowest font-body-sm text-body-sm hover:bg-surface-container-low transition-all shadow-sm disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <motion.span animate={syncing ? { rotate: 360 } : { rotate: 0 }}
                transition={syncing ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
                className="material-symbols-outlined text-[18px]" aria-hidden="true"
              >sync</motion.span>
              {syncing ? 'Synchronisation...' : 'Sync GLPI'}
            </motion.button>
          </div>
        )}
      </motion.header>

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -8, height: 0 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md"
          >{error}</motion.div>
        )}
        {syncMessage && (
          <motion.div initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -8, height: 0 }}
            className="border border-primary/20 bg-primary/5 text-primary p-md rounded-xl font-body-md"
          >{syncMessage}</motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* STATISTIQUES */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
        <StatCard label="Total équipes" value={teams.length} icon="hub" />
        <StatCard label="Membres actifs" value={totalMembers} icon="badge" />
        <StatCard label="Tickets totaux" value={totalTickets} icon="confirmation_number" />
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* TABLEAU DES ÉQUIPES (PLEINE LARGEUR) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="space-y-md w-full">
        <h3 className="font-headline-md text-headline-md text-on-surface font-semibold">Équipes actives</h3>
        <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest overflow-hidden card-shadow">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-primary/10 border-b-2 border-primary/20">
                  <TH>Nom</TH>
                  <TH>Catégorie</TH>
                  <TH>GLPI</TH>
                  <TH className="text-center">Membres</TH>
                  <TH className="text-right">Tickets</TH>
                  {canManageTeams && <TH className="w-10"></TH>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30 text-sm">
                <AnimatePresence mode="popLayout">
                  {teams.map((t, idx) => (
                    <Fragment key={t.id}>
                      <motion.tr layout
                        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25, delay: idx * 0.02 }}
                        className="hover:bg-primary/[0.08] transition-colors duration-150 group cursor-pointer"
                        onClick={() => toggleTeamDetail(t.id)}
                      >
                        <td className="py-5 px-6">
                          <button onClick={(e) => { e.stopPropagation(); toggleTeamDetail(t.id); }}
                            className="font-headline-sm text-headline-sm text-on-surface font-semibold hover:text-primary transition-colors text-left focus-visible:outline-2 focus-visible:outline-primary rounded"
                          >
                            <span className="flex items-center gap-2">
                              <motion.span
                                animate={{ rotate: openTeamId === t.id ? 90 : 0 }}
                                transition={{ duration: 0.2 }}
                                className="material-symbols-outlined text-[16px] text-on-surface-variant" aria-hidden="true"
                              >chevron_right</motion.span>
                              {t.name}
                            </span>
                          </button>
                        </td>
                        <td className="py-5 px-6">
                          {t.category ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-primary/20 bg-primary/5 text-primary">
                              {t.category}
                            </span>
                          ) : <span className="text-outline/60">-</span>}
                        </td>
                        <td className="py-5 px-6">
                          {t.glpiGroupId ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-outline-variant bg-surface-container-low text-on-surface-variant font-medium text-[11px]">
                              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">sync</span>
                              #{t.glpiGroupId}
                            </span>
                          ) : <span className="text-outline/60 italic text-[11px]">Non lié</span>}
                        </td>
                        <td className="py-5 px-6 text-center font-medium">{t.members.length}</td>
                        <td className="py-5 px-6">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-medium">{t._count.tickets}</span>
                            <div className="w-16 h-2 bg-surface-container/60 rounded-full overflow-hidden shrink-0">
                              <motion.div
                                animate={{ width: `${(t._count.tickets / maxTickets) * 100}%` }}
                                transition={{ duration: 0.6, delay: idx * 0.05 }}
                                className="progress-gradient h-full rounded-full"
                              />
                            </div>
                          </div>
                        </td>
                        {canManageTeams && (
                          <td className="py-5 px-6">
                            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                              onClick={(e) => { e.stopPropagation(); askDelete(t.id); }}
                              className="text-on-surface-variant/50 hover:text-error transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                            </motion.button>
                          </td>
                        )}
                      </motion.tr>
                      {/* ── Ligne extensible ─────────────────────────────────── */}
                      <AnimatePresence>
                        {openTeamId === t.id && (
                          <motion.tr key={`${t.id}-detail`}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <td colSpan={canManageTeams ? 6 : 5} className="p-0">
                              <div className="bg-surface-container-low/40 border-t border-outline-variant/40 px-md py-md">
                                {loadingDetail ? (
                                  <div className="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm">
                                    <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                                    Chargement...
                                  </div>
                                ) : openTeamDetail && (
                                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
                                    className="flex flex-col gap-3"
                                  >
                                    {canManageTeams && (
                                      <div className="flex items-center gap-2 pb-3 border-b border-outline-variant/50 flex-wrap">
                                        <span className="font-label-md text-label-md text-on-surface-variant uppercase shrink-0">Email de groupe</span>
                                        <input type="email"
                                          className="flex-1 min-w-[200px] h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface"
                                          placeholder="ex: reseau@entreprise.com"
                                          value={groupEmailDraft} onChange={(e) => setGroupEmailDraft(e.target.value)}
                                          disabled={savingGroupEmail}
                                        />
                                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                                          onClick={() => saveGroupEmail(t.id)}
                                          disabled={savingGroupEmail || groupEmailDraft === (openTeamDetail.groupEmail || '')}
                                          className="px-4 py-2.5 rounded-xl border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-all disabled:opacity-50 font-medium shrink-0"
                                        >{savingGroupEmail ? '...' : 'Enregistrer'}</motion.button>
                                      </div>
                                    )}
                                    <span className="font-label-md text-label-md text-on-surface-variant uppercase">Charge active par technicien</span>
                                    {openTeamDetail.members.length === 0 ? (
                                      <p className="text-on-surface-variant font-body-sm text-body-sm italic">Aucun membre dans cette équipe.</p>
                                    ) : (
                                      <div className="flex flex-col divide-y divide-outline-variant/40">
                                        {openTeamDetail.members.map((m) => (
                                          <div key={m.id} className="py-2 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <span className="font-body-md text-body-md text-on-surface font-semibold">{m.fullName}</span>
                                              <span className="text-[11px] text-on-surface-variant border border-outline-variant/50 px-2 py-0.5 rounded-full bg-surface-container-low font-medium">{m.role}</span>
                                            </div>
                                            <span className="font-mono-sm text-mono-sm text-on-surface-variant flex items-center gap-1.5">
                                              <span className={`w-1.5 h-1.5 rounded-full ${m.activeTicketCount > 0 ? 'bg-primary animate-pulse-soft' : 'bg-outline/30'}`} />
                                              {m.activeTicketCount} actif(s)
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </motion.div>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </Fragment>
                  ))}
                </AnimatePresence>
                {teams.length === 0 && (
                  <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td colSpan={6} className="py-12 px-md text-center">
                      <div className="flex flex-col items-center gap-2 text-on-surface-variant">
                        <span className="material-symbols-outlined text-[40px] text-outline/40" aria-hidden="true">groups</span>
                        <p className="font-body-md text-body-md italic">Aucune équipe.</p>
                      </div>
                    </td>
                  </motion.tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* ── Confirm Delete Dialog ────────────────────────────────────────── */}
      <ConfirmDialog open={!!confirmDeleteId} title="Supprimer l'équipe"
        message="Supprimer définitivement cette équipe ? Cette action est irréversible."
        confirmLabel="Supprimer" danger loading={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />

      {/* ── Create Team Modal ───────────────────────────────────────────── */}
      {canManageTeams && createPortal(
        <AnimatePresence>
          {showCreateModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setShowCreateModal(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-[2px] cursor-pointer"
              />

              {/* Dialog Window */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-md w-full p-lg card-shadow flex flex-col gap-md"
              >
                {/* Header */}
                <div className="flex justify-between items-start pb-2 border-b border-outline-variant/30">
                  <h3 className="font-headline-md text-headline-md text-on-background font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">add_circle</span>
                    Nouvelle équipe
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-low p-1.5 rounded-lg transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
                  </button>
                </div>

                {/* Error Box */}
                {modalError && (
                  <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-sm text-body-sm">
                    {modalError}
                  </div>
                )}

                {/* Form */}
                <form onSubmit={handleCreate} className="space-y-4">
                  <Field label="Nom de l'équipe">
                    <input
                      className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface"
                      placeholder="ex: Réseau L1"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      autoFocus
                    />
                  </Field>
                  <Field label="Catégorie">
                    <input
                      className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface"
                      placeholder="ex: Infrastructure"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    />
                  </Field>
                  <Field label="Email de groupe">
                    <input
                      type="email"
                      className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-body-sm text-body-sm text-on-surface"
                      placeholder="ex: reseau@entreprise.com"
                      value={form.groupEmail}
                      onChange={(e) => setForm({ ...form, groupEmail: e.target.value })}
                    />
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 italic">Reçoit le récapitulatif quotidien.</p>
                  </Field>

                  {/* Actions */}
                  <div className="pt-4 border-t border-outline-variant/30 flex justify-end gap-sm">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors duration-300 font-medium cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl text-white font-body-sm text-body-sm font-semibold shadow-md btn-gradient shadow-primary/20 hover:shadow-lg transition-all cursor-pointer"
                    >
                      Créer l'équipe
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
}

/* ── Sous-composants ────────────────────────────────────────────────────────── */

function TH({ children, className }) {
  return (
    <th className={`py-3 px-6 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap ${className || ''}`}>
      {children}
    </th>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <motion.div variants={itemVariants}
      className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow flex flex-col p-lg justify-between hover-interactive"
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
    >
      <div className="flex justify-between items-start mb-md">
        <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">{label}</p>
        <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary border border-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-sm">{icon}</span>
        </div>
      </div>
      <h3 className="font-display-lg text-display-lg text-on-background font-bold">{value}</h3>
    </motion.div>
  );
}
