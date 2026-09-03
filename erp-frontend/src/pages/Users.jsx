import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Users as UsersIcon, UserPlus, ShieldCheck, UserX,
  Trash2, Upload, Download, X, Search, CheckCircle2,
  RotateCcw, Edit2, AlertTriangle, Database,
  RefreshCw, Layers, Plus, Filter, ChevronLeft, ChevronRight,
} from 'lucide-react';

import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import Toggle from '../components/Toggle';
import { useAuth } from '../context/AuthContext';
import { useFilterParam } from '../hooks/useFilterParam';
import useSystemSettings from '../hooks/useSystemSettings';
import { hasPermission } from '../utils/permissions';
import DataGrid from '../components/DataGrid';

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

function ChevronsLeft({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" />
    </svg>
  );
}
function ChevronsRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 17 5-5-5-5" /><path d="m13 17 5-5-5-5" />
    </svg>
  );
}

function PaginationButtons({ page, totalPages, onPageChange }) {
  const [jumpValue, setJumpValue] = useState('');
  const jumpRef = useRef(null);

  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const result = [];
    result.push(1);
    if (page > 3) result.push('...');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) result.push(i);
    if (page < totalPages - 2) result.push('...');
    result.push(totalPages);
    return result;
  }, [page, totalPages]);

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onPageChange(Math.max(1, page - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onPageChange(Math.min(totalPages, page + 1)); }
    else if (e.key === 'Home') { e.preventDefault(); onPageChange(1); }
    else if (e.key === 'End') { e.preventDefault(); onPageChange(totalPages); }
  }

  function handleJump(e) {
    e.preventDefault();
    const val = parseInt(jumpValue, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages && val !== page) onPageChange(val);
    setJumpValue('');
    jumpRef.current?.blur();
  }

  const btnBase = 'h-10 min-w-[40px] flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95';
  const btnEnabled = 'text-muted-foreground hover:bg-surface-muted hover:text-foreground';
  const btnDisabled = 'text-muted-foreground/30 cursor-not-allowed';
  const btnActive = 'bg-primary text-primary-foreground shadow-sm shadow-primary/20';

  return (
    <div className="flex items-center gap-2" onKeyDown={handleKeyDown} role="navigation" aria-label="Pagination">
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="Première page" className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}>
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Page précédente" className={`${btnBase} px-1.5 ${page <= 1 ? btnDisabled : btnEnabled}`}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="w-8 h-10 flex items-center justify-center text-xs text-muted-foreground/40">…</span>
          ) : (
            <button key={p} onClick={() => onPageChange(p)} aria-label={`Page ${p}`} aria-current={p === page ? 'page' : undefined}
              className={`${btnBase} px-1 ${p === page ? btnActive : btnEnabled}`}>{p}</button>
          )
        )}
        <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} aria-label="Page suivante" className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}>
          <ChevronRight className="w-4 h-4" />
        </button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} aria-label="Dernière page" className={`${btnBase} px-1.5 ${page >= totalPages ? btnDisabled : btnEnabled}`}>
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={handleJump} className="flex items-center gap-1.5 ml-2">
        <span className="text-[11px] text-muted-foreground">→</span>
        <input ref={jumpRef} type="number" min={1} max={totalPages} value={jumpValue} onChange={(e) => setJumpValue(e.target.value)}
          placeholder={`1–${totalPages}`}
          className="w-16 h-8 px-2 text-[11px] text-center font-semibold bg-surface border border-border/40 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
      </form>
    </div>
  );
}

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

export default function Users() {
  const { user: currentUser } = useAuth();
  const { autonomousMode } = useSystemSettings();
  const canManage = hasPermission(currentUser, 'users.manage') || currentUser?.role === 'SUPERADMIN' || currentUser?.role === 'ADMIN';
  const ROLES = assignableRoles(currentUser?.role);

  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const s = localStorage.getItem('users_page_size');
    return s ? parseInt(s, 10) : 25;
  });
  const [totalPages, setTotalPages] = useState(1);

  const [searchQuery, setSearchQuery] = useFilterParam('search');
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter, setRoleFilter] = useFilterParam('role');
  const [teamFilter, setTeamFilter] = useFilterParam('teamId');
  const [statusFilter, setStatusFilter] = useFilterParam('status');
  const [showFilters, setShowFilters] = useState(false);

  const [selectedIds, setSelectedIds] = useState([]);
  const [assignGroupId, setAssignGroupId] = useState('');
  const [assignTeamId, setAssignTeamId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [editModal, setEditModal] = useState({ open: false, user: null });
  const [editForm, setEditForm] = useState({ fullName: '', email: '', role: 'REQUESTER', teamId: '', isActive: true });
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
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
  const [csvResult, setCsvResult] = useState(null);
  const [ldapSyncing, setLdapSyncing] = useState(false);

  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgePreview, setPurgePreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [purgeMode, setPurgeMode] = useState('smart');
  const [purging, setPurging] = useState(false);

  const [showTeamManager, setShowTeamManager] = useState(false);
  const [teamManagerTeams, setTeamManagerTeams] = useState([]);
  const [teamManagerUsers, setTeamManagerUsers] = useState([]);
  const [teamManagerLoading, setTeamManagerLoading] = useState(false);
  const [tmSearch, setTmSearch] = useState('');
  const [tmDragUser, setTmDragUser] = useState(null);

  const searchDebounceRef = useRef(null);
  const loadReqIdRef = useRef(0);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => { setSearchQuery(searchInput); setPage(1); }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchInput]);

  const load = useCallback(() => {
    const reqId = ++loadReqIdRef.current;
    const params = new URLSearchParams();
    params.set('page', page); params.set('limit', pageSize);
    if (searchQuery?.trim()) params.set('search', searchQuery.trim());
    if (roleFilter) params.set('role', roleFilter);
    if (teamFilter) params.set('teamId', teamFilter);
    if (statusFilter === 'active') params.set('isActive', 'true');
    else if (statusFilter === 'inactive') params.set('isActive', 'false');
    setLoading(true);
    Promise.all([api.get(`/users?${params}`), api.get('/teams'), api.get('/permission-groups')])
      .then(([uRes, tRes, gRes]) => {
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
      .catch(err => { if (reqId === loadReqIdRef.current) setError(err.response?.data?.error || 'Erreur de chargement'); })
      .finally(() => { if (reqId === loadReqIdRef.current) setLoading(false); });
  }, [page, pageSize, searchQuery, roleFilter, teamFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [searchQuery, roleFilter, teamFilter, statusFilter]);

  async function updateField(id, field, value) {
    try {
      await api.patch(`/users/${id}`, { [field]: value });
      load();
      if (field === 'role') {
        const target = users.find((u) => u.id === id);
        let groupNote = '';
        try {
          const { data: fresh } = await api.get(`/users/${id}`);
          const g = fresh?.permissionGroups?.[0];
          if (g) groupNote = ` — groupe « ${g.name} » aligné`;
        } catch { }
        toast.success(`Rôle de ${target?.fullName || "l'utilisateur"} changé pour « ${ROLE_CONFIG[value]?.label || value} » — effet immédiat${groupNote}`);
      } else if (field === 'isActive') {
        const target = users.find((u) => u.id === id);
        toast.success(`${target?.fullName || 'Utilisateur'} ${value ? 'réactivé' : 'désactivé'}`);
      }
    } catch (err) { setError(err.response?.data?.error || 'Erreur'); }
  }

  function startEdit(u) { setEditModal({ open: true, user: u }); setEditForm({ fullName: u.fullName, email: u.email, role: u.role, teamId: u.teamId || '', isActive: u.isActive }); }
  function closeEditModal() { setEditModal({ open: false, user: null }); setEditForm({ fullName: '', email: '', role: 'REQUESTER', teamId: '', isActive: true }); }
  async function saveEdit() {
    if (!editModal.user) return; setSavingEdit(true);
    try {
      const payload = { ...editForm, teamId: editForm.teamId ? Number(editForm.teamId) : null };
      await api.patch(`/users/${editModal.user.id}`, payload);
      toast.success(`${editModal.user.fullName} mis à jour`); closeEditModal(); load();
    }
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
    setShowPurgeModal(true); setLoadingPreview(true); setPurgePreview(null);
    try { const { data } = await api.get('/users/purge-preview'); setPurgePreview(data); }
    catch (err) { setError(err.response?.data?.error || "Erreur lors du calcul de l'aperçu"); }
    finally { setLoadingPreview(false); }
  }

  async function handlePurgeSmart() {
    setPurging(true);
    try { const { data } = await api.post('/users/purge-smart', { mode: purgeMode }); toast.success(data.message); setShowPurgeModal(false); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur lors de la purge'); }
    finally { setPurging(false); }
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

  async function handleLdapSync() {
    setLdapSyncing(true);
    try {
      const { data } = await api.post('/users/sync-ldap');
      const s = data.stats || {};
      const skipped = s.skipped ? `, ${s.skipped} ignoré(s)` : '';
      toast.success(`Annuaire synchronisé (${s.adTotal || 0} entrées AD) : ${s.created || 0} créé(s), ${s.updated || 0} mis à jour, ${s.deactivated || 0} désactivé(s), ${s.reactivated || 0} réactivé(s)${skipped}`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Échec de la synchronisation annuaire'); }
    finally { setLdapSyncing(false); }
  }

  const onSelectionChange = useCallback((ids) => { setSelectedIds(ids); }, []);

  const columns = useMemo(() => [
    {
      field: 'fullName',
      headerName: 'Utilisateur',
      flex: 1.5,
      minWidth: 220,
      valueGetter: (params) => params.data.fullName || '',
      cellRenderer: (params) => {
        const u = params.data;
        const roleCfg = ROLE_CONFIG[u.role] || ROLE_CONFIG.REQUESTER;
        return (
          <div className="flex items-center gap-2.5 h-full">
            <div className="relative shrink-0">
              <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-[11px] font-bold ${roleCfg.bg} ${roleCfg.color} ${roleCfg.border}`}>
                {initials(u.fullName)}
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-container-lowest ${u.isActive ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface truncate">{u.fullName}</p>
              <p className="text-[11px] text-on-surface-variant truncate font-mono">{u.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      field: 'role',
      headerName: 'Rôle',
      width: 140,
      cellRenderer: (params) => {
        const cfg = ROLE_CONFIG[params.value] || ROLE_CONFIG.REQUESTER;
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
            {cfg.label}
          </span>
        );
      },
    },
    {
      field: 'team',
      headerName: 'Équipe',
      width: 150,
      valueGetter: (params) => params.data.team?.name || '',
      cellRenderer: (params) => {
        const u = params.data;
        return (
          <select value={u.teamId || ''} onChange={e => { e.stopPropagation(); updateField(u.id, 'teamId', e.target.value ? Number(e.target.value) : null); }}
            onClick={e => e.stopPropagation()}
            className="w-full appearance-none bg-transparent border border-outline-variant/30 rounded-lg px-2 py-1 text-[11px] font-medium text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer truncate">
            <option value="">Sans équipe</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        );
      },
    },
    {
      field: 'isActive',
      headerName: 'Statut',
      width: 80,
      headerClass: 'text-center',
      valueGetter: (params) => params.data.isActive,
      cellRenderer: (params) => (
        <div className="flex justify-center w-full">
          <Toggle checked={params.value} onChange={val => { params.node.setDataValue('isActive', val); updateField(params.data.id, 'isActive', val); }}
            onClick={e => e.stopPropagation()} title={params.value ? 'Désactiver' : 'Activer'} />
        </div>
      ),
    },
    ...(currentUser?.role === 'SUPERADMIN' || currentUser?.role === 'ADMIN' ? [{
      field: 'receiveDraftAlerts',
      headerName: 'Alertes',
      width: 80,
      headerClass: 'text-center',
      valueGetter: (params) => params.data.receiveDraftAlerts,
      cellRenderer: (params) => {
        const u = params.data;
        if (u.role === 'REQUESTER') return <span className="text-outline/30 text-xs text-center w-full block">—</span>;
        return (
          <div className="flex justify-center w-full">
            <Toggle checked={params.value} onChange={val => { params.node.setDataValue('receiveDraftAlerts', val); updateField(u.id, 'receiveDraftAlerts', val); }}
              onClick={e => e.stopPropagation()} title="Alertes brouillons IA" />
          </div>
        );
      },
    }] : []),
  ], [teams, currentUser, updateField]);

  return (
    <div className="flex flex-col h-full w-full min-w-0 gap-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <UsersIcon className="w-4 h-4 text-blue-500 shrink-0" />
          <h1 className="text-sm font-bold text-on-surface whitespace-nowrap">Utilisateurs</h1>
          <span className="text-[11px] text-on-surface-variant font-medium tabular-nums">
            {total > 0 && `${total}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleLdapSync} disabled={ldapSyncing} title="Synchroniser l'annuaire AD"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50">
            {ldapSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Annuaire AD</span>
          </button>
          <button onClick={openPurgeModal} title="Purger les comptes"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/40 text-xs font-semibold text-red-500 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setError(''); setCsvFile(null); setCsvResult(null); setShowCsvImport(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high transition-colors">
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="Gérer les équipes par glisser-déposer">
            <UsersIcon className="w-3.5 h-3.5" />
          </button>
          {!autonomousMode && (
            <button onClick={async () => {
              setError(''); setImportResult(null);
              try { const { data } = await api.get('/glpi/importable-users'); setImportableUsers(data); setSelectedImportIds([]); setShowGlpiImport(true); }
              catch (err) { setError(err.response?.data?.error || 'Erreur GLPI'); }
            }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high transition-colors">
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">GLPI</span>
            </button>
          )}
          {canManage && (
            <button onClick={() => { setCreateModal(true); setError(''); setForm(emptyForm); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shadow-sm">
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nouveau</span>
            </button>
          )}
        </div>
      </div>

      {/* AD Sync overlay */}
      <AnimatePresence>
        {ldapSyncing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0.25 }}
              className="bg-surface-container-lowest border border-indigo-500/30 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 max-w-sm">
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-0">
            <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
              <button onClick={() => setError('')} className="ml-auto p-1 text-on-surface-variant hover:text-on-surface"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 sm:px-6 py-3 shrink-0">
        {[
          { label: 'Total', value: total, color: 'text-on-surface' },
          { label: 'Staff', value: staffCount, color: 'text-purple-600 dark:text-purple-400' },
          { label: 'Inactifs', value: inactiveCount, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Nouveaux ce mois', value: users.length, color: 'text-emerald-600 dark:text-emerald-400' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-container rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-on-surface-variant">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/30" />
          <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Rechercher par nom, email, équipe..." className={`${inputCls} w-full pl-9`} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 rounded-xl border text-sm font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
            showFilters || roleFilter || teamFilter || statusFilter
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high'
          }`}>
          <Filter className="w-4 h-4" />
          Filtres
        </button>
        <button onClick={load} className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-surface-container rounded-xl p-3 flex flex-wrap gap-3 items-center mx-4 sm:mx-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant font-medium">Rôle :</span>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={`${inputCls} py-1.5 text-xs pr-8`}>
              <option value="">Tous</option>
              {Object.entries(ROLE_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant font-medium">Équipe :</span>
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className={`${inputCls} py-1.5 text-xs pr-8`}>
              <option value="">Toutes</option>
              <option value="null">Sans équipe</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant font-medium">Statut :</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} py-1.5 text-xs pr-8`}>
              <option value="">Tous</option>
              <option value="active">Actifs</option>
              <option value="inactive">Inactifs</option>
            </select>
          </div>
          {(roleFilter || teamFilter || statusFilter) && (
            <button onClick={() => { setRoleFilter(''); setTeamFilter(''); setStatusFilter(''); }}
              className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
              <X className="w-3 h-3" /> Effacer
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-blue-500/20 bg-blue-500/5">
            <div className="px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />{selectedIds.length} sélectionné(s)
              </span>
              <div className="flex items-center gap-1.5">
                <select value={assignGroupId} onChange={e => setAssignGroupId(e.target.value)}
                  className="bg-surface border border-outline-variant/40 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="">Assigner groupe...</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button onClick={handleAssignToGroup} disabled={!assignGroupId || assigning}
                  className="px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-40">OK</button>
              </div>
              <div className="flex items-center gap-1.5">
                <select value={assignTeamId} onChange={e => setAssignTeamId(e.target.value)}
                  className="bg-surface border border-outline-variant/40 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="">Assigner équipe...</option>
                  <option value="none">Retirer l'équipe</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button onClick={handleAssignToTeam} disabled={!assignTeamId || assigning}
                  className="px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-40">OK</button>
              </div>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-xs font-semibold hover:bg-red-500/15 transition-all disabled:opacity-40 ml-auto">
                <Trash2 className="w-3 h-3" />Supprimer ({selectedIds.length})
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 min-h-0 relative overflow-auto">
        <div className="mx-4 sm:mx-6 lg:mx-8 mt-3.5 mb-4">
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
            <DataGrid
              columns={columns}
              rowData={users}
              loading={loading}
              onRowClick={(data) => canManage && startEdit(data)}
              pagination={false}
              rowSelection="multiple"
              selectedIds={selectedIds}
              onSelectionChange={onSelectionChange}
              noRowsText="Aucun utilisateur trouvé."
              className="rounded-2xl overflow-hidden"
              height="calc(100vh - 380px)"
            />
          </div>
        </div>
      </div>

      {/* ── PAGINATION ── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-border/20 bg-surface shrink-0">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium tabular-nums">
            {total > 0
              ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} sur ${total.toLocaleString('fr-FR')}`
              : '0 résultat'}
          </span>
          <div className="w-px h-3.5 bg-border/40" />
          <select value={pageSize}
            onChange={(e) => { const v = Number(e.target.value); setPageSize(v); localStorage.setItem('users_page_size', String(v)); setPage(1); }}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-border/40 bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
        <PaginationButtons page={page} totalPages={Math.max(totalPages, 1)} onPageChange={setPage} />
      </div>

      {/* ── Modals ── */}

      {/* Modal Création */}
      {createPortal(
        <AnimatePresence>
          {createModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!submitting) setCreateModal(false); }} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="relative w-full max-w-md bg-surface border border-outline-variant/40 rounded-3xl shadow-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-blue-500/10"><UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                  <h3 className="text-sm font-bold text-on-surface">Nouveau compte</h3>
                  <motion.button onClick={() => { if (!submitting) setCreateModal(false); }} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
                <form onSubmit={handleCreate} className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 gap-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom complet *</span>
                      <input required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })}
                        placeholder="Nom complet" className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email *</span>
                      <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                        placeholder="email@exemple.ci" className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mot de passe *</span>
                      <input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                        placeholder="••••••••" className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
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
                      className="px-4 py-2 rounded-xl border border-outline-variant/40 text-sm font-medium hover:bg-surface-container-high transition-colors disabled:opacity-50">Annuler</button>
                    <button type="submit" disabled={submitting}
                      className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold hover:opacity-90 disabled:opacity-50 flex items-center gap-2 shadow-sm">
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

      {/* Modal Édition */}
      {createPortal(
        <AnimatePresence>
          {editModal.open && editModal.user && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeEditModal} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="relative w-full max-w-md bg-surface border border-outline-variant/40 rounded-3xl shadow-2xl overflow-hidden">
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
                      placeholder="Nom complet" className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email</span>
                    <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                      placeholder="email@exemple.ci" className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Rôle</span>
                      <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                        className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer">
                        {Array.from(new Set([...ROLES, editForm.role])).map(r => (
                          <option key={r} value={r}>{ROLE_CONFIG[r]?.label || r}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Équipe</span>
                      <select value={editForm.teamId} onChange={e => setEditForm({ ...editForm, teamId: e.target.value })}
                        className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer">
                        <option value="">Sans équipe</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="flex items-center justify-between gap-3 py-2">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Actif</span>
                    <Toggle checked={editForm.isActive} onChange={val => setEditForm({ ...editForm, isActive: val })} />
                  </label>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/30 bg-surface-container-low/40">
                  <button onClick={closeEditModal} className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors">Annuler</button>
                  <button onClick={saveEdit} disabled={savingEdit || !editForm.fullName.trim() || !editForm.email.trim()}
                    className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md disabled:opacity-50 flex items-center gap-2 transition-all hover:opacity-90">
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

      <ConfirmDialog open={!!confirmDeleteId} title="Supprimer l'utilisateur"
        message="Supprimer définitivement cet utilisateur ? Cette action est irréversible."
        confirmLabel="Supprimer" danger loading={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />
      <ConfirmDialog open={!!confirmResetId} title="Réinitialiser le mot de passe"
        message="Un nouveau mot de passe temporaire sera généré et envoyé par email."
        confirmLabel="Réinitialiser" loading={resetting} onConfirm={handleResetPassword} onCancel={() => setConfirmResetId(null)} />

      {/* Modal GLPI Import */}
      {createPortal(
        <AnimatePresence>
          {showGlpiImport && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!importing) setShowGlpiImport(false); }} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface border border-outline-variant/40 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
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
                        <button onClick={() => { setShowGlpiImport(false); load(); }} className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold">Terminé</button>
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
                          }} className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-md">
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

      {/* Modal CSV Import */}
      {createPortal(
        <AnimatePresence>
          {showCsvImport && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!csvImporting) setShowCsvImport(false); }} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface border border-outline-variant/40 rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
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
                      <div className="flex justify-end">
                        <button onClick={() => { setShowCsvImport(false); load(); }} className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold">Terminé</button>
                      </div>
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
                          className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-md">
                          {csvImporting && <RotateCcw className="w-3.5 h-3.5 animate-spin" />}
                          {csvImporting ? 'Importation...' : "Lancer l'import"}
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

      {/* Modal Purge */}
      {createPortal(
        <AnimatePresence>
          {showPurgeModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!purging) setShowPurgeModal(false); }} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface border border-outline-variant/40 rounded-3xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-outline-variant/30 bg-surface-container-low/40">
                  <div className="p-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20"><Trash2 className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-base font-extrabold text-on-surface">Purge & Nettoyage Intelligent des Comptes</h3>
                    <p className="text-[11px] text-on-surface-variant font-medium">Analyse d'impact automatisée pour préserver l'historique ITSM</p>
                  </div>
                  <motion.button onClick={() => { if (!purging) setShowPurgeModal(false); }} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer">
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
                <div className="p-6 overflow-y-auto flex-1 space-y-5">
                  {loadingPreview ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-3">
                      <RotateCcw className="w-8 h-8 text-primary animate-spin" />
                      <p className="text-xs font-semibold text-on-surface-variant">Analyse d'impact de la base d'utilisateurs en cours...</p>
                    </div>
                  ) : purgePreview ? (
                    <>
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
                      <div className="space-y-2.5">
                        <label className="text-xs font-bold text-on-surface uppercase tracking-wider block">Stratégie de Nettoyage :</label>
                        {[
                          { id: 'smart', title: '🛡️ Nettoyage Intelligent (Recommandé)', desc: `Supprime les ${purgePreview.deletableOrphansCount} comptes orphelins sans tickets et désactive les ${purgePreview.inactivesWithTicketsCount} comptes inactifs.`, badge: 'Zéro risque', color: 'emerald' },
                          { id: 'deletable_only', title: '🗑️ Supprimer les orphelins uniquement', desc: `Supprime uniquement les ${purgePreview.deletableOrphansCount} comptes n'ayant aucun ticket associé.`, badge: 'Conservation', color: 'blue' },
                          { id: 'deactivate_only', title: '💤 Désactiver les comptes inactifs', desc: 'Désactive les comptes sans supprimer aucune donnée.', badge: 'Sécurité', color: 'amber' },
                          { id: 'full_force', title: '⚠️ Purge intégrale forcée', desc: `Supprime TOUS les ${purgePreview.totalNonAdmin} comptes non-admin (les tickets historiques seront déliés).`, badge: 'Action lourde', color: 'red' },
                        ].map((mode) => (
                          <div key={mode.id} onClick={() => setPurgeMode(mode.id)}
                            className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                              purgeMode === mode.id ? 'bg-primary/10 border-primary shadow-sm' : 'bg-surface border-outline-variant/30 hover:border-outline-variant/60'
                            }`}>
                            <input type="radio" name="purgeMode" checked={purgeMode === mode.id} onChange={() => setPurgeMode(mode.id)} className="accent-primary mt-0.5 cursor-pointer" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold text-on-surface">{mode.title}</h4>
                                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">{mode.badge}</span>
                              </div>
                              <p className="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed">{mode.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-outline-variant/30 bg-surface-container-low/40">
                  <button onClick={() => setShowPurgeModal(false)} disabled={purging}
                    className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors disabled:opacity-50 cursor-pointer">Annuler</button>
                  <button onClick={handlePurgeSmart} disabled={purging || loadingPreview}
                    className="px-5 py-2 rounded-xl bg-red-500 text-white text-xs font-bold shadow-md disabled:opacity-50 flex items-center gap-2 transition-all cursor-pointer hover:opacity-90">
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

      {/* Modal Team Manager */}
      {createPortal(
        <AnimatePresence>
          {showTeamManager && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowTeamManager(false)} className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface border border-outline-variant/40 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10"><UsersIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Gérer les équipes</h3>
                    <p className="text-[10px] text-on-surface-variant">Glissez les utilisateurs dans une équipe</p>
                  </div>
                  <motion.button onClick={() => setShowTeamManager(false)} whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></motion.button>
                </div>
                {teamManagerLoading ? (
                  <div className="flex items-center justify-center py-16 gap-2 text-on-surface-variant text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />Chargement...
                  </div>
                ) : (
                  <div className="flex flex-1 min-h-0 overflow-hidden">
                    <div className="w-[320px] shrink-0 border-r border-outline-variant/30 flex flex-col">
                      <div className="px-4 py-3 border-b border-outline-variant/20">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/40" />
                          <input value={tmSearch} onChange={e => setTmSearch(e.target.value)} placeholder="Recherche (séparez par des virgules)"
                            className="w-full pl-9 pr-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
                        </div>
                        {tmSearch.includes(',') && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {tmSearch.split(',').map((term, i) => term.trim() && (
                              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                                {term.trim()}
                                <button onClick={() => { const parts = tmSearch.split(',').filter((_, idx) => idx !== i); setTmSearch(parts.join(', ')); }}
                                  className="hover:text-red-500 transition-colors"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {(() => {
                          const terms = tmSearch.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                          const filtered = teamManagerUsers.filter(u => {
                            if (u.teamId) return false;
                            if (terms.length === 0) return true;
                            return terms.some(q => u.fullName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
                          });
                          if (filtered.length === 0) return (
                            <div className="text-center py-8 text-on-surface-variant/50">
                              <UserX className="w-8 h-8 mx-auto mb-2 opacity-30" />
                              <p className="text-[11px] italic">Aucun utilisateur sans équipe</p>
                            </div>
                          );
                          return filtered.map(u => (
                            <div key={u.id} draggable onDragStart={() => setTmDragUser(u)} onDragEnd={() => setTmDragUser(null)}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
                                tmDragUser?.id === u.id ? 'border-emerald-500/40 bg-emerald-500/10 shadow-md scale-[1.02]' : 'border-outline-variant/20 bg-surface hover:border-outline-variant/40 hover:bg-surface-container-low'
                              }`}>
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
                    <div className="flex-1 overflow-y-auto p-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {teamManagerTeams.map(team => {
                          const teamMembers = teamManagerUsers.filter(u => u.teamId === team.id);
                          return (
                            <div key={team.id}
                              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-emerald-500/40', 'bg-emerald-500/5'); }}
                              onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-emerald-500/40', 'bg-emerald-500/5'); }}
                              onDrop={async (e) => {
                                e.preventDefault(); e.currentTarget.classList.remove('ring-2', 'ring-emerald-500/40', 'bg-emerald-500/5');
                                const user = tmDragUser; if (!user) return;
                                try {
                                  await api.post(`/teams/${team.id}/members`, { userId: user.id });
                                  toast.success(`${user.fullName} assigné à « ${team.name} »`);
                                  setTeamManagerUsers(prev => prev.map(u => u.id === user.id ? { ...u, teamId: team.id } : u));
                                  setTmDragUser(null); load();
                                } catch (err) { toast.error(err.response?.data?.error || "Erreur lors de l'assignation"); }
                              }}
                              className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest hover-interactive transition-all overflow-hidden">
                              <div className="px-4 py-3 border-b border-outline-variant/20 flex items-center gap-2">
                                <div className="p-1 rounded-md bg-blue-500/10"><Layers className="w-3.5 h-3.5 text-blue-500" /></div>
                                <span className="text-xs font-bold text-on-surface">{team.name}</span>
                                {team.category && <span className="text-[10px] text-on-surface-variant">· {team.category}</span>}
                                <span className="ml-auto text-[10px] font-semibold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-md">{teamMembers.length}</span>
                              </div>
                              <div className="p-2 min-h-[60px]">
                                {teamMembers.length === 0 ? (
                                  <p className="text-[10px] text-on-surface-variant/30 text-center py-3 italic">Glissez un utilisateur ici</p>
                                ) : (
                                  <div className="space-y-1">
                                    {teamMembers.map(u => (
                                      <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-outline-variant/20 group">
                                        <div className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-600 font-bold text-[9px] flex items-center justify-center shrink-0">{u.fullName?.charAt(0)?.toUpperCase()}</div>
                                        <span className="text-[11px] font-medium text-on-surface truncate flex-1">{u.fullName}</span>
                                        <button onClick={async () => {
                                          try { await api.delete(`/teams/${team.id}/members/${u.id}`); toast.success(`${u.fullName} retiré de « ${team.name} »`); setTeamManagerUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, teamId: null } : usr)); load(); }
                                          catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
                                        }} className="p-1 rounded-md text-on-surface/20 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer" title="Retirer de l'équipe">
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
