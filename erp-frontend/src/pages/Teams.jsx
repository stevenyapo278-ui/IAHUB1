import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';
import UserAvatar from '../components/UserAvatar';
import { useTheme } from '../context/ThemeContext';
import { Users, ShieldCheck, Ticket, Plus, RefreshCw, Trash2, X, AlertTriangle, Mail, Check, Layers, Save, ChevronDown, UserCheck } from 'lucide-react';
import RemoteUserMultiSelect from '../components/RemoteUserMultiSelect';
import PageShell from '../components/PageShell';
import KpiRow from '../components/KpiRow';
import FormDrawer from '../components/FormDrawer';

export default function Teams() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const canManageTeams = hasPermission(user, 'teams.manage');

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [convertingRequesters, setConvertingRequesters] = useState(false);

  // ── Basculer tous les demandeurs des équipes en techniciens ──
  async function handleConvertAllRequesters() {
    setConvertingRequesters(true);
    try {
      const { data } = await api.post('/teams/convert-all-requesters');
      toast.success(data.message || 'Demandeurs basculés en techniciens');
      load();
      if (detailModal) {
        const { data: updated } = await api.get(`/teams/${detailModal.id}`);
        setDetailModal(updated);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la conversion');
    } finally {
      setConvertingRequesters(false);
    }
  }

  // ── Basculer les demandeurs d'une équipe spécifique ──
  async function handleConvertTeamRequesters(teamId) {
    setConvertingRequesters(true);
    try {
      const { data } = await api.post(`/teams/${teamId}/convert-requesters`);
      toast.success(data.message || 'Demandeurs de l\'équipe basculés en techniciens');
      load();
      if (detailModal && detailModal.id === teamId) {
        const { data: updated } = await api.get(`/teams/${teamId}`);
        setDetailModal(updated);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la conversion');
    } finally {
      setConvertingRequesters(false);
    }
  }

  const [categories, setCategories] = useState([]);

  // ── Modal création ────────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', category: '', groupEmail: '' });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Modal détail/édition ──────────────────────────────────────────
  const [detailModal, setDetailModal] = useState(null); // null | team object loaded from API
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailDraft, setDetailDraft] = useState({ name: '', category: '', groupEmail: '', defaultObserverIds: [] });
  const [allUsers, setAllUsers] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState(null);

  function load() {
    api.get('/teams')
      .then(({ data }) => setTeams(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api.get('/categories')
      .then(({ data }) => {
        // Aplatir l'arbre : enfants reçoivent le chemin complet "Parent > Enfant"
        const flat = [];
        function walk(nodes, prefix) {
          for (const n of nodes) {
            const label = prefix ? `${prefix} > ${n.name}` : n.name;
            flat.push({ name: label });
            if (n.children?.length) walk(n.children, label);
          }
        }
        walk(data, '');
        setCategories(flat);
      })
      .catch(() => {});
  }, []);

  // ── Ouvrir le modal détail ────────────────────────────────────────
  async function openDetail(teamId) {
    setDetailModal(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/teams/${teamId}`);
      setDetailModal(data);
      setDetailDraft({
        name: data.name || '',
        category: data.category || '',
        groupEmail: data.groupEmail || '',
        defaultObserverIds: (data.defaultObservers || []).map((o) => o.id),
      });
    } catch (err) {
      setDetailError(err.response?.data?.error || "Erreur lors du chargement de l'équipe");
      toast.error(err.response?.data?.error || "Erreur lors du chargement");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailModal(null);
    setDetailDraft({ name: '', category: '', groupEmail: '', defaultObserverIds: [] });
    setDetailError('');
  }

  // ── Sauvegarder l'équipe (depuis le modal détail) ─────────────────
  async function saveDetail() {
    if (!detailModal) return;
    if (!detailDraft.name.trim()) { setDetailError('Le nom est requis'); return; }
    setDetailSaving(true);
    setDetailError('');
    try {
      const { data } = await api.patch(`/teams/${detailModal.id}`, {
        name: detailDraft.name.trim(),
        category: detailDraft.category.trim() || null,
        groupEmail: detailDraft.groupEmail.trim() || null,
        defaultObserverIds: detailDraft.defaultObserverIds,
      });
      setDetailModal(data);
      toast.success(`Équipe « ${data.name} » enregistrée`);
      load();
    } catch (err) {
      const msg = err.response?.data?.error || "Erreur lors de l'enregistrement";
      setDetailError(msg);
      toast.error(msg);
    } finally {
      setDetailSaving(false);
    }
  }

  // ── Charger les utilisateurs pour l'ajout de membres ─────────────
  useEffect(() => {
    if (detailModal) {
      api.get('/users?all=true')
        .then(({ data }) => {
          const list = Array.isArray(data) ? data : (data.users || []);
          setAllUsers(list.filter(u => u.isActive));
        })
        .catch(() => {});
    }
  }, [detailModal?.id]);

  // Utilisateurs non-membres de l'équipe actuelle
  const availableUsers = allUsers.filter(u => {
    const isMember = detailModal?.members?.some(m => m.id === u.id);
    if (isMember) return false;
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return [u.fullName, u.email].some(f => f?.toLowerCase().includes(q));
  });

  // ── Ajouter un membre ─────────────────────────────────────────────
  async function handleAddMember(userId) {
    if (!detailModal) return;
    setAddingMember(true);
    try {
      const { data } = await api.post(`/teams/${detailModal.id}/members`, { userId });
      toast.success(data.message || 'Membre ajouté');
      // Recharger l'équipe pour avoir la liste à jour
      const { data: updated } = await api.get(`/teams/${detailModal.id}`);
      setDetailModal(updated);
      setMemberSearch('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'ajout");
    } finally {
      setAddingMember(false);
    }
  }

  // ── Retirer un membre ─────────────────────────────────────────────
  async function handleRemoveMember(userId) {
    if (!detailModal) return;
    setRemovingMemberId(userId);
    try {
      const { data } = await api.delete(`/teams/${detailModal.id}/members/${userId}`);
      toast.success(data.message || 'Membre retiré');
      const { data: updated } = await api.get(`/teams/${detailModal.id}`);
      setDetailModal(updated);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du retrait');
    } finally {
      setRemovingMemberId(null);
    }
  }

  // ── Création ──────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const { data } = await api.post('/teams', createForm);
      toast.success(`Équipe « ${data.name} » créée`);
      setCreateForm({ name: '', category: '', groupEmail: '' });
      setShowCreateModal(false);
      load();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la création';
      setCreateError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  // ── Suppression ───────────────────────────────────────────────────
  function askDelete(id) { setConfirmDeleteId(id); }
  async function handleDelete() {
    if (!confirmDeleteId) return;
    const team = teams.find(t => t.id === confirmDeleteId);
    setDeleting(true);
    try {
      await api.delete(`/teams/${confirmDeleteId}`);
      toast.success(`Équipe « ${team?.name || ''} » supprimée`);
      load();
      setConfirmDeleteId(null);
      closeDetail();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la suppression';
      toast.error(msg);
      setError(msg);
    } finally {
      setDeleting(false);
    }
  }

  const totalMembers = useMemo(() => teams.reduce((sum, t) => sum + (t.members?.length || 0), 0), [teams]);
  const totalTickets = useMemo(() => teams.reduce((sum, t) => sum + (t._count?.tickets || 0), 0), [teams]);

  const kpiCards = useMemo(() => [
    { label: 'Total Équipes', value: teams.length, icon: Users, color: 'text-blue-400' },
    { label: 'Membres Actifs', value: totalMembers, icon: ShieldCheck, color: 'text-purple-400' },
    { label: 'Tickets Ouverts', value: totalTickets, icon: Ticket, color: 'text-emerald-400' },
  ], [teams.length, totalMembers, totalTickets]);

  return (
    <PageShell
      icon={Users}
      iconColor="text-blue-400"
      title="Équipes"
      subtitle={`${teams.length} équipes · ${totalMembers} membres · ${totalTickets} tickets ouverts`}
      actions={
        canManageTeams && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleConvertAllRequesters}
              disabled={convertingRequesters}
              className="btn-secondary"
              title="Basculer tous les membres demandeurs des équipes en techniciens"
            >
              <UserCheck className={`w-3.5 h-3.5 ${convertingRequesters ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Basculer demandeurs en techniciens</span>
            </button>
            <button
              onClick={() => { setShowCreateModal(true); setCreateError(''); }}
              className="btn-primary"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nouvelle équipe</span>
            </button>
          </div>
        )
      }
    >
      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
            <div className="px-4 py-2 bg-red-500/10 rounded-xl border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
              <button onClick={() => setError('')} className="ml-auto p-1 text-on-surface-variant hover:text-on-surface"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stats KPI ────────────────────────────────────────────────────── */}
      <KpiRow cards={kpiCards} />

      {/* ── Liste des équipes ──────────────────────────────────────────── */}
      <div className="pb-6">
        {loading ? (
          <div className="text-center py-12 text-on-surface/40">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            Chargement...
          </div>
        ) : teams.length === 0 ? (
          <div className="text-center py-12 text-on-surface/40">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            Aucune équipe. Créez-en une !
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Liste de toutes les équipes */}
            <div className="space-y-2 pt-2">
              <span className="field-label"><span>Toutes les équipes</span></span>
              {teams.sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
                <motion.div
                  key={t.id}
                  whileHover={{ x: 4 }}
                  onClick={() => openDetail(t.id)}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest hover:border-primary/40 transition-all cursor-pointer group shadow-sm"
                >
                  <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500 shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">{t.name}</p>
                    {t.category && <p className="text-[10px] text-on-surface-variant">{t.category}</p>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-on-surface-variant shrink-0">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> {t.members.length}
                    </span>
                    <span className="flex items-center gap-1">
                      <Ticket className="w-3.5 h-3.5" /> {t._count.tickets}
                    </span>
                  </div>
                  {canManageTeams && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); askDelete(t.id); }}
                        title="Supprimer"
                        className="p-1.5 rounded-lg text-on-surface/30 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── DRAWER DÉTAIL / ÉDITION ────────────────────────────────────────── */}
      <FormDrawer
        open={!!detailModal}
        onClose={closeDetail}
        title={detailModal?.name || 'Détail de l\'équipe'}
        subtitle={detailModal ? `${detailModal.members?.length || 0} membres · ${detailModal._count?.tickets || 0} tickets ouverts` : null}
        icon={Layers}
        iconColor="text-blue-400"
        size="lg"
        footer={
          canManageTeams && (
            <>
              <button onClick={closeDetail} className="btn-secondary">
                Annuler
              </button>
              <button onClick={saveDetail} disabled={detailSaving} className="btn-primary">
                {detailSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {detailSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </>
          )
        }
      >
        {detailLoading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-on-surface-variant text-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
            Chargement des détails...
          </div>
        ) : detailModal && (
          <div className="space-y-5">
            {detailError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs font-medium flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{detailError}
              </div>
            )}

            {/* Champs éditables */}
            {canManageTeams && (
              <div className="space-y-3">
                <label className="field-label">
                  <span>Nom de l'équipe *</span>
                  <input value={detailDraft.name} onChange={e => setDetailDraft({ ...detailDraft, name: e.target.value })}
                    className="input-katalyst" />
                </label>
                <label className="field-label">
                  <span>Catégorie</span>
                  <select value={detailDraft.category} onChange={e => setDetailDraft({ ...detailDraft, category: e.target.value })}
                    className="input-katalyst cursor-pointer">
                    <option value="">— Aucune catégorie —</option>
                    {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3 h-3" /> Email de groupe
                  </span>
                  <input type="email" value={detailDraft.groupEmail} onChange={e => setDetailDraft({ ...detailDraft, groupEmail: e.target.value })}
                    placeholder="support-equipe@domaine.ci"
                    className="input-katalyst font-mono" />
                </label>
              </div>
            )}

            {/* Membres */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="field-label mb-0">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-blue-500" />
                    Membres ({detailModal.members?.length || 0})
                  </span>
                </span>
                {canManageTeams && detailModal.members?.some(m => m.role === 'REQUESTER') && (
                  <button
                    type="button"
                    onClick={() => handleConvertTeamRequesters(detailModal.id)}
                    disabled={convertingRequesters}
                    className="text-xs text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Convertir les membres demandeurs de cette équipe en techniciens"
                  >
                    <UserCheck className={`w-3.5 h-3.5 ${convertingRequesters ? 'animate-spin' : ''}`} />
                    Basculer demandeurs en techniciens
                  </button>
                )}
              </div>

              {canManageTeams && (
                <div className="mb-3">
                  <input
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    placeholder="Ajouter un membre... (recherche par nom ou email)"
                    className="input-katalyst"
                  />
                  {memberSearch && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-lg">
                      {availableUsers.length === 0 ? (
                        <p className="px-3 py-2.5 text-[11px] text-on-surface-variant italic">Aucun utilisateur trouvé</p>
                      ) : (
                        availableUsers.slice(0, 10).map(u => (
                          <button
                            key={u.id}
                            onClick={() => handleAddMember(u.id)}
                            disabled={addingMember}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-container text-left transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <UserAvatar user={u} size="md" colorClass="bg-emerald-500/10 text-emerald-600" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-on-surface truncate">{u.fullName}</p>
                              <p className="text-[10px] text-on-surface-variant truncate">{u.email}</p>
                            </div>
                            <Plus className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {detailModal.members?.map(m => (
                  <div key={m.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-surface border border-outline-variant/30 group">
                    <UserAvatar user={m} size="md" colorClass="bg-blue-500/10 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-on-surface truncate">{m.fullName}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                          m.role === 'REQUESTER'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                            : m.role === 'TECHNICIAN'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                        }`}>
                          {m.role === 'REQUESTER' ? 'Demandeur' : m.role === 'TECHNICIAN' ? 'Technicien' : m.role}
                        </span>
                      </div>
                      <p className="text-[10px] text-on-surface-variant font-mono truncate">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                        m.activeTicketCount > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'
                      }`}>
                        {m.activeTicketCount || 0} ticket{(m.activeTicketCount || 0) > 1 ? 's' : ''}
                      </span>
                      {canManageTeams && (
                        <button
                          onClick={() => handleRemoveMember(m.id)}
                          disabled={removingMemberId === m.id}
                          title="Retirer de l'équipe"
                          className="p-1.5 rounded-lg text-on-surface/30 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer disabled:opacity-40"
                        >
                          {removingMemberId === m.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {detailModal.members?.length === 0 && (
                  <p className="text-xs text-on-surface-variant italic py-2">Aucun membre dans cette équipe.</p>
                )}
              </div>
            </div>

            {/* Observateurs par défaut */}
            <div className="pt-3 border-t border-outline-variant/20">
              <span className="field-label mb-2">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-500" />
                  Observateurs par défaut ({detailDraft.defaultObserverIds.length})
                </span>
              </span>
              <p className="text-[10px] text-on-surface-variant mb-2">
                Les observateurs reçoivent une notification quand un ticket est assigné à cette équipe.
              </p>
              <RemoteUserMultiSelect
                selectedIds={detailDraft.defaultObserverIds}
                onChange={(nextIds) => setDetailDraft({ ...detailDraft, defaultObserverIds: nextIds })}
                placeholder="Rechercher un observateur..."
                disabled={!canManageTeams}
              />
            </div>
          </div>
        )}
      </FormDrawer>

      {/* ── DRAWER CRÉATION ──────────────────────────────────────────────── */}
      <FormDrawer
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nouvelle équipe"
        icon={Users}
        iconColor="text-blue-400"
        size="md"
        footer={
          <>
            <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">
              Annuler
            </button>
            <button onClick={handleCreate} disabled={creating} className="btn-primary">
              {creating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Créer
            </button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {createError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs font-medium">{createError}</div>
          )}
          <label className="field-label">
            <span>Nom de l'équipe *</span>
            <input required value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="ex: Support Réseau"
              className="input-katalyst" />
          </label>
          <label className="field-label">
            <span>Catégorie</span>
            <select value={createForm.category} onChange={e => setCreateForm({ ...createForm, category: e.target.value })}
              className="input-katalyst cursor-pointer">
              <option value="">— Aucune catégorie —</option>
              {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span>Email de groupe</span>
            <input type="email" value={createForm.groupEmail} onChange={e => setCreateForm({ ...createForm, groupEmail: e.target.value })}
              placeholder="equipe@domaine.ci"
              className="input-katalyst font-mono" />
          </label>
        </form>
      </FormDrawer>

      <ConfirmDialog open={!!confirmDeleteId} title="Supprimer l'équipe"
        message="Supprimer définitivement cette équipe ? Cette action est irréversible."
        confirmLabel="Supprimer" danger loading={deleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />
    </PageShell>
  );
}
