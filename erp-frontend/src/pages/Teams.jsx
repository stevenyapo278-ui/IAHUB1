import { Fragment, useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';

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
    api
      .get('/teams')
      .then(({ data }) => setTeams(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/teams', form);
      setForm({ name: '', category: '', groupEmail: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  function askDelete(id) {
    setConfirmDeleteId(id);
  }

  async function saveGroupEmail(teamId) {
    setSavingGroupEmail(true);
    setError('');
    try {
      await api.patch(`/teams/${teamId}`, { groupEmail: groupEmailDraft });
      setOpenTeamDetail((prev) => ({ ...prev, groupEmail: groupEmailDraft }));
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'enregistrement");
    } finally {
      setSavingGroupEmail(false);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/teams/${confirmDeleteId}`);
      load();
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSyncGlpi() {
    setSyncing(true);
    setError('');
    setSyncMessage('');
    try {
      const { data } = await api.post('/teams/sync-glpi');
      setSyncMessage(`${data.synced} équipe(s) et ${data.syncedCategories || 0} catégorie(s) synchronisée(s) depuis GLPI.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la synchronisation GLPI');
    } finally {
      setSyncing(false);
    }
  }

  const totalMembers = teams.reduce((sum, t) => sum + t.members.length, 0);
  const totalTickets = teams.reduce((sum, t) => sum + t._count.tickets, 0);
  const maxTickets = Math.max(1, ...teams.map((t) => t._count.tickets));

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex justify-between items-start">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Équipes</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Configuration des groupes de support et niveaux d'escalade.</p>
        </div>
        {canManageTeams && (
          <button
            onClick={handleSyncGlpi}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant text-on-surface bg-surface-container-lowest font-body-sm text-body-sm hover:bg-surface-container-low transition-all duration-300 shadow-sm disabled:opacity-50 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">sync</span>
            {syncing ? 'Synchronisation...' : 'Synchroniser depuis GLPI'}
          </button>
        )}
      </header>

      {error && <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">{error}</div>}
      {syncMessage && <div className="border border-primary/20 bg-primary/5 text-primary p-md rounded-xl font-body-md">{syncMessage}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
        <div className="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant/60 card-shadow hover-interactive flex flex-col justify-between">
          <div className="flex justify-between items-start mb-md">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Total équipes</span>
            <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary border border-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm">hub</span>
            </div>
          </div>
          <span className="font-display-lg text-display-lg text-on-surface">{teams.length}</span>
        </div>
        <div className="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant/60 card-shadow hover-interactive flex flex-col justify-between">
          <div className="flex justify-between items-start mb-md">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Membres actifs</span>
            <div className="w-10 h-10 rounded-xl bg-secondary/5 text-secondary border border-secondary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm">badge</span>
            </div>
          </div>
          <span className="font-display-lg text-display-lg text-on-surface">{totalMembers}</span>
        </div>
        <div className="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant/60 card-shadow hover-interactive flex flex-col justify-between">
          <div className="flex justify-between items-start mb-md">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Tickets totaux</span>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/5 text-indigo-500 border border-indigo-500/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm">confirmation_number</span>
            </div>
          </div>
          <span className="font-display-lg text-display-lg text-on-surface">{totalTickets}</span>
        </div>
      </div>

      <div className={`grid grid-cols-1 ${canManageTeams ? 'lg:grid-cols-3' : ''} gap-xl`}>
        <div className={`${canManageTeams ? 'lg:col-span-2' : ''} space-y-md`}>
          <h3 className="font-headline-md text-headline-md text-on-surface">Équipes actives</h3>
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-bright/50">
                  <th className="py-sm px-md font-label-md text-label-md text-on-surface-variant uppercase">Nom</th>
                  <th className="py-sm px-md font-label-md text-label-md text-on-surface-variant uppercase">Catégorie</th>
                  <th className="py-sm px-md font-label-md text-label-md text-on-surface-variant uppercase">GLPI</th>
                  <th className="py-sm px-md font-label-md text-label-md text-on-surface-variant uppercase text-center">Membres</th>
                  <th className="py-sm px-md font-label-md text-label-md text-on-surface-variant uppercase text-right">Tickets</th>
                  {canManageTeams && <th className="py-sm px-md w-10"></th>}
                </tr>
              </thead>
              <tbody className="font-body-md text-body-md text-on-surface">
                {teams.map((t) => (
                  <Fragment key={t.id}>
                  <tr className="border-b border-outline-variant/60 hover:bg-surface-container-low/70 transition-colors group">
                    <td className="py-md px-md font-headline-sm text-headline-sm">
                      <button onClick={() => toggleTeamDetail(t.id)} className="hover:underline text-left text-on-surface font-semibold">
                        {t.name}
                      </button>
                    </td>
                    <td className="py-md px-md">
                      {t.category ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-primary/20 bg-primary/5 text-primary">
                          {t.category}
                        </span>
                      ) : (
                        <span className="text-outline/60">-</span>
                      )}
                    </td>
                    <td className="py-md px-md">
                      {t.glpiGroupId ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-outline-variant bg-surface-container-low text-on-surface-variant font-medium text-[11px]">
                          <span className="material-symbols-outlined text-[14px]">sync</span>
                          #{t.glpiGroupId}
                        </span>
                      ) : (
                        <span className="text-outline/60 italic text-[11px]">Non lié</span>
                      )}
                    </td>
                    <td className="py-md px-md text-center font-medium">{t.members.length}</td>
                    <td className="py-md px-md text-right">
                      <div className="flex items-center justify-end gap-sm">
                        <span className="font-medium">{t._count.tickets}</span>
                        <div className="w-16 h-2 bg-surface-container/60 rounded-full overflow-hidden">
                          <div className="bg-gradient-to-r from-primary to-indigo-500 h-full rounded-full" style={{ width: `${(t._count.tickets / maxTickets) * 100}%` }}></div>
                        </div>
                      </div>
                    </td>
                    {canManageTeams && (
                      <td className="py-md px-md text-right opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => askDelete(t.id)} className="text-on-surface-variant hover:text-error transition-colors">
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </td>
                    )}
                  </tr>
                  {openTeamId === t.id && (
                    <tr className="border-b border-outline-variant/60 bg-surface-container-low/40">
                      <td colSpan={canManageTeams ? 6 : 5} className="py-md px-md">
                        {loadingDetail && <p className="text-on-surface-variant font-body-sm text-body-sm">Chargement...</p>}
                        {!loadingDetail && openTeamDetail && (
                          <div className="flex flex-col gap-3 p-xs">
                            {canManageTeams && (
                              <div className="flex items-center gap-sm pb-md border-b border-outline-variant/50 mb-2">
                                <span className="font-label-md text-label-md text-on-surface-variant uppercase shrink-0">
                                  Email de groupe
                                </span>
                                <input
                                  type="email"
                                  className="flex-1 h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-sm text-body-sm text-on-surface"
                                  placeholder="ex: reseau@entreprise.com"
                                  value={groupEmailDraft}
                                  onChange={(e) => setGroupEmailDraft(e.target.value)}
                                  disabled={savingGroupEmail}
                                />
                                <button
                                  onClick={() => saveGroupEmail(t.id)}
                                  disabled={savingGroupEmail || groupEmailDraft === (openTeamDetail.groupEmail || '')}
                                  className="px-4 py-2 rounded-xl border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-all duration-300 disabled:opacity-50 shrink-0 font-medium"
                                >
                                  Enregistrer
                                </button>
                              </div>
                            )}
                            <span className="font-label-md text-label-md text-on-surface-variant uppercase">
                              Charge active par technicien (du moins au plus chargé)
                            </span>
                            {openTeamDetail.members.length === 0 && (
                              <p className="text-on-surface-variant font-body-sm text-body-sm italic">Aucun membre dans cette équipe.</p>
                            )}
                            <div className="flex flex-col divide-y divide-outline-variant/40">
                              {openTeamDetail.members.map((m) => (
                                <div key={m.id} className="py-2 flex items-center justify-between">
                                  <div>
                                    <span className="font-body-md text-body-md text-on-surface font-semibold">{m.fullName}</span>
                                    <span className="text-xs text-on-surface-variant ml-2 border border-outline-variant/50 px-2 py-0.5 rounded-full bg-surface-container-low">{m.role}</span>
                                  </div>
                                  <span className="font-mono-sm text-mono-sm text-on-surface-variant">
                                    {m.activeTicketCount} ticket(s) actif(s)
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 px-md text-center text-on-surface-variant italic">Aucune équipe.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {canManageTeams && (
          <div className="lg:col-span-1">
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow sticky top-4 overflow-hidden">
              <div className="p-lg border-b border-outline-variant/60 bg-surface-bright/35">
                <h3 className="font-headline-md text-headline-md text-on-surface flex items-center gap-sm font-semibold">
                  <span className="material-symbols-outlined text-primary text-[22px]">add_circle</span>
                  Nouvelle équipe
                </h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">Définir le nom et le domaine de l'équipe.</p>
              </div>
              <form onSubmit={handleCreate} className="p-lg space-y-md">
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Nom de l'équipe</label>
                  <input
                    className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-sm text-body-sm text-on-surface"
                    placeholder="ex: Réseau L1"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Catégorie</label>
                  <input
                    className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-sm text-body-sm text-on-surface"
                    placeholder="ex: Infrastructure"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Email de groupe</label>
                  <input
                    type="email"
                    className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-sm text-body-sm text-on-surface"
                    placeholder="ex: reseau@entreprise.com"
                    value={form.groupEmail}
                    onChange={(e) => setForm({ ...form, groupEmail: e.target.value })}
                  />
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-2 italic leading-relaxed">
                    Reçoit le récapitulatif quotidien des tickets de cette équipe.
                  </p>
                </div>
                <div className="pt-md mt-md border-t border-outline-variant/60 flex justify-end">
                  <button
                    type="submit"
                    className="px-md py-sm rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-headline-sm text-headline-sm hover:opacity-90 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all duration-300"
                  >
                    Créer l'équipe
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Supprimer l'équipe"
        message="Supprimer définitivement cette équipe ? Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
