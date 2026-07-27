import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ShieldCheck, Ticket, MailCheck, Clock, CheckCircle2,
  XCircle, AlertTriangle, RefreshCw, ChevronRight, User,
  Sparkles, ExternalLink, Send, ArrowRight, Shield, Check, X,
  Bell,
} from 'lucide-react';
import { sanitizeHtml } from '../utils/sanitize';
import api from '../api/client';

export default function ValidationCenter({ defaultTab = 'tickets' }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || defaultTab;

  const [pendingTickets, setPendingTickets] = useState([]);
  const [pendingDrafts, setPendingDrafts] = useState([]);
  const [reminderDrafts, setReminderDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modale de rejet ticket
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTicketId, setRejectTicketId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Modale d'approbation combinée (Ticket GLPI + Réponse IA)
  const [showCombinedModal, setShowCombinedModal] = useState(false);
  const [combinedDraft, setCombinedDraft] = useState(null);
  const [approvingCombined, setApprovingCombined] = useState(false);

  // Édition de brouillon
  const [editingDraftId, setEditingDraftId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  function loadAllData(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    Promise.all([
      api.get('/tickets?approvalStatus=PENDING&limit=100').catch(() => ({ data: { tickets: [] } })),
      api.get('/dashboard/pending-ai-drafts').catch(() => ({ data: [] })),
    ])
      .then(([ticketsRes, draftsRes]) => {
        const ticketList = Array.isArray(ticketsRes.data)
          ? ticketsRes.data
          : ticketsRes.data?.items || [];
        setPendingTickets(ticketList);

        const draftList = Array.isArray(draftsRes.data) ? draftsRes.data : [];
        setPendingDrafts(draftList.filter((d) => d.draftKind !== 'REMINDER'));
        setReminderDrafts(draftList.filter((d) => d.draftKind === 'REMINDER'));
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur lors du chargement des validations'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    loadAllData();
  }, []);

  function handleTabChange(tab) {
    setSearchParams({ tab });
  }

  // --- ACTIONS TICKET PENDING ---
  async function handleApproveTicket(ticketId) {
    try {
      const res = await api.post(`/tickets/${ticketId}/approve`);
      toast.success(`Ticket #${ticketId} approuvé ! GLPI #${res.data.glpiTicketId || ''}`);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'approbation du ticket');
    }
  }

  function openRejectModal(ticketId) {
    setRejectTicketId(ticketId);
    setRejectReason('');
    setShowRejectModal(true);
  }

  async function handleConfirmRejectTicket() {
    if (!rejectReason.trim()) {
      toast.error('La raison du rejet est obligatoire');
      return;
    }
    setRejecting(true);
    try {
      await api.post(`/tickets/${rejectTicketId}/reject`, { reason: rejectReason.trim() });
      toast.success('Ticket rejeté');
      setShowRejectModal(false);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du rejet');
    } finally {
      setRejecting(false);
    }
  }

  // --- ACTIONS BROUILLON IA ---
  async function handleApproveDraft(draft) {
    const ticketObj = draft.ticket;
    const isTicketPending = ticketObj && (!ticketObj.glpiTicketId || ticketObj.approvalStatus === 'PENDING');

    if (isTicketPending) {
      // Déclencher la modale d'approbation combinée !
      setCombinedDraft(draft);
      setShowCombinedModal(true);
      return;
    }

    // Ticket déjà dans GLPI : approuver directement le brouillon
    try {
      await api.post(`/ai-email-drafts/${draft.id}/approve`);
      toast.success('Réponse IA approuvée et envoyée au demandeur !');
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'envoi de la réponse');
    }
  }

  async function handleConfirmCombinedApproval() {
    if (!combinedDraft) return;
    setApprovingCombined(true);
    try {
      const ticketId = combinedDraft.ticketId || combinedDraft.ticket?.id;

      // Step 1: Approuver le ticket dans GLPI s'il est en attente
      if (ticketId && combinedDraft.ticket?.approvalStatus === 'PENDING') {
        await api.post(`/tickets/${ticketId}/approve`);
      }

      // Step 2: Approuver et envoyer le brouillon de réponse
      await api.post(`/ai-email-drafts/${combinedDraft.id}/approve`);

      toast.success('Ticket GLPI créé ET Réponse IA envoyée avec succès !');
      setShowCombinedModal(false);
      setCombinedDraft(null);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'approbation combinée');
    } finally {
      setApprovingCombined(false);
    }
  }

  async function handleRejectDraft(draftId) {
    try {
      await api.post(`/ai-email-drafts/${draftId}/reject`);
      toast.success('Brouillon de réponse rejeté');
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du rejet');
    }
  }

  async function handleSaveDraftEdit(draftId) {
    setSavingDraft(true);
    try {
      await api.patch(`/ai-email-drafts/${draftId}`, { proposedBody: editBody });
      toast.success('Brouillon mis à jour');
      setEditingDraftId(null);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification');
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* En-tête de la page */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/30 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-on-surface tracking-tight">Centre de Validation & Approbations</h1>
              <p className="text-xs text-on-surface-variant font-medium">
                Hub unifié Hotline & Techniciens pour valider la création GLPI des tickets et l'envoi des réponses IA.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => loadAllData(true)}
          disabled={refreshing}
          className="p-2.5 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container text-on-surface transition-all shrink-0 self-start sm:self-auto flex items-center gap-2 text-xs font-bold"
          title="Rafraîchir"
        >
          <RefreshCw className={`w-4 h-4 text-primary ${refreshing ? 'animate-spin' : ''}`} />
          <span>Rafraîchir</span>
        </button>
      </div>

      {/* Barre d'onglets Principale */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-surface-container border border-outline-variant/30 w-full">
        <button
          onClick={() => handleTabChange('tickets')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
            activeTab === 'tickets'
              ? 'bg-blue-600 text-white shadow-md font-extrabold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
          }`}
        >
          <Ticket className="w-4 h-4" />
          <span className="whitespace-nowrap">Tickets en attente GLPI</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap ${
            activeTab === 'tickets' ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
          }`}>
            {pendingTickets.length}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('drafts')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
            activeTab === 'drafts'
              ? 'bg-purple-600 text-white shadow-md font-extrabold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
          }`}
        >
          <MailCheck className="w-4 h-4" />
          <span className="whitespace-nowrap">Réponses Email IA</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap ${
            activeTab === 'drafts' ? 'bg-white/20 text-white' : 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
          }`}>
            {pendingDrafts.length}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('reminders')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
            activeTab === 'reminders'
              ? 'bg-amber-600 text-white shadow-md font-extrabold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span className="whitespace-nowrap">Relances Auto.</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap ${
            activeTab === 'reminders' ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
          }`}>
            {reminderDrafts.length}
          </span>
        </button>
      </div>

      {/* CONTENU DE L'ONGLET 1 : TICKETS EN ATTENTE GLPI */}
      {activeTab === 'tickets' && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-3xl bg-surface-container-low animate-pulse border border-outline-variant/20" />
              ))}
            </div>
          ) : pendingTickets.length === 0 ? (
            <div className="p-12 text-center rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-lowest space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-on-surface">Aucun ticket en attente d'approbation</h3>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Tous les tickets créés ont été validés et transmis à GLPI.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingTickets.map((t) => (
                <div
                  key={t.id}
                  className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-outline-variant/60 transition-all"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-extrabold border border-amber-500/30 uppercase tracking-wider">
                        🛡️ En attente Hotline
                      </span>
                      {t.category && (
                        <span className="px-2.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant text-[10px] font-bold border border-outline-variant/30">
                          {t.category}
                        </span>
                      )}
                      <span className="text-[11px] text-on-surface-variant font-mono">#{t.id}</span>
                    </div>

                    <h3 className="text-base font-bold text-on-surface truncate">{t.title}</h3>
                    <p className="text-xs text-on-surface-variant line-clamp-2">{t.content}</p>

                    <div className="flex items-center gap-4 text-[11px] text-on-surface-variant pt-1 flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-primary" />
                        {t.requester?.fullName || t.sourceName || t.sourceEmail || 'Demandeur anonyme'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-primary" />
                        {new Date(t.createdAt).toLocaleString('fr-FR')}
                      </span>
                    </div>
                  </div>

                  {/* Actions directes Hotline */}
                  <div className="flex items-center gap-2 shrink-0 border-t md:border-t-0 pt-4 md:pt-0 border-outline-variant/20">
                    <button
                      onClick={() => navigate(`/tickets/${t.id}`)}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all flex items-center gap-1"
                    >
                      <span>Détails</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => openRejectModal(t.id)}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      Rejeter
                    </button>

                    <button
                      onClick={() => handleApproveTicket(t.id)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      <span>Approuver GLPI</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CONTENU DE L'ONGLET 2 : RÉPONSES EMAIL IA */}
      {activeTab === 'drafts' && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-3xl bg-surface-container-low animate-pulse border border-outline-variant/20" />
              ))}
            </div>
          ) : pendingDrafts.length === 0 ? (
            <div className="p-12 text-center rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-lowest space-y-3">
              <MailCheck className="w-12 h-12 text-purple-500 mx-auto" />
              <h3 className="text-base font-bold text-on-surface">Aucune réponse IA en attente de validation</h3>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Toutes les réponses automatiques suggérées par l'IA ont été examinées et envoyées.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {pendingDrafts.map((draft) => {
                const ticketObj = draft.ticket;
                const glpiId = ticketObj?.glpiTicketId;
                const isTicketPending = ticketObj && (!glpiId || ticketObj.approvalStatus === 'PENDING');

                return (
                  <div
                    key={draft.id}
                    className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-4 hover:border-outline-variant/60 transition-all"
                  >
                    {/* Header draft avec BADGE ÉTAT GLPI */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/20 pb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-on-surface">
                            Réponse pour : {ticketObj?.title || (draft.ticketId ? `Ticket #${draft.ticketId}` : 'Ticket sans numéro')}
                          </h3>
                          <p className="text-[11px] text-on-surface-variant">
                            Demandeur : <strong className="text-on-surface">{ticketObj?.requester?.fullName || draft.recipientEmail || 'Inconnu'}</strong>
                          </p>
                          <p className="text-[11px] text-on-surface-variant mt-0.5">
                            Créé le <strong className="text-on-surface font-semibold">{new Date(draft.createdAt).toLocaleString('fr-FR')}</strong>
                          </p>
                        </div>
                      </div>

                      {/* BADGE ÉTAT GLPI CLAIR ET VISIBLE */}
                      <div className="flex items-center gap-2">
                        {glpiId ? (
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            🔗 Créé dans GLPI (#{glpiId})
                          </span>
                        ) : isTicketPending ? (
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/30 flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5" />
                            🛡️ Ticket non créé GLPI (En attente)
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-surface-container text-on-surface-variant border border-outline-variant/30">
                            Ticket Interne ERP
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Proposition de contenu IA */}
                    <div className="p-4 rounded-2xl bg-surface-container-low/40 border border-outline-variant/20 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-on-surface-variant">
                        <span>Proposition de réponse IA</span>
                        {draft.aiConfidence != null && (
                          <span className="text-purple-600 dark:text-purple-400 font-mono">
                            {Math.round(draft.aiConfidence * 100)}% confiance
                          </span>
                        )}
                      </div>

                      {editingDraftId === draft.id ? (
                        <div className="space-y-3 pt-1">
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            rows={5}
                            className="w-full p-3 rounded-xl bg-surface border border-outline-variant text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditingDraftId(null)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline-variant/40 text-on-surface hover:bg-surface-container"
                            >
                              Annuler
                            </button>
                            <button
                              onClick={() => handleSaveDraftEdit(draft.id)}
                              disabled={savingDraft}
                              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white disabled:opacity-50"
                            >
                              Enregistrer
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-on-surface leading-relaxed font-serif prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml((draft.proposedContent || '').replace(/#null\b/g, `#${draft.glpiTicketId || draft.ticketId || 'N/A'}`)) }} />
                      )}
                    </div>

                    {/* Actions sur le brouillon */}
                    <div className="flex items-center justify-between gap-4 pt-2">
                      <button
                        onClick={() => {
                          setEditingDraftId(draft.id);
                          setEditBody(draft.proposedContent);
                        }}
                        className="text-xs text-purple-600 dark:text-purple-400 font-bold hover:underline"
                      >
                        Éditer le texte de la réponse
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRejectDraft(draft.id)}
                          className="px-3.5 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all"
                        >
                          Rejeter la réponse
                        </button>

                        <button
                          onClick={() => handleApproveDraft(draft)}
                          className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md shadow-purple-500/20 transition-all flex items-center gap-1.5"
                        >
                          <Send className="w-4 h-4" />
                          <span>Approuver & Envoyer</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CONTENU DE L'ONGLET 3 : RELANCES AUTOMATIQUES */}
      {activeTab === 'reminders' && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-3xl bg-surface-container-low animate-pulse border border-outline-variant/20" />
              ))}
            </div>
          ) : reminderDrafts.length === 0 ? (
            <div className="p-12 text-center rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-lowest space-y-3">
              <Bell className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="text-base font-bold text-on-surface">Aucune relance automatique en attente</h3>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Les prochaines relances de tickets en attente apparaîtront ici pour approbation.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {reminderDrafts.map((draft) => {
                const ticketObj = draft.ticket;
                return (
                  <div
                    key={draft.id}
                    className="rounded-3xl border border-amber-200 dark:border-amber-500/20 bg-surface-container-lowest p-6 shadow-sm space-y-4 hover:border-amber-300 dark:hover:border-amber-500/30 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/20 pb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          <Bell className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-on-surface">
                            Relance pour : {ticketObj?.title || (draft.ticketId ? `Ticket #${draft.ticketId}` : 'Ticket sans numéro')}
                          </h3>
                          <p className="text-[11px] text-on-surface-variant">
                            Destinataire : <strong className="text-on-surface">{draft.recipientName || draft.recipientEmail}</strong>
                          </p>
                          <p className="text-[11px] text-on-surface-variant mt-0.5">
                            Créé le <strong className="text-on-surface font-semibold">{new Date(draft.createdAt).toLocaleString('fr-FR')}</strong>
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/30 flex items-center gap-1.5 self-start sm:self-auto">
                        <Clock className="w-3.5 h-3.5" />
                        Relance auto.
                      </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-surface-container-low/40 border border-outline-variant/20">
                      <div className="text-[11px] font-bold text-on-surface-variant mb-2">Contenu de la relance</div>
                      <div className="text-xs text-on-surface leading-relaxed font-serif prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml((draft.proposedContent || '').replace(/#null\b/g, `#${draft.glpiTicketId || draft.ticketId || 'N/A'}`)) }} />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        onClick={() => handleRejectDraft(draft.id)}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all"
                      >
                        Ne pas envoyer
                      </button>
                      <button
                        onClick={() => handleApproveDraft(draft)}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white shadow-md shadow-amber-500/20 transition-all flex items-center gap-1.5"
                      >
                        <Send className="w-4 h-4" />
                        <span>Approuver & Envoyer</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODALE REJET TICKET */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold">Raison du rejet du ticket</h3>
            </div>
            <p className="text-xs text-on-surface-variant">
              Veuillez indiquer le motif du rejet du ticket. Cette raison alimente l'apprentissage IA de la plateforme.
            </p>
            <textarea
              className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
              rows={3}
              placeholder="Ex: Doublon, hors périmètre..."
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
                onClick={handleConfirmRejectTicket}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white shadow-md shadow-red-500/20 hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {rejecting ? 'Rejet en cours...' : 'Confirmer le rejet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE D'APPROBATION COMBINÉE (TICKET GLPI + RÉPONSE IA) */}
      {showCombinedModal && combinedDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <Shield className="w-7 h-7 shrink-0" />
              <div>
                <h3 className="text-base font-bold">Ticket non encore créé dans GLPI</h3>
                <p className="text-xs text-on-surface-variant">
                  Ce ticket est actuellement en attente d'approbation Hotline dans l'ERP.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2 text-xs">
              <p className="font-bold text-on-surface">Ticket : {combinedDraft.ticket?.title}</p>
              <p className="text-on-surface-variant">
                Demandeur : <strong>{combinedDraft.ticket?.requester?.fullName || combinedDraft.recipientEmail}</strong>
              </p>
              {combinedDraft.ticket?.category && (
                <p className="text-on-surface-variant">
                  Catégorie : <strong>{combinedDraft.ticket.category}</strong>
                </p>
              )}
            </div>

            <p className="text-xs text-on-surface font-medium leading-relaxed">
              Souhaitez-vous <strong>approuver la création du ticket dans GLPI</strong> ET <strong>envoyer la réponse IA par email</strong> en une seule opération ?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowCombinedModal(false);
                  setCombinedDraft(null);
                }}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={approvingCombined}
                onClick={handleConfirmCombinedApproval}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{approvingCombined ? 'Approbation en cours...' : 'Approuver GLPI + Envoyer Réponse'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
