import { useEffect, useState } from 'react';
import api from '../api/client';

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
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    Promise.all([api.get('/users'), api.get('/teams')])
      .then(([usersRes, teamsRes]) => {
        setUsers(usersRes.data);
        setTeams(teamsRes.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  async function updateField(id, field, value) {
    try {
      await api.patch(`/users/${id}`, { [field]: value });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      await api.delete(`/users/${id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
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

      <div className="bg-surface-container-lowest border border-outline-variant rounded-none overflow-hidden flex flex-col">
        <div className="p-md border-b border-outline-variant flex justify-between items-center">
          <span className="font-headline-sm text-headline-sm text-on-surface">Annuaire</span>
          <span className="text-on-surface-variant text-xs font-mono-sm">{users.length} utilisateurs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant">
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Utilisateur</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Rôle</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase">Équipe</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-center w-24">Actif</th>
                <th className="p-md font-label-md text-label-md text-on-surface-variant uppercase text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm text-on-surface">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-container-low transition-colors group">
                  <td className="p-md">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full border border-outline-variant flex items-center justify-center font-headline-sm text-xs font-bold shrink-0 text-on-surface">
                        {initials(u.fullName)}
                      </div>
                      <div>
                        <div className="font-headline-sm text-headline-sm text-on-surface">{u.fullName}</div>
                        <div className="text-on-surface-variant text-xs">{u.email}</div>
                      </div>
                    </div>
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
                  <td className="p-md text-right">
                    <button onClick={() => handleDelete(u.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-md text-center text-on-surface-variant">Aucun utilisateur.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
