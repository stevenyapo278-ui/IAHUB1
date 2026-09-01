import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, Clock, CheckCircle2, Radio, User, Users, Tag,
  Link2, Plus, X, RefreshCw, Send, Eye, Calendar, Flame, Info, ArrowDown,
  Sparkles, Pencil, Trash2, LinkIcon, Unlink,
} from 'lucide-react';
import api from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useAuth } from '../context/AuthContext';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';

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

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const loadProblem = useCallback(() => {
    setLoading(true);
    api.get(`/problems/${id}`)
      .then(({ data }) => { setProblem(data); setEditForm(data); })
      .catch(() => { toast.error('Problème introuvable'); navigate('/problems'); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => { loadProblem(); }, [loadProblem]);

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

  async function handleAddFollowup() {
    if (!newFollowup.trim()) return;
    setSendingFollowup(true);
    try {
      await api.post(`/problems/${id}/followups`, { content: newFollowup.trim() });
      toast.success('Commentaire ajouté');
      setNewFollowup('');
      loadProblem();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSendingFollowup(false);
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
              <StatusBadge status={problem.status} />
              <PriorityBadge priority={problem.priority} />
              {problem.category && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-container text-on-surface-variant">
                  <Tag className="w-3 h-3" /> {problem.category}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-on-surface mt-2">{problem.title}</h1>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Créé le {new Date(problem.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
              {problem.assignedTo && ` · Assigné à ${problem.assignedTo.fullName}`}
              {problem.team && ` · Équipe ${problem.team.name}`}
            </p>
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
            {problem.glpiLocationName && <span>Lieu: <strong>{problem.glpiLocationName}</strong></span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Tickets liés + Timeline */}
        <div className="lg:col-span-2 space-y-5">
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

          {/* Timeline (followups) */}
          <div className="bg-surface-container rounded-xl p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3">Timeline</h3>
            <div className="space-y-3">
              {problem.followups?.map((f) => (
                <div key={f.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(f.author?.fullName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-on-surface">{f.author?.fullName || 'Système'}</span>
                      <span className="text-[10px] text-on-surface-variant">
                        {new Date(f.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface-variant mt-0.5 whitespace-pre-wrap">{f.content}</p>
                  </div>
                </div>
              ))}

              {/* New followup input */}
              {canManage && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-outline-variant/30">
                  <input
                    type="text"
                    value={newFollowup}
                    onChange={(e) => setNewFollowup(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddFollowup()}
                    placeholder="Ajouter un commentaire..."
                    className={`${inputCls} flex-1`}
                  />
                  <button onClick={handleAddFollowup} disabled={sendingFollowup || !newFollowup.trim()}
                    className="p-2 rounded-xl bg-primary text-on-primary cursor-pointer hover:opacity-90 disabled:opacity-50">
                    {sendingFollowup ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions sidebar */}
        <div className="space-y-4">
          {/* Quick status change */}
          <div className="bg-surface-container rounded-xl p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3">Actions rapides</h3>
            <div className="space-y-2">
              {STATUS_OPTIONS.filter((s) => s !== problem.status).slice(0, 5).map((s) => {
                const cfg = STATUS_CONFIG[s];
                const Icon = cfg?.Icon || Clock;
                return (
                  <button key={s} onClick={() => handleStatusChange(s)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 cursor-pointer hover:bg-surface-container-high transition-colors ${cfg?.bg || ''}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Event log */}
          <div className="bg-surface-container rounded-xl p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3">Journal</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {problem.events?.map((e) => (
                <div key={e.id} className="text-[11px] text-on-surface-variant">
                  <span className="font-medium">{e.actor}</span> — {e.type.replace(/_/g, ' ').toLowerCase()}
                  <br />
                  <span className="text-[10px] opacity-70">
                    {new Date(e.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              {(!problem.events || problem.events.length === 0) && (
                <p className="text-[11px] text-on-surface-variant italic">Aucun événement</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Link ticket modal */}
      {showLinkModal && (
        <LinkTicketModal problemId={id} onClose={() => setShowLinkModal(false)} onLinked={() => { setShowLinkModal(false); loadProblem(); }} />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
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

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const timeout = setTimeout(() => {
      setLoading(true);
      api.get('/tickets', { params: { search, limit: 20 } })
        .then(({ data }) => setResults(data.tickets || data || []))
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-on-surface">Lier un ticket</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container-high cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un ticket par titre ou ID..."
            className={`${inputCls} w-full`}
            autoFocus
          />
        </div>
        <div className="max-h-60 overflow-y-auto space-y-1">
          {loading && <p className="text-xs text-on-surface-variant text-center py-4">Recherche...</p>}
          {!loading && results.length === 0 && search.trim() && (
            <p className="text-xs text-on-surface-variant italic text-center py-4">Aucun résultat</p>
          )}
          {results.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-surface-container-high group">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface truncate">#{t.id} — {t.title}</p>
                <p className="text-[11px] text-on-surface-variant">{STATUS_LABELS[t.status] || t.status} · {t.priority}</p>
              </div>
              <button onClick={() => handleLink(t.id)} disabled={linking === t.id}
                className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold cursor-pointer hover:bg-primary/20 disabled:opacity-50">
                {linking === t.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Lier'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
