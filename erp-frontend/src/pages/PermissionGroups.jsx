import { useEffect, useState } from 'react';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { PERMISSION_DEFINITIONS } from '../config/permissions';

const emptyForm = { name: '', description: '', permissions: [] };

export default function PermissionGroups() {
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

  const inputClass = 'bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 text-body-sm text-on-surface focus:border-on-surface focus:outline-none';
  const openGroup = groups.find((g) => g.id === openGroupId);
  const filteredUsers = users.filter((u) =>
    `${u.fullName} ${u.email}`.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex justify-between items-end gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Groupes de droits</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Gestion fine des permissions par groupe.</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setError(''); }}
          className="border border-outline-variant rounded-none py-2 px-4 font-label-md text-label-md text-on-surface hover:bg-surface-container-low transition-colors"
        >
          {showForm ? 'Annuler' : '+ Nouveau groupe'}
        </button>
      </header>

      {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-md">
          <span className="font-headline-sm text-headline-sm text-on-surface">Créer un groupe de droits</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase">Nom</label>
              <input
                required
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase">Description</label>
              <input
                className={inputClass}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-label-md text-label-md text-on-surface-variant uppercase">Permissions</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PERMISSION_DEFINITIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(p.key)}
                    onChange={() => togglePermission(p.key)}
                    className="w-4 h-4 border-outline-variant cursor-pointer"
                  />
                  <span className="text-body-sm text-on-surface">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={submitting}
              className="border border-outline-variant rounded-none py-2 px-4 font-label-md text-label-md text-on-surface hover:bg-surface-container-low transition-colors disabled:opacity-50"
            >
              {submitting ? 'Création…' : 'Créer'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-none overflow-hidden flex flex-col">
        <div className="p-md border-b border-outline-variant flex justify-between items-center">
          <span className="font-headline-sm text-headline-sm text-on-surface">Groupes</span>
          <span className="text-on-surface-variant text-xs font-mono-sm">{groups.length} groupe(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant">
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Nom</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Description</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-center w-32">Permissions</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-center w-28">Membres</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm text-on-surface">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="p-md font-headline-sm text-headline-sm">
                    <button
                      onClick={() => { setOpenGroupId(openGroupId === g.id ? null : g.id); setMemberSearch(''); }}
                      className="hover:underline text-left"
                    >
                      {g.name}
                    </button>
                  </td>
                  <td className="p-md text-on-surface-variant">{g.description || '-'}</td>
                  <td className="p-md text-center">{g.permissions.length}</td>
                  <td className="p-md text-center">{g._count?.members ?? g.members?.length ?? 0}</td>
                  <td className="p-md text-right">
                    <button onClick={() => askDelete(g.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-md text-center text-on-surface-variant">Aucun groupe de droits.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openGroup && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-lg">
          <div className="flex justify-between items-center">
            <span className="font-headline-sm text-headline-sm text-on-surface">{openGroup.name} — détail</span>
            <button onClick={() => setOpenGroupId(null)} className="text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase">Permissions</span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PERMISSION_DEFINITIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={openGroup.permissions.includes(p.key)}
                    onChange={() => toggleGroupPermission(openGroup, p.key)}
                    className="w-4 h-4 border-outline-variant cursor-pointer"
                  />
                  <span className="text-body-sm text-on-surface">{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase">Membres ({openGroup.members?.length || 0})</span>
            <input
              placeholder="Rechercher un utilisateur..."
              className={inputClass}
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto border border-outline-variant rounded-none divide-y divide-outline-variant">
              {filteredUsers.map((u) => {
                const isMember = openGroup.members?.some((m) => m.id === u.id);
                return (
                  <label key={u.id} className="flex items-center gap-3 p-2 cursor-pointer hover:bg-surface-container-low">
                    <input
                      type="checkbox"
                      checked={!!isMember}
                      onChange={() => toggleMember(openGroup, u.id, isMember)}
                      className="w-4 h-4 border-outline-variant cursor-pointer"
                    />
                    <span className="text-body-sm text-on-surface">{u.fullName}</span>
                    <span className="text-xs text-on-surface-variant">{u.email}</span>
                  </label>
                );
              })}
              {filteredUsers.length === 0 && (
                <div className="p-md text-center text-on-surface-variant text-body-sm">Aucun utilisateur trouvé.</div>
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
