import { useEffect, useState } from 'react';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { PERMISSION_DEFINITIONS } from '../config/permissions';
import { useAuth } from '../context/AuthContext';

const emptyForm = { name: '', description: '', permissions: [] };

export default function PermissionGroups() {
  const { user } = useAuth();
  // Créer/modifier/supprimer un groupe (et ses permissions) est réservé au SUPERADMIN — un ADMIN
  // peut seulement assigner des utilisateurs aux groupes déjà définis (même règle côté backend,
  // voir permissiongroup.routes.js : requireSuperAdmin sur POST/PATCH/DELETE).
  const canManageGroups = user?.role === 'SUPERADMIN';
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [openGroupId, setOpenGroupId] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [detailForm, setDetailForm] = useState({ name: '', description: '' });
  const [savingDetail, setSavingDetail] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);

  function load() {
    Promise.all([api.get('/permission-groups'), api.get('/users')])
      .then(([groupsRes, usersRes]) => {
        setGroups(groupsRes.data);
        setUsers(usersRes.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  function togglePermission(key) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/permission-groups', form);
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  }

  function openGroupDetail(group) {
    setOpenGroupId(group.id);
    setDetailForm({ name: group.name, description: group.description || '' });
    setMemberSearch('');
    setSavedMessage(false);
  }

  async function saveGroupDetail(group) {
    setSavingDetail(true);
    setError('');
    setSavedMessage(false);
    try {
      await api.patch(`/permission-groups/${group.id}`, { name: detailForm.name, description: detailForm.description });
      setSavedMessage(true);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSavingDetail(false);
    }
  }

  async function toggleGroupPermission(group, key) {
    const permissions = group.permissions.includes(key)
      ? group.permissions.filter((p) => p !== key)
      : [...group.permissions, key];
    try {
      await api.patch(`/permission-groups/${group.id}`, { permissions });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  async function toggleMember(group, userId, isMember) {
    try {
      await api.post(`/permission-groups/${group.id}/${isMember ? 'unassign' : 'assign'}`, { userIds: [userId] });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour des membres');
    }
  }

  function askDelete(id) {
    setConfirmDeleteId(id);
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/permission-groups/${confirmDeleteId}`);
      load();
      setConfirmDeleteId(null);
      if (openGroupId === confirmDeleteId) setOpenGroupId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  const inputClass = 'bg-surface border border-outline-variant/60 rounded-xl py-2 px-3.5 text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';
  const openGroup = groups.find((g) => g.id === openGroupId);
  const filteredUsers = users.filter((u) =>
    `${u.fullName} ${u.email}`.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex justify-between items-end gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background font-bold">Groupes de droits</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Gestion fine des permissions par groupe.
            {!canManageGroups && ' Seul un super-administrateur peut créer, modifier ou supprimer un groupe — vous pouvez assigner des utilisateurs aux groupes existants.'}
          </p>
        </div>
        {canManageGroups && (
          <button
            onClick={() => { setShowForm((v) => !v); setError(''); }}
            className="border border-outline-variant/60 rounded-xl py-2 px-4 font-semibold text-body-sm text-on-surface hover:bg-surface-container-high transition-all duration-300 shadow-sm"
          >
            {showForm ? 'Annuler' : '+ Nouveau groupe'}
          </button>
        )}
      </header>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      {canManageGroups && showForm && (
        <form onSubmit={handleCreate} className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md">
          <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Créer un groupe de droits</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom</label>
              <input
                required
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Description</label>
              <input
                className={inputClass}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 mt-2">
            <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold mb-2">Permissions</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-surface-container-low/40 border border-outline-variant/60 rounded-xl p-md">
              {PERMISSION_DEFINITIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(p.key)}
                    onChange={() => togglePermission(p.key)}
                    className="w-4 h-4 cursor-pointer accent-primary"
                  />
                  <span className="text-body-sm text-on-surface font-medium">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end mt-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-50 text-body-sm"
            >
              {submitting ? 'Création…' : 'Créer le groupe'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow overflow-hidden flex flex-col">
        <div className="p-md border-b border-outline-variant/40 bg-surface-container-low/20 flex justify-between items-center">
          <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Groupes</span>
          <span className="text-on-surface-variant text-xs font-mono-sm bg-surface-container border border-outline-variant/50 px-2.5 py-0.5 rounded-full font-medium">
            {groups.length} groupe(s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Description</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center w-32">Permissions</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center w-28">Membres</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/40 font-body-sm text-body-sm text-on-surface">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="p-md font-headline-sm text-headline-sm">
                    <button
                      onClick={() => (openGroupId === g.id ? setOpenGroupId(null) : openGroupDetail(g))}
                      className="hover:underline text-left text-primary font-semibold"
                    >
                      {g.name}
                    </button>
                  </td>
                  <td className="p-md text-on-surface-variant">{g.description || '-'}</td>
                  <td className="p-md text-center font-mono">{g.permissions.length}</td>
                  <td className="p-md text-center font-mono">{g._count?.members ?? g.members?.length ?? 0}</td>
                  <td className="p-md text-right">
                    {canManageGroups && (
                      <button onClick={() => askDelete(g.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-md text-center text-on-surface-variant italic font-body-md">Aucun groupe de droits défini.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openGroup && (
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-lg">
          <div className="flex justify-between items-center border-b border-outline-variant/40 pb-md">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {canManageGroups ? `Modifier le groupe : ${openGroup.name}` : openGroup.name}
            </span>
            <button onClick={() => setOpenGroupId(null)} className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {canManageGroups && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                <div className="flex flex-col gap-1">
                  <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom</label>
                  <input
                    value={detailForm.name}
                    onChange={(e) => { setDetailForm({ ...detailForm, name: e.target.value }); setSavedMessage(false); }}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Description</label>
                  <input
                    value={detailForm.description}
                    onChange={(e) => { setDetailForm({ ...detailForm, description: e.target.value }); setSavedMessage(false); }}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="flex items-center gap-md">
                <button
                  onClick={() => saveGroupDetail(openGroup)}
                  disabled={savingDetail || (detailForm.name === openGroup.name && detailForm.description === (openGroup.description || ''))}
                  className="bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2 px-5 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-50 text-body-sm"
                >
                  {savingDetail ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
                {savedMessage && (
                  <span className="text-body-sm text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 animate-pulse">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    Modifications enregistrées.
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t border-outline-variant/40 pt-md">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold mb-1">Permissions</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-surface-container-low/40 border border-outline-variant/60 rounded-xl p-md">
                  {PERMISSION_DEFINITIONS.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={openGroup.permissions.includes(p.key)}
                        onChange={() => toggleGroupPermission(openGroup, p.key)}
                        className="w-4 h-4 cursor-pointer accent-primary"
                      />
                      <span className="text-body-sm text-on-surface font-medium">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex flex-col gap-2 border-t border-outline-variant/40 pt-md">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold mb-1">Membres ({openGroup.members?.length || 0})</span>
            <input
              placeholder="Rechercher un utilisateur pour l'ajouter/retirer..."
              className={inputClass}
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto border border-outline-variant/60 rounded-xl divide-y divide-outline-variant/40 mt-2 bg-surface">
              {filteredUsers.map((u) => {
                const isMember = openGroup.members?.some((m) => m.id === u.id);
                return (
                  <label key={u.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-surface-container-low/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={!!isMember}
                      onChange={() => toggleMember(openGroup, u.id, isMember)}
                      className="w-4 h-4 cursor-pointer accent-primary"
                    />
                    <div className="flex-1">
                      <span className="text-body-sm text-on-surface font-semibold">{u.fullName}</span>
                      <span className="text-xs text-on-surface-variant block mt-0.5">{u.email}</span>
                    </div>
                  </label>
                );
              })}
              {filteredUsers.length === 0 && (
                <div className="p-xl text-center text-on-surface-variant italic text-body-sm">Aucun utilisateur correspondant.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Supprimer le groupe"
        message="Supprimer définitivement ce groupe de droits ? Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
