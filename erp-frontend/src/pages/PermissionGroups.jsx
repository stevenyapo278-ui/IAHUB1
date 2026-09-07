import { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import useSWR from 'swr';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import UserAvatar from '../components/UserAvatar';
import Skeleton from '../components/Skeleton';
import { PERMISSION_DEFINITIONS } from '../config/permissions';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { createPortal } from 'react-dom';
import {
  Shield, Users, Plus, Trash2, X, Search,
  Lock, Check, AlertTriangle, Headphones, ArrowRightLeft,
  HelpCircle, RefreshCcw, UserX, Layers, GripVertical,
  ChevronRight, Settings, Sparkles, FolderOpen, UserCog
} from 'lucide-react';

const fetcher = (url) => api.get(url).then((r) => r.data);
const emptyForm = { name: '', description: '', permissions: [] };

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

// ── Permission categories for visual grouping ──────────────────────────────
const PERM_CATEGORIES = [
  { key: 'tickets', label: 'Tickets', icon: FolderOpen, color: 'blue', prefix: 'tickets.' },
  { key: 'problems', label: 'Problèmes', icon: AlertTriangle, color: 'amber', prefix: 'problems.' },
  { key: 'users', label: 'Utilisateurs', icon: Users, color: 'cyan', prefix: 'users.' },
  { key: 'teams', label: 'Équipes', icon: UserCog, color: 'teal', prefix: 'teams.' },
  { key: 'settings', label: 'Paramètres', icon: Settings, color: 'purple', prefix: 'settings.' },
  { key: 'ai', label: 'Intelligence IA', icon: Sparkles, color: 'violet', prefix: '' },
  { key: 'other', label: 'Autres', icon: Layers, color: 'slate', prefix: '' },
];

const CAT_COLORS = {
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-600 dark:text-blue-400', ring: 'ring-blue-500/30' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-500/30' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-600 dark:text-cyan-400', ring: 'ring-cyan-500/30' },
  teal: { bg: 'bg-teal-500/10', border: 'border-teal-500/20', text: 'text-teal-600 dark:text-teal-400', ring: 'ring-teal-500/30' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', text: 'text-purple-600 dark:text-purple-400', ring: 'ring-purple-500/30' },
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-600 dark:text-violet-400', ring: 'ring-violet-500/30' },
  slate: { bg: 'bg-slate-500/10', border: 'border-slate-500/20', text: 'text-slate-600 dark:text-slate-400', ring: 'ring-slate-500/30' },
};

function categorizePerm(key) {
  for (const cat of PERM_CATEGORIES) {
    if (cat.prefix && key.startsWith(cat.prefix)) return cat;
    if (cat.key === 'ai' && (key.startsWith('ai') || key.startsWith('email') || key === 'prompts.manage' || key === 'emaildrafts.manage' || key === 'aiweeklyreports.manage')) return cat;
    if (cat.key === 'other' && (key.startsWith('automation') || key.startsWith('knowledge') || key.startsWith('locations') || key.startsWith('assets') || key.startsWith('inbox'))) return cat;
  }
  return PERM_CATEGORIES[PERM_CATEGORIES.length - 1];
}

// ── Role / Group constants ─────────────────────────────────────────────────
const ROLE_STYLES = {
  SUPERADMIN: { label: 'Super admin', cls: 'bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300' },
  ADMIN: { label: 'Admin', cls: 'bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300' },
  HOTLINE: { label: 'Hotline', cls: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300' },
  TECHNICIAN: { label: 'Technicien', cls: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300' },
  REQUESTER: { label: 'Demandeur', cls: 'bg-outline/10 border-outline/30 text-on-surface-variant' },
};

const GROUP_ROLE_KEY = { 'Administrateurs': 'ADMIN', 'Équipe Hotline': 'HOTLINE', 'Techniciens': 'TECHNICIAN', 'Demandeurs': 'REQUESTER' };
function roleHintFor(groupName) {
  const key = GROUP_ROLE_KEY[groupName];
  return key ? ROLE_STYLES[key]?.label || key : null;
}

const SYSTEM_GROUPS = {
  'administrateurs': { color: 'purple', icon: Shield, label: 'Système Admin' },
  'équipe hotline': { color: 'amber', icon: Headphones, label: 'Système Hotline' },
  'techniciens': { color: 'blue', icon: Layers, label: 'Système Tech' },
  'demandeurs': { color: 'teal', icon: Users, label: 'Système Demandeur' },
};

const GRADIENT_MAP = {
  purple: 'from-purple-500 to-violet-600',
  amber: 'from-amber-400 to-orange-500',
  blue: 'from-blue-500 to-indigo-600',
  teal: 'from-teal-400 to-emerald-500',
};

const ICON_BG_MAP = {
  purple: 'bg-purple-500/15 border-purple-500/30 text-purple-600 dark:text-purple-400',
  amber: 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400',
  blue: 'bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400',
  teal: 'bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400',
};

function RoleBadge({ role }) {
  const style = ROLE_STYLES[role] || { label: role, cls: 'bg-outline/10 border-outline/30 text-on-surface-variant' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-bold shrink-0 ${style.cls}`}>
      {style.label}
    </span>
  );
}

// ── Animated Toggle Switch ─────────────────────────────────────────────────
function PermToggle({ checked, onChange, disabled, color = 'purple' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
        checked
          ? `bg-${color}-500 focus:ring-${color}-500/30`
          : 'bg-outline-variant/40 focus:ring-outline-variant/30'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      style={checked ? { backgroundColor: color === 'purple' ? '#7C3AED' : color === 'blue' ? '#2563EB' : color === 'amber' ? '#F59E0B' : color === 'teal' ? '#14B8A6' : color === 'cyan' ? '#06B6D4' : '#7C3AED' } : {}}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ${
          checked ? 'ml-[18px]' : 'ml-[3px]'
        }`}
      />
    </button>
  );
}

// ── Permission Progress Ring ───────────────────────────────────────────────
function PermProgress({ count, total, size = 36 }) {
  const pct = total > 0 ? count / total : 0;
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={2.5} className="text-outline-variant/20" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={2.5}
          className="text-purple-500"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-on-surface">
        {count}
      </span>
    </div>
  );
}

// ── Avatar Stack ───────────────────────────────────────────────────────────
function AvatarStack({ members, max = 4 }) {
  const shown = members.slice(0, max);
  const rest = members.length - max;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((m, i) => (
        <motion.div
          key={m.id}
          initial={{ scale: 0, x: -10 }}
          animate={{ scale: 1, x: 0 }}
          transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 20 }}
          className="w-6 h-6 rounded-full bg-purple-500/15 border-2 border-surface-container-lowest text-purple-600 dark:text-purple-400 font-bold text-[8px] flex items-center justify-center shrink-0 relative z-[1]"
          style={{ zIndex: max - i }}
          title={m.fullName}
        >
          {initials(m.fullName)}
        </motion.div>
      ))}
      {rest > 0 && (
        <div className="w-6 h-6 rounded-full bg-surface-container border-2 border-surface-container-lowest text-[8px] font-bold text-on-surface-variant flex items-center justify-center shrink-0">
          +{rest}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function PermissionGroups() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const canManageGroups = user?.role === 'SUPERADMIN';

  const { data: groups = [], isLoading, mutate } = useSWR('/permission-groups', fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
  });

  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detailForm, setDetailForm] = useState({ name: '', description: '' });
  const [savingDetail, setSavingDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [togglingMember, setTogglingMember] = useState(null);
  const [moveConfirm, setMoveConfirm] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [gmGroups, setGmGroups] = useState([]);
  const [gmUsers, setGmUsers] = useState([]);
  const [gmLoading, setGmLoading] = useState(false);
  const [gmSearch, setGmSearch] = useState('');
  const [gmDragUser, setGmDragUser] = useState(null);
  const [showMemberSearch, setShowMemberSearch] = useState(false);
  const memberDebounceRef = useRef(null);
  const memberRequestSeq = useRef(0);

  const loading = isLoading;

  // ── Data ──────────────────────────────────────────────────────────────────
  function searchMembers(q) {
    const seq = ++memberRequestSeq.current;
    setMemberLoading(true);
    const params = { limit: 30 };
    if (q.trim()) params.search = q.trim();
    api.get('/users', { params })
      .then(({ data }) => {
        if (seq !== memberRequestSeq.current) return;
        setMemberResults(Array.isArray(data) ? data : (data.users || []));
      })
      .catch(() => { if (seq === memberRequestSeq.current) setMemberResults([]); })
      .finally(() => { if (seq === memberRequestSeq.current) setMemberLoading(false); });
  }

  function handleMemberQueryChange(text) {
    setMemberQuery(text);
    if (memberDebounceRef.current) clearTimeout(memberDebounceRef.current);
    memberDebounceRef.current = setTimeout(() => searchMembers(text), 250);
  }

  const selectGroup = useCallback((group) => {
    setSelectedId(group.id);
    setDetailForm({ name: group.name, description: group.description || '' });
    setMemberQuery('');
    setMemberResults([]);
    setShowMemberSearch(false);
    searchMembers('');
  }, []);

  function togglePermission(key) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/permission-groups', form);
      toast.success(`Groupe « ${form.name} » créé avec succès`);
      setForm(emptyForm);
      setShowForm(false);
      mutate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveGroupDetail(group) {
    setSavingDetail(true);
    setError('');
    try {
      await api.patch(`/permission-groups/${group.id}`, { name: detailForm.name, description: detailForm.description });
      toast.success('Informations du groupe enregistrées');
      mutate();
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
    mutate((prev) => prev.map((g) => g.id === group.id ? { ...g, permissions } : g), { revalidate: false });
    try {
      await api.patch(`/permission-groups/${group.id}`, { permissions });
      mutate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
      mutate();
    }
  }

  async function toggleMember(group, userId, isMember) {
    setTogglingMember(userId);
    try {
      await api.post(`/permission-groups/${group.id}/${isMember ? 'unassign' : 'assign'}`, { userIds: [userId] });
      mutate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour des membres');
      mutate();
    } finally {
      setTogglingMember(null);
    }
  }

  function handleAddCandidate(user) {
    const current = selectedGroup ? groupOfUser[user.id] : null;
    if (current && current.groupId !== selectedGroup?.id) {
      setMoveConfirm({ user, fromGroup: current.groupName });
    } else {
      toggleMember(selectedGroup, user.id, false);
    }
  }

  async function confirmMove() {
    if (!moveConfirm) return;
    const { user } = moveConfirm;
    setMoveConfirm(null);
    setTogglingMember(user.id);
    try {
      await api.post(`/permission-groups/${selectedGroup.id}/assign`, { userIds: [user.id] });
      const hint = roleHintFor(selectedGroup.name);
      const roleChanged = hint && user.role !== GROUP_ROLE_KEY[selectedGroup.name];
      toast.success(`« ${user.fullName} » déplacé vers « ${selectedGroup.name } »${roleChanged ? ` — rôle passé à « ${hint} »` : ''}`);
      mutate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du déplacement');
      mutate();
    } finally {
      setTogglingMember(null);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/permission-groups/${confirmDeleteId}`);
      toast.success('Groupe supprimé');
      mutate();
      setConfirmDeleteId(null);
      if (selectedId === confirmDeleteId) setSelectedId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const selectedGroup = groups.find((g) => g.id === selectedId);

  const filteredGroups = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(term) ||
      (g.description && g.description.toLowerCase().includes(term))
    );
  }, [groups, search]);

  const memberCandidates = useMemo(() => selectedGroup
    ? memberResults.filter((u) => !selectedGroup.members?.some((m) => m.id === u.id))
    : [], [selectedGroup, memberResults]);

  const groupOfUser = useMemo(() => {
    const map = {};
    if (Array.isArray(groups)) {
      for (const g of groups) {
        for (const m of g.members || []) map[m.id] = { groupId: g.id, groupName: g.name };
      }
    }
    return map;
  }, [groups]);

  const totalMembers = useMemo(() =>
    groups.reduce((acc, g) => acc + (g._count?.members ?? g.members?.length ?? 0), 0),
  [groups]);

  // ── Group permissions by category ─────────────────────────────────────────
  const groupedPerms = useMemo(() => {
    if (!selectedGroup) return [];
    const groups = [];
    for (const cat of PERM_CATEGORIES) {
      const perms = PERMISSION_DEFINITIONS.filter((p) => {
        if (cat.prefix) return p.key.startsWith(cat.prefix);
        if (cat.key === 'ai') return p.key.startsWith('ai') || p.key.startsWith('email') || p.key === 'prompts.manage' || p.key === 'emaildrafts.manage' || p.key === 'aiweeklyreports.manage';
        if (cat.key === 'other') return p.key.startsWith('automation') || p.key.startsWith('knowledge') || p.key.startsWith('locations') || p.key.startsWith('assets') || p.key.startsWith('inbox');
        return false;
      });
      if (perms.length > 0) groups.push({ ...cat, perms });
    }
    return groups;
  }, [selectedGroup]);

  // ── Stagger animation variants ────────────────────────────────────────────
  const containerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.04 } },
  };
  const cardVariants = {
    hidden: { opacity: 0, y: 16, scale: 0.97 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 24 } },
  };

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
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

        <div className="relative flex-1 max-w-xs hidden sm:block">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            type="text"
            placeholder="Rechercher un groupe..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface border border-outline-variant/60 rounded-xl pl-8 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container text-xs font-semibold transition-all cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Aide</span>
          </button>
          {canManageGroups && (
            <button onClick={async () => {
                setShowGroupManager(true); setGmLoading(true); setGmSearch('');
                try {
                  const [gRes, uRes] = await Promise.all([api.get('/permission-groups'), api.get('/users?all=true')]);
                  setGmGroups(gRes.data);
                  const list = Array.isArray(uRes.data) ? uRes.data : (uRes.data.users || []);
                  setGmUsers(list.filter(u => u.isActive));
                } catch (err) { toast.error(err.response?.data?.error || 'Erreur chargement'); setShowGroupManager(false); }
                finally { setGmLoading(false); }
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 text-xs font-semibold transition-all cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Membres</span>
            </button>
          )}
          {canManageGroups && (
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => { setShowForm(v => !v); setError(''); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl btn-primary text-xs font-bold shadow-md cursor-pointer"
            >
              {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{showForm ? 'Fermer' : 'Nouveau'}</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Create Form Panel ───────────────────────────────────────────── */}
      <AnimatePresence>
        {canManageGroups && showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="overflow-hidden border-b border-outline-variant/20 bg-surface-container-low/40 shrink-0"
          >
            <form onSubmit={handleCreate} className="px-4 sm:px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom du groupe *</span>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="ex: Support Niveau 2"
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Description</span>
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Accès étendu aux tickets réseau et sécurité"
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
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
                        <input type="checkbox" checked={isChecked} onChange={() => togglePermission(p.key)} className="w-3.5 h-3.5 cursor-pointer accent-purple-600 rounded" />
                        <span className={`font-medium ${isChecked ? 'text-purple-700 dark:text-purple-300 font-bold' : 'text-on-surface-variant'}`}>{p.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-outline-variant/40 text-on-surface-variant text-xs font-semibold hover:bg-surface-container cursor-pointer transition-all"
                >Annuler</button>
                <button type="submit" disabled={submitting}
                  className="px-4 py-1.5 rounded-xl btn-primary text-xs font-bold shadow-md disabled:opacity-50 cursor-pointer transition-all"
                >{submitting ? 'Création…' : 'Créer le groupe'}</button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* ── LEFT: Cards Grid ──────────────────────────────────────────── */}
        <div className={`flex flex-col overflow-hidden transition-all duration-300 ease-out ${
          selectedGroup ? 'w-[380px] xl:w-[420px] shrink-0 border-r border-outline-variant/30' : 'flex-1'
        }`}>
          <div className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-2.5 border-b border-outline-variant/20 bg-surface-container-low/40">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              {filteredGroups.length} groupe{filteredGroups.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="rounded-2xl border border-outline-variant/30 bg-surface p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Skeleton variant="avatar-sm" className="w-10 h-10 rounded-xl" />
                      <div className="flex-1 space-y-1.5"><Skeleton variant="text-sm" className="w-2/3" /><Skeleton variant="text" /></div>
                    </div>
                    <Skeleton variant="text" />
                  </div>
                ))}
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant py-16">
                <div className="p-4 rounded-full bg-surface-container"><Shield className="w-8 h-8 text-outline/30" /></div>
                <p className="text-sm italic">Aucun groupe trouvé.</p>
              </div>
            ) : (
              <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 gap-2.5">
                <LayoutGroup>
                  {filteredGroups.map((g) => {
                    const isSelected = selectedId === g.id;
                    const memberCount = g._count?.members ?? g.members?.length ?? 0;
                    const permCount = g.permissions.length;
                    const sysKey = g.name.toLowerCase();
                    const sysGroup = SYSTEM_GROUPS[sysKey];
                    const isSystem = !!sysGroup;
                    const colorKey = isSystem ? sysGroup.color : 'purple';
                    const IconComp = isSystem ? sysGroup.icon : Lock;
                    const members = g.members || [];

                    return (
                      <motion.button
                        key={g.id}
                        layoutId={`group-card-${g.id}`}
                        variants={cardVariants}
                        onClick={() => selectGroup(g)}
                        className={`w-full text-left rounded-2xl border transition-all duration-200 cursor-pointer group ${
                          isSelected
                            ? 'border-purple-500/40 bg-purple-500/5 shadow-md shadow-purple-500/5 ring-1 ring-purple-500/20'
                            : 'border-outline-variant/25 bg-surface-container-lowest hover:border-outline-variant/50 hover:shadow-sm'
                        }`}
                      >
                        <div className="p-3.5">
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border ${ICON_BG_MAP[colorKey]}`}>
                              <IconComp className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className={`text-xs font-bold truncate ${isSelected ? 'text-purple-600 dark:text-purple-400' : 'text-on-surface group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors'}`}>
                                  {g.name}
                                </p>
                                {isSystem && (
                                  <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase border shrink-0 ${ICON_BG_MAP[colorKey]}`}>
                                    {sysGroup.label}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-on-surface-variant truncate">{g.description || 'Aucune description'}</p>
                            </div>
                            {canManageGroups && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(g.id); }}
                                className="p-1 text-on-surface-variant/30 hover:text-red-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-outline-variant/15">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                <PermProgress count={permCount} total={PERMISSION_DEFINITIONS.length} size={24} />
                                <span className="text-[10px] text-on-surface-variant font-medium">droits</span>
                              </div>
                              {members.length > 0 && (
                                <AvatarStack members={members} max={3} />
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-on-surface-variant/40 group-hover:text-purple-500 transition-colors">
                              <span className="text-[10px] font-medium">{memberCount} membre{memberCount !== 1 ? 's' : ''}</span>
                              <ChevronRight className="w-3 h-3" />
                            </div>
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </LayoutGroup>
              </motion.div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Detail Panel ────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {selectedGroup ? (
            <motion.div
              key={selectedGroup.id}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface-container-lowest"
            >
              {/* Detail Header */}
              <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-outline-variant/20">
                <motion.button
                  onClick={() => setSelectedId(null)}
                  whileHover={{ scale: 1.08, x: -2 }} whileTap={{ scale: 0.92 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-on-surface truncate">{selectedGroup.name}</h2>
                  <p className="text-[11px] text-on-surface-variant truncate font-medium">{selectedGroup.description || 'Groupe de permissions'}</p>
                </div>
                {canManageGroups && (
                  <motion.button
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={() => saveGroupDetail(selectedGroup)}
                    disabled={savingDetail || (detailForm.name === selectedGroup.name && detailForm.description === (selectedGroup.description || ''))}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl btn-primary text-xs font-bold shadow-md disabled:opacity-40 cursor-pointer transition-all"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {savingDetail ? 'Enregistrement...' : 'Enregistrer'}
                  </motion.button>
                )}
              </div>

              {/* Scrollable details */}
              <div className="flex-1 overflow-y-auto">
                {/* Group Info */}
                {canManageGroups && (
                  <div className="px-6 py-4 border-b border-outline-variant/15">
                    <h3 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-3">Informations</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom</span>
                        <input value={detailForm.name} onChange={(e) => setDetailForm({ ...detailForm, name: e.target.value })}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Description</span>
                        <input value={detailForm.description} onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* Permissions Matrix — grouped by category with toggles */}
                <div className="px-6 py-4 border-b border-outline-variant/15">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                      Permissions ({selectedGroup.permissions.length}/{PERMISSION_DEFINITIONS.length})
                    </h3>
                    <PermProgress count={selectedGroup.permissions.length} total={PERMISSION_DEFINITIONS.length} size={28} />
                  </div>
                  <div className="space-y-4">
                    {groupedPerms.map((cat) => {
                      const colors = CAT_COLORS[cat.color] || CAT_COLORS.slate;
                      const grantedCount = cat.perms.filter(p => selectedGroup.permissions.includes(p.key)).length;
                      return (
                        <motion.div
                          key={cat.key}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}
                        >
                          <div className={`flex items-center gap-2 px-3 py-2 ${colors.bg}`}>
                            <cat.icon className={`w-3.5 h-3.5 ${colors.text}`} />
                            <span className={`text-[11px] font-bold ${colors.text}`}>{cat.label}</span>
                            <span className="ml-auto text-[10px] font-semibold text-on-surface-variant">
                              {grantedCount}/{cat.perms.length}
                            </span>
                          </div>
                          <div className="divide-y divide-outline-variant/10">
                            {cat.perms.map((p) => {
                              const isGranted = selectedGroup.permissions.includes(p.key);
                              return (
                                <div key={p.key} className="flex items-center gap-3 px-3 py-2">
                                  <PermToggle
                                    checked={isGranted}
                                    onChange={() => canManageGroups && toggleGroupPermission(selectedGroup, p.key)}
                                    disabled={!canManageGroups}
                                    color={cat.color}
                                  />
                                  <span className={`text-xs flex-1 ${isGranted ? 'font-semibold text-on-surface' : 'text-on-surface-variant'}`}>
                                    {p.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>

                {/* Members Section */}
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                      Membres ({selectedGroup.members?.length || 0})
                    </h3>
                    {canManageGroups && (
                      <button
                        onClick={() => setShowMemberSearch(v => !v)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-all cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        Ajouter
                      </button>
                    )}
                  </div>

                  {/* Info hints */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="text-[10px] text-on-surface-variant/60 flex items-center gap-1">
                      <Lock className="w-2.5 h-2.5" /> Un seul groupe par utilisateur
                    </span>
                    <span className="text-[10px] text-on-surface-variant/60 flex items-center gap-1">
                      <Users className="w-2.5 h-2.5" /> Rôle indépendant (vue Utilisateurs)
                    </span>
                  </div>

                  {/* Current members */}
                  <motion.div layout className="space-y-1.5">
                    <AnimatePresence>
                      {(selectedGroup.members || []).length === 0 ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="p-6 text-center text-xs text-on-surface-variant/50 rounded-xl border border-dashed border-outline-variant/30"
                        >
                          Aucun membre dans ce groupe
                        </motion.div>
                      ) : (
                        (selectedGroup.members || []).map((u, i) => (
                          <motion.div
                            key={u.id}
                            layout
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 12, scale: 0.95 }}
                            transition={{ delay: i * 0.03 }}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-outline-variant/20 bg-surface hover:bg-surface-container-low/50 transition-colors group"
                          >
                            <div className="w-7 h-7 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                              {initials(u.fullName)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-on-surface truncate">{u.fullName}</p>
                              <p className="text-[10px] text-on-surface-variant font-mono truncate">{u.email}</p>
                            </div>
                            <RoleBadge role={u.role} />
                            {canManageGroups && (
                              <button
                                onClick={() => toggleMember(selectedGroup, u.id, true)}
                                disabled={togglingMember === u.id}
                                className="p-1.5 rounded-lg text-on-surface-variant/30 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                  </motion.div>

                  {/* Add member search */}
                  <AnimatePresence>
                    {canManageGroups && showMemberSearch && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                        className="overflow-hidden mt-3"
                      >
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                            <input
                              type="text"
                              placeholder="Rechercher un utilisateur (nom ou email)..."
                              value={memberQuery}
                              onChange={(e) => handleMemberQueryChange(e.target.value)}
                              autoFocus
                              className="w-full bg-surface border border-outline-variant/60 rounded-xl pl-9 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                            />
                            {memberLoading && (
                              <RefreshCcw className="w-3 h-3 text-on-surface-variant/50 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                            )}
                          </div>
                          <div className="rounded-xl border border-outline-variant/30 divide-y divide-outline-variant/15 overflow-hidden max-h-48 overflow-y-auto bg-surface-container-lowest">
                            {memberCandidates.length === 0 ? (
                              <div className="p-4 text-center text-xs text-on-surface-variant italic">
                                {memberLoading ? 'Recherche...' : memberQuery ? 'Aucun utilisateur trouvé.' : 'Tapez un nom pour chercher.'}
                              </div>
                            ) : (
                              memberCandidates.map((u) => {
                                const currentGroup = groupOfUser[u.id];
                                const isMove = currentGroup && currentGroup.groupId !== selectedGroup.id;
                                return (
                                  <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-container-low/50 transition-colors">
                                    <div className="w-7 h-7 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                                      {initials(u.fullName)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-semibold text-on-surface truncate">{u.fullName}</p>
                                      <p className="text-[10px] text-on-surface-variant font-mono truncate">{u.email}</p>
                                      {isMove && (
                                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400 text-[10px] font-bold">
                                          Dans « {currentGroup.groupName} »
                                        </span>
                                      )}
                                    </div>
                                    <RoleBadge role={u.role} />
                                    <button
                                      onClick={() => handleAddCandidate(u)}
                                      disabled={togglingMember === u.id}
                                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold disabled:opacity-40 transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                                        isMove
                                          ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:opacity-90'
                                          : 'bg-purple-600 text-white hover:bg-purple-700'
                                      }`}
                                    >
                                      {isMove ? <ArrowRightLeft className="w-2.5 h-2.5" /> : <Plus className="w-2.5 h-2.5" />}
                                      {isMove ? 'Déplacer' : 'Ajouter'}
                                    </button>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-4 text-on-surface-variant bg-surface-container-lowest"
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                className="p-6 rounded-full bg-surface-container"
              >
                <Shield className="w-10 h-10 text-purple-500/30" />
              </motion.div>
              <div className="text-center">
                <p className="text-sm font-semibold">Sélectionnez un groupe de droits</p>
                <p className="text-xs text-on-surface-variant/60 mt-1">pour consulter ou modifier ses permissions et membres</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!moveConfirm}
        title="Déplacer l'utilisateur"
        message={moveConfirm
          ? `« ${moveConfirm.user.fullName} » est actuellement dans « ${moveConfirm.fromGroup} ». Il quittera ce groupe et sera placé dans « ${selectedGroup?.name} »${roleHintFor(selectedGroup?.name) && moveConfirm.user.role !== GROUP_ROLE_KEY[selectedGroup?.name] ? ` — son rôle sera également mis à jour (${ROLE_STYLES[moveConfirm.user.role]?.label || moveConfirm.user.role} → ${roleHintFor(selectedGroup.name)}).` : '.'}`
          : ''}
        confirmLabel="Déplacer"
        loading={togglingMember === moveConfirm?.user?.id}
        onConfirm={confirmMove}
        onCancel={() => setMoveConfirm(null)}
      />

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

      {/* ── Help Modal ─────────────────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showHelp && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowHelp(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
                  <div className="p-1.5 rounded-lg bg-purple-500/10"><HelpCircle className="w-4 h-4 text-purple-600" /></div>
                  <h3 className="text-sm font-bold text-on-surface">Aide — Groupes de droits</h3>
                  <motion.button onClick={() => setShowHelp(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs text-on-surface">
                  <div>
                    <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><Shield className="w-4 h-4 text-purple-500" /> Qu'est-ce qu'un groupe de droits ?</h4>
                    <p className="text-on-surface-variant leading-relaxed">
                      Un groupe de droits définit <strong>ce qu'un utilisateur peut faire</strong> dans l'application.
                      Chaque utilisateur peut appartenir à <strong>un seul groupe de droits</strong> à la fois.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-blue-500" /> Gérer les membres</h4>
                    <ul className="space-y-1.5 text-on-surface-variant">
                      <li className="flex items-start gap-2"><span className="text-purple-500 mt-0.5">•</span> <span><strong>Clic sur un groupe</strong> dans la grille pour ouvrir son panneau de détail.</span></li>
                      <li className="flex items-start gap-2"><span className="text-purple-500 mt-0.5">•</span> <span><strong>Bouton « Ajouter »</strong> dans la section membres pour chercher et assigner un utilisateur.</span></li>
                      <li className="flex items-start gap-2"><span className="text-purple-500 mt-0.5">•</span> <span><strong>Bouton « Membres »</strong> dans la barre du haut : ouvre un modal glisser-déposer.</span></li>
                      <li className="flex items-start gap-2"><span className="text-purple-500 mt-0.5">•</span> <span><strong>Déplacement</strong> : si un utilisateur est déjà dans un autre groupe, un pop-up de confirmation apparaît.</span></li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><Lock className="w-4 h-4 text-amber-500" /> Permissions</h4>
                    <ul className="space-y-1.5 text-on-surface-variant">
                      <li className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">•</span> <span>Les permissions sont organisées par <strong>catégorie</strong> avec des interrupteurs animés.</span></li>
                      <li className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">•</span> <span>Le <strong>Disque de progression</strong> montre la couverture des permissions.</span></li>
                      <li className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">•</span> <span>Un Superadmin a automatiquement <strong>toutes les permissions</strong>.</span></li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-emerald-500" /> Rôle vs Groupe</h4>
                    <p className="text-on-surface-variant leading-relaxed">
                      Le <strong>rôle</strong> et le <strong>groupe de droits</strong> sont liés mais distincts.
                      Le rôle se change depuis la vue <strong>Utilisateurs</strong>.
                    </p>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>, document.body
      )}

      {/* ── Group Manager Modal (Drag & Drop) ──────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showGroupManager && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowGroupManager(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
                  <div className="p-1.5 rounded-lg bg-purple-500/10"><Users className="w-4 h-4 text-purple-600" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Gérer les membres</h3>
                    <p className="text-[10px] text-on-surface-variant">Glissez les utilisateurs dans un groupe</p>
                  </div>
                  <motion.button onClick={() => setShowGroupManager(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                {gmLoading ? (
                  <div className="flex items-center justify-center py-16 gap-2 text-on-surface-variant text-xs">
                    <RefreshCcw className="w-4 h-4 animate-spin text-purple-600" />
                    Chargement...
                  </div>
                ) : (
                  <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Left: Users without group */}
                    <div className="w-[320px] shrink-0 border-r border-outline-variant/30 flex flex-col">
                      <div className="px-4 py-3 border-b border-outline-variant/20">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/40" />
                          <input
                            value={gmSearch} onChange={e => setGmSearch(e.target.value)}
                            placeholder="Recherche (virgules pour multi-terme)"
                            className="w-full pl-9 pr-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                          />
                        </div>
                        {gmSearch.includes(',') && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {gmSearch.split(',').map((term, i) => term.trim() && (
                              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] font-semibold border border-purple-500/20">
                                {term.trim()}
                                <button onClick={() => { const parts = gmSearch.split(',').filter((_, idx) => idx !== i); setGmSearch(parts.join(', ')); }}
                                  className="hover:text-red-500 transition-colors cursor-pointer"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {(() => {
                          const terms = gmSearch.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                          const filtered = gmUsers.filter(u => {
                            if (u.permissionGroups?.length > 0) return false;
                            if (terms.length === 0) return true;
                            return terms.some(q => u.fullName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
                          });
                          if (filtered.length === 0) {
                            return (
                              <div className="text-center py-8 text-on-surface-variant/50">
                                <UserX className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-[11px] italic">Aucun utilisateur sans groupe</p>
                              </div>
                            );
                          }
                          return filtered.map(u => (
                            <div key={u.id} draggable onDragStart={() => setGmDragUser(u)} onDragEnd={() => setGmDragUser(null)}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
                                gmDragUser?.id === u.id ? 'border-purple-500/40 bg-purple-500/10 shadow-md scale-[1.02]' : 'border-outline-variant/20 bg-surface hover:border-outline-variant/40 hover:bg-surface-container-low'
                              }`}
                            >
                              <UserAvatar user={u} size="md" colorClass="bg-purple-500/10 text-purple-600" />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-on-surface truncate">{u.fullName}</p>
                                <p className="text-[10px] text-on-surface-variant truncate">{u.email}</p>
                              </div>
                              {u.role && ROLE_STYLES[u.role] && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 ${ROLE_STYLES[u.role].cls}`}>{ROLE_STYLES[u.role].label}</span>
                              )}
                            </div>
                          ));
                        })()}
                      </div>
                      <div className="px-4 py-2 border-t border-outline-variant/20 text-[10px] text-on-surface-variant/50 text-center">
                        {gmUsers.filter(u => !u.permissionGroups?.length).length} disponible(s)
                      </div>
                    </div>

                    {/* Right: Groups as drop zones */}
                    <div className="flex-1 overflow-y-auto p-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {gmGroups.map(group => {
                          const groupMembers = gmUsers.filter(u => u.permissionGroups?.some(g => g.id === group.id));
                          return (
                            <div
                              key={group.id}
                              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-purple-500/40', 'bg-purple-500/5'); }}
                              onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-purple-500/40', 'bg-purple-500/5'); }}
                              onDrop={async (e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove('ring-2', 'ring-purple-500/40', 'bg-purple-500/5');
                                const user = gmDragUser;
                                if (!user) return;
                                try {
                                  await api.post(`/permission-groups/${group.id}/assign`, { userIds: [user.id] });
                                  toast.success(`${user.fullName} assigné au groupe « ${group.name} »`);
                                  setGmUsers(prev => prev.map(u => u.id === user.id ? { ...u, permissionGroups: [{ id: group.id, name: group.name }] } : u));
                                  setGmDragUser(null);
                                  mutate();
                                } catch (err) {
                                  toast.error(err.response?.data?.error || "Erreur lors de l'assignation");
                                }
                              }}
                              className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest hover:border-outline-variant/50 transition-all overflow-hidden"
                            >
                              <div className="px-4 py-3 border-b border-outline-variant/20 flex items-center gap-2">
                                <div className="p-1 rounded-md bg-purple-500/10"><Shield className="w-3.5 h-3.5 text-purple-500" /></div>
                                <span className="text-xs font-bold text-on-surface">{group.name}</span>
                                <span className="ml-auto text-[10px] font-semibold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-md">{groupMembers.length}</span>
                              </div>
                              <div className="p-2 min-h-[60px]">
                                {groupMembers.length === 0 ? (
                                  <p className="text-[10px] text-on-surface-variant/30 text-center py-3 italic">Glissez un utilisateur ici</p>
                                ) : (
                                  <div className="space-y-1">
                                    {groupMembers.map(u => (
                                      <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-outline-variant/20">
                                        <UserAvatar user={u} size="sm" colorClass="bg-purple-500/10 text-purple-600" />
                                        <span className="text-[11px] font-medium text-on-surface truncate flex-1">{u.fullName}</span>
                                        {u.role && ROLE_STYLES[u.role] && (
                                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded border shrink-0 ${ROLE_STYLES[u.role].cls}`}>{ROLE_STYLES[u.role].label}</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>, document.body
      )}
    </div>
  );
}
