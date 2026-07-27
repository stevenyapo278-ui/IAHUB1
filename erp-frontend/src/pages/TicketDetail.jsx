import { useEffect, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import SearchableSelect from '../components/SearchableSelect';
import SearchableMultiSelect from '../components/SearchableMultiSelect';
import {
  ArrowLeft, Clock, User, Tag, AlertTriangle, CheckCircle2,
  Trash2, Paperclip, MessageSquare, Sparkles, Shield, MapPin,
  RefreshCw, Mail, FileText, Check, X, Send, ChevronRight,
  Flame, Radio, Info, ArrowDown, UserCheck, HelpCircle, Layers, History
} from 'lucide-react';
import {
  STATUS_OPTIONS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS,
  URGENCY_IMPACT_OPTIONS, PRIORITY_CONFIG, STATUS_CONFIG, initials
} from '../constants/tickets';

import { sanitizeHtml } from '../utils/sanitize';

function AttachmentThumbnail({ ticketId, attachment }) {
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let url;
    api
      .get(`/tickets/${ticketId}/attachments/${attachment.id}/file`, { responseType: 'blob' })
      .then(({ data }) => {
        url = URL.createObjectURL(data);
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [ticketId, attachment.id]);

  if (!blobUrl) {
    return <div className="h-20 w-20 border border-outline-variant/60 bg-surface-container-low rounded-xl animate-pulse" />;
  }
  return <img src={blobUrl} alt={attachment.filename} className="h-20 w-20 object-cover border border-outline-variant/60 rounded-xl shadow-sm hover:shadow-md transition-all duration-300" />;
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);    const [followup, setFollowup] = useState('');
  const [pastedImages, setPastedImages] = useState([]);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [syncFailures, setSyncFailures] = useState([]);
  const [savingField, setSavingField] = useState(null);
  const [corrections, setCorrections] = useState([]);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approving, setApproving] = useState(false);

  const canAssign = hasPermission(user, 'tickets.assign') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canApprove = hasPermission(user, 'tickets.approve') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canDelete = hasPermission(user, 'tickets.delete') || user?.role === 'SUPERADMIN';

  const followupContainerRef = useRef(null);
  const followupBlobUrlsRef = useRef([]);

  const load = useCallback(() => {
    api
      .get(`/tickets/${id}`)
      .then(({ data }) => setTicket(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement du ticket'));
    api
      .get(`/tickets/${id}/events`)
      .then(({ data }) => setSyncFailures(data.filter((e) => e.type === 'GLPI_SYNC_FAILED')))
      .catch(() => {});
    api
      .get(`/tickets/${id}/corrections`)
      .then(({ data }) => setCorrections(data))
      .catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const intervalId = setInterval(load, 15000);
    return () => clearInterval(intervalId);
  }, [load]);

  useEffect(() => {
    const container = followupContainerRef.current;
    if (!container) return;

    container.querySelectorAll('img[src^="/glpi/document/"]').forEach((img) => {
      if (img.getAttribute('data-blob-processed')) return;
      img.setAttribute('data-blob-processed', 'true');

      const src = img.getAttribute('src');
      if (!src) return;

      const parentLink = img.closest('a[href="' + CSS.escape(src) + '"]');

      api
        .get(src, { responseType: 'blob' })
        .then(({ data }) => {
          const url = URL.createObjectURL(data);
          followupBlobUrlsRef.current.push(url);
          img.setAttribute('data-blob-url', url);
          img.src = url;
          if (parentLink) { parentLink.href = url; }
        })
        .catch(() => {});
    });

    container.querySelectorAll('a[href^="/glpi/document/"]').forEach((link) => {
      if (link.getAttribute('data-blob-processed')) return;
      if (link.querySelector('img[src^="/glpi/document/"]')) return;
      link.setAttribute('data-blob-processed', 'true');

      const href = link.getAttribute('href');
      if (!href) return;

      api
        .get(href, { responseType: 'blob' })
        .then(({ data }) => {
          const url = URL.createObjectURL(data);
          followupBlobUrlsRef.current.push(url);
          link.href = url;
        })
        .catch(() => {});
    });

    return () => {
      followupBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      followupBlobUrlsRef.current = [];
    };
  }, [ticket?.followups, ticket?.messages]);

  async function downloadAttachment(attachment) {
    try {
      const { data } = await api.get(`/tickets/${id}/attachments/${attachment.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError('Échec du téléchargement de la pièce jointe');
    }
  }

  useEffect(() => {
    api.get('/glpi/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/glpi/locations').then(({ data }) => setLocations(data)).catch(() => {});
    api.get('/glpi/users').then(({ data }) => setGlpiUsers(data)).catch(() => {});
    if (!canAssign) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : (data.users || []))).catch(() => {});
  }, [canAssign]);

  async function updateField(field, value) {
    try {
      setSavingField(field);
      await api.patch(`/tickets/${id}`, { [field]: value });
      toast.success('Mise à jour enregistrée');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSavingField(null);
    }
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type?.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const id = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const dataUrl = URL.createObjectURL(file);
        setPastedImages((prev) => [...prev, { id, file, dataUrl }]);
        toast.success('Image collée — elle sera envoyée avec le commentaire');
      }
    }
  }

  function removePastedImage(id) {
    setPastedImages((prev) => {
      const img = prev.find((p) => p.id === id);
      if (img) URL.revokeObjectURL(img.dataUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleAddFollowup(e) {
    e.preventDefault();
    if (!followup.trim() && pastedImages.length === 0) return;
    try {
      const hasImages = pastedImages.length > 0;
      let content = followup;

      if (hasImages) {
        // Envoyer en FormData avec les images
        const fd = new FormData();
        fd.append('content', followup);
        pastedImages.forEach((img, idx) => {
          fd.append('images', img.file);
          content += `\n\n<!--IMAGE_${idx}-->`;
        });
        // Re-build content with image markers
        fd.set('content', content);
        await api.post(`/tickets/${id}/followups`, fd);
      } else {
        await api.post(`/tickets/${id}/followups`, { content });
      }

      toast.success('Commentaire ajouté');
      setFollowup('');
      pastedImages.forEach((img) => URL.revokeObjectURL(img.dataUrl));
      setPastedImages([]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout du commentaire");
    }
  }

  async function handleDismissSuggestion(suggestionId) {
    try {
      await api.delete(`/ai-ticket-suggestions/${suggestionId}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression de la suggestion');
    }
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/tickets/${id}`);
      navigate(-1);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
      setDeleting(false);
    }
  }

  function handleApprove() {
    setShowApproveModal(true);
  }

  async function handleApproveConfirm() {
    setApproving(true);
    try {
      const { data } = await api.post(`/tickets/${id}/approve`);
      toast.success('Ticket approuvé');
      if (data.warning) {
        toast.warning(data.warning, { duration: 8000 });
      }
      setShowApproveModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'approbation");
    } finally {
      setApproving(false);
    }
  }

  function handleReject() {
    setRejectReason('');
    setShowRejectModal(true);
  }

  async function handleRejectConfirm() {
    if (!rejectReason.trim()) {
      toast.error('La raison du rejet est obligatoire');
      return;
    }
    setRejecting(true);
    try {
      await api.post(`/tickets/${id}/reject`, { reason: rejectReason.trim() });
      toast.success('Ticket rejeté');
      setShowRejectModal(false);
      setRejectReason('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du rejet');
    } finally {
      setRejecting(false);
    }
  }

  async function handleRequestApproval() {
    try {
      await api.patch(`/tickets/${id}`, { approvalStatus: 'PENDING' });
      toast.success('Soumis pour approbation');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la demande d\'approbation');
    }
  }

  if (error) {
    return (
      <div className="p-8 flex flex-col items-center gap-4">
        <div className="border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 p-4 rounded-xl font-semibold text-sm flex items-center gap-2 max-w-lg">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
        <button onClick={load} className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white shadow-md shadow-blue-500/20 hover:brightness-110 transition-all">
          Réessayer
        </button>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="p-6 sm:p-8 flex flex-col gap-6 animate-pulse">
        <div className="h-6 w-48 bg-surface-container-high rounded-xl" />
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-8 space-y-6">
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl p-6 space-y-4">
              <div className="h-8 w-3/4 bg-surface-container-high rounded-xl" />
              <div className="h-4 w-full bg-surface-container-high/60 rounded" />
              <div className="h-24 w-full bg-surface-container-high/40 rounded-xl" />
            </div>
          </div>
          <div className="xl:col-span-4 space-y-6">
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl p-6 space-y-4">
              <div className="h-6 w-32 bg-surface-container-high rounded-xl" />
              <div className="h-10 w-full bg-surface-container-high/40 rounded-xl" />
              <div className="h-10 w-full bg-surface-container-high/40 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pConfig = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.P3;
  const sConfig = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.NEW;
  const PIcon = pConfig.Icon;
  const SIcon = sConfig.Icon;

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl border border-outline-variant/40 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
            title="Retour aux tickets"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-primary">#{ticket.id}</span>
              {ticket.glpiTicketId && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-surface-container-high dark:text-on-surface-variant border border-slate-200 dark:border-outline-variant/40 flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5" />
                  GLPI #{ticket.glpiTicketId}
                </span>
              )}
            </div>
            <h1 className="text-lg font-bold text-on-surface leading-snug line-clamp-1">{ticket.title}</h1>
          </div>
        </div>

        {/* Right Badges & Actions */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={async () => {
              try {
                toast.loading('Génération de la fiche KB...', { id: 'kb-gen' });
                await api.post(`/tickets/${id}/generate-knowledge`);
                toast.success('Fiche capturée avec succès dans la Base de Connaissances !', { id: 'kb-gen' });
              } catch (err) {
                toast.error(err.response?.data?.error || 'Erreur lors de la capture KB', { id: 'kb-gen' });
              }
            }}
            className="px-3 py-1.5 rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-300 hover:bg-purple-500/20 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="Créer automatiquement un article dans la Base de Connaissances d'après la résolution de ce ticket"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Capturer dans la KB</span>
          </button>

          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${sConfig.bg}`}>
            <SIcon className="w-3.5 h-3.5" />
            {sConfig.label}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${pConfig.bg}`}>
            <PIcon className="w-3.5 h-3.5" />
            {pConfig.label}
          </span>
          {canDelete && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 rounded-xl border border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer ml-2"
              title="Supprimer le ticket"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Sync Failure Banner */}
      {syncFailures.length > 0 && (
        <div className="border border-red-500/25 bg-red-500/10 rounded-xl p-4 flex items-start gap-3 text-red-700 dark:text-red-400">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider">Synchronisation GLPI incomplète</h4>
            <ul className="text-xs mt-1 space-y-1 list-disc pl-4">
              {syncFailures.map((e) => (
                <li key={e.id}>
                  {new Date(e.createdAt).toLocaleString('fr-FR')} — {e.payload?.action || 'action'} : {e.payload?.error || 'erreur inconnue'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: Main Ticket Content & Timeline */}
        <div className="xl:col-span-8 flex flex-col gap-6">
          {/* Main Ticket Card */}
          <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-outline-variant/20">
              <div className="flex items-center gap-2 flex-wrap">
                {ticket.category && (
                  <span className="bg-slate-100 text-slate-700 dark:bg-surface-container-high dark:text-on-surface-variant border border-slate-200 dark:border-outline-variant/40 text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    {ticket.category}
                  </span>
                )}
                {ticket.aiProcessed && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-purple-200 bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 text-[11px] font-bold">
                    <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                    Traité par IA
                  </span>
                )}
              </div>
              <div className="text-[11px] font-medium text-on-surface-variant flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-on-surface-variant/60" />
                <span>Créé le {new Date(ticket.createdAt).toLocaleString('fr-FR')}</span>
              </div>
            </div>

            {/* Ticket Description Content */}
            {ticket.content && (ticket.content.includes('<') || ticket.content.includes('&#') || ticket.content.includes('&lt;')) ? (
              <div
                className="leading-relaxed text-sm text-on-surface [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-3 [&_a]:text-blue-600 [&_a]:underline [&_p]:mb-2 [&_p]:last:mb-0 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-2.5 [&_h3]:mb-1 [&_div]:mb-1.5 [&_b]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-outline-variant/30 [&_th]:p-2 [&_th]:bg-surface-container [&_th]:text-left [&_th]:text-[11px] [&_th]:font-bold [&_td]:border [&_td]:border-outline-variant/30 [&_td]:p-2 [&_td]:text-[11px] [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1.5 [&_li]:mb-0.5"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(ticket.content) }}
              />
            ) : (
              <div className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap font-normal">
                {ticket.content}
              </div>
            )}

            {/* Attachments */}
            {ticket.attachments?.length > 0 && (
              <div className="border-t border-outline-variant/30 pt-4 mt-4">
                <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-primary" />
                  Pièces jointes ({ticket.attachments.length})
                </h4>
                <div className="flex flex-wrap gap-3">
                  {ticket.attachments.map((a) => {
                    const isImage = a.mimeType?.startsWith('image/');
                    const fromEmail = a.source === 'INCOMING_EMAIL';
                    return isImage ? (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => downloadAttachment(a)}
                        title={fromEmail ? `${a.filename} (reçu par email)` : a.filename}
                        className="relative hover:opacity-90 transition-opacity group cursor-pointer"
                      >
                        <AttachmentThumbnail ticketId={ticket.id} attachment={a} />
                        {fromEmail && (
                          <span className="p-1 bg-surface rounded-full text-on-surface-variant shadow-sm border border-outline-variant/40 absolute top-1 right-1">
                            <Mail className="w-3 h-3 text-primary" />
                          </span>
                        )}
                      </button>
                    ) : (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => downloadAttachment(a)}
                        title={fromEmail ? 'Reçu par email' : undefined}
                        className="flex items-center gap-2 px-3.5 py-2 border border-outline-variant/50 bg-surface-container-low/40 text-on-surface text-xs font-semibold rounded-xl hover:bg-surface-container hover:border-primary/40 transition-all cursor-pointer"
                      >
                        {fromEmail ? <Mail className="w-4 h-4 text-primary" /> : <Paperclip className="w-4 h-4 text-primary" />}
                        <span className="truncate max-w-[180px]">{a.filename}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Follow-up / Timeline Card */}
          <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-6">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface border-b border-outline-variant/20 pb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Suivi & Échanges
            </h3>

            {/* Timeline entries */}
            <div className="space-y-4" ref={followupContainerRef}>
              {(() => {
                const timeline = [
                  ...ticket.followups.map((f) => ({ kind: 'followup', date: f.createdAt, data: f })),
                  ...(ticket.messages || []).map((m) => ({ kind: 'email', date: m.timestamp, data: m })),
                ].sort((a, b) => new Date(a.date) - new Date(b.date));

                if (timeline.length === 0) {
                  return (
                    <div className="py-8 text-center text-on-surface-variant/60 text-xs italic">
                      Aucun commentaire pour le moment.
                    </div>
                  );
                }

                return timeline.map((item) =>
                  item.kind === 'followup' ? (
                    <div key={`f-${item.data.id}`} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 flex gap-3">
                      <div className="w-9 h-9 rounded-full border border-outline-variant/60 bg-surface-container-high text-on-surface flex items-center justify-center text-xs font-bold shrink-0 shadow-sm">
                        {initials(item.data.author?.fullName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-on-surface">
                              {item.data.source === 'glpi' ? 'GLPI' : (item.data.author?.fullName || 'Inconnu')}
                            </span>
                            {item.data.source === 'glpi' && (
                              <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold border border-amber-500/25">GLPI</span>
                            )}
                          </div>
                          <time className="text-[10px] font-mono text-on-surface-variant bg-surface-container border border-outline-variant/30 px-2 py-0.5 rounded-full">
                            {new Date(item.data.createdAt).toLocaleString('fr-FR')}
                          </time>
                        </div>
                        {item.data.content && (item.data.content.includes('<') || item.data.content.includes('&#') || item.data.content.includes('&lt;')) ? (
                          <div
                            className="leading-relaxed text-xs text-on-surface [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-2 [&_a]:text-blue-600 [&_a]:underline [&_p]:mb-1.5 [&_p]:last:mb-0 [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-0.5 [&_div]:mb-1 [&_b]:font-semibold"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.data.content) }}
                          />
                        ) : (
                          <div className="text-xs text-on-surface leading-relaxed whitespace-pre-wrap font-normal">
                            {item.data.content}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div key={`m-${item.data.id}`} className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex gap-3">
                      <div className="w-9 h-9 rounded-full border border-outline-variant/50 bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 shadow-sm">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-bold text-on-surface">
                            {item.data.direction === 'INBOUND' ? `Email de ${item.data.sender}` : `Email envoyé à ${item.data.recipients?.join(', ')}`}
                          </span>
                          <time className="text-[10px] font-mono text-on-surface-variant bg-surface-container border border-outline-variant/30 px-2 py-0.5 rounded-full">
                            {new Date(item.data.timestamp).toLocaleString('fr-FR')}
                          </time>
                        </div>
                        <div className="text-[11px] text-on-surface-variant mb-1 font-semibold italic">{item.data.subject}</div>
                        {item.data.bodyHtml ? (
                          <div
                            className="leading-relaxed text-xs text-on-surface [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-2 [&_a]:text-blue-600 [&_a]:underline [&_p]:mb-1.5 [&_p]:last:mb-0 [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-0.5 [&_div]:mb-1 [&_b]:font-semibold"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.data.bodyHtml) }}
                          />
                        ) : (
                          <div className="text-xs text-on-surface whitespace-pre-wrap leading-relaxed">{item.data.body}</div>
                        )}
                      </div>
                    </div>
                  )
                );
              })()}
            </div>

            {/* Add Comment Form */}
            <form onSubmit={handleAddFollowup} className="pt-4 border-t border-outline-variant/30 space-y-3">
              <textarea
                className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                placeholder="Ajouter un commentaire ou suivi... (Ctrl+Entrée pour envoyer)"
                rows={3}
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleAddFollowup(e); } }}
                onPaste={handlePaste}
              />

              {/* Pasted images preview */}
              {pastedImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pastedImages.map((img) => (
                    <div key={img.id} className="relative group">
                      <img
                        src={img.dataUrl}
                        alt="image collée"
                        className="h-16 w-16 object-cover rounded-xl border border-outline-variant/40 shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removePastedImage(img.id)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <span className="text-[10px] text-on-surface-variant self-end pb-1 font-medium">
                    {pastedImages.length} image{pastedImages.length > 1 ? 's' : ''} collée{pastedImages.length > 1 ? 's' : ''}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-on-surface-variant font-medium">Astuce : Appuyez sur <kbd className="px-1.5 py-0.5 bg-surface-container border border-outline-variant/40 rounded text-[9px] font-mono">Ctrl+Entrée</kbd> pour soumettre. Vous pouvez <kbd className="px-1.5 py-0.5 bg-surface-container border border-outline-variant/40 rounded text-[9px] font-mono">Coller</kbd> des images directement.</span>
                <button
                  type="submit"
                  disabled={!followup.trim() && pastedImages.length === 0}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-40 hover:brightness-110 transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Envoyer{pastedImages.length > 0 ? ` (${pastedImages.length} img.)` : ''}</span>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Properties Sidebar */}
        <div className="xl:col-span-4 flex flex-col gap-6">
          {/* Source Email Details */}
          {ticket.sourceEmail && (
            <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
                <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Email d'origine
              </h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-on-surface-variant font-medium">De :</dt>
                  <dd className="text-on-surface font-semibold truncate text-right">
                    {ticket.sourceName ? `${ticket.sourceName} <${ticket.sourceEmail}>` : ticket.sourceEmail}
                  </dd>
                </div>
                {ticket.sourceSubject && (
                  <div className="flex justify-between gap-2 border-t border-outline-variant/20 pt-2">
                    <dt className="text-on-surface-variant font-medium">Sujet :</dt>
                    <dd className="text-on-surface font-semibold truncate text-right">{ticket.sourceSubject}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* AI Suggestions */}
          {ticket.aiSuggestions?.length > 0 && (
            <div className="rounded-3xl border border-purple-500/20 bg-purple-500/5 p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-400 flex items-center gap-2 border-b border-purple-500/20 pb-3">
                <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                Suggestions IA
              </h3>
              <div className="space-y-2">
                {ticket.aiSuggestions.map((s) => (
                  <div key={s.id} className="border border-purple-500/20 bg-surface-container-lowest rounded-xl p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-on-surface font-medium leading-relaxed">{s.suggestion}</p>
                      <button
                        onClick={() => handleDismissSuggestion(s.id)}
                        className="text-on-surface-variant hover:text-red-500 p-0.5 rounded transition-colors"
                        title="Ignorer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {s.reason && (
                      <p className="text-[10px] text-on-surface-variant border-t border-outline-variant/20 pt-1.5 italic">{s.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approval Workflow Card */}
          {ticket.approvalStatus !== 'NOT_REQUIRED' && (
            <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Approbation
              </h3>

              <div className={`px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-center rounded-xl border ${
                ticket.approvalStatus === 'REJECTED'
                  ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border-red-200 dark:border-red-500/25'
                  : ticket.approvalStatus === 'APPROVED'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/25'
                  : 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border-amber-300 dark:border-amber-500/25'
              }`}>
                {ticket.approvalStatus === 'PENDING' && 'En attente d\'approbation'}
                {ticket.approvalStatus === 'APPROVED' && 'Approuvé'}
                {ticket.approvalStatus === 'REJECTED' && 'Rejeté'}
              </div>

              {ticket.approvedBy && (
                <p className="text-[11px] text-on-surface-variant italic">
                  Par {ticket.approvedBy.fullName} le {new Date(ticket.approvedAt).toLocaleString('fr-FR')}
                </p>
              )}

              {canApprove && ticket.approvalStatus === 'PENDING' && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleApprove}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 hover:brightness-110 cursor-pointer transition-all"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approuver
                  </button>
                  <button
                    onClick={handleReject}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-500/10 cursor-pointer transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                    Rejeter
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Properties Card */}
          <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface border-b border-outline-variant/20 pb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Propriétés du ticket
            </h3>

            <div className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Date d'ouverture
                </label>
                <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {new Date(ticket.createdAt).toLocaleString('fr-FR')}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Type
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                  value={ticket.type}
                  disabled={!canAssign || savingField === 'type'}
                  onChange={(e) => updateField('type', e.target.value)}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Catégorie
                </label>
                {canAssign ? (
                  <select
                    className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                    value={ticket.category || ''}
                    disabled={savingField === 'category'}
                    onChange={(e) => updateField('category', e.target.value)}
                  >
                    <option value="">-----</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {ticket.category || '-'}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Statut
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                  value={ticket.status}
                  disabled={!canAssign || savingField === 'status'}
                  onChange={(e) => updateField('status', e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Source de la demande
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                  value={ticket.source || ''}
                  disabled={!canAssign || savingField === 'source'}
                  onChange={(e) => updateField('source', e.target.value)}
                >
                  <option value="">-----</option>
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Urgence
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                  value={ticket.urgency}
                  disabled={!canAssign || savingField === 'urgency'}
                  onChange={(e) => updateField('urgency', e.target.value)}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Impact
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                  value={ticket.impact}
                  disabled={!canAssign || savingField === 'impact'}
                  onChange={(e) => updateField('impact', e.target.value)}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Priorité
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                  value={ticket.priority}
                  disabled={!canAssign || savingField === 'priority'}
                  onChange={(e) => updateField('priority', e.target.value)}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  ID externe
                </label>
                <input
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  defaultValue={ticket.externalId || ''}
                  disabled={!canAssign}
                  onBlur={(e) => updateField('externalId', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Équipe
                </label>
                {canAssign ? (
                  <select
                    className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                    value={ticket.teamId || ''}
                    disabled={savingField === 'teamId'}
                    onChange={(e) => updateField('teamId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Aucune</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {ticket.team?.name || 'Non assignée'}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Attribué à
                </label>
                {canAssign ? (
                  <SearchableSelect
                    options={Array.isArray(users) ? users : []}
                    value={ticket.assignedToId || ''}
                    disabled={savingField === 'assignedToId'}
                    onChange={(val) => updateField('assignedToId', val ? Number(val) : null)}
                    placeholder="Non assigné"
                    searchPlaceholder="Rechercher un technicien..."
                    labelKey="fullName"
                    valueKey="id"
                    subLabelKey="email"
                    icon={User}
                  />
                ) : (
                  <div className="w-full flex items-center gap-2 bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {ticket.assignedTo ? (
                      <>
                        <div className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[9px] font-bold border border-blue-500/20">
                          {initials(ticket.assignedTo.fullName)}
                        </div>
                        {ticket.assignedTo.fullName}
                      </>
                    ) : (
                      <span className="text-slate-500 italic">Non assigné</span>
                    )}
                  </div>
                )}
              </div>

              {ticket.observers?.length > 0 && (
                <div>
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Observateur(s)
                  </label>
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {ticket.observers.map((o) => o.fullName).join(', ')}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-primary" />
                  Lieu
                </label>
                {canAssign ? (
                  <SearchableSelect
                    options={locations}
                    value={ticket.glpiLocationId || ''}
                    disabled={savingField === 'glpiLocationId'}
                    onChange={async (val) => {
                      const selectedLoc = locations.find((l) => String(l.id) === String(val));
                      const locName = selectedLoc ? (selectedLoc.completename || selectedLoc.name) : null;
                      const suffix = ticket.title?.includes(' : ') ? ticket.title.split(' : ').slice(1).join(' : ') : ticket.title;
                      const newTitle = locName && suffix ? `${locName} : ${suffix}` : (locName || suffix || ticket.title);
                      try {
                        setSavingField('glpiLocationId');
                        await api.patch(`/tickets/${id}`, {
                          locationId: val ? Number(val) : null,
                          title: newTitle,
                        });
                        toast.success('Lieu et titre mis à jour');
                        load();
                      } catch (err) {
                        setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
                      } finally {
                        setSavingField(null);
                      }
                    }}
                    placeholder="Sélectionner un lieu..."
                    searchPlaceholder="Rechercher un lieu GLPI..."
                    labelKey="name"
                    valueKey="id"
                    subLabelKey="completename"
                    icon={MapPin}
                  />
                ) : (
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                    {ticket.glpiLocationName || <span className="text-slate-500 italic font-normal">Non spécifié</span>}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Ticket GLPI ID
                </label>
                <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-bold font-mono text-slate-800 dark:text-slate-200">
                  {ticket.glpiTicketId ? (
                    <span className="text-blue-600 dark:text-blue-400 font-bold">#{ticket.glpiTicketId}</span>
                  ) : (
                    <span className="text-slate-500 italic font-sans font-medium">Non lié GLPI</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Requester Details Card */}
          <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
              <User className="w-4 h-4 text-primary" />
              Demandeur
            </h3>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl border border-outline-variant/40 bg-surface-container text-on-surface flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                {initials(ticket.requester?.fullName || ticket.sourceName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-on-surface truncate">{ticket.requester?.fullName || ticket.sourceName || ticket.sourceEmail || '-'}</p>
                <p className="text-[11px] text-on-surface-variant font-medium truncate">{ticket.requester?.email || ticket.sourceEmail || '-'}</p>
              </div>
            </div>
          </div>

          {/* Audit Trail / Corrections History Card */}
          {corrections.length > 0 && (
            <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
                <History className="w-4 h-4 text-primary" />
                Historique des Corrections ({corrections.length})
              </h3>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {corrections.map((c) => (
                  <div key={c.id} className="p-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low/30 text-xs space-y-1">
                    <div className="flex items-center justify-between text-on-surface-variant text-[10px]">
                      <span className="font-bold text-on-surface">{c.correctedBy?.fullName || 'Hotline / Système'}</span>
                      <span className="font-mono">{new Date(c.createdAt).toLocaleString('fr-FR')}</span>
                    </div>
                    <p className="text-xs text-on-surface font-medium">
                      Modification de <span className="font-bold text-primary">{c.fieldName}</span> :
                      <span className="line-through text-red-500 mx-1.5">{c.oldValue || 'vide'}</span> →
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 ml-1.5">{c.newValue || 'vide'}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Approval Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
              <h3 className="text-base font-bold">Approuver le ticket #{ticket.id}</h3>
            </div>
            <p className="text-xs text-on-surface-variant border-b border-outline-variant/20 pb-3">
              Veuillez vérifier les informations ci-dessous avant de confirmer l'approbation.
            </p>

            {/* Ticket Summary */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Titre</span>
                  <span className="font-semibold text-on-surface break-words col-span-2 block">{ticket.title}</span>
                </div>
                <div className="col-span-2 border-t border-outline-variant/20 pt-2" />
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Demandeur</span>
                  <span className="font-semibold text-on-surface">{ticket.requester?.fullName || ticket.sourceName || ticket.sourceEmail || 'Non spécifié'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Email</span>
                  <span className="font-semibold text-on-surface truncate block">{ticket.requester?.email || ticket.sourceEmail || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Catégorie</span>
                  <span className="font-semibold text-on-surface">{ticket.category || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Type</span>
                  <span className="font-semibold text-on-surface">{ticket.type || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Statut</span>
                  <span className="font-semibold">{sConfig ? (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${sConfig.bg}`}>
                      <SIcon className="w-3 h-3" />
                      {sConfig.label}
                    </span>
                  ) : ticket.status}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Priorité</span>
                  <span className="font-semibold">{pConfig ? (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${pConfig.bg}`}>
                      <PIcon className="w-3 h-3" />
                      {pConfig.label}
                    </span>
                  ) : ticket.priority}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Urgence</span>
                  <span className="font-semibold text-on-surface">{ticket.urgency || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Impact</span>
                  <span className="font-semibold text-on-surface">{ticket.impact || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Équipe</span>
                  <span className="font-semibold text-on-surface">{ticket.team?.name || 'Non assignée'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Assigné à</span>
                  <span className="font-semibold text-on-surface">{ticket.assignedTo?.fullName || 'Non assigné'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Lieu</span>
                  <span className="font-semibold text-on-surface">{ticket.glpiLocationName || 'Non spécifié'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Source</span>
                  <span className="font-semibold text-on-surface">{ticket.source || 'N/A'}</span>
                </div>
              </div>

              {ticket.content && (
                <div className="border-t border-outline-variant/20 pt-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-1.5">Description</span>
                  <div className="bg-surface-container-low rounded-xl p-3 max-h-24 overflow-y-auto text-xs text-on-surface leading-relaxed [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mt-1.5 [&_h2]:mb-0.5 [&_div]:mb-0.5 [&_b]:font-semibold">
                    {ticket.content.includes('<') || ticket.content.includes('&#') ? (
                      <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(ticket.content) }} />
                    ) : (
                      <span className="whitespace-pre-wrap">{ticket.content}</span>
                    )}
                  </div>
                </div>
              )}

              {ticket.sourceEmail && (
                <div className="border-t border-outline-variant/20 pt-3 flex items-center gap-2 text-xs text-on-surface-variant">
                  <Mail className="w-3.5 h-3.5" />
                  <span>Reçu de : {ticket.sourceName ? `${ticket.sourceName} <${ticket.sourceEmail}>` : ticket.sourceEmail}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => setShowApproveModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={approving}
                onClick={handleApproveConfirm}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/20 hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {approving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Approbation en cours...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Confirmer l'approbation
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold">Raison du rejet du ticket</h3>
            </div>
            <p className="text-xs text-on-surface-variant">
              Veuillez spécifier la raison du rejet. Cette raison sera enregistrée pour alimenter l'apprentissage IA de la plateforme.
            </p>
            <textarea
              className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
              rows={3}
              placeholder="Ex: Doublon du ticket #42, demande non conforme..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || rejecting}
                onClick={handleRejectConfirm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white shadow-md shadow-red-500/20 hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {rejecting ? 'Rejet en cours...' : 'Confirmer le rejet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Supprimer le ticket"
        message={`Supprimer définitivement le ticket #${id} ? Cette action est irréversible et supprime aussi le ticket GLPI lié.`}
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
