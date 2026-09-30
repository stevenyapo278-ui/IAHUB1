import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, Clock, CheckCircle2, Radio, User, Users, Tag,
  Link2, Plus, X, RefreshCw, Send, Eye, Calendar, Flame, Info, ArrowDown,
  Sparkles, Pencil, Trash2, LinkIcon, Unlink, Search, Loader2, Paperclip,
  ChevronDown, FileText,
} from 'lucide-react';
import api from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useAuth } from '../context/AuthContext';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import ActivityStream, { buildTimeline } from '../components/ActivityStream';
import ImageAttachmentsEditor from '../components/ImageAttachmentsEditor';
import RemoteUserMultiSelect from '../components/RemoteUserMultiSelect';
import { clipboardImageFiles, imageItemsFromFiles, revokeImageItems } from '../utils/imageAttachments';
import { sanitizeHtml } from '../utils/sanitize';

const STATUS_OPTIONS = ['NEW', 'IN_PROGRESS', 'ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED', 'OBSERVED'];
const STATUS_LABELS = {
  NEW: 'Nouveau', IN_PROGRESS: 'En cours', ASSIGNED: 'Attribué', PLANNED: 'Planifié',
  WAITING: 'En attente', SOLVED: 'Résolu', CLOSED: 'Fermé', OBSERVED: 'Observé',
};
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
const PRIORITY_LABELS = { P1: 'Critique', P2: 'Haute', P3: 'Moyenne', P4: 'Basse' };
const URGENCY_IMPACT_OPTIONS = [
  { value: 'VERY_LOW', label: 'Très basse' }, { value: 'LOW', label: 'Basse' },
  { value: 'MEDIUM', label: 'Moyenne' }, { value: 'HIGH', label: 'Haute' },
  { value: 'VERY_HIGH', label: 'Très haute' }, { value: 'MAJOR', label: 'Majeure' },
];

const STATUS_CONFIG = {
  NEW: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25', Icon: Sparkles },
  IN_PROGRESS: { bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/25', Icon: Radio },
  ASSIGNED: { bg: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border border-purple-200 dark:border-purple-500/25', Icon: User },
  PLANNED: { bg: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400 border border-violet-200 dark:border-violet-500/25', Icon: Calendar },
  WAITING: { bg: 'bg-amber-50 text-amber-800 dark:bg-yellow-500/15 dark:text-yellow-400 border border-amber-300 dark:border-yellow-500/25', Icon: Clock },
  SOLVED: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25', Icon: CheckCircle2 },
  CLOSED: { bg: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400 border border-slate-300 dark:border-slate-500/25', Icon: Clock },
  OBSERVED: { bg: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/25', Icon: Eye },
};

const PRIORITY_CONFIG = {
  P1: { label: 'P1', bg: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border border-red-200 dark:border-red-500/25', Icon: Flame },
  P2: { label: 'P2', bg: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25', Icon: AlertTriangle },
  P3: { label: 'P3', bg: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/25', Icon: Info },
  P4: { label: 'P4', bg: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25', Icon: ArrowDown },
};

const inputCls = 'px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';
const miniSelectCls = 'px-2 py-1 rounded-lg border border-outline-variant/60 bg-surface text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer';

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg}`}>
      <Icon className="w-3 h-3" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// Badge de statut devenu sélecteur : un seul clic pour changer d'état,
// sans le volet « Actions rapides » qui occupait tout le tiers droit.
function StatusSelect({ status, onChange }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  const Icon = cfg.Icon;
  return (
    <span className={`relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg}`}>
      <Icon className="w-3 h-3" />
      {STATUS_LABELS[status] || status}
      <ChevronDown className="w-3 h-3 -mr-1 pointer-events-none" />
      <select
        value={status}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Changer le statut"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </select>
    </span>
  );
}

function PriorityBadge({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.P3;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg}`}>
      <Icon className="w-3 h-3" />
      {cfg.label} — {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

export default function ProblemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const settings = useSystemSettings();
  const canManage = hasPermission(user, 'tickets.manage', settings);

  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [newFollowup, setNewFollowup] = useState('');
  const [sendingFollowup, setSendingFollowup] = useState(false);
  const [pastedImages, setPastedImages] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  // Édition d'un suivi existant (miroir du comportement de TicketDetail)
  const [editingFollowupId, setEditingFollowupId] = useState(null);
  const [editingFollowupContent, setEditingFollowupContent] = useState('');
  const [savingFollowupEdit, setSavingFollowupEdit] = useState(false);

  // Libère les aperçus blob:// du composeur au démontage
  const pastedImagesRef = useRef(pastedImages);
  useEffect(() => { pastedImagesRef.current = pastedImages; }, [pastedImages]);
  useEffect(() => () => revokeImageItems(pastedImagesRef.current), []);

  const loadProblem = useCallback(() => {
    setLoading(true);
    api.get(`/problems/${id}`)
      .then(({ data }) => { setProblem(data); setEditForm(data); })
      .catch(() => { toast.error('Problème introuvable'); navigate('/problems'); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => { loadProblem(); }, [loadProblem]);

  // Catégories proposées à l'édition (même source que la création de problème)
  useEffect(() => {
    api.get('/categories')
      .then(({ data }) => setCategories(Array.isArray(data) ? data : data.categories || []))
      .catch(() => {});
  }, []);

  // Équipes + techniciens pour l'assignation. /users est réservé aux admins :
  // en cas d'échec, les membres des équipes (GET /teams, ouvert) servent de repli.
  useEffect(() => {
    api.get('/teams').then(({ data }) => setTeams(Array.isArray(data) ? data : [])).catch(() => {});
    if (canManage) {
      api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : data.users || [])).catch(() => {});
    }
  }, [canManage]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch(`/problems/${id}`, editForm);
      toast.success('Problème mis à jour');
      setEditMode(false);
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur mise à jour');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus) {
    try {
      await api.patch(`/problems/${id}`, { status: newStatus });
      toast.success(`Statut changé : ${STATUS_LABELS[newStatus]}`);
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  }

  // Assignation directe depuis l'en-tête (assigné à / équipe) — PATCH immédiat.
  async function handleAssign(field, value) {
    try {
      await api.patch(`/problems/${id}`, { [field]: value });
      toast.success(field === 'teamId' ? 'Équipe mise à jour' : 'Assignation mise à jour');
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  }

  // ── Édition d'un suivi (auteur ou ADMIN/SUPERADMIN, côté serveur) ────
  function startEditFollowup(f) {
    setEditingFollowupId(f.id);
    // Le contenu peut contenir des images inline : on les conserve telles quelles,
    // l'éditeur texte garde tout le HTML et le serveur re-sanitize à l'enregistrement.
    setEditingFollowupContent(f.content || '');
  }

  function cancelEditFollowup() {
    setEditingFollowupId(null);
    setEditingFollowupContent('');
  }

  async function saveEditFollowup(followupId) {
    const text = editingFollowupContent.trim();
    if (!text) return;
    setSavingFollowupEdit(true);
    try {
      await api.patch(`/problems/${id}/followups/${followupId}`, { content: text });
      toast.success('Commentaire modifié');
      setEditingFollowupId(null);
      setEditingFollowupContent('');
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification du commentaire');
    } finally {
      setSavingFollowupEdit(false);
    }
  }

  async function handleDeleteFollowup(followupId) {
    try {
      await api.delete(`/problems/${id}/followups/${followupId}`);
      toast.success('Commentaire supprimé');
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  async function handleAddFollowup() {
    if (!newFollowup.trim() && pastedImages.length === 0) return;
    setSendingFollowup(true);
    try {
      // Multipart dès qu'une image est jointe ; JSON reste accepté sinon
      const fd = new FormData();
      let content = newFollowup.trim();
      pastedImages.forEach((img, idx) => {
        fd.append('images', img.file);
        content += `${content ? '\n\n' : ''}<!--IMAGE_${idx}-->`;
      });
      fd.append('content', content);
      await api.post(`/problems/${id}/followups`, fd);
      toast.success('Commentaire ajouté');
      setNewFollowup('');
      revokeImageItems(pastedImages);
      setPastedImages([]);
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSendingFollowup(false);
    }
  }

  // Images du commentaire : collage (Ctrl+V), bouton ou glisser-déposer
  function addCommentImages(files) {
    const items = imageItemsFromFiles(files, 'problem');
    if (items.length === 0) return;
    setPastedImages((prev) => [...prev, ...items]);
    toast.success(
      items.length > 1
        ? `${items.length} images ajoutées — elles partiront avec le commentaire`
        : 'Image ajoutée — elle partira avec le commentaire',
    );
  }

  function handlePasteImages(e) {
    const files = clipboardImageFiles(e);
    if (files.length === 0) return;
    e.preventDefault();
    addCommentImages(files);
  }

  // Pièces jointes du problème (section Description)
  async function handleUploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingFiles(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      await api.post(`/problems/${id}/attachments`, fd);
      toast.success(files.length > 1 ? `${files.length} fichiers ajoutés` : 'Pièce jointe ajoutée');
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'envoi");
    } finally {
      setUploadingFiles(false);
    }
  }

  async function handleDeleteAttachment(attachmentId) {
    try {
      await api.delete(`/problems/${id}/attachments/${attachmentId}`);
      toast.success('Pièce jointe supprimée');
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleDelete() {
    try {
      await api.delete(`/problems/${id}`);
      toast.success('Problème supprimé');
      navigate('/problems');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur suppression');
    }
  }

  async function handleUnlinkTicket(ticketId) {
    try {
      await api.delete(`/problems/${id}/unlink-ticket/${ticketId}`);
      toast.success('Ticket détaché');
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  }

  // Historique fusionné (commentaires + journal d'événements), trié une seule fois.
  const historyItems = useMemo(
    () => buildTimeline({ followups: problem?.followups, events: problem?.events }),
    [problem]
  );

  // Catégories de l'API + valeur courante si elle a été retirée de la liste
  // (catégorie GLPI importée, renommée…) : elle reste sélectionnable/affichable.
  const categoryOptions = useMemo(() => {
    const opts = categories.map((c) => ({ value: c.name, label: c.name }));
    const current = editForm.category || problem?.category;
    if (current && !opts.some((o) => o.value === current)) opts.unshift({ value: current, label: current });
    return opts;
  }, [categories, editForm.category, problem?.category]);

  // Techniciens assignables : liste /users si dispo, sinon membres des équipes.
  const assigneeOptions = useMemo(() => {
    const byId = new Map();
    [...users, ...teams.flatMap((t) => t.members || [])]
      .filter((u) => u && u.role !== 'REQUESTER')
      .forEach((u) => byId.set(u.id, u));
    const opts = [...byId.values()]
      .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'fr'))
      .map((u) => ({ value: u.id, label: u.fullName }));
    const current = problem?.assignedTo;
    if (current && !opts.some((o) => o.value === current.id)) {
      opts.unshift({ value: current.id, label: current.fullName });
    }
    return opts;
  }, [users, teams, problem?.assignedTo]);

  const teamOptions = useMemo(() => {
    const opts = teams.map((t) => ({ value: t.id, label: t.name }));
    const current = problem?.team;
    if (current && !opts.some((o) => o.value === current.id)) {
      opts.unshift({ value: current.id, label: current.name });
    }
    return opts;
  }, [teams, problem?.team]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-on-surface-variant" />
      </div>
    );
  }

  if (!problem) return null;

  const linkedTickets = problem.tickets?.map((pt) => pt.ticket) || [];

  return (
    <div className="max-w-5xl mx-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate('/problems')}
            className="mt-1 p-2 rounded-xl hover:bg-surface-container-high cursor-pointer transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              {canManage ? (
                <StatusSelect status={problem.status} onChange={handleStatusChange} />
              ) : (
                <StatusBadge status={problem.status} />
              )}
              <PriorityBadge priority={problem.priority} />
              {problem.category && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-container text-on-surface-variant">
                  <Tag className="w-3 h-3" /> {problem.category}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-on-surface mt-2">{problem.title}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="text-sm text-on-surface-variant">
                Créé le {new Date(problem.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
              {canManage ? (
                <>
                  <div className="min-w-[220px]">
                    <RemoteUserMultiSelect
                      value={(problem.assignees && problem.assignees.length > 0)
                        ? problem.assignees.map((a) => a.id)
                        : (problem.assignedToId ? [problem.assignedToId] : [])}
                      onChange={async (vals, selectedUsers) => {
                        try {
                          // Auto-équipe : la première personne porte son équipe si aucune n'est définie
                          const firstUser = selectedUsers && selectedUsers[0];
                          const autoTeamId = firstUser ? (firstUser.teamId || firstUser.team?.id) : null;
                          const payload = { assigneeIds: vals };
                          if (autoTeamId && !problem.teamId) payload.teamId = autoTeamId;
                          await api.patch(`/problems/${id}`, payload);
                          toast.success('Assignés mis à jour');
                          loadProblem();
                        } catch (err) {
                          toast.error(err.response?.data?.error || 'Échec de la mise à jour');
                        }
                      }}
                      teamId={problem.teamId || null}
                      onlyStaff
                      placeholder="Rechercher des techniciens..."
                    />
                  </div>
                  <select aria-label="Équipe" value={problem.teamId || ''}
                    onChange={(e) => handleAssign('teamId', e.target.value ? Number(e.target.value) : null)}
                    className={miniSelectCls}>
                    <option value="">Aucune équipe</option>
                    {teamOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </>
              ) : (
                <>
                  {problem.assignedTo && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-surface-container text-on-surface-variant">
                      <User className="w-3 h-3" /> {problem.assignedTo.fullName}
                    </span>
                  )}
                  {problem.team && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-surface-container text-on-surface-variant">
                      <Users className="w-3 h-3" /> {problem.team.name}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditMode(!editMode)}
              className="px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:bg-surface-container-high">
              <Pencil className="w-3.5 h-3.5" />
              {editMode ? 'Annuler' : 'Modifier'}
            </button>
            <button onClick={() => setShowDeleteConfirm(true)}
              className="p-2 rounded-xl border border-red-300/60 text-red-500 cursor-pointer hover:bg-red-50 dark:hover:bg-red-500/10">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Edit form or display */}
      {editMode ? (
        <div className="bg-surface-container rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Titre</label>
            <input value={editForm.title || ''} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Description</label>
            <textarea value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows={5} className={`${inputCls} w-full resize-none`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Statut</label>
              <select value={editForm.status || ''} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className={`${inputCls} w-full text-xs`}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Priorité</label>
              <select value={editForm.priority || ''} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                className={`${inputCls} w-full text-xs`}>
                {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Urgence</label>
              <select value={editForm.urgency || ''} onChange={(e) => setEditForm({ ...editForm, urgency: e.target.value })}
                className={`${inputCls} w-full text-xs`}>
                {URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Impact</label>
              <select value={editForm.impact || ''} onChange={(e) => setEditForm({ ...editForm, impact: e.target.value })}
                className={`${inputCls} w-full text-xs`}>
                {URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Catégorie</label>
            <select value={editForm.category || ''} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
              className={`${inputCls} w-full text-xs`}>
              <option value="">Aucune</option>
              {categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditMode(false)}
              className="px-4 py-2 rounded-xl border border-outline-variant/60 text-sm font-medium cursor-pointer hover:bg-surface-container-high">
              Annuler
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold cursor-pointer hover:opacity-90 disabled:opacity-50">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin inline" /> : 'Enregistrer'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-surface-container rounded-xl p-4">
          <h3 className="text-sm font-semibold text-on-surface mb-2">Description</h3>
          <p className="text-sm text-on-surface-variant whitespace-pre-wrap">{problem.description}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-on-surface-variant">
            <span>Urgence: <strong>{URGENCY_IMPACT_OPTIONS.find((o) => o.value === problem.urgency)?.label || problem.urgency}</strong></span>
            <span>Impact: <strong>{URGENCY_IMPACT_OPTIONS.find((o) => o.value === problem.impact)?.label || problem.impact}</strong></span>
            {problem.requester && <span>Demandeur: <strong>{problem.requester.fullName}</strong></span>}
            {problem.locationName && <span>Lieu: <strong>{problem.locationName}</strong></span>}
          </div>

          {/* Pièces jointes : captures / fichiers uploadés */}
          <div className="mt-4 pt-3 border-t border-outline-variant/30">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                Pièces jointes ({problem.attachments?.length || 0})
              </h4>
              {canManage && (
                <label className={`px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:bg-primary/20 ${uploadingFiles ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadingFiles ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Joindre
                  <input type="file" multiple hidden disabled={uploadingFiles}
                    onChange={(e) => { handleUploadFiles(e.target.files); e.target.value = ''; }} />
                </label>
              )}
            </div>
            {(problem.attachments?.length || 0) === 0 ? (
              <p className="text-xs text-on-surface-variant italic">Aucune pièce jointe.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {problem.attachments.map((att) => {
                  const url = att.localFilepath
                    ? `/${att.localFilepath.replace(/^\/+/, '').replace(/\\/g, '/')}`
                    : `/problems/${problem.id}/attachments/${att.id}/file`;
                  const isImage = (att.mimeType || '').startsWith('image/');
                  return (
                    <div key={att.id} className="relative group/att">
                      <a href={url} target="_blank" rel="noreferrer"
                        className={`block ${isImage ? '' : 'px-3 py-2 rounded-lg border border-outline-variant/40 bg-surface-container-high flex items-center gap-1.5'}`}>
                        {isImage ? (
                          <img src={url} alt={att.filename}
                            className="h-16 w-16 object-cover rounded-lg border border-outline-variant/40 bg-surface" />
                        ) : (
                          <>
                            <FileText className="w-3.5 h-3.5 text-primary" />
                            <span className="text-[11px] font-medium text-on-surface max-w-[140px] truncate">{att.filename}</span>
                          </>
                        )}
                      </a>
                      {canManage && (
                        <button onClick={() => handleDeleteAttachment(att.id)} title="Supprimer"
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md opacity-0 group-hover/att:opacity-100 hover:scale-110 transition-all cursor-pointer">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contenu pleine largeur : le volet « Actions rapides » a cédé la place
          au sélecteur de statut de l'en-tête */}
      <div className="space-y-5">
        {/* Tickets liés */}
          <div className="bg-surface-container rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-on-surface flex items-center gap-1.5">
                <Link2 className="w-4 h-4" />
                Tickets liés ({linkedTickets.length})
              </h3>
              {canManage && (
                <button onClick={() => setShowLinkModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold flex items-center gap-1 cursor-pointer hover:bg-primary/20">
                  <Plus className="w-3 h-3" /> Lier un ticket
                </button>
              )}
            </div>
            {linkedTickets.length === 0 ? (
              <p className="text-xs text-on-surface-variant italic">Aucun ticket lié. Cliquez sur « Lier un ticket » pour associer des incidents à ce problème.</p>
            ) : (
              <div className="space-y-2">
                {linkedTickets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-high/50 hover:bg-surface-container-high group">
                    <button onClick={() => navigate(`/tickets/${t.id}`)}
                      className="flex-1 text-left cursor-pointer">
                      <p className="text-sm font-medium text-on-surface group-hover:text-primary truncate">#{t.id} — {t.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <StatusBadge status={t.status} />
                        <PriorityBadge priority={t.priority} />
                      </div>
                    </button>
                    {canManage && (
                      <button onClick={() => handleUnlinkTicket(t.id)}
                        className="p-1.5 rounded-lg text-on-surface-variant hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 cursor-pointer transition-all"
                        title="Détacher">
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Observateurs (multi) */}
          <div className="bg-surface-container rounded-xl p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-amber-500" />
              Observateurs {problem.observers?.length > 0 && `(${problem.observers.length})`}
            </h3>
            {canManage ? (
              <RemoteUserMultiSelect
                value={(problem.observers || []).map((o) => o.id)}
                onChange={async (vals) => {
                  try {
                    await api.patch(`/problems/${id}`, { observerIds: vals });
                    toast.success('Observateurs mis à jour');
                    loadProblem();
                  } catch (err) {
                    toast.error(err.response?.data?.error || 'Échec de la mise à jour');
                  }
                }}
                placeholder="Rechercher des observateurs..."
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(problem.observers || []).length > 0 ? (
                  problem.observers.map((o) => (
                    <span key={o.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      {o.fullName}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-on-surface-variant italic">Aucun observateur.</span>
                )}
              </div>
            )}
          </div>

          {/* Historique — Activity Stream (commentaires + journal) */}
          <div className="bg-surface-container rounded-xl p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3">Historique</h3>
            <ActivityStream
              items={historyItems}
              showFilters
              empty="Aucun échange pour le moment."
              editingId={editingFollowupId}
              commentBadges={(f) => (
                <>
                  {f.authorId && f.authorId === user?.id && (
                    <span className="act-tint text-[9px] px-2 py-0.5 rounded-full text-primary font-bold border">
                      Vous
                    </span>
                  )}
                  {f.updatedAt && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-semibold border border-outline-variant/30"
                      title={`Modifié le ${new Date(f.updatedAt).toLocaleString('fr-FR')}`}>
                      modifié
                    </span>
                  )}
                </>
              )}
              commentActions={(f) => (
                <>
                  {canManage && f.authorId === user?.id && editingFollowupId !== f.id && (
                    <button
                      onClick={() => startEditFollowup(f)}
                      title="Modifier"
                      className="p-1 rounded-md border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface hover:border-outline transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  {canManage && f.authorId === user?.id && (
                    <button
                      onClick={() => handleDeleteFollowup(f.id)}
                      title="Supprimer"
                      className="p-1 rounded-md border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-red-500 hover:border-red-500/40 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </>
              )}
              commentBody={(f) => (
                editingFollowupId === f.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      rows={3}
                      value={editingFollowupContent}
                      onChange={(e) => setEditingFollowupContent(e.target.value)}
                      className={`${inputCls} w-full resize-none`}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveEditFollowup(f.id)} disabled={savingFollowupEdit || !editingFollowupContent.trim()}
                        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-bold cursor-pointer hover:opacity-90 disabled:opacity-50 flex items-center gap-1">
                        {savingFollowupEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Enregistrer
                      </button>
                      <button onClick={cancelEditFollowup}
                        className="px-3 py-1.5 rounded-lg border border-outline-variant/60 text-on-surface-variant text-[11px] font-semibold cursor-pointer hover:bg-surface-container-high">
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  f.content && (f.content.includes('<') || f.content.includes('&#') || f.content.includes('&lt;')) ? (
                    <div
                      className="text-sm text-on-surface-variant leading-relaxed mt-1 break-words [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-2 [&_p]:mb-1.5 [&_p]:last:mb-0"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(f.content) }}
                    />
                  ) : (
                    <p className="text-sm text-on-surface-variant mt-1 whitespace-pre-wrap break-words">{f.content}</p>
                  )
                )
              )}
            />

            {/* Composer : texte + captures (collage Ctrl+V, fichier, glisser-déposer) */}
            {canManage && (
              <div className="flex gap-2 mt-3 pt-3 border-t border-outline-variant/30">
                <div className="flex-1 space-y-2">
                  <textarea
                    rows={2}
                    value={newFollowup}
                    onChange={(e) => setNewFollowup(e.target.value)}
                    onPaste={handlePasteImages}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddFollowup(); }
                    }}
                    placeholder="Ajouter un commentaire… (Entrée pour envoyer, Ctrl+V pour coller une capture)"
                    className={`${inputCls} w-full resize-none`}
                  />
                  <ImageAttachmentsEditor
                    items={pastedImages}
                    onChange={setPastedImages}
                    onFiles={addCommentImages}
                  />
                </div>
                <button onClick={handleAddFollowup}
                  disabled={sendingFollowup || (!newFollowup.trim() && pastedImages.length === 0)}
                  className="self-start p-2 rounded-xl bg-primary text-on-primary cursor-pointer hover:opacity-90 disabled:opacity-50">
                  {sendingFollowup ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
      </div>

      {/* Link ticket modal */}
      {showLinkModal && (
        <LinkTicketModal problemId={id} onClose={() => setShowLinkModal(false)} onLinked={() => { setShowLinkModal(false); loadProblem(); }} />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Supprimer ce problème"
        message="Êtes-vous sûr de vouloir supprimer ce problème ? Cette action est irréversible."
      />
    </div>
  );
}

function LinkTicketModal({ problemId, onClose, onLinked }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(null);

  // Charger les tickets au montage de la modale
  useEffect(() => {
    setLoading(true);
    api.get('/tickets', { params: { limit: 15, page: 1, status: 'NOT_CLOSED' } })
      .then(({ data }) => setResults(data.items || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  // Recherche debounce
  useEffect(() => {
    if (!search.trim()) return;
    const timeout = setTimeout(() => {
      setLoading(true);
      api.get('/tickets', { params: { search, limit: 15 } })
        .then(({ data }) => setResults(data.items || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  async function handleLink(ticketId) {
    setLinking(ticketId);
    try {
      await api.post(`/problems/${problemId}/link-ticket`, { ticketId });
      toast.success('Ticket lié au problème');
      onLinked();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLinking(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Link2 className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-on-surface">Lier un ticket</h3>
              <p className="text-[11px] text-on-surface-variant">Associez un ticket à ce problème</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Recherche */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Rechercher un ticket</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Titre, n° de ticket…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-outline-variant/60 bg-surface text-on-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none placeholder:text-on-surface-variant/40"
                autoFocus
              />
              {loading && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-primary animate-spin" />}
            </div>
          </div>

          {/* Résultats */}
          <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
            {loading && results.length === 0 && <p className="text-xs text-on-surface-variant text-center py-6">Chargement…</p>}
            {!loading && results.length === 0 && search.trim() && (
              <div className="flex flex-col items-center justify-center py-6 text-on-surface-variant/50">
                <Search className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs font-medium">Aucun résultat pour "{search}"</p>
              </div>
            )}
            {!loading && results.length === 0 && !search.trim() && (
              <div className="flex flex-col items-center justify-center py-6 text-on-surface-variant/50">
                <Search className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs font-medium">Tapez pour rechercher un ticket</p>
              </div>
            )}
            {results.map((t) => {
              const prioColor = { P1: 'text-red-500 bg-red-500/10', P2: 'text-orange-500 bg-orange-500/10', P3: 'text-blue-500 bg-blue-500/10', P4: 'text-slate-500 bg-slate-500/10' };
              const stColor = {
                NEW: 'bg-blue-500/10 text-blue-600', OPEN: 'bg-blue-500/10 text-blue-600',
                PENDING: 'bg-amber-500/10 text-amber-600', SOLVED: 'bg-emerald-500/10 text-emerald-600',
                CLOSED: 'bg-slate-500/10 text-slate-600',
              };
              return (
                <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl border border-outline-variant/20 hover:border-primary/40 hover:bg-primary/5 transition-all group">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="font-mono text-[10px] font-bold text-primary">#{t.id}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">{t.title}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${stColor[t.status] || 'bg-slate-500/10 text-slate-500'}`}>{STATUS_LABELS[t.status] || t.status}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${prioColor[t.priority] || 'bg-slate-500/10 text-slate-500'}`}>{t.priority}</span>
                      {t.requester?.fullName && <span className="text-[10px] text-on-surface-variant">par {t.requester.fullName}</span>}
                    </div>
                  </div>
                  <button onClick={() => handleLink(t.id)} disabled={linking === t.id}
                    className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold cursor-pointer hover:bg-primary/20 disabled:opacity-50 shrink-0 mt-0.5">
                    {linking === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Lier'}
                  </button>
                </div>
              );
            })}
          </div>

          {results.length > 0 && (
            <p className="text-[10px] text-on-surface-variant/50 text-center">{results.length} ticket(s) affiché(s)</p>
          )}
        </div>
      </div>
    </div>
  );
}
