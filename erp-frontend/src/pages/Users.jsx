import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import Toggle from '../components/Toggle';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useFilterParam } from '../hooks/useFilterParam';
import useSystemSettings from '../hooks/useSystemSettings';
import { hasPermission } from '../utils/permissions';
import {
  Users as UsersIcon, UserPlus, ShieldCheck, UserX,
  Trash2, Upload, Download, X, Search, CheckCircle2,
  RotateCcw, KeyRound, Edit2, AlertTriangle, Zap, Database,
  RefreshCw, Layers
} from 'lucide-react';

const ROLE_LABELS = {
  SUPERADMIN: 'Superadmin',
  ADMIN: 'Admin',
  HOTLINE: 'Hotline',
  TECHNICIAN: 'Technicien',
  REQUESTER: 'Demandeur',
};
const ADMIN_LIKE_ROLES = ['SUPERADMIN', 'ADMIN'];

function assignableRoles(actorRole) {
  if (actorRole === 'SUPERADMIN') return ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN', 'REQUESTER'];
  if (actorRole === 'ADMIN') return ['HOTLINE', 'TECHNICIAN', 'REQUESTER'];
  if (actorRole === 'HOTLINE') return ['TECHNICIAN', 'REQUESTER'];
  return [];
}

const emptyForm = { email: '', fullName: '', password: '', role: 'REQUESTER', teamId: '' };

function HighlightText({ text, query }) {
  if (!query || !text) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = String(text).split(regex);
  return <>{parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-amber-300/40 text-on-surface rounded-sm px-0.5">{part}</mark> : part
  )}</>;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

const ROLE_CONFIG = {
  SUPERADMIN: { label: 'Superadmin',  color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-500/15', border: 'border-purple-500/25', icon: 'military_tech'         },
  ADMIN:      { label: 'Admin',        color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/25',   icon: 'admin_panel_settings'  },
  HOTLINE:    { label: 'Hotline',      color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/15',  border: 'border-amber-500/25',  icon: 'support_agent'         },
  TECHNICIAN: { label: 'Technicien',   color: 'text-emerald-700 dark:text-emerald-400',bg: 'bg-emerald-500/15',border: 'border-emerald-500/25',icon: 'build'                 },
  REQUESTER:  { label: 'Demandeur',    color: 'text-zinc-700 dark:text-zinc-400',   bg: 'bg-zinc-500/15',   border: 'border-zinc-500/25',   icon: 'person'                },
};

function ToggleSwitch({ checked, onChange, disabled = false, title }) {
  // Délègue au toggle moderne partagé (design identique au reste de l'app)
  return (
    <Toggle
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      label={title}
    />
  );
}

export default function Users() {
  console.log('[Users] Component mounting...');
  const { user: currentUser } = useAuth();
  console.log('[Users] currentUser:', currentUser?.fullName, currentUser?.role);
  const { autonomousMode } = useSystemSettings();
  const canManage = hasPermission(currentUser, 'users.manage') || currentUser?.role === 'SUPERADMIN' || currentUser?.role === 'ADMIN';
  console.log('[Users] canManage:', canManage, 'hasPermission:', typeof hasPermission);
  const ROLES = assignableRoles(currentUser?.role);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [assignGroupId, setAssignGroupId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [editModal, setEditModal] = useState({ open: false, user: null });
  const [editForm, setEditForm] = useState({ fullName: '', email: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [showGlpiImport, setShowGlpiImport] = useState(false);
  const [importableUsers, setImportableUsers] = useState([]);
  const [selectedImportIds, setSelectedImportIds] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [ldapSyncing, setLdapSyncing] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const [searchQuery, setSearchQuery] = useFilterParam('search');
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = searchQuery;
  const searchDebounceRef = useRef(null);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchInput]);

  const [roleFilter, setRoleFilter] = useFilterParam('role');
  const [teamFilter, setTeamFilter] = useFilterParam('teamId');
  const [statusFilter, setStatusFilter] = useFilterParam('status');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [total, setTotal] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [assignTeamId, setAssignTeamId] = useState('');
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgePreview, setPurgePreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [purgeMode, setPurgeMode] = useState('smart');
  const [purging, setPurging] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showTeamManager, setShowTeamManager] = useState(false);
  const [teamManagerTeams, setTeamManagerTeams] = useState([]);
  const [teamManagerUsers, setTeamManagerUsers] = useState([]);
  const [teamManagerLoading, setTeamManagerLoading] = useState(false);
  const [tmSearch, setTmSearch] = useState('');
  const [tmDragUser, setTmDragUser] = useState(null);
  const loadReqIdRef = useRef(0);

  function load() {
    console.log('[Users] Loading data...');
    const reqId = ++loadReqIdRef.current;
    const params = new URLSearchParams();
    params.set('page', page); params.set('limit', limit);
    if (searchQuery?.trim()) params.set('search', searchQuery.trim());
    if (roleFilter) params.set('role', roleFilter);
    if (teamFilter) params.set('teamId', teamFilter);
    if (statusFilter === 'active') params.set('isActive', 'true');
    else if (statusFilter === 'inactive') params.set('isActive', 'false');
    Promise.all([api.get(`/users?${params}`), api.get('/teams'), api.get('/permission-groups')])
      .then(([uRes, tRes, gRes]) => {
        console.log('[Users] Data loaded:', { users: uRes.data.users?.length || uRes.data?.length, teams: tRes.data?.length, groups: gRes.data?.length });
        if (reqId !== loadReqIdRef.current) return;
        if (uRes.data.users) {
          setUsers(uRes.data.users); setTotal(uRes.data.total || 0);
          setStaffCount(uRes.data.staffCount ?? 0); setInactiveCount(uRes.data.inactiveCount ?? 0);
          setTotalPages(uRes.data.totalPages || 1);
        } else {
          const list = Array.isArray(uRes.data) ? uRes.data : [];
          setUsers(list); setTotal(list.length);
          setStaffCount(list.filter(u => u.role !== 'REQUESTER').length);
          setInactiveCount(list.filter(u => !u.isActive).length);
          setTotalPages(1);
        }
        setTeams(tRes.data); setGroups(gRes.data); setSelectedIds([]);
      })
      .catch(err => { console.error('[Users] Load error:', err); if (reqId === loadReqIdRef.current) setError(err.response?.data?.error || 'Erreur de chargement'); })
      .finally(() => { if (reqId === loadReqIdRef.current) setLoading(false); });
  }
  useEffect(() => { load(); }, [page, debouncedSearch, roleFilter, teamFilter, statusFilter]);

  function toggleSelect(id) { setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]); }
  function toggleSelectAll() { setSelectedIds(ids => ids.length === users.length ? [] : users.map(u => u.id)); }

  async function updateField(id, field, value) {
    try {
      await api.patch(`/users/${id}`, { [field]: value });
      load();
if (field === 'role') {
        const target = users.find((u) => u.id === id);
        // Le groupe de droits suit le rôle (RBAC) : on affiche le groupe aligné automatiquement
        let groupNote = '';
        try {
          const { data: fresh } = await api.get(`/users/${id}`);
          const g = fresh?.permissionGroups?.[0];
          if (g) groupNote = ` — groupe « ${g.name} » aligné`;
        } catch { /* info optionnelle */ }
        toast.success(`Rôle de ${target?.fullName || 'l’utilisateur'} changé pour « ${ROLE_CONFIG[value]?.label || value} » — effet immédiat${groupNote}`);
      } else if (field === 'isActive') {
        const target = users.find((u) => u.id === id);
        toast.success(`${target?.fullName || 'Utilisateur'} ${value ? 'réactivé' : 'désactivé'}`);
      }
    } catch (err) { setError(err.response?.data?.error || 'Erreur'); }
  }

  function startEdit(u) { setEditModal({ open: true, user: u }); setEditForm({ fullName: u.fullName, email: u.email }); }
  function closeEditModal() { setEditModal({ open: false, user: null }); setEditForm({ fullName: '', email: '' }); }
  async function saveEdit() {
    if (!editModal.user) return;
    setSavingEdit(true);
    try { await api.patch(`/users/${editModal.user.id}`, editForm); toast.success(`${editModal.user.fullName} mis à jour`); closeEditModal(); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur'); }
    finally { setSavingEdit(false); }
  }

  async function handleResetPassword() {
    if (!confirmResetId) return; setResetting(true);
    try { await api.post(`/users/${confirmResetId}/reset-password`); toast.success('Mot de passe réinitialisé'); setConfirmResetId(null); }
    catch (err) { setError(err.response?.data?.error || 'Erreur'); setConfirmResetId(null); }
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
      toast.success('Utilisateur créé'); setForm(emptyForm); setCreateModal(false); load();
    } catch (err) { setError(err.response?.data?.error || 'Erreur lors de la création'); }
    finally { setSubmitting(false); }
  }

  async function handleAssignToGroup() {
    if (!assignGroupId || selectedIds.length === 0) return; setAssigning(true);
    try { await api.post(`/permission-groups/${assignGroupId}/assign`, { userIds: selectedIds }); toast.success(`${selectedIds.length} assigné(s) au groupe`); setAssignGroupId(''); setSelectedIds([]); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur'); } finally { setAssigning(false); }
  }

  async function handleAssignToTeam() {
    if (!assignTeamId || selectedIds.length === 0) return; setAssigning(true);
    try { await api.post('/users/bulk-assign-team', { userIds: selectedIds, teamId: assignTeamId === 'none' ? null : assignTeamId }); toast.success(`${selectedIds.length} assigné(s)`); setAssignTeamId(''); setSelectedIds([]); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur'); } finally { setAssigning(false); }
  }

  async function handleBulkDelete() {
    if (selectedIds.length === 0) return; setBulkDeleting(true);
    try { const { data } = await api.post('/users/bulk-delete', { userIds: selectedIds }); toast.success(`${data.deletedCount} supprimé(s)`); setSelectedIds([]); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur'); } finally { setBulkDeleting(false); }
  }

  async function openPurgeModal() {
    setShowPurgeModal(true);
    setLoadingPreview(true);
    setPurgePreview(null);
    try {
      const { data } = await api.get('/users/purge-preview');
      setPurgePreview(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du calcul de l\'aperçu');
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handlePurgeSmart() {
    setPurging(true);
    try {
      const { data } = await api.post('/users/purge-smart', { mode: purgeMode });
      toast.success(data.message);
      setShowPurgeModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la purge');
    } finally {
      setPurging(false);
    }
  }

  function downloadSampleCsv() {
    const sample = "Identifiant;Nom de famille;Courriels;Téléphone;Lieu;Actif\nabledou (1778);BLEDOU;Ange.BLEDOU@prosuma.ci;;;Oui\n";
    const blob = new Blob(['\uFEFF' + sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', 'modele_import_utilisateurs.csv');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }

  async function handleCsvUpload() {
    if (!csvFile) return; setCsvImporting(true);
    const fd = new FormData(); fd.append('file', csvFile);
    try { const { data } = await api.post('/users/import-csv', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); setCsvResult(data); toast.success(`Import : ${data.imported} créé(s), ${data.updated} mis à jour`); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur CSV'); } finally { setCsvImporting(false); }
  }

  // Synchro annuaire AD — équivalent 1 clic de la « vue LDAP » GLPI :
  // crée les nouveaux, met à jour les noms, désactive les comptes disparus.
  async function handleLdapSync() {
    setLdapSyncing(true);
    try {
      const { data } = await api.post('/users/sync-ldap');
      const s = data.stats || {};
      const skipped = s.skipped ? `, ${s.skipped} ignoré(s)` : '';
      toast.success(`Annuaire synchronisé (${s.adTotal || 0} entrées AD) : ${s.created || 0} créé(s), ${s.updated || 0} mis à jour, ${s.deactivated || 0} désactivé(s), ${s.reactivated || 0} réactivé(s)${skipped}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec de la synchronisation annuaire');
    } finally {
      setLdapSyncing(false);
    }
  }

  console.log('[Users] Rendering, users:', users.length, 'loading:', loading);
  return (
    <div className="flex flex-col min-h-screen">
      {/* ── AD Sync Loading Overlay ────────────────────────────────────── */}
      <AnimatePresence>
        {ldapSyncing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0.25 }}
              className="bg-surface-container-lowest border border-indigo-500/30 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 max-w-sm"
            >
              <div className="relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-30" />
                <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/15">
                  <Database className="w-8 h-8 text-indigo-500 animate-pulse" />
                </span>
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-on-surface">Synchronisation Active Directory</p>
                <p className="text-xs text-on-surface-variant mt-1">Lecture de l'annuaire, création et mise à jour des comptes…</p>
              </div>
              <div className="w-full bg-indigo-500/10 rounded-full h-1.5 overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: '90%' }}
                  transition={{ duration: 8, ease: 'easeInOut' }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <UsersIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Gestion des Utilisateurs</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">{total} comptes · {staffCount} staff · {inactiveCount} inactifs</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <button onClick={handleLdapSync} disabled={ldapSyncing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 text-xs font-semibold transition-all disabled:opacity-70"
            title="Synchroniser les comptes depuis l'Active Directory"
          >
            {ldapSyncing ? (
              <>
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-indigo-500" />
                </span>
                <span className="hidden sm:inline animate-pulse">Synchronisation AD…</span>
              </>
            ) : (
              <>
                <Database className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Annuaire AD</span>
              </>
            )}
          </button>
          <button onClick={openPurgeModal}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-semibold transition-all cursor-pointer"
            title="Purger & nettoyer intelligemment les comptes"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Purger</span>
          </button>
          <button onClick={() => { setError(''); setCsvFile(null); setCsvResult(null); setShowCsvImport(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container text-xs font-semibold transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button onClick={async () => {
              setShowTeamManager(true); setTeamManagerLoading(true); setTmSearch('');
              try {
                const [tRes, uRes] = await Promise.all([api.get('/teams'), api.get('/users?all=true')]);
                setTeamManagerTeams(tRes.data);
                const list = Array.isArray(uRes.data) ? uRes.data : (uRes.data.users || []);
                setTeamManagerUsers(list.filter(u => u.isActive));
              } catch (err) { toast.error(err.response?.data?.error || 'Erreur chargement'); setShowTeamManager(false); }
              finally { setTeamManagerLoading(false); }
            }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs font-semibold transition-all"
              title="Gérer les équipes par glisser-déposer"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Équipes</span>
            </button>
          {!autonomousMode && (
            <button onClick={async () => {
              setError(''); setImportResult(null);
              try { const { data } = await api.get('/glpi/importable-users'); setImportableUsers(data); setSelectedImportIds([]); setShowGlpiImport(true); }
              catch (err) { setError(err.response?.data?.error || 'Erreur GLPI'); }
            }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container text-xs font-semibold transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">GLPI</span>
            </button>
          )}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => { setCreateModal(true); setError(''); setForm(emptyForm); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-blue-500/20"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau compte</span>
          </motion.button>
        </div>
      </div>



      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 lg:px-8 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-2.5 border-b border-outline-variant/10 flex items-center gap-6">
        {[
          { label: 'Total', value: total,         icon: UsersIcon,    color: 'text-blue-600 dark:text-blue-400'   },
          { label: 'Staff',  value: staffCount,    icon: ShieldCheck,  color: 'text-emerald-600 dark:text-emerald-400'},
          { label: 'Inactifs',value: inactiveCount,icon: UserX,        color: inactiveCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-1.5">
              <Icon className={`w-3.5 h-3.5 ${s.color}`} />
              <span className="text-sm font-bold text-on-surface">{s.value}</span>
              <span className="text-[11px] text-on-surface-variant font-medium hidden sm:block">{s.label}</span>
            </div>
          );
        })}
      </div>
      {/* ── Search & Filter Controls Bar ───────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-3 bg-surface-container-low/30 border-b border-outline-variant/20 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Live Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
          <input
            type="text"
            placeholder="Rechercher par nom, email, équipe, ID GLPI..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full bg-surface border border-outline-variant/40 rounded-xl pl-10 pr-9 py-2 text-xs font-medium text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface p-0.5 rounded-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Role & Team Filters */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Role filter pills */}
          <div className="flex items-center gap-1 bg-surface border border-outline-variant/30 rounded-xl p-1">
            {[{ v: '', l: 'Tous les rôles' }, ...Object.entries(ROLE_CONFIG).map(([v, c]) => ({ v, l: c.label }))].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => { setRoleFilter(v); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  roleFilter === v
                    ? v ? `${ROLE_CONFIG[v]?.bg} ${ROLE_CONFIG[v]?.color} ${ROLE_CONFIG[v]?.border}` : 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Team filter dropdown */}
          <select
            value={teamFilter}
            onChange={(e) => { setTeamFilter(e.target.value); setPage(1); }}
            className="bg-surface border border-outline-variant/40 rounded-xl px-3.5 py-2 text-xs font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer shadow-sm"
          >
            <option value="">Toutes les équipes</option>
            <option value="null">Sans équipe</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {/* Status filter pills */}
          <div className="flex items-center gap-1 bg-surface border border-outline-variant/30 rounded-xl p-1">
            {[{ v: '', l: 'Tous' }, { v: 'active', l: 'Actifs' }, { v: 'inactive', l: 'Inactifs' }].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => { setStatusFilter(v); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  statusFilter === v
                    ? v === 'active' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shadow-xs'
                      : v === 'inactive' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 shadow-xs'
                      : 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Active filter chips ──────────────────────────────────────── */}
      {(searchQuery || roleFilter || teamFilter || statusFilter) && (
        <div className="px-4 sm:px-6 lg:px-8 py-2 bg-surface-container-low/20 border-b border-outline-variant/10 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider shrink-0">Filtres :</span>
          {searchQuery && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold border border-primary/20">
              🔍 « {searchQuery} »
              <button onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(1); }} className="p-0.5 rounded-full hover:bg-primary/20 transition-colors"><X className="w-3 h-3" /></button>
            </span>
          )}
          {roleFilter && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[11px] font-semibold border border-purple-500/20">
              {ROLE_CONFIG[roleFilter]?.label || roleFilter}
              <button onClick={() => { setRoleFilter(''); setPage(1); }} className="p-0.5 rounded-full hover:bg-purple-500/20 transition-colors"><X className="w-3 h-3" /></button>
            </span>
          )}
          {teamFilter && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[11px] font-semibold border border-sky-500/20">
              {teamFilter === 'null' ? 'Sans équipe' : teams.find(t => String(t.id) === teamFilter)?.name || `Équipe #${teamFilter}`}
              <button onClick={() => { setTeamFilter(''); setPage(1); }} className="p-0.5 rounded-full hover:bg-sky-500/20 transition-colors"><X className="w-3 h-3" /></button>
            </span>
          )}
          {statusFilter && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
              statusFilter === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
            }`}>
              {statusFilter === 'active' ? 'Actifs' : 'Inactifs'}
              <button onClick={() => { setStatusFilter(''); setPage(1); }} className="p-0.5 rounded-full hover:bg-white/20 transition-colors"><X className="w-3 h-3" /></button>
            </span>
          )}
          <button
            onClick={() => { setSearchInput(''); setSearchQuery(''); setRoleFilter(''); setTeamFilter(''); setStatusFilter(''); setPage(1); }}
            className="ml-auto text-[10px] font-bold text-on-surface-variant hover:text-red-500 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Tout effacer
          </button>
        </div>
      )}

      {/* ── Bulk action bar ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-blue-500/20 bg-blue-500/5"
          >
            <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {selectedIds.length} sélectionné(s)
              </span>
              <div className="flex items-center gap-1.5">
                <select value={assignGroupId} onChange={e => setAssignGroupId(e.target.value)}
                  className="bg-surface border border-outline-variant/40 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="">Assigner groupe...</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button onClick={handleAssignToGroup} disabled={!assignGroupId || assigning}
                  className="px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-40">
                  OK
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <select value={assignTeamId} onChange={e => setAssignTeamId(e.target.value)}
                  className="bg-surface border border-outline-variant/40 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="">Assigner équipe...</option>
                  <option value="none">Retirer l'équipe</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button onClick={handleAssignToTeam} disabled={!assignTeamId || assigning}
                  className="px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-40">
                  OK
                </button>
              </div>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-xs font-semibold hover:bg-red-500/15 transition-all disabled:opacity-40 ml-auto">
                <Trash2 className="w-3 h-3" />
                Supprimer ({selectedIds.length})
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Users table ───────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4">
        <div className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest">
          {/* Table header */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-b border-outline-variant/20 bg-surface-container-low/40 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
            <div className="w-5 shrink-0">
              <input type="checkbox" checked={users.length > 0 && selectedIds.length === users.length}
                onChange={toggleSelectAll} className="cursor-pointer accent-primary w-3.5 h-3.5 rounded" />
            </div>
            <div className="flex-1 min-w-0">Utilisateur</div>
            <div className="w-28 shrink-0 hidden sm:block">Rôle</div>
            <div className="w-32 shrink-0 hidden md:block">Équipe</div>
            <div className="w-16 shrink-0 text-center">Statut</div>
            <div className="w-14 shrink-0 text-center hidden xl:block">Alertes</div>
            <div className="w-20 shrink-0 text-right">Actions</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-outline-variant/10">
            {loading && users.length === 0 ? (
              Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton variant="text-sm" className="w-3 h-3" />
                  <Skeleton variant="avatar-sm" className="w-8 h-8 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Skeleton variant="text-sm" className="w-1/3" />
                    <Skeleton variant="text-sm" className="w-1/4" />
                  </div>
                  <Skeleton variant="badge" className="w-28 hidden sm:block" />
                  <Skeleton variant="badge" className="w-32 hidden md:block" />
                  <Skeleton variant="badge" className="w-16" />
                  <Skeleton variant="badge" className="w-20" />
                </div>
              ))
            ) : (
              <>
              <AnimatePresence mode="popLayout">
              {users.map((u, idx) => {
                const roleCfg = ROLE_CONFIG[u.role] || ROLE_CONFIG.REQUESTER;
                return (
                  <motion.div
                    key={u.id}
                    layout
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.15, delay: idx * 0.01, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-surface-container-low/50 transition-colors group"
                  >
                    {/* Checkbox */}
                    <div className="w-5 shrink-0">
                      <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => toggleSelect(u.id)}
                        className="cursor-pointer accent-primary w-3.5 h-3.5 rounded" />
                    </div>

                    {/* User */}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => canManage && startEdit(u)}>
                      <div className="flex items-center gap-2.5">
                        {/* Avatar */}
                        <div className="relative shrink-0">
                          <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-[11px] font-bold ${roleCfg.bg} ${roleCfg.color} ${roleCfg.border}`}>
                            {initials(u.fullName)}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-container-lowest ${u.isActive ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-on-surface truncate"><HighlightText text={u.fullName} query={searchQuery} /></p>
                          <p className="text-[10px] text-on-surface-variant truncate font-mono"><HighlightText text={u.email} query={searchQuery} /></p>
                        </div>
                      </div>
                    </div>

                    {/* Role */}
                    <div className="w-28 shrink-0 hidden sm:block">
                      {(currentUser?.role === 'SUPERADMIN' || !ADMIN_LIKE_ROLES.includes(u.role)) ? (
                        <div className="relative">
                          <select value={u.role} onChange={e => updateField(u.id, 'role', e.target.value)}
                            className={`appearance-none w-full rounded-xl pl-6 pr-5 py-1.5 text-[10px] font-bold border focus:outline-none cursor-pointer ${roleCfg.bg} ${roleCfg.color} ${roleCfg.border}`}>
                            {Array.from(new Set([...ROLES, u.role])).map(r => (
                              <option key={r} value={r} className="bg-surface text-on-surface">{ROLE_CONFIG[r]?.label || r}</option>
                            ))}
                          </select>
                          <span className="material-symbols-outlined absolute left-1.5 top-1.5 text-[12px] pointer-events-none">{roleCfg.icon}</span>
                          <span className="material-symbols-outlined absolute right-1 top-1.5 text-[12px] pointer-events-none opacity-60">expand_more</span>
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[10px] font-bold border ${roleCfg.bg} ${roleCfg.color} ${roleCfg.border}`}>
                          <span className="material-symbols-outlined text-[11px]">{roleCfg.icon}</span>
                          {roleCfg.label}
                        </span>
                      )}
                    </div>

                    {/* Team */}
                    <div className="w-32 shrink-0 hidden md:block">
                      <select value={u.teamId || ''} onChange={e => updateField(u.id, 'teamId', e.target.value ? Number(e.target.value) : null)}
                        className="w-full appearance-none bg-surface border border-outline-variant/30 rounded-xl px-2.5 py-1.5 text-[10px] font-medium text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer truncate">
                        <option value="">Sans équipe</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>

                    {/* Active toggle */}
                    <div className="w-16 shrink-0 flex justify-center">
                      <ToggleSwitch checked={u.isActive} onChange={val => updateField(u.id, 'isActive', val)} title={u.isActive ? 'Désactiver' : 'Activer'} />
                    </div>

                    {/* Draft alerts toggle */}
                    <div className="w-14 shrink-0 hidden xl:flex justify-center">
                      {u.role !== 'REQUESTER' ? (
                        <ToggleSwitch checked={u.receiveDraftAlerts} onChange={val => updateField(u.id, 'receiveDraftAlerts', val)} title="Alertes brouillons IA" />
                      ) : <span className="text-outline/30 text-xs">—</span>}
                    </div>

                    {/* Actions */}
                    <div className="w-20 shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(currentUser?.role === 'SUPERADMIN' || !ADMIN_LIKE_ROLES.includes(u.role)) && (
                        <>
                          <motion.button whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}
                            onClick={() => setConfirmDeleteId(u.id)} title="Supprimer"
                            className="p-1.5 rounded-lg text-on-surface-variant hover:text-red-500 hover:bg-red-500/10 transition-all">
                            <Trash2 className="w-3.5 h-3.5" />
                          </motion.button>
                        </>
                      )}
                    </div>
                  </motion.div>
                );
              })}
              </AnimatePresence>

              {users.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
                  <UsersIcon className="w-10 h-10 text-outline/30" />
                  <p className="text-sm italic">Aucun utilisateur trouvé.</p>
                </div>
              )}
              </>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-outline-variant/20 bg-surface-container-low/20">
              <span className="text-[11px] text-on-surface-variant font-medium">Page <strong>{page}</strong> / <strong>{totalPages}</strong> ({total} utilisateurs)</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-[11px] font-semibold text-on-surface-variant disabled:opacity-30 hover:bg-surface-container transition-colors">
                  ← Préc.
                </button>
                <span className="text-[11px] font-mono text-on-surface-variant px-2">{page}/{totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-[11px] font-semibold text-on-surface-variant disabled:opacity-30 hover:bg-surface-container transition-colors">
                  Suiv. →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showGlpiImport && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!importing) setShowGlpiImport(false); }} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-sky-500/10"><Download className="w-4 h-4 text-sky-600 dark:text-sky-400" /></div>
                  <h3 className="text-sm font-bold text-on-surface">Importer depuis GLPI</h3>
                  <motion.button onClick={() => { if (!importing) setShowGlpiImport(false); }} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></motion.button>
                </div>
                <div className="p-5 overflow-y-auto flex-1">
                  {importResult ? (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-sm">
                        {importResult.imported} utilisateur(s) importé(s) avec succès
                      </div>
                      {importResult.errors?.length > 0 && (
                        <div className="p-4 rounded-xl bg-red-500/5 text-red-600 dark:text-red-400 border border-red-500/20 text-xs">
                          <p className="font-bold mb-2">Erreurs :</p>
                          <ul className="list-disc pl-4 space-y-1">{importResult.errors.map((e, i) => <li key={i}>GLPI #{e.glpiId} : {e.reason}</li>)}</ul>
                        </div>
                      )}
                      <div className="flex justify-end">
                        <button onClick={() => { setShowGlpiImport(false); load(); }} className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold">Terminé</button>
                      </div>
                    </div>
                  ) : importableUsers.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-8 text-on-surface-variant">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500/40" />
                      <p className="text-sm">Tous les utilisateurs GLPI sont déjà importés.</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-on-surface-variant mb-3">{importableUsers.length} utilisateur(s) GLPI disponibles. Ils recevront le rôle <strong>Technicien</strong>.</p>
                      <label className="flex items-center gap-2 cursor-pointer mb-3">
                        <input type="checkbox" checked={selectedImportIds.length === importableUsers.length}
                          onChange={() => setSelectedImportIds(selectedImportIds.length === importableUsers.length ? [] : importableUsers.map(u => u.glpiId))}
                          className="accent-primary w-3.5 h-3.5" />
                        <span className="text-xs text-on-surface">Tout sélectionner ({selectedImportIds.length})</span>
                      </label>
                      <div className="border border-outline-variant/30 rounded-xl divide-y divide-outline-variant/15 max-h-60 overflow-y-auto">
                        {importableUsers.map(u => (
                          <label key={u.glpiId} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-container-low/60 cursor-pointer">
                            <input type="checkbox" checked={selectedImportIds.includes(u.glpiId)}
                              onChange={() => setSelectedImportIds(ids => ids.includes(u.glpiId) ? ids.filter(id => id !== u.glpiId) : [...ids, u.glpiId])}
                              className="accent-primary w-3.5 h-3.5" />
                            <div className="w-7 h-7 rounded-full bg-surface-container border border-outline-variant/40 text-on-surface text-[10px] font-bold flex items-center justify-center">
                              {u.fullName?.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-on-surface truncate">{u.fullName}</p>
                              <p className="text-[10px] text-on-surface-variant truncate">{u.email}</p>
                            </div>
                            <span className="text-[10px] text-outline/50 font-mono">#{u.glpiId}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-outline-variant/30">
                        <button onClick={() => setShowGlpiImport(false)} disabled={importing} className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-sm font-medium hover:bg-surface-container transition-colors disabled:opacity-50">Annuler</button>
                        <button disabled={selectedImportIds.length === 0 || importing}
                          onClick={async () => {
                            setImporting(true);
                            try { const { data } = await api.post('/glpi/import-users', { userIds: selectedImportIds }); setImportResult(data); }
                            catch (err) { setError(err.response?.data?.error || "Erreur d'import"); setShowGlpiImport(false); }
                            finally { setImporting(false); }
                          }}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-md">
                          {importing && <RotateCcw className="w-3.5 h-3.5 animate-spin" />}
                          {importing ? 'Import...' : `Importer (${selectedImportIds.length})`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {createPortal(
        <AnimatePresence>
          {showCsvImport && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!csvImporting) setShowCsvImport(false); }} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10"><Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <h3 className="text-sm font-bold text-on-surface">Importer via CSV</h3>
                  <motion.button onClick={() => { if (!csvImporting) setShowCsvImport(false); }} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></motion.button>
                </div>
                <div className="p-5 overflow-y-auto flex-1 space-y-4">
                  {csvResult ? (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-sm space-y-1">
                        <p className="font-bold">Import CSV terminé !</p>
                        <p>{csvResult.imported} créé(s) · {csvResult.updated} mis à jour · {csvResult.totalProcessed} traité(s)</p>
                      </div>
                      {csvResult.errors?.length > 0 && (
                        <div className="p-4 rounded-xl bg-red-500/5 text-red-600 dark:text-red-400 border border-red-500/20 text-xs">
                          <p className="font-bold mb-1">Erreurs ({csvResult.errors.length}) :</p>
                          <ul className="list-disc pl-4 space-y-0.5 max-h-24 overflow-y-auto">{csvResult.errors.map((e, i) => <li key={i}>{e.email || `Ligne ${i+1}`} : {e.reason}</li>)}</ul>
                        </div>
                      )}
                      <div className="flex justify-end"><button onClick={() => { setShowCsvImport(false); load(); }} className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold">Terminé</button></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between bg-surface-container border border-outline-variant/30 rounded-xl p-3">
                        <p className="text-xs text-on-surface-variant font-medium">Format : <code className="text-primary font-bold">Identifiant;Nom;Courriels;Lieu;Actif</code></p>
                        <button onClick={downloadSampleCsv} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1 shrink-0 ml-3">
                          <Download className="w-3 h-3" />Modèle
                        </button>
                      </div>
                      <label htmlFor="csv-file-input" className="cursor-pointer border-2 border-dashed border-outline-variant/40 hover:border-primary/50 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-center transition-colors">
                        <Upload className="w-8 h-8 text-on-surface-variant/40" />
                        {csvFile ? (
                          <>
                            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{csvFile.name}</p>
                            <p className="text-[10px] text-on-surface-variant font-mono">{(csvFile.size / 1024).toFixed(1)} KB</p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-on-surface-variant">Glissez votre fichier CSV ici</p>
                            <p className="text-xs text-on-surface-variant/50">ou cliquez pour choisir</p>
                          </>
                        )}
                        <input id="csv-file-input" type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && setCsvFile(e.target.files[0])} className="hidden" />
                      </label>
                      <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant/30">
                        <button onClick={() => setShowCsvImport(false)} disabled={csvImporting} className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-sm font-medium hover:bg-surface-container disabled:opacity-50">Annuler</button>
                        <button onClick={handleCsvUpload} disabled={!csvFile || csvImporting}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-md">
                          {csvImporting && <RotateCcw className="w-3.5 h-3.5 animate-spin" />}
                          {csvImporting ? 'Importation...' : 'Lancer l\'import'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modal Édition utilisateur ──────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {editModal.open && editModal.user && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeEditModal} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="relative w-full max-w-md bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-blue-500/10"><Edit2 className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Modifier l'utilisateur</h3>
                    <p className="text-[11px] text-on-surface-variant">{editModal.user.fullName}</p>
                  </div>
                  <motion.button onClick={closeEditModal} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom complet</span>
                    <input value={editForm.fullName} onChange={e => setEditForm({ ...editForm, fullName: e.target.value })}
                      placeholder="Nom complet"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email</span>
                    <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                      placeholder="email@exemple.ci"
                      className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/30 bg-surface-container-low/40">
                  <button onClick={closeEditModal} className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors">Annuler</button>
                  <button onClick={saveEdit} disabled={savingEdit || !editForm.fullName.trim() || !editForm.email.trim()}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md disabled:opacity-50 flex items-center gap-2 transition-all">
                    {savingEdit ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {savingEdit ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modal Création utilisateur ──────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {createModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!submitting) setCreateModal(false); }} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="relative w-full max-w-md bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-blue-500/10"><UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                  <h3 className="text-sm font-bold text-on-surface">Nouveau compte</h3>
                  <motion.button onClick={() => { if (!submitting) setCreateModal(false); }} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
                <form onSubmit={(e) => { handleCreate(e); }} className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 gap-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom complet *</span>
                      <input required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })}
                        placeholder="Nom complet"
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email *</span>
                      <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                        placeholder="email@exemple.ci"
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mot de passe *</span>
                      <input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                        placeholder="••••••••"
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Rôle</span>
                        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                          className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer">
                          {ROLES.map(r => <option key={r} value={r}>{ROLE_CONFIG[r]?.label || r}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Équipe</span>
                        <select value={form.teamId} onChange={e => setForm({ ...form, teamId: e.target.value })}
                          className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer">
                          <option value="">Sans équipe</option>
                          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={() => setCreateModal(false)} disabled={submitting}
                      className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors disabled:opacity-50">Annuler</button>
                    <button type="submit" disabled={submitting}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md disabled:opacity-50 flex items-center gap-2 transition-all">
                      {submitting ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                      {submitting ? 'Création...' : 'Créer le compte'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <ConfirmDialog open={!!confirmDeleteId} title="Supprimer l'utilisateur"
        message="Supprimer définitivement cet utilisateur ? Cette action est irréversible."
        confirmLabel="Supprimer" danger loading={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />
      <ConfirmDialog open={!!confirmResetId} title="Réinitialiser le mot de passe"
        message="Un nouveau mot de passe temporaire sera généré et envoyé par email."
        confirmLabel="Réinitialiser" loading={resetting} onConfirm={handleResetPassword} onCancel={() => setConfirmResetId(null)} />
      {/* ── Modale de Purge Intelligente ────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showPurgeModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => { if (!purging) setShowPurgeModal(false); }}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-3xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-outline-variant/30 bg-surface-container-low/40">
                  <div className="p-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-on-surface">Purge & Nettoyage Intelligent des Comptes</h3>
                    <p className="text-[11px] text-on-surface-variant font-medium">Analyse d'impact automatisée pour préserver l'historique ITSM</p>
                  </div>
                  <motion.button onClick={() => { if (!purging) setShowPurgeModal(false); }} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-5">
                  {loadingPreview ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-3">
                      <RotateCcw className="w-8 h-8 text-primary animate-spin" />
                      <p className="text-xs font-semibold text-on-surface-variant">Analyse d'impact de la base d'utilisateurs en cours...</p>
                    </div>
                  ) : purgePreview ? (
                    <>
                      {/* Bilan analytique 3-cartes */}
                      <div className="grid grid-cols-3 gap-2.5">
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center">
                          <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 block">{purgePreview.deletableOrphansCount}</span>
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">Orphelins (Sans Ticket)</span>
                          <span className="text-[9px] text-on-surface-variant block mt-0.5">100% supprimables</span>
                        </div>
                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-center">
                          <span className="text-lg font-black text-amber-600 dark:text-amber-400 block">{purgePreview.inactivesWithTicketsCount}</span>
                          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">Inactifs avec Tickets</span>
                          <span className="text-[9px] text-on-surface-variant block mt-0.5">Désactivation seule</span>
                        </div>
                        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-center">
                          <span className="text-lg font-black text-blue-600 dark:text-blue-400 block">{purgePreview.activeImportedCount}</span>
                          <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300">Comptes Actifs</span>
                          <span className="text-[9px] text-on-surface-variant block mt-0.5">Conservés</span>
                        </div>
                      </div>

                      {/* Choix du mode de purge */}
                      <div className="space-y-2.5">
                        <label className="text-xs font-bold text-on-surface uppercase tracking-wider block">Stratégie de Nettoyage :</label>

                        {[
                          {
                            id: 'smart',
                            title: '🛡️ Nettoyage Intelligent (Recommandé)',
                            desc: `Supprime les ${purgePreview.deletableOrphansCount} comptes orphelins sans tickets et désactive les ${purgePreview.inactivesWithTicketsCount} comptes inactifs.`,
                            badge: 'Zéro risque',
                            color: 'emerald',
                          },
                          {
                            id: 'deletable_only',
                            title: '🗑️ Supprimer les orphelins uniquement',
                            desc: `Supprime uniquement les ${purgePreview.deletableOrphansCount} comptes n'ayant aucun ticket associé.`,
                            badge: 'Conservation',
                            color: 'blue',
                          },
                          {
                            id: 'deactivate_only',
                            title: '💤 Désactiver les comptes inactifs',
                            desc: 'Désactive les comptes sans supprimer aucune donnée.',
                            badge: 'Sécurité',
                            color: 'amber',
                          },
                          {
                            id: 'full_force',
                            title: '⚠️ Purge intégrale forcée',
                            desc: `Supprime TOUS les ${purgePreview.totalNonAdmin} comptes non-admin (les tickets historiques seront déliés).`,
                            badge: 'Action lourde',
                            color: 'red',
                          },
                        ].map((mode) => (
                          <div
                            key={mode.id}
                            onClick={() => setPurgeMode(mode.id)}
                            className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                              purgeMode === mode.id
                                ? 'bg-primary/10 border-primary shadow-sm'
                                : 'bg-surface border-outline-variant/30 hover:border-outline-variant/60'
                            }`}
                          >
                            <input
                              type="radio"
                              name="purgeMode"
                              checked={purgeMode === mode.id}
                              onChange={() => setPurgeMode(mode.id)}
                              className="accent-primary mt-0.5 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold text-on-surface">{mode.title}</h4>
                                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">
                                  {mode.badge}
                                </span>
                              </div>
                              <p className="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed">{mode.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>

                {/* Footer Actions */}
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-outline-variant/30 bg-surface-container-low/40">
                  <button
                    onClick={() => setShowPurgeModal(false)}
                    disabled={purging}
                    className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handlePurgeSmart}
                    disabled={purging || loadingPreview}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-xs font-bold shadow-md hover:shadow-lg disabled:opacity-50 flex items-center gap-2 transition-all cursor-pointer"
                  >
                    {purging && <RotateCcw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{purging ? 'Purge en cours...' : 'Exécuter la Purge'}</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modal Gestion Équipes (Drag & Drop) ─────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showTeamManager && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowTeamManager(false)}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10"><Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Gérer les équipes</h3>
                    <p className="text-[10px] text-on-surface-variant">Glissez les utilisateurs dans une équipe • Recherche multiple avec virgules</p>
                  </div>
                  <motion.button onClick={() => setShowTeamManager(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                {teamManagerLoading ? (
                  <div className="flex items-center justify-center py-16 gap-2 text-on-surface-variant text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                    Chargement...
                  </div>
                ) : (
                  <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* ── Panneau gauche : Utilisateurs non assignés ────────── */}
                    <div className="w-[320px] shrink-0 border-r border-outline-variant/30 flex flex-col">
                      <div className="px-4 py-3 border-b border-outline-variant/20">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/40" />
                          <input
                            value={tmSearch}
                            onChange={e => setTmSearch(e.target.value)}
                            placeholder="Recherche (séparez par des virgules)"
                            className="w-full pl-9 pr-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                          />
                        </div>
                        {tmSearch.includes(',') && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {tmSearch.split(',').map((term, i) => term.trim() && (
                              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                                {term.trim()}
                                <button onClick={() => {
                                  const parts = tmSearch.split(',').filter((_, idx) => idx !== i);
                                  setTmSearch(parts.join(', '));
                                }} className="hover:text-red-500 transition-colors"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {(() => {
                          // Recherche multi-terme : chaque terme séparé par virgule est combiné avec OR
                          const terms = tmSearch.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                          const filtered = teamManagerUsers.filter(u => {
                            // Exclure les utilisateurs qui ont déjà une équipe (ils sont dans une colonne d'équipe)
                            if (u.teamId) return false;
                            if (terms.length === 0) return true;
                            return terms.some(q =>
                              u.fullName?.toLowerCase().includes(q) ||
                              u.email?.toLowerCase().includes(q)
                            );
                          });
                          if (filtered.length === 0) {
                            return (
                              <div className="text-center py-8 text-on-surface-variant/50">
                                <UserX className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-[11px] italic">Aucun utilisateur sans équipe</p>
                              </div>
                            );
                          }
                          return filtered.map(u => (
                            <div
                              key={u.id}
                              draggable
                              onDragStart={() => setTmDragUser(u)}
                              onDragEnd={() => setTmDragUser(null)}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
                                tmDragUser?.id === u.id
                                  ? 'border-emerald-500/40 bg-emerald-500/10 shadow-md scale-[1.02]'
                                  : 'border-outline-variant/20 bg-surface hover:border-outline-variant/40 hover:bg-surface-container-low'
                              }`}
                            >
                              <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-bold text-[11px] flex items-center justify-center shrink-0">
                                {u.fullName?.charAt(0)?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-on-surface truncate">{u.fullName}</p>
                                <p className="text-[10px] text-on-surface-variant truncate">{u.email}</p>
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                      <div className="px-4 py-2 border-t border-outline-variant/20 text-[10px] text-on-surface-variant/50 text-center">
                        {teamManagerUsers.filter(u => !u.teamId).length} utilisateur(s) disponible(s)
                      </div>
                    </div>

                    {/* ── Panneau droit : Équipes (zones de drop) ──────────── */}
                    <div className="flex-1 overflow-y-auto p-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {teamManagerTeams.map(team => {
                          const teamMembers = teamManagerUsers.filter(u => u.teamId === team.id);
                          const isDragOver = false; // géré par onDragOver/Leave
                          return (
                            <div
                              key={team.id}
                              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-emerald-500/40', 'bg-emerald-500/5'); }}
                              onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-emerald-500/40', 'bg-emerald-500/5'); }}
                              onDrop={async (e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove('ring-2', 'ring-emerald-500/40', 'bg-emerald-500/5');
                                const user = tmDragUser;
                                if (!user) return;
                                try {
                                  await api.post(`/teams/${team.id}/members`, { userId: user.id });
                                  toast.success(`${user.fullName} assigné à « ${team.name} »`);
                                  // Mettre à jour localement
                                  setTeamManagerUsers(prev => prev.map(u => u.id === user.id ? { ...u, teamId: team.id } : u));
                                  setTmDragUser(null);
                                  load();
                                } catch (err) {
                                  toast.error(err.response?.data?.error || "Erreur lors de l'assignation");
                                }
                              }}
                              className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest hover:border-outline-variant/50 transition-all overflow-hidden"
                            >
                              {/* Header équipe */}
                              <div className="px-4 py-3 border-b border-outline-variant/20 flex items-center gap-2">
                                <div className="p-1 rounded-md bg-blue-500/10"><Layers className="w-3.5 h-3.5 text-blue-500" /></div>
                                <span className="text-xs font-bold text-on-surface">{team.name}</span>
                                {team.category && <span className="text-[10px] text-on-surface-variant">· {team.category}</span>}
                                <span className="ml-auto text-[10px] font-semibold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-md">
                                  {teamMembers.length}
                                </span>
                              </div>
                              {/* Membres */}
                              <div className="p-2 min-h-[60px]">
                                {teamMembers.length === 0 ? (
                                  <p className="text-[10px] text-on-surface-variant/30 text-center py-3 italic">Glissez un utilisateur ici</p>
                                ) : (
                                  <div className="space-y-1">
                                    {teamMembers.map(u => (
                                      <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-outline-variant/20 group">
                                        <div className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-600 font-bold text-[9px] flex items-center justify-center shrink-0">
                                          {u.fullName?.charAt(0)?.toUpperCase()}
                                        </div>
                                        <span className="text-[11px] font-medium text-on-surface truncate flex-1">{u.fullName}</span>
                                        <button
                                          onClick={async () => {
                                            try {
                                              await api.delete(`/teams/${team.id}/members/${u.id}`);
                                              toast.success(`${u.fullName} retiré de « ${team.name} »`);
                                              setTeamManagerUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, teamId: null } : usr));
                                              load();
                                            } catch (err) {
                                              toast.error(err.response?.data?.error || 'Erreur');
                                            }
                                          }}
                                          className="p-1 rounded-md text-on-surface/20 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                          title="Retirer de l'équipe"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
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
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
}
