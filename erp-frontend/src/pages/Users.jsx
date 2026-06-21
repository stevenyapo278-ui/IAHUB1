import { useEffect, useState } from 'react';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

const ROLES = ['ADMIN', 'TECHNICIAN', 'REQUESTER'];

const ROLE_LABELS = {
  ADMIN: 'Administrateur — accès complet',
  TECHNICIAN: 'Technicien — gère et traite les tickets',
  REQUESTER: 'Demandeur — peut créer des tickets',
};

const emptyForm = { email: '', fullName: '', password: '', role: 'REQUESTER', teamId: '' };

function initials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [assignGroupId, setAssignGroupId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ fullName: '', email: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  function load() {
    Promise.all([api.get('/users'), api.get('/teams'), api.get('/permission-groups')])
      .then(([usersRes, teamsRes, groupsRes]) => {
        setUsers(usersRes.data);
        setTeams(teamsRes.data);
        setGroups(groupsRes.data);
        setSelectedIds([]);
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  function toggleSelect(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  function toggleSelectAll() {
    setSelectedIds((ids) => (ids.length === users.length ? [] : users.map((u) => u.id)));
  }

  async function handleAssignToGroup() {
    if (!assignGroupId || selectedIds.length === 0) return;
    setAssigning(true);
    setError('');
    try {
      await api.post(`/permission-groups/${assignGroupId}/assign`, { userIds: selectedIds });
      setAssignGroupId('');
      setSelectedIds([]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'assignation");
    } finally {
      setAssigning(false);
    }
  }

  async function updateField(id, field, value) {
    try {
      await api.patch(`/users/${id}`, { [field]: value });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  function startEdit(u) {
    setEditingId(u.id);
    setEditForm({ fullName: u.fullName, email: u.email });
    setError('');
  }

  async function saveEdit(id) {
    setSavingEdit(true);
    setError('');
    try {
      await api.patch(`/users/${id}`, editForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSavingEdit(false);
    }
  }

  function askDelete(id) {
    setConfirmDeleteId(id);
  }

  function askResetPassword(id) {
    setConfirmResetId(id);
    setResetMessage('');
  }

  async function handleResetPassword() {
    if (!confirmResetId) return;
    setResetting(true);
    setError('');
    try {
      const { data } = await api.post(`/users/${confirmResetId}/reset-password`);
      setResetMessage(data.message);
      setConfirmResetId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la réinitialisation');
      setConfirmResetId(null);
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/users/${confirmDeleteId}`);
      load();
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/users', {
        ...form,
        teamId: form.teamId ? Number(form.teamId) : null,
      });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  }

  const activeCount = users.filter((u) => u.isActive).length;
  const inactiveCount = users.length - activeCount;
  const staffCount = users.filter((u) => u.role !== 'REQUESTER').length;

  const inputClass = 'bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 text-body-sm text-on-surface focus:border-on-surface focus:outline-none';

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex justify-between items-end gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Utilisateurs</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Gestion des comptes et des rôles.</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setError(''); }}
          className="border border-outline-variant rounded-none py-2 px-4 font-label-md text-label-md text-on-surface hover:bg-surface-container-low transition-colors"
        >
          {showForm ? 'Annuler' : '+ Nouvel utilisateur'}
        </button>
      </header>

      {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}
      {resetMessage && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{resetMessage}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-md">
          <span className="font-headline-sm text-headline-sm text-on-surface">Créer un utilisateur</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase">Nom complet</label>
              <input
                required
                className={inputClass}
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase">Email</label>
              <input
                required
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase">Mot de passe</label>
              <input
                required
                type="password"
                minLength={8}
                placeholder="Au moins 8 caractères"
                className={inputClass}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase">Équipe</label>
              <select
                className={inputClass}
                value={form.teamId}
                onChange={(e) => setForm({ ...form, teamId: e.target.value })}
              >
                <option value="">Aucune</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="font-label-md text-label-md text-on-surface-variant uppercase">Rôle / droits</label>
              <div className="flex flex-col gap-2">
                {ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={form.role === r}
                      onChange={() => setForm({ ...form, role: r })}
                      className="accent-on-surface"
                    />
                    <span className="text-body-sm text-on-surface">{ROLE_LABELS[r]}</span>
                  </label>
                ))}
              </div>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-2">
          <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Total utilisateurs</span>
          <span className="font-display-lg text-display-lg text-on-surface">{users.length}</span>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-2">
          <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Admins &amp; Techniciens</span>
          <span className="font-display-lg text-display-lg text-on-surface">{staffCount}</span>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-2">
          <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Comptes inactifs</span>
          <span className="font-display-lg text-display-lg text-on-surface">{inactiveCount}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-surface-container-lowest p-md rounded-none border border-outline-variant">
        <select
          className="px-3 py-1.5 rounded-none border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm focus:outline-none"
          value={assignGroupId}
          onChange={(e) => setAssignGroupId(e.target.value)}
          disabled={selectedIds.length === 0}
        >
          <option value="">Groupe de droits...</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button
          onClick={handleAssignToGroup}
          disabled={!assignGroupId || selectedIds.length === 0 || assigning}
          className="flex items-center gap-2 px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all disabled:opacity-50 whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px]">group_add</span>
          Assigner à un groupe de droits ({selectedIds.length})
        </button>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-none overflow-hidden flex flex-col">
        <div className="p-md border-b border-outline-variant flex justify-between items-center">
          <span className="font-headline-sm text-headline-sm text-on-surface">Annuaire</span>
          <span className="text-on-surface-variant text-xs font-mono-sm">{users.length} utilisateurs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant">
                <th className="p-md w-10">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && selectedIds.length === users.length}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Utilisateur</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Rôle</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Équipe</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-center w-24">Actif</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-center w-32" title="Reçoit un email si un brouillon de réponse IA attend trop longtemps une validation">Alertes brouillons</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm text-on-surface">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-container-low transition-colors group">
                  <td className="p-md">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(u.id)}
                      onChange={() => toggleSelect(u.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="p-md">
                    {editingId === u.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={editForm.fullName}
                          onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                          placeholder="Nom complet"
                          className="border border-outline-variant rounded-none px-2 py-1 text-body-sm text-on-surface bg-surface focus:outline-none focus:border-on-surface"
                        />
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          placeholder="Email"
                          className="border border-outline-variant rounded-none px-2 py-1 text-body-sm text-on-surface bg-surface focus:outline-none focus:border-on-surface"
                        />
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={() => saveEdit(u.id)}
                            disabled={savingEdit}
                            className="text-xs px-2 py-1 border border-outline-variant bg-on-surface text-surface hover:opacity-80 disabled:opacity-50"
                          >
                            {savingEdit ? 'Enregistrement...' : 'Enregistrer'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={savingEdit}
                            className="text-xs px-2 py-1 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(u)} className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
                        <div className="w-8 h-8 rounded-full border border-outline-variant flex items-center justify-center font-headline-sm text-xs font-bold shrink-0 text-on-surface">
                          {initials(u.fullName)}
                        </div>
                        <div>
                          <div className="font-headline-sm text-headline-sm text-on-surface">{u.fullName}</div>
                          <div className="text-on-surface-variant text-xs">{u.email}</div>
                        </div>
                      </button>
                    )}
                  </td>
                  <td className="p-md">
                    <select
                      className="appearance-none bg-transparent border border-outline-variant rounded-none py-1.5 px-2 text-body-sm cursor-pointer"
                      value={u.role}
                      onChange={(e) => updateField(u.id, 'role', e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-md">
                    <select
                      className="appearance-none bg-transparent border border-outline-variant rounded-none py-1.5 px-2 text-body-sm cursor-pointer"
                      value={u.teamId || ''}
                      onChange={(e) => updateField(u.id, 'teamId', e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">Aucune</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-md text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 border-outline-variant cursor-pointer"
                      checked={u.isActive}
                      onChange={(e) => updateField(u.id, 'isActive', e.target.checked)}
                    />
                  </td>
                  <td className="p-md text-center">
                    {u.role !== 'REQUESTER' && (
                      <input
                        type="checkbox"
                        className="w-4 h-4 border-outline-variant cursor-pointer"
                        checked={u.receiveDraftAlerts}
                        onChange={(e) => updateField(u.id, 'receiveDraftAlerts', e.target.checked)}
                      />
                    )}
                  </td>
                  <td className="p-md text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => askResetPassword(u.id)}
                        title="Réinitialiser le mot de passe"
                        className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
                      >
                        <span className="material-symbols-outlined text-[18px]">lock_reset</span>
                      </button>
                      <button onClick={() => askDelete(u.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-md text-center text-on-surface-variant">Aucun utilisateur.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Supprimer l'utilisateur"
        message="Supprimer définitivement cet utilisateur ? Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        open={!!confirmResetId}
        title="Réinitialiser le mot de passe"
        message="Un nouveau mot de passe temporaire sera généré et envoyé par email à cet utilisateur. Il devra le changer dès sa prochaine connexion."
        confirmLabel="Réinitialiser"
        loading={resetting}
        onConfirm={handleResetPassword}
        onCancel={() => setConfirmResetId(null)}
      />
    </div>
  );
}
