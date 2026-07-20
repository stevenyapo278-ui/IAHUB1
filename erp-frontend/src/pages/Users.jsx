import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';

const ROLE_LABELS = {
  SUPERADMIN: 'Super-administrateur — accès total, y compris la configuration serveur',
  ADMIN: 'Administrateur — accès complet',
  TECHNICIAN: 'Technicien — gère et traite les tickets',
  REQUESTER: 'Demandeur — peut créer des tickets',
};

const ADMIN_LIKE_ROLES = ['SUPERADMIN', 'ADMIN'];

function assignableRoles(actorRole) {
  if (actorRole === 'SUPERADMIN') return ['SUPERADMIN', 'ADMIN', 'TECHNICIAN', 'REQUESTER'];
  if (actorRole === 'ADMIN') return ['TECHNICIAN', 'REQUESTER'];
  return [];
}

const emptyForm = { email: '', fullName: '', password: '', role: 'REQUESTER', teamId: '' };

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

export default function Users() {
  const { user: currentUser } = useAuth();
  const ROLES = assignableRoles(currentUser?.role);
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
  const [showGlpiImport, setShowGlpiImport] = useState(false);
  const [importableUsers, setImportableUsers] = useState([]);
  const [selectedImportIds, setSelectedImportIds] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const inputClass = 'bg-surface border border-outline-variant/60 rounded-xl py-2 px-3.5 text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

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
    setAssigning(true); setError('');
    try {
      await api.post(`/permission-groups/${assignGroupId}/assign`, { userIds: selectedIds });
      toast.success(`${selectedIds.length} utilisateur(s) assigné(s) au groupe`);
      setAssignGroupId(''); setSelectedIds([]); load();
    } catch (err) { setError(err.response?.data?.error || "Erreur lors de l'assignation"); }
    finally { setAssigning(false); }
  }

  async function updateField(id, field, value) {
    try { await api.patch(`/users/${id}`, { [field]: value }); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur lors de la mise à jour'); }
  }

  function startEdit(u) {
    setEditingId(u.id); setEditForm({ fullName: u.fullName, email: u.email }); setError('');
  }
  async function saveEdit(id) {
    setSavingEdit(true); setError('');
    try { await api.patch(`/users/${id}`, editForm); toast.success('Utilisateur mis à jour'); setEditingId(null); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur lors de la mise à jour'); }
    finally { setSavingEdit(false); }
  }

  function askDelete(id) { setConfirmDeleteId(id); }
  function askResetPassword(id) { setConfirmResetId(id); setResetMessage(''); }

  async function handleResetPassword() {
    if (!confirmResetId) return; setResetting(true); setError('');
    try {
      const { data } = await api.post(`/users/${confirmResetId}/reset-password`);
      setResetMessage(data.message); setConfirmResetId(null);
    } catch (err) { setError(err.response?.data?.error || 'Erreur'); setConfirmResetId(null); }
    finally { setResetting(false); }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return; setDeleting(true);
    try { await api.delete(`/users/${confirmDeleteId}`); toast.success('Utilisateur supprimé'); load(); setConfirmDeleteId(null); }
    catch (err) { setError(err.response?.data?.error || 'Erreur'); }
    finally { setDeleting(false); }
  }

  async function handleCreate(e) {
    e.preventDefault(); setError(''); setSubmitting(true);
    try {
      await api.post('/users', { ...form, teamId: form.teamId ? Number(form.teamId) : null });
      toast.success('Utilisateur créé');
      setForm(emptyForm); setShowForm(false); load();
    } catch (err) { setError(err.response?.data?.error || 'Erreur lors de la création'); }
    finally { setSubmitting(false); }
  }

  const activeCount = users.filter((u) => u.isActive).length;
  const inactiveCount = users.length - activeCount;
  const staffCount = users.filter((u) => u.role !== 'REQUESTER').length;

  return (
    <motion.div className="p-lg space-y-lg" variants={containerVariants} initial="hidden" animate="visible">
      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <motion.header variants={itemVariants} className="flex justify-between items-end gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Utilisateurs</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Gestion des comptes et des rôles.</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={async () => {
              setError(''); setImportResult(null);
              try {
                const { data } = await api.get('/glpi/importable-users');
                setImportableUsers(data);
                setSelectedImportIds([]);
                setShowGlpiImport(true);
              } catch (err) {
                setError(err.response?.data?.error || 'Erreur de récupération des utilisateurs GLPI');
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant text-on-surface hover:bg-surface-container-low font-semibold text-body-sm transition-all duration-300 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">cloud_download</span>
            Importer de GLPI
          </motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => { setShowForm((v) => !v); setError(''); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold text-body-sm transition-all duration-300 whitespace-nowrap ${
              showForm
                ? 'border border-outline-variant text-on-surface hover:bg-surface-container-low'
                : 'btn-gradient shadow-md shadow-primary/10 dark:shadow-white/10 hover:shadow-lg'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{showForm ? 'close' : 'person_add'}</span>
            {showForm ? 'Fermer' : 'Nouvel utilisateur'}
          </motion.button>
        </div>
      </motion.header>

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -8, height: 0 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md"
          >{error}</motion.div>
        )}
        {resetMessage && (
          <motion.div initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -8, height: 0 }}
            className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-md rounded-xl font-body-md"
          >{resetMessage}</motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FORMULAIRE DE CRÉATION */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showForm && (
          <motion.form initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} onSubmit={handleCreate} className="bento-card flex flex-col"
          >
            <div className="bento-card-header">
              <h3 className="font-headline-md text-headline-md text-on-background flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]" aria-hidden="true">person_add</span>
                Créer un utilisateur
              </h3>
            </div>
            <div className="bento-card-body">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                <Field label="Nom complet" required>
                  <input required className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                </Field>
                <Field label="Email" required>
                  <input required type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label="Mot de passe" required>
                  <input required type="password" minLength={8} placeholder="Au moins 8 caractères" className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
                <Field label="Équipe">
                  <select className={inputClass} value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                    <option value="">Aucune</option>
                    {teams.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                  </select>
                </Field>
                <Field label="Rôle / droits" className="md:col-span-2">
                  <div className="flex flex-col gap-2 bg-surface-container-low/40 border border-outline-variant/60 rounded-xl p-md">
                    {ROLES.map((r) => (
                      <label key={r} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="role" value={r} checked={form.role === r} onChange={() => setForm({ ...form, role: r })} className="accent-primary w-4 h-4" />
                        <span className="text-body-sm text-on-surface font-medium">{ROLE_LABELS[r]}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
              <div className="flex justify-end mt-lg pt-4 border-t border-outline-variant/50">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  type="submit" disabled={submitting}
                  className="btn-gradient font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all disabled:opacity-50 text-body-sm"
                >{submitting ? 'Création…' : 'Créer'}</motion.button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* STATISTIQUES — Bento grid */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
        <StatCard label="Total utilisateurs" value={users.length} icon="people" />
        <StatCard label="Admins & Techniciens" value={staffCount} icon="admin_panel_settings" />
        <StatCard label="Comptes inactifs" value={inactiveCount} icon="person_off" critical={inactiveCount > 0} />
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* BARRE D'ASSIGNATION DE GROUPE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="bento-card">
        <div className="flex flex-wrap items-center gap-3 p-lg">
          <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider shrink-0">Assignation groupe</span>
          <select
            className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            value={assignGroupId} onChange={(e) => setAssignGroupId(e.target.value)} disabled={selectedIds.length === 0}
          >
            <option value="">Groupe de droits...</option>
            {groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
          </select>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleAssignToGroup} disabled={!assignGroupId || selectedIds.length === 0 || assigning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant/60 bg-surface hover:bg-surface-container-high transition-colors font-semibold text-body-sm disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">group_add</span>
            Assigner ({selectedIds.length})
          </motion.button>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* TABLEAU DES UTILISATEURS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="bento-card">
        <div className="bento-card-header">
          <span className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">badge</span>
            Annuaire
          </span>
          <span className="text-on-surface-variant text-xs font-mono-sm bg-surface-container border border-outline-variant/50 px-2.5 py-0.5 rounded-full font-medium">
            {users.length} utilisateur{users.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr              className="bg-surface-bright/50 dark:bg-[rgba(255,255,255,0.03)] border-b border-outline-variant/60">
                <TH checkbox>
                  <input type="checkbox" checked={users.length > 0 && selectedIds.length === users.length}
                    onChange={toggleSelectAll} className="cursor-pointer accent-primary w-4 h-4" />
                </TH>
                <TH>Utilisateur</TH>
                <TH>Rôle</TH>
                <TH>Équipe</TH>
                <TH className="text-center">GLPI</TH>
                <TH className="text-center">Actif</TH>
                <TH className="text-center">Alertes</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              <AnimatePresence mode="popLayout">
                {users.map((u, idx) => (
                  <motion.tr key={u.id} layout
                    initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25, delay: idx * 0.015, ease: [0.16, 1, 0.3, 1] }}
                    className="hover:bg-surface-container-low/60 transition-colors group"
                  >
                    <td className="p-md"><input type="checkbox" checked={selectedIds.includes(u.id)}
                      onChange={() => toggleSelect(u.id)} className="cursor-pointer accent-primary w-4 h-4" /></td>
                    <td className="p-md">
                      {editingId === u.id ? (
                        <div className="flex flex-col gap-2 max-w-xs">
                          <input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                            placeholder="Nom" className="border border-outline-variant/60 rounded-xl px-3 py-1.5 text-body-sm text-on-surface bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                          <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            placeholder="Email" className="border border-outline-variant/60 rounded-xl px-3 py-1.5 text-body-sm text-on-surface bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                          <div className="flex gap-2 mt-1">
                            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                              onClick={() => saveEdit(u.id)} disabled={savingEdit}
                              className="text-xs px-2.5 py-1.5 rounded-lg btn-gradient font-semibold shadow-sm hover:shadow transition-all disabled:opacity-50"
                            >{savingEdit ? '...' : 'Enregistrer'}</motion.button>
                            <button onClick={() => setEditingId(null)} disabled={savingEdit}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-outline-variant/60 text-on-surface hover:bg-surface-container-high transition-all"
                            >Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <motion.button whileHover={{ x: 2 }} onClick={() => startEdit(u)}
                          className="flex items-center gap-3 text-left"
                        >
                          <div className="w-8 h-8 rounded-full border border-outline-variant/60 bg-surface-container-low text-on-surface flex items-center justify-center font-semibold shrink-0 shadow-sm text-[12px]">
                            {initials(u.fullName)}
                          </div>
                          <div>
                            <div className="font-headline-sm text-headline-sm text-on-surface font-medium">{u.fullName}</div>
                            <div className="text-on-surface-variant text-xs">{u.email}</div>
                          </div>
                        </motion.button>
                      )}
                    </td>
                    <td className="p-md">
                      {(currentUser?.role === 'SUPERADMIN' || !ADMIN_LIKE_ROLES.includes(u.role)) ? (
                        <select value={u.role} onChange={(e) => updateField(u.id, 'role', e.target.value)}
                          className="bg-surface border border-outline-variant/60 rounded-xl px-2.5 py-1.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                        >{Array.from(new Set([...ROLES, u.role])).map((r) => (<option key={r} value={r}>{r}</option>))}</select>
                      ) : (
                        <span className="text-on-surface-variant font-medium" title="Seul un super-administrateur peut modifier">{u.role}</span>
                      )}
                    </td>
                    <td className="p-md">
                      <select value={u.teamId || ''} onChange={(e) => updateField(u.id, 'teamId', e.target.value ? Number(e.target.value) : null)}
                        className="bg-surface border border-outline-variant/60 rounded-xl px-2.5 py-1.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                      ><option value="">Aucune</option>
                        {teams.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                      </select>
                    </td>
                    <td className="p-md text-center">
                      {u.glpiId ? (
                        <span title={`ID GLPI: ${u.glpiId}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-outline-variant bg-surface-container-low text-on-surface-variant font-medium text-[10px]"
                        >
                          <span className="material-symbols-outlined text-[12px]">sync</span>
                          #{u.glpiId}
                        </span>
                      ) : (
                        <span className="text-outline/60 italic text-[11px]">Non lié</span>
                      )}
                    </td>
                    <td className="p-md text-center">
                      <input type="checkbox" checked={u.isActive} onChange={(e) => updateField(u.id, 'isActive', e.target.checked)}
                        className="w-4 h-4 accent-primary cursor-pointer" />
                    </td>
                    <td className="p-md text-center">
                      {u.role !== 'REQUESTER' && (
                        <input type="checkbox" checked={u.receiveDraftAlerts} onChange={(e) => updateField(u.id, 'receiveDraftAlerts', e.target.checked)}
                          className="w-4 h-4 accent-primary cursor-pointer" />
                      )}
                    </td>
                    <td className="p-md text-right">
                      {(currentUser?.role === 'SUPERADMIN' || !ADMIN_LIKE_ROLES.includes(u.role)) && (
                        <div className="flex items-center justify-end gap-1">
                          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                            onClick={() => askResetPassword(u.id)} title="Réinitialiser le mot de passe"
                            className="text-on-surface-variant hover:text-primary transition-colors p-1"
                          ><span className="material-symbols-outlined text-[18px]" aria-hidden="true">lock_reset</span></motion.button>
                          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                            onClick={() => askDelete(u.id)} title="Supprimer"
                            className="text-on-surface-variant hover:text-error transition-colors p-1 opacity-60 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100"
                          ><span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span></motion.button>
                        </div>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
              {users.length === 0 && (
                <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <td colSpan={8} className="p-md py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-on-surface-variant">
                      <span className="material-symbols-outlined text-[40px] text-outline/40" aria-hidden="true">people</span>
                      <p className="font-body-md text-body-md italic">Aucun utilisateur trouvé.</p>
                    </div>
                  </td>
                </motion.tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL D'IMPORT GLPI */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showGlpiImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!importing) setShowGlpiImport(false); }}
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px] cursor-pointer"
            />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
              className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            >
              <div className="sticky top-0 z-10 bg-surface-container-lowest rounded-t-2xl border-b border-outline-variant/40">
                <div className="bento-card-header">
                  <h3 className="font-headline-md text-headline-md text-on-background flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">cloud_download</span>
                    Importer depuis GLPI
                  </h3>
                  <button onClick={() => { if (!importing) setShowGlpiImport(false); }}
                    className="text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Fermer"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>

              <div className="p-lg overflow-y-auto flex-1">
                {importResult ? (
                  <div className="space-y-4">
                    <div className={`p-md rounded-xl font-body-sm ${
                      importResult.imported > 0
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                    }`}>
                      {importResult.imported} utilisateur(s) importé(s) avec succès
                    </div>
                    {importResult.errors?.length > 0 && (
                      <div className="bg-red-500/5 text-red-500 border border-red-500/20 rounded-xl p-md font-body-sm">
                        <p className="font-semibold mb-2">Erreurs :</p>
                        <ul className="list-disc pl-md space-y-1">
                          {importResult.errors.map((e, i) => (
                            <li key={i}>GLPI #{e.glpiId} : {e.reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={() => { setShowGlpiImport(false); load(); }}
                        className="px-5 py-2.5 rounded-xl btn-gradient font-semibold text-body-sm"
                      >
                        Terminé
                      </motion.button>
                    </div>
                  </div>
                ) : importableUsers.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-on-surface-variant">
                    <span className="material-symbols-outlined text-[48px] text-outline/40">check_circle</span>
                    <p className="font-body-md text-body-md">Tous les utilisateurs GLPI sont déjà importés.</p>
                  </div>
                ) : (
                  <>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
                      {importableUsers.length} utilisateur(s) GLPI peuvent être importés.
                      Ils recevront un rôle <strong>Technicien</strong> et devront changer leur mot de passe à la première connexion.
                    </p>
                    <div className="flex items-center gap-3 mb-md">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox"
                          checked={selectedImportIds.length === importableUsers.length}
                          onChange={() => {
                            setSelectedImportIds(
                              selectedImportIds.length === importableUsers.length ? [] : importableUsers.map((u) => u.glpiId)
                            );
                          }}
                          className="accent-primary w-4 h-4"
                        />
                        <span className="font-body-sm text-body-sm text-on-surface">Tout sélectionner</span>
                      </label>
                      <span className="text-on-surface-variant text-body-sm">{selectedImportIds.length} sélectionné(s)</span>
                    </div>
                    <div className="border border-outline-variant/60 rounded-xl divide-y divide-outline-variant/30 max-h-64 overflow-y-auto">
                      {importableUsers.map((u) => (
                        <label key={u.glpiId}
                          className="flex items-center gap-3 px-md py-2.5 hover:bg-surface-container-low/60 cursor-pointer transition-colors"
                        >
                          <input type="checkbox"
                            checked={selectedImportIds.includes(u.glpiId)}
                            onChange={() => {
                              setSelectedImportIds((ids) =>
                                ids.includes(u.glpiId) ? ids.filter((id) => id !== u.glpiId) : [...ids, u.glpiId]
                              );
                            }}
                            className="accent-primary w-4 h-4"
                          />
                          <div className="w-8 h-8 rounded-full border border-outline-variant/60 bg-surface-container-low text-on-surface flex items-center justify-center font-semibold text-[12px] shrink-0 shadow-sm">
                            {u.fullName ? u.fullName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() : '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-body-sm text-body-sm text-on-surface font-medium truncate">{u.fullName}</div>
                            <div className="text-on-surface-variant text-xs truncate">{u.email}</div>
                          </div>
                          <span className="text-outline/60 text-xs font-mono">#{u.glpiId}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end gap-sm mt-lg pt-4 border-t border-outline-variant/50">
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={() => setShowGlpiImport(false)} disabled={importing}
                        className="px-5 py-2.5 rounded-xl border border-outline-variant text-on-surface font-semibold text-body-sm hover:bg-surface-container-low transition-colors"
                      >
                        Annuler
                      </motion.button>
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={async () => {
                          if (selectedImportIds.length === 0) return;
                          setImporting(true); setError('');
                          try {
                            const { data } = await api.post('/glpi/import-users', { userIds: selectedImportIds });
                            setImportResult(data);
                          } catch (err) {
                            setError(err.response?.data?.error || "Erreur d'import");
                            setShowGlpiImport(false);
                          } finally {
                            setImporting(false);
                          }
                        }}
                        disabled={selectedImportIds.length === 0 || importing}
                        className="px-5 py-2.5 rounded-xl btn-gradient font-semibold text-body-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {importing && <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>}
                        {importing ? 'Import...' : `Importer (${selectedImportIds.length})`}
                      </motion.button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog open={!!confirmDeleteId} title="Supprimer l'utilisateur"
        message="Supprimer définitivement cet utilisateur ? Cette action est irréversible."
        confirmLabel="Supprimer" danger loading={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />
      <ConfirmDialog open={!!confirmResetId} title="Réinitialiser le mot de passe"
        message="Un nouveau mot de passe temporaire sera généré et envoyé par email."
        confirmLabel="Réinitialiser" loading={resetting} onConfirm={handleResetPassword} onCancel={() => setConfirmResetId(null)} />
    </motion.div>
  );
}

/* ── Sous-composants ────────────────────────────────────────────────────────── */

function TH({ children, className, checkbox }) {
  return (
    <th className={`p-md font-label-md text-label-md text-on-surface-variant uppercase tracking-wider whitespace-nowrap ${checkbox ? 'w-10' : ''} ${className || ''}`}>
      {children}
    </th>
  );
}

function Field({ label, required, children, className }) {
  return (
    <div className={`flex flex-col gap-1 ${className || ''}`}>
      <label className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
        {label}{required && <span className="text-error ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function StatCard({ label, value, icon, critical }) {
  return (
    <motion.div variants={itemVariants}
      className={`bento-card bento-col-1 flex flex-col p-lg justify-between ${critical ? 'stat-card-glow' : ''}`}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
    >
      <div className="flex justify-between items-start mb-md">
        <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">{label}</p>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          critical ? 'bg-gradient-to-br from-red-500/10 to-orange-500/10 text-red-500 border border-red-500/20' : 'bg-primary/5 text-primary border border-primary/10'
        }`}>
          <span className="material-symbols-outlined text-sm">{icon}</span>
        </div>
      </div>
      <h3 className="font-display-lg text-display-lg text-on-background font-bold">{value}</h3>
    </motion.div>
  );
}
