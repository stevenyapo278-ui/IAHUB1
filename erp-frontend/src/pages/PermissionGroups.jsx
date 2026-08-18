import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import Skeleton from '../components/Skeleton';
import { PERMISSION_DEFINITIONS } from '../config/permissions';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Shield, Users, Plus, Trash2, X, Search,
  Lock, Check, AlertTriangle, Headphones
} from 'lucide-react';

const emptyForm = { name: '', description: '', permissions: [] };

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function PermissionGroups() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const canManageGroups = user?.role === 'SUPERADMIN';

  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [search, setSearch] = useState('');

  function load() {
    Promise.all([api.get('/permission-groups'), api.get('/users')])
      .then(([groupsRes, usersRes]) => {
        setGroups(groupsRes.data);
        setUsers(Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data.users || []));
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
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
      toast.success(`Groupe « ${form.name} » créé avec succès`);
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
  }

  async function saveGroupDetail(group) {
    setSavingDetail(true);
    setError('');
    try {
      await api.patch(`/permission-groups/${group.id}`, { name: detailForm.name, description: detailForm.description });
      toast.success('Informations du groupe enregistrées');
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
      toast.success('Groupe supprimé');
      load();
      setConfirmDeleteId(null);
      if (openGroupId === confirmDeleteId) setOpenGroupId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  const openGroup = groups.find((g) => g.id === openGroupId);
  const filteredUsers = users.filter((u) =>
    `${u.fullName} ${u.email}`.toLowerCase().includes(memberSearch.toLowerCase())
  );
  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.description && g.description.toLowerCase().includes(search.toLowerCase()))
  );

  const totalMembers = groups.reduce((acc, g) => acc + (g._count?.members ?? g.members?.length ?? 0), 0);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-purple-500/10 rounded-lg">
            <Shield className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Groupes de droits</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">
              {groups.length} groupe{groups.length !== 1 ? 's' : ''} · {totalMembers} affectation{totalMembers !== 1 ? 's' : ''}
              {!canManageGroups && ' (Lecture seule)'}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs hidden sm:block">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            type="text"
            placeholder="Rechercher un groupe..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface border border-outline-variant/60 rounded-xl pl-8 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Actions */}
        {canManageGroups && (
          <div className="flex items-center gap-2 ml-auto">
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => { setShowForm(v => !v); setError(''); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-purple-500/20"
            >
              {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{showForm ? 'Fermer' : 'Nouveau groupe'}</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Create Form Panel ───────────────────────────────────────────── */}
      <AnimatePresence>
        {canManageGroups && showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-b border-outline-variant/20 bg-surface-container-low/40 shrink-0"
          >
            <form onSubmit={handleCreate} className="px-4 sm:px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom du groupe *</span>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="ex: Support Niveau 2"
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Description</span>
                  <input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Accès étendu aux tickets réseau et sécurité"
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </label>
              </div>

              <div>
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">Permissions incluses</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 bg-surface-container/40 border border-outline-variant/30 rounded-xl p-3 max-h-36 overflow-y-auto">
                  {PERMISSION_DEFINITIONS.map((p) => {
                    const isChecked = form.permissions.includes(p.key);
                    return (
                      <label key={p.key} className="flex items-center gap-2 cursor-pointer text-xs select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => togglePermission(p.key)}
                          className="w-3.5 h-3.5 cursor-pointer accent-purple-600 rounded"
                        />
                        <span className={`font-medium ${isChecked ? 'text-purple-700 dark:text-purple-300 font-bold' : 'text-on-surface-variant'}`}>{p.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-outline-variant/40 text-on-surface-variant text-xs font-semibold hover:bg-surface-container"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-purple-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Création…' : 'Créer le groupe'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Split View ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Groups list */}
        <div className={`flex flex-col border-r border-outline-variant/30 bg-surface-container-lowest overflow-hidden transition-all duration-300 ${
          openGroup ? 'w-80 xl:w-96 shrink-0' : 'flex-1'
        }`}>
          {/* List Header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/20 bg-surface-container-low/40">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              {filteredGroups.length} groupe{filteredGroups.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="rounded-xl border border-outline-variant/30 bg-surface p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton variant="text-sm" className="w-1/2" />
                      <Skeleton variant="badge" />
                    </div>
                    <Skeleton variant="text" />
                    <div className="flex gap-2">
                      <Skeleton variant="avatar-sm" className="w-6 h-6 rounded-full" />
                      <Skeleton variant="avatar-sm" className="w-6 h-6 rounded-full" />
                      <Skeleton variant="avatar-sm" className="w-6 h-6 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant py-16">
                <div className="p-4 rounded-full bg-surface-container">
                  <Shield className="w-8 h-8 text-outline/30" />
                </div>
                <p className="text-sm italic">Aucun groupe trouvé.</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {filteredGroups.map((g, idx) => {
                  const isSelected = openGroupId === g.id;
                  const memberCount = g._count?.members ?? g.members?.length ?? 0;
                  const permCount = g.permissions.length;
                  const isHotline = g.name.toLowerCase().includes('hotline');

                  return (
                    <motion.button
                      key={g.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.15, delay: idx * 0.01 }}
                      onClick={() => openGroupDetail(g)}
                      className={`w-full text-left flex items-stretch border-b border-outline-variant/10 transition-all group ${
                        isSelected
                          ? 'bg-purple-500/10 ring-1 ring-inset ring-purple-500/30'
                          : 'hover:bg-surface-container-low/60'
                      }`}
                    >
                      {/* Priority / Color stripe */}
                      <div className={`w-1 shrink-0 ${isHotline ? 'bg-amber-500' : 'bg-purple-600 dark:bg-purple-400'}`} />

                      <div className="flex items-start gap-3 px-4 py-3.5 flex-1 min-w-0">
                        {/* Group Icon */}
                        <div className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center mt-0.5 border ${
                          isHotline
                            ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400'
                            : 'bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400'
                        }`}>
                          {isHotline ? <Headphones className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className="flex items-center gap-2 truncate">
                              <p className={`text-xs font-bold truncate ${isSelected ? 'text-purple-600 dark:text-purple-400' : 'text-on-surface group-hover:text-primary transition-colors'}`}>
                                {g.name}
                              </p>
                              {isHotline && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[9px] font-extrabold uppercase border border-amber-500/30 shrink-0">
                                  Système Hotline
                                </span>
                              )}
                            </div>
                            {canManageGroups && (
                              <button
                                onClick={(e) => { e.stopPropagation(); askDelete(g.id); }}
                                className="p-1 text-on-surface-variant/40 hover:text-red-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                title="Supprimer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] text-on-surface-variant truncate">{g.description || 'Aucune description'}</p>

                          <div className="flex items-center gap-2 mt-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/30 text-[10px] font-bold text-on-surface-variant">
                              <Lock className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                              {permCount} droit{permCount !== 1 ? 's' : ''}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/30 text-[10px] font-bold text-on-surface-variant">
                              <Users className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400" />
                              {memberCount} membre{memberCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* Right: Group Detail Panel */}
        <AnimatePresence mode="wait">
          {openGroup ? (
            <motion.div
              key={openGroup.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-container-lowest"
            >
              {/* Header */}
              <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-outline-variant/20">
                <motion.button
                  onClick={() => setOpenGroupId(null)}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                >
                  <X className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-on-surface truncate">{openGroup.name}</h2>
                  <p className="text-[11px] text-on-surface-variant truncate font-medium">{openGroup.description || 'Groupe de permissions'}</p>
                </div>
                {canManageGroups && (
                  <motion.button
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={() => saveGroupDetail(openGroup)}
                    disabled={savingDetail || (detailForm.name === openGroup.name && detailForm.description === (openGroup.description || ''))}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-purple-500/20 disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {savingDetail ? 'Enregistrement...' : 'Enregistrer'}
                  </motion.button>
                )}
              </div>

              {/* Scrollable details */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* General Settings */}
                {canManageGroups && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Informations du groupe</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom</span>
                        <input
                          value={detailForm.name}
                          onChange={(e) => setDetailForm({ ...detailForm, name: e.target.value })}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Description</span>
                        <input
                          value={detailForm.description}
                          onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* Permissions Matrix */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                      Permissions Accordées ({openGroup.permissions.length}/{PERMISSION_DEFINITIONS.length})
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-2xl border border-outline-variant/30 p-4 bg-surface-container-low/30">
                    {PERMISSION_DEFINITIONS.map((p) => {
                      const isGranted = openGroup.permissions.includes(p.key);
                      return (
                        <label
                          key={p.key}
                          className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all ${
                            canManageGroups ? 'cursor-pointer' : 'cursor-default'
                          } ${
                            isGranted
                              ? 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300'
                              : 'bg-transparent border-outline-variant/20 text-on-surface-variant'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!canManageGroups}
                            checked={isGranted}
                            onChange={() => toggleGroupPermission(openGroup, p.key)}
                            className="w-3.5 h-3.5 accent-purple-600 rounded cursor-pointer"
                          />
                          <span className={`text-xs font-medium ${isGranted ? 'font-bold text-on-surface' : ''}`}>{p.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Members List */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                      Membres Affectés ({openGroup.members?.length || 0})
                    </h3>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                    <input
                      type="text"
                      placeholder="Rechercher un utilisateur pour l'ajouter / le retirer..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl pl-9 pr-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                  </div>

                  <div className="rounded-2xl border border-outline-variant/30 divide-y divide-outline-variant/15 overflow-hidden max-h-72 overflow-y-auto bg-surface-container-lowest">
                    {filteredUsers.map((u) => {
                      const isMember = openGroup.members?.some((m) => m.id === u.id);
                      return (
                        <label
                          key={u.id}
                          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                            isMember ? 'bg-purple-500/5' : 'hover:bg-surface-container-low/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!!isMember}
                            onChange={() => toggleMember(openGroup, u.id, isMember)}
                            className="w-3.5 h-3.5 accent-purple-600 rounded cursor-pointer"
                          />
                          <div className="w-7 h-7 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                            {initials(u.fullName)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-on-surface truncate">{u.fullName}</p>
                            <p className="text-[10px] text-on-surface-variant font-mono truncate">{u.email}</p>
                          </div>
                          {isMember && (
                            <span className="text-[10px] font-bold text-purple-700 dark:text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                              Membre
                            </span>
                          )}
                        </label>
                      );
                    })}
                    {filteredUsers.length === 0 && (
                      <div className="p-6 text-center text-xs text-on-surface-variant italic">
                        Aucun utilisateur trouvé.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-4 text-on-surface-variant bg-surface-container-lowest"
            >
              <div className="p-6 rounded-full bg-surface-container">
                <Shield className="w-10 h-10 text-outline/30" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Sélectionnez un groupe de droits</p>
                <p className="text-xs text-on-surface-variant/60 mt-1">pour consulter ou modifier ses permissions et membres</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Confirm Delete Dialog ────────────────────────────────────────── */}
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
