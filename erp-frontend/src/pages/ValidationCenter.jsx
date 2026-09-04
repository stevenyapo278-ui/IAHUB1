import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ShieldCheck, Ticket, MailCheck, Clock, CheckCircle2,
  XCircle, AlertTriangle, RefreshCw, ChevronRight, User,
  Sparkles, ExternalLink, Send, ArrowRight, Shield, Check, X,
  Bell, BookOpen, Edit3, Tags, HelpCircle, TrendingUp, Search,
} from 'lucide-react';
import { staggerContainer, staggerItem } from '../utils/animations';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { sanitizeHtml } from '../utils/sanitize';
import api from '../api/client';
import useSystemSettings from '../hooks/useSystemSettings';
import { useAuth } from '../context/AuthContext';
import { playApproval, playRejection, playError } from '../utils/sounds';
import {
  clearClosureAnalysis,
  getClosureAnalysisState,
  startClosureAnalysis,
  subscribeClosureAnalysis,
} from '../stores/closureAnalysisStore';

function matchesSearch(item, tab, q) {
  let fields = [];
  if (tab === 'tickets' || tab === 'closures') {
    fields = [
      item.title, item.content, item.category,
      item.requester?.fullName, item.sourceName, item.sourceEmail,
      String(item.id || ''),
    ];
  } else if (tab === 'drafts' || tab === 'reminders') {
    fields = [
      item.ticket?.title, item.recipientName, item.recipientEmail,
      item.proposedContent, String(item.ticketId || ''),
    ];
  } else if (tab === 'knowledge') {
    fields = [
      item.title, item.problem, item.cause, item.solution, item.category,
      ...(item.tags || []), ...(item.keywords || []),
    ];
  }
  return fields.some((v) => v && String(v).toLowerCase().includes(q));
}

export default function ValidationCenter({ defaultTab = 'tickets' }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { autonomousMode } = useSystemSettings();
  const { user } = useAuth();
  const activeTab = searchParams.get('tab') || defaultTab;

  const [pendingTickets, setPendingTickets] = useState([]);
  const [pendingDrafts, setPendingDrafts] = useState([]);
  const [reminderDrafts, setReminderDrafts] = useState([]);
  const [pendingKnowledgeDrafts, setPendingKnowledgeDrafts] = useState([]);
  const [pendingClosures, setPendingClosures] = useState([]);
  const [closureStats, setClosureStats] = useState(null);
  // Analyse des clôtures portée par le store module (survit à la navigation et au reload)
  const analysis = useSyncExternalStore(subscribeClosureAnalysis, getClosureAnalysisState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modale de rejet ticket
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTicketId, setRejectTicketId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Modale de rejet de clôture suggérée
  const [showClosureRejectModal, setShowClosureRejectModal] = useState(false);
  const [closureRejectTicketId, setClosureRejectTicketId] = useState(null);
  const [closureRejectReason, setClosureRejectReason] = useState('');
  const [rejectingClosure, setRejectingClosure] = useState(false);
  const [validatingClosureId, setValidatingClosureId] = useState(null);

  // Modale d'approbation combinée (Ticket GLPI + Réponse IA)
  const [showCombinedModal, setShowCombinedModal] = useState(false);
  const [combinedDraft, setCombinedDraft] = useState(null);
  const [approvingCombined, setApprovingCombined] = useState(false);

  // Édition de brouillon
  const [editingDraftId, setEditingDraftId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  // Modale d'approbation connaissance
  const [showKbApproveModal, setShowKbApproveModal] = useState(false);
  const [kbDraftToApprove, setKbDraftToApprove] = useState(null);
  const [approvingKb, setApprovingKb] = useState(false);

  // Modale de rejet connaissance
  const [showKbRejectModal, setShowKbRejectModal] = useState(false);
  const [kbDraftToReject, setKbDraftToReject] = useState(null);
  const [kbRejectReason, setKbRejectReason] = useState('');
  const [rejectingKb, setRejectingKb] = useState(false);

  // Édition de brouillon connaissance
  const [editingKbDraftId, setEditingKbDraftId] = useState(null);
  const [editingKbFields, setEditingKbFields] = useState({ title: '', problem: '', cause: '', solution: '' });
  const [savingKbDraft, setSavingKbDraft] = useState(false);

  // Recherche + pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  function loadAllData(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    const isTechnician = user?.role === 'TECHNICIAN';
    const mineFilter = isTechnician ? '&mine=true' : '';

    Promise.all([
      api.get('/tickets?approvalStatus=PENDING&limit=100').catch(() => ({ data: { tickets: [] } })),
      api.get(`/tickets?closeSuggested=true${mineFilter}&limit=100`).catch(() => ({ data: { tickets: [] } })),
      api.get('/dashboard/pending-ai-drafts').catch(() => ({ data: [] })),
      api.get('/knowledge/drafts').catch(() => ({ data: [] })),
      api.get('/dashboard/closure-stats?days=30').catch(() => null),
    ])
      .then(([ticketsRes, closuresRes, draftsRes, knowledgeRes, closureStatsRes]) => {
        const ticketList = Array.isArray(ticketsRes.data)
          ? ticketsRes.data
          : ticketsRes.data?.items || [];
        // Les tickets d'expéditeurs à risque passent en tête de file pour la revue Hotline
        ticketList.sort((a, b) => (b.lowTrustSender ? 1 : 0) - (a.lowTrustSender ? 1 : 0));
        setPendingTickets(ticketList);

        const closureList = Array.isArray(closuresRes.data)
          ? closuresRes.data
          : closuresRes.data?.items || [];
        closureList.sort((a, b) => new Date(b.closeSuggestedAt || 0) - new Date(a.closeSuggestedAt || 0));
        setPendingClosures(closureList);

        const draftList = Array.isArray(draftsRes.data) ? draftsRes.data : [];
        setPendingDrafts(draftList.filter((d) => d.draftKind !== 'REMINDER'));
        setReminderDrafts(draftList.filter((d) => d.draftKind === 'REMINDER'));

        const knowledgeList = Array.isArray(knowledgeRes.data) ? knowledgeRes.data : [];
        setPendingKnowledgeDrafts(knowledgeList);

        // Statistiques + série temporelle de l'évolution des clôtures suggérées
        setClosureStats(closureStatsRes?.data || null);
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
    setCurrentPage(1);
  }

  const activeList = {
    tickets: pendingTickets,
    drafts: pendingDrafts,
    reminders: reminderDrafts,
    closures: pendingClosures,
    knowledge: pendingKnowledgeDrafts,
  }[activeTab] || [];

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredList = normalizedQuery
    ? activeList.filter((item) => matchesSearch(item, activeTab, normalizedQuery))
    : activeList;

  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedList = filteredList.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = filteredList.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, filteredList.length);
  const searchPlaceholder = {
    tickets: 'Rechercher un ticket (titre, demandeur, #id)...',
    drafts: 'Rechercher une réponse IA (ticket, destinataire, contenu)...',
    reminders: 'Rechercher une relance (ticket, destinataire)...',
    closures: 'Rechercher un ticket à clôturer (titre, demandeur)...',
    knowledge: 'Rechercher un article (titre, problème, solution, tags)...',
  }[activeTab] || 'Rechercher...';

  // --- ACTIONS TICKET PENDING ---
  async function handleApproveTicket(ticketId) {
    try {
      const res = await api.post(`/tickets/${ticketId}/approve`);
      playApproval();
      toast.success(
        autonomousMode
          ? `Ticket #${ticketId} approuvé !`
          : `Ticket #${ticketId} approuvé ! GLPI #${res.data.glpiTicketId || ''}`
      );
      loadAllData(true);
    } catch (err) {
      playError();
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
      playRejection();
      toast.success('Ticket rejeté');
      setShowRejectModal(false);
      loadAllData(true);
    } catch (err) {
      playError();
      toast.error(err.response?.data?.error || 'Erreur lors du rejet');
    } finally {
      setRejecting(false);
    }
  }

  // --- ACTIONS CLÔTURE SUGGÉRÉE IA ---
  async function handleValidateClosure(ticketId) {
    setValidatingClosureId(ticketId);
    try {
      await api.post(`/tickets/${ticketId}/validate-close`);
      playApproval();
      toast.success(`Clôture du ticket #${ticketId} validée`);
      loadAllData(true);
    } catch (err) {
      playError();
      toast.error(err.response?.data?.error || "Erreur lors de la validation de la clôture");
    } finally {
      setValidatingClosureId(null);
    }
  }

  function openClosureRejectModal(ticketId) {
    setClosureRejectTicketId(ticketId);
    setClosureRejectReason('');
    setShowClosureRejectModal(true);
  }

  // Analyse proactive : portée par closureAnalysisStore — naviguer vers une autre
  // vue pendant le scan ne l'interrompt pas, et le rapport reste affiché au retour
  // (mémoire + sessionStorage, 2 h max).
  const lastFinishedAtRef = useRef(null);
  useEffect(() => {
    const finishedAt = analysis.results?.finishedAt;
    if (!analysis.running && finishedAt && lastFinishedAtRef.current !== finishedAt) {
      lastFinishedAtRef.current = finishedAt;
      const r = analysis.results;
      if (r.suggested > 0) {
        toast.success(`${r.suggested} clôture(s) suggérée(s) sur ${r.scanned} ticket(s) analysé(s)`);
      } else if (r.scanned === 0) {
        toast.info('Aucun ticket à analyser : aucun ticket ouvert sans réponse récente');
      } else {
        toast.info(`Analyse terminée : ${r.scanned} ticket(s) analysé(s), aucune nouvelle clôture suggérée`);
      }
      loadAllData(true);
    }
  }, [analysis]);

  async function handleAnalyzeClosures() {
    // Un nouveau scan repart d'un panneau vierge (comportement historique)
    clearClosureAnalysis();
    lastFinishedAtRef.current = null;
    await startClosureAnalysis();
    if (getClosureAnalysisState().error) {
      toast.error(getClosureAnalysisState().error);
    } else if (!analysis.running && !analysis.results) {
      toast.error("Échec de l'analyse des tickets");
    }
  }

  async function handleConfirmClosureReject() {
    if (!closureRejectReason.trim()) {
      toast.error('La raison du rejet est obligatoire');
      return;
    }
    setRejectingClosure(true);
    try {
      await api.post(`/tickets/${closureRejectTicketId}/reject-close`, { reason: closureRejectReason.trim() });
      playRejection();
      toast.success('Clôture rejetée — le ticket reste actif');
      setShowClosureRejectModal(false);
      loadAllData(true);
    } catch (err) {
      playError();
      toast.error(err.response?.data?.error || 'Erreur lors du rejet de la clôture');
    } finally {
      setRejectingClosure(false);
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

      toast.success(
        autonomousMode
          ? 'Ticket approuvé ET Réponse IA envoyée avec succès !'
          : 'Ticket GLPI créé ET Réponse IA envoyée avec succès !'
      );
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
      await api.patch(`/ai-email-drafts/${draftId}`, { proposedContent: editBody });
      toast.success('Brouillon mis à jour');
      setEditingDraftId(null);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification');
    } finally {
      setSavingDraft(false);
    }
  }

  // --- ACTIONS BROUILLON CONNAISSANCE ---
  function openKbApproveModal(draft) {
    setKbDraftToApprove(draft);
    setShowKbApproveModal(true);
  }

  async function handleKbApproveConfirm() {
    if (!kbDraftToApprove) return;
    setApprovingKb(true);
    try {
      await api.post(`/knowledge/drafts/${kbDraftToApprove.id}/approve`);
      toast.success('Article de connaissance publié dans la KB !');
      setShowKbApproveModal(false);
      setKbDraftToApprove(null);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'approbation du brouillon');
    } finally {
      setApprovingKb(false);
    }
  }

  function openKbRejectModal(draft) {
    setKbDraftToReject(draft);
    setKbRejectReason('');
    setShowKbRejectModal(true);
  }

  async function handleKbRejectConfirm() {
    if (!kbDraftToReject) return;
    if (!kbRejectReason.trim()) {
      toast.error('Veuillez indiquer une raison de rejet');
      return;
    }
    setRejectingKb(true);
    try {
      await api.post(`/knowledge/drafts/${kbDraftToReject.id}/reject`, { reason: kbRejectReason.trim() });
      toast.success('Brouillon de connaissance rejeté');
      setShowKbRejectModal(false);
      setKbDraftToReject(null);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du rejet');
    } finally {
      setRejectingKb(false);
    }
  }

  function startKbEdit(draft) {
    setEditingKbDraftId(draft.id);
    setEditingKbFields({
      title: draft.title,
      problem: draft.problem,
      cause: draft.cause,
      solution: draft.solution,
    });
  }

  async function handleKbSaveEdit() {
    if (!editingKbDraftId) return;
    setSavingKbDraft(true);
    try {
      await api.patch(`/knowledge/drafts/${editingKbDraftId}`, editingKbFields);
      toast.success('Brouillon mis à jour');
      setEditingKbDraftId(null);
      loadAllData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification');
    } finally {
      setSavingKbDraft(false);
    }
  }

  const noResultsBlock = (
    <div className="p-12 text-center bento-card border-dashed space-y-3">
      <Search className="w-12 h-12 text-on-surface-variant/40 mx-auto" />
      <h3 className="text-base font-bold text-on-surface">Aucun résultat pour cette recherche</h3>
      <p className="text-xs text-on-surface-variant max-w-md mx-auto">
        Aucun élément ne correspond à « {searchQuery.trim()} ». Essayez avec d'autres mots-clés.
      </p>
    </div>
  );

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* En-tête de la page */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/30 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary text-on-primary shadow-md">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-on-surface tracking-tight">Centre de Validation & Approbations</h1>
              <p className="text-xs text-on-surface-variant font-medium">
                {autonomousMode
                  ? "Hub unifié Hotline & Techniciens pour valider la création des tickets et l'envoi des réponses IA."
                  : "Hub unifié Hotline & Techniciens pour valider la création GLPI des tickets et l'envoi des réponses IA."}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => loadAllData(true)}
          disabled={refreshing}
          className="p-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container text-on-surface transition-all shrink-0 self-start sm:self-auto flex items-center gap-2 text-xs font-bold"
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
          <span className="whitespace-nowrap">{autonomousMode ? 'Tickets en attente' : 'Tickets en attente GLPI'}</span>
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

        <button
          onClick={() => handleTabChange('closures')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
            activeTab === 'closures'
              ? 'bg-cyan-600 text-white shadow-md font-extrabold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span className="whitespace-nowrap">Clôtures IA</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap ${
            activeTab === 'closures' ? 'bg-white/20 text-white' : 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
          }`}>
            {pendingClosures.length}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('knowledge')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
            activeTab === 'knowledge'
              ? 'bg-emerald-600 text-white shadow-md font-extrabold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span className="whitespace-nowrap">Connaissances</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap ${
            activeTab === 'knowledge' ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
          }`}>
            {pendingKnowledgeDrafts.length}
          </span>
        </button>
      </div>

      {/* Barre de recherche + nombre d'affichage par page */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            placeholder={searchPlaceholder}
            className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-surface-container-lowest border border-outline-variant/40 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-surface-container-high text-on-surface-variant transition-all"
              title="Effacer la recherche"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="vc-page-size" className="text-xs font-semibold text-on-surface-variant whitespace-nowrap">
            Afficher par page :
          </label>
          <select
            id="vc-page-size"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            className="py-2.5 px-3 rounded-2xl bg-surface-container-lowest border border-outline-variant/40 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
          >
            {[5, 10, 25, 50].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* CONTENU DE L'ONGLET 1 : TICKETS EN ATTENTE GLPI */}
      {activeTab === 'tickets' && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bento-card animate-pulse" />
              ))}
            </div>
          ) : filteredList.length === 0 ? (
            activeList.length === 0 ? (
              <div className="p-12 text-center bento-card border-dashed space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <h3 className="text-base font-bold text-on-surface">Aucun ticket en attente d'approbation</h3>
                <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                  {autonomousMode
                    ? 'Tous les tickets créés ont été validés.'
                    : 'Tous les tickets créés ont été validés et transmis à GLPI.'}
                </p>
              </div>
            ) : noResultsBlock
          ) : (
            <div className="space-y-4">
              {paginatedList.map((t) => (
                <div
                  key={t.id}
                  className="bento-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover-interactive transition-all"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-extrabold border border-amber-500/30 uppercase tracking-wider">
                        🛡️ En attente Hotline
                      </span>
                      {t.lowTrustSender && (
                        <span
                          className="px-2.5 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-extrabold border border-red-500/40 uppercase tracking-wider"
                          title="Cet expéditeur a un taux de rejets élevé par la Hotline : sa suggestion IA est à vérifier avec une attention particulière"
                        >
                          ⚠️ Expéditeur à risque
                        </span>
                      )}
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
                      <span>{autonomousMode ? 'Approuver' : 'Approuver GLPI'}</span>
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
                <div key={i} className="h-40 bento-card animate-pulse" />
              ))}
            </div>
          ) : filteredList.length === 0 ? (
            activeList.length === 0 ? (
              <div className="p-12 text-center bento-card border-dashed space-y-3">
                <MailCheck className="w-12 h-12 text-purple-500 mx-auto" />
                <h3 className="text-base font-bold text-on-surface">Aucune réponse IA en attente de validation</h3>
                <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                  Toutes les réponses automatiques suggérées par l'IA ont été examinées et envoyées.
                </p>
              </div>
            ) : noResultsBlock
          ) : (
            <div className="space-y-6">
              {paginatedList.map((draft) => {
                const ticketObj = draft.ticket;
                const glpiId = ticketObj?.glpiTicketId;
                const isTicketPending = ticketObj && (!glpiId || ticketObj.approvalStatus === 'PENDING');

                return (
                  <div
                    key={draft.id}
                    className="bento-card p-6 space-y-4 hover-interactive transition-all"
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
                            {autonomousMode ? '🛡️ Ticket en attente d\'approbation' : '🛡️ Ticket non créé GLPI (En attente)'}
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-surface-container text-on-surface-variant border border-outline-variant/30">
                            {autonomousMode ? '✅ Ticket approuvé' : 'Ticket Interne ERP'}
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
                          onClick={() => handleApproveDraft(draft)}                           className="px-4 py-2 rounded-xl text-xs font-bold btn-primary shadow-md transition-all flex items-center gap-1.5"
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
                <div key={i} className="h-32 bento-card animate-pulse" />
              ))}
            </div>
          ) : filteredList.length === 0 ? (
            activeList.length === 0 ? (
              <div className="p-12 text-center bento-card border-dashed space-y-3">
                <Bell className="w-12 h-12 text-amber-500 mx-auto" />
                <h3 className="text-base font-bold text-on-surface">Aucune relance automatique en attente</h3>
                <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                  Les prochaines relances de tickets en attente apparaîtront ici pour approbation.
                </p>
              </div>
            ) : noResultsBlock
          ) : (
            <div className="space-y-6">
              {paginatedList.map((draft) => {
                const ticketObj = draft.ticket;
                return (
                  <div
                    key={draft.id}
                    className="bento-card p-6 space-y-4 hover-interactive transition-all" style={{ borderColor: 'color-mix(in srgb, var(--skin-warning) 25%, var(--color-border))' }}
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
                        onClick={() => handleApproveDraft(draft)}                         className="px-4 py-2 rounded-xl text-xs font-bold btn-secondary shadow-md transition-all flex items-center gap-1.5"
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

      {/* CONTENU DE L'ONGLET CLÔTURES IA */}
      {activeTab === 'closures' && (
        <div className="space-y-4">
          {/* Action : analyse proactive de l'état des tickets (ADMIN/HOTLINE uniquement) */}
          {user?.role !== 'TECHNICIAN' && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-on-surface-variant">
              L'analyse scanne les tickets ouverts sans réponse utilisateur récente et détecte les résolutions probables à valider.
            </p>
            <button
              onClick={handleAnalyzeClosures}
              disabled={analysis.running}               className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold btn-primary shadow-md transition-all disabled:opacity-50 cursor-pointer shrink-0"
              title="Analyser l'état des tickets ouverts pour détecter les clôtures à proposer"
            >
              <RefreshCw className={`w-4 h-4 ${analysis.running ? 'animate-spin' : ''}`} />
              <span>{analysis.running ? 'Analyse en cours…' : 'Analyser les tickets'}</span>
            </button>
          </div>
          )}

          {/* Résultats détaillés de la dernière analyse IA */}
          {analysis.results && (
            <div className="space-y-4">
              {/* Résumé rapide */}
              <div className="bento-card p-6 space-y-4" style={{ borderColor: 'color-mix(in srgb, #06b6d4 20%, var(--color-border))' }}>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-500" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface">
                    Résultats de l'analyse — {analysis.results.scanned} ticket(s) analysé(s)
                  </h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Suggérés</p>
                    <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{analysis.results.suggested}</p>
                  </div>
                  <div className="p-3 rounded-2xl border border-amber-500/25 bg-amber-500/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">À vérifier</p>
                    <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{analysis.results.needsReviewResults?.length || 0}</p>
                  </div>
                  <div className="p-3 rounded-xl border border-outline-variant/30 bg-surface-container">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Ignorés</p>
                    <p className="text-2xl font-extrabold text-on-surface">{analysis.results.skippedResults?.length || 0}</p>
                  </div>
                  <div className="p-3 rounded-xl border border-outline-variant/30 bg-surface-container">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Non résolus</p>
                    <p className="text-2xl font-extrabold text-on-surface">{analysis.results.results?.filter(r => r.action === 'SKIP_NOT_RESOLVED').length || 0}</p>
                  </div>
                </div>
              </div>

              {/* Tickets suggérés pour clôture */}
              {analysis.results.suggestedResults?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Probablement résolus — clôture suggérée ({analysis.results.suggestedResults.length})
                  </h4>
                  {analysis.results.suggestedResults.map((r) => (
                    <div key={r.ticketId} className="rounded-xl border bg-surface-container-lowest p-4 shadow-sm space-y-3" style={{ borderColor: 'color-mix(in srgb, #10b981 20%, var(--color-border))' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-primary">#{r.ticketId}</span>
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-extrabold border border-emerald-500/30">
                              ✅ Résolu ({Math.round((r.confidence || 0) * 100)}%)
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant text-[10px] font-bold border border-outline-variant/30">
                              {r.priority} — {r.category || 'Sans catégorie'}
                            </span>
                            {r.slaBreached && (
                              <span className="px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-extrabold border border-red-500/30">
                                ⚠️ SLA dépassé
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-bold text-on-surface truncate">{r.title}</p>
                          <p className="text-xs text-on-surface-variant line-clamp-2">{r.content || r.aiSummary || 'Pas de résumé'}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => navigate(`/tickets/${r.ticketId}`)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
                          >
                            Voir
                          </button>
                          <button
                            onClick={() => handleValidateClosure(r.ticketId)}
                            disabled={validatingClosureId === r.ticketId}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all flex items-center gap-1 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {validatingClosureId === r.ticketId ? '...' : 'Valider'}
                          </button>
                        </div>
                      </div>
                      {/* Preuve IA */}
                      {r.evidence && (
                        <div className="p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                          <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">Preuve IA :</p>
                          <p className="text-[11px] text-on-surface-variant italic">"{r.evidence}"</p>
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-on-surface-variant">
                        <span>Ouvert {r.daysOpen}j</span>
                        {r.daysSilent != null && <span>Silence {r.daysSilent}j</span>}
                        {r.assignedTo && <span>Assigné à {r.assignedTo}</span>}
                        {r.previousSuggestions > 0 && <span className="text-amber-500">{r.previousSuggestions} suggestion(s) précédente(s)</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tickets à vérifier (faible confiance ou non résolu) */}
              {analysis.results.needsReviewResults?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    À vérifier — confiance faible ou incertain ({analysis.results.needsReviewResults.length})
                  </h4>
                  {analysis.results.needsReviewResults.map((r) => (
                    <div key={r.ticketId} className="rounded-xl border bg-surface-container-lowest p-4 shadow-sm space-y-2" style={{ borderColor: 'color-mix(in srgb, #f59e0b 20%, var(--color-border))' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-primary">#{r.ticketId}</span>
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-extrabold border border-amber-500/30">
                              ⚠️ {r.action === 'SKIP_LOW_CONFIDENCE' ? 'Faible confiance' : 'Incertain'} ({Math.round((r.confidence || 0) * 100)}%)
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant text-[10px] font-bold border border-outline-variant/30">
                              {r.priority} — {r.category || 'Sans catégorie'}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-on-surface truncate">{r.title}</p>
                        </div>
                        <button
                          onClick={() => navigate(`/tickets/${r.ticketId}`)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all shrink-0"
                        >
                          Voir le ticket
                        </button>
                      </div>
                      {r.evidence && (
                        <div className="p-2 rounded-xl bg-amber-500/5 border border-amber-500/15">
                          <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mb-0.5">Preuve :</p>
                          <p className="text-[11px] text-on-surface-variant italic">"{r.evidence}"</p>
                        </div>
                      )}
                      <p className="text-[11px] text-on-surface-variant">{r.reasoning}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Tickets ignorés (pas d'historique, réponse récente, etc.) */}
              {analysis.results.skippedResults?.length > 0 && (
                <details className="group">
                  <summary className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant cursor-pointer flex items-center gap-2 hover:text-on-surface transition-colors">
                    <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                    Ignorés — pas d'action requise ({analysis.results.skippedResults.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {analysis.results.skippedResults.map((r) => (
                      <div key={r.ticketId} className="rounded-xl border border-outline-variant/20 bg-surface-container-low/30 p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[10px] font-bold text-primary">#{r.ticketId}</span>
                          <span className="text-[11px] text-on-surface truncate">{r.title}</span>
                          <span className="text-[10px] text-on-surface-variant shrink-0">— {r.reasoning}</span>
                        </div>
                        <button
                          onClick={() => navigate(`/tickets/${r.ticketId}`)}
                          className="text-[10px] text-primary font-bold hover:underline shrink-0"
                        >
                          Voir
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Suivi de l'évolution : file actuelle + tendance 30 jours (ADMIN/HOTLINE uniquement) */}
          {closureStats && user?.role !== 'TECHNICIAN' && (
            <div className="bento-card p-6 space-y-5">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-500" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface">
                  Évolution des clôtures suggérées — 30 jours
                </h3>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="p-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/10">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">En attente</p>
                  <p className="text-2xl font-extrabold text-on-surface">{closureStats.pending}</p>
                </div>
                <div className="p-3 rounded-2xl border border-outline-variant/30 bg-surface-container">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Suggérées</p>
                  <p className="text-2xl font-extrabold text-on-surface">{closureStats.suggested}</p>
                </div>
                <div className="p-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Validées</p>
                  <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{closureStats.validated}</p>
                </div>
                <div className="p-3 rounded-2xl border border-red-500/25 bg-red-500/10">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Rejetées</p>
                  <p className="text-2xl font-extrabold text-red-600 dark:text-red-400">{closureStats.rejected}</p>
                </div>
                <div className="p-3 rounded-2xl border border-outline-variant/30 bg-surface-container">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Acceptation</p>
                  <p className={`text-2xl font-extrabold ${closureStats.acceptanceRate === null || closureStats.acceptanceRate >= 50 ? 'text-on-surface' : 'text-red-500'}`}>
                    {closureStats.acceptanceRate === null ? '—' : `${closureStats.acceptanceRate}%`}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Suggérées vs décisions Hotline (par jour)
                </p>
                <div className="w-full" style={{ height: '180px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={closureStats.series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" strokeOpacity={0.4} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d) => d.slice(8, 10) + '/' + d.slice(5, 7)}
                        tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} />
                      <Tooltip
                        cursor={{ fill: 'var(--color-surface-container-high)' }}
                        contentStyle={{
                          backgroundColor: 'var(--color-surface-container-lowest)',
                          border: '1px solid var(--color-outline-variant)',
                          borderRadius: '12px',
                          fontSize: '11px',
                        }}
                        labelFormatter={(d) => new Date(d).toLocaleDateString('fr-FR')}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="suggested" name="Suggérées" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="validated" name="Validées" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="rejected" name="Rejetées" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {closureStats.acceptanceRate !== null && closureStats.acceptanceRate < 50 && (
                  <p className="text-[11px] text-red-500 font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Taux d'acceptation sous 50 % : la classification IA dérive, vérifier le prompt analyzeIntent.
                  </p>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bento-card animate-pulse" />
              ))}
            </div>
          ) : filteredList.length === 0 ? (
            activeList.length === 0 ? (
              <div className="p-12 text-center bento-card border-dashed space-y-3">
                <CheckCircle2 className="w-12 h-12 text-cyan-500 mx-auto" />
                <h3 className="text-base font-bold text-on-surface">Aucune clôture suggérée en attente</h3>
                <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                  {user?.role === 'TECHNICIAN'
                    ? "Aucune clôture suggérée par l'IA sur vos tickets assignés pour le moment."
                    : "L'IA ne clôt plus les tickets automatiquement : lorsqu'elle détecte un problème résolu, elle propose la clôture ici pour validation par la Hotline."}
                </p>
              </div>
            ) : noResultsBlock
          ) : (
            <div className="space-y-4">
              {paginatedList.map((t) => (
                <div
                  key={t.id}
                  className="bento-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover-interactive transition-all" style={{ borderColor: 'color-mix(in srgb, #06b6d4 25%, var(--color-border))' }}
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 text-[10px] font-extrabold border border-cyan-500/30 uppercase tracking-wider">
                        🤖 Clôture suggérée par l'IA
                      </span>
                      {typeof t.closeSuggestionConfidence === 'number' && (
                        <span className="px-2.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant text-[10px] font-bold border border-outline-variant/30">
                          Confiance : {Math.round(t.closeSuggestionConfidence * 100)}%
                        </span>
                      )}
                      {t.lowTrustClosureSender && (
                        <span
                          className="px-2.5 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-extrabold border border-red-500/40 uppercase tracking-wider"
                          title="Les suggestions de clôture de cet expéditeur ont déjà été rejetées plusieurs fois par la Hotline : cliquez « Détails » et vérifiez avant de valider."
                        >
                          ⚠️ Clôtures souvent injustifiées
                        </span>
                      )}
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
                        Suggérée le {t.closeSuggestedAt ? new Date(t.closeSuggestedAt).toLocaleString('fr-FR') : new Date(t.createdAt).toLocaleString('fr-FR')}
                      </span>
                    </div>
                  </div>

                  {/* Actions Hotline */}
                  <div className="flex items-center gap-2 shrink-0 border-t md:border-t-0 pt-4 md:pt-0 border-outline-variant/20">
                    <button
                      onClick={() => navigate(`/tickets/${t.id}`)}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all flex items-center gap-1"
                    >
                      <span>Détails</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => openClosureRejectModal(t.id)}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      Refuser
                    </button>

                    <button
                      onClick={() => handleValidateClosure(t.id)}
                      disabled={validatingClosureId === t.id}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-md shadow-cyan-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      <span>{validatingClosureId === t.id ? 'Validation...' : 'Valider la clôture'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CONTENU DE L'ONGLET 4 : CONNAISSANCES (KnowledgeDraft) */}
      {activeTab === 'knowledge' && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 bento-card animate-pulse" />
              ))}
            </div>
          ) : filteredList.length === 0 ? (
            activeList.length === 0 ? (
              <div className="p-12 text-center bento-card border-dashed space-y-3">
                <BookOpen className="w-12 h-12 text-emerald-500 mx-auto" />
                <h3 className="text-base font-bold text-on-surface">Aucun brouillon de connaissance en attente</h3>
                <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                  Utilisez le bouton "Capturer dans la KB" depuis un ticket résolu pour générer un article de base de connaissances.
                </p>
              </div>
            ) : noResultsBlock
          ) : (
            <div className="space-y-6">
              {paginatedList.map((draft) => {
                const isEditing = editingKbDraftId === draft.id;
                return (
                  <div
                    key={draft.id}
                    className="bento-card p-6 space-y-4 hover-interactive transition-all" style={{ borderColor: 'color-mix(in srgb, #10b981 25%, var(--color-border))' }}
                  >
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/20 pb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          {isEditing ? (
                            <input
                              value={editingKbFields.title}
                              onChange={(e) => setEditingKbFields(p => ({ ...p, title: e.target.value }))}
                              className="w-full bg-surface border border-outline-variant/60 rounded-lg px-3 py-1.5 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                          ) : (
                            <h3 className="text-sm font-bold text-on-surface">{draft.title}</h3>
                          )}
                          <p className="text-[11px] text-on-surface-variant mt-0.5">
                            {draft.ticket ? (
                              <>Ticket associé : <strong className="text-on-surface">#{draft.ticket.id} — {draft.ticket.title}</strong></>
                            ) : (
                              <span className="italic">Aucun ticket associé</span>
                            )}
                          </p>
                          <p className="text-[11px] text-on-surface-variant">
                            Créé le <strong className="text-on-surface font-semibold">{new Date(draft.createdAt).toLocaleString('fr-FR')}</strong>
                          </p>
                        </div>
                      </div>

                      {/* Badge catégorie + tags */}
                      <div className="flex items-center gap-2 flex-wrap shrink-0">
                        {draft.category && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30">
                            {draft.category}
                          </span>
                        )}
                        {draft.keywords?.length > 0 && (
                          <span className="text-[10px] text-on-surface-variant font-mono">
                            {draft.keywords.slice(0, 3).join(', ')}{draft.keywords.length > 3 ? '...' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Content fields */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-3 rounded-2xl bg-surface-container-low/40 border border-outline-variant/20">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1 mb-1.5">
                          <AlertTriangle className="w-3 h-3" />
                          Problème
                        </span>
                        {isEditing ? (
                          <textarea
                            value={editingKbFields.problem}
                            onChange={(e) => setEditingKbFields(p => ({ ...p, problem: e.target.value }))}
                            rows={3}
                            className="w-full p-1.5 rounded-lg bg-surface border border-outline-variant/60 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        ) : (
                          <p className="text-xs text-on-surface leading-relaxed whitespace-pre-wrap">{draft.problem}</p>
                        )}
                      </div>
                      <div className="p-3 rounded-2xl bg-surface-container-low/40 border border-outline-variant/20">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-1.5">
                          <HelpCircle className="w-3 h-3" />
                          Cause
                        </span>
                        {isEditing ? (
                          <textarea
                            value={editingKbFields.cause}
                            onChange={(e) => setEditingKbFields(p => ({ ...p, cause: e.target.value }))}
                            rows={3}
                            className="w-full p-1.5 rounded-lg bg-surface border border-outline-variant/60 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        ) : (
                          <p className="text-xs text-on-surface leading-relaxed whitespace-pre-wrap">{draft.cause}</p>
                        )}
                      </div>
                      <div className="p-3 rounded-2xl bg-surface-container-low/40 border border-outline-variant/20 md:col-span-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-1.5">
                          <CheckCircle2 className="w-3 h-3" />
                          Solution
                        </span>
                        {isEditing ? (
                          <textarea
                            value={editingKbFields.solution}
                            onChange={(e) => setEditingKbFields(p => ({ ...p, solution: e.target.value }))}
                            rows={3}
                            className="w-full p-1.5 rounded-lg bg-surface border border-outline-variant/60 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        ) : (
                          <p className="text-xs text-on-surface leading-relaxed whitespace-pre-wrap">{draft.solution}</p>
                        )}
                      </div>
                    </div>

                    {/* Tags */}
                    {draft.tags?.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Tags className="w-3 h-3 text-on-surface-variant" />
                        {draft.tags.map(t => (
                          <span key={t} className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant border border-outline-variant/30 text-[10px] font-medium">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/20">
                      <button
                        onClick={() => isEditing ? null : startKbEdit(draft)}
                        className="text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:underline flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        {isEditing ? 'Modification en cours...' : 'Modifier le brouillon'}
                      </button>

                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingKbDraftId(null)}
                            className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
                          >
                            Annuler
                          </button>
                          <button
                            onClick={handleKbSaveEdit}
                            disabled={savingKbDraft}
                            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white disabled:opacity-50 hover:brightness-110 transition-all"
                          >
                            {savingKbDraft ? 'Enregistrement...' : 'Enregistrer'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openKbRejectModal(draft)}
                            className="px-3.5 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all"
                          >
                            <X className="w-3.5 h-3.5 inline mr-1" />
                            Rejeter
                          </button>
                          <button
                            onClick={() => openKbApproveModal(draft)}                             className="px-4 py-2 rounded-xl text-xs font-bold btn-primary shadow-md transition-all flex items-center gap-1.5"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Publier dans la KB</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PAGINATION (onglet actif) */}
      {!loading && filteredList.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          <p className="text-xs text-on-surface-variant">
            {rangeStart}–{rangeEnd} sur {filteredList.length} élément{filteredList.length > 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container text-on-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Précédent
            </button>
            <span className="text-xs font-bold text-on-surface px-2 whitespace-nowrap">
              Page {safePage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container text-on-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {/* MODALE APPROBATION CONNAISSANCE */}
      {showKbApproveModal && kbDraftToApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
              <BookOpen className="w-6 h-6" />
              <div>
                <h3 className="text-base font-bold">Publier dans la Base de Connaissances</h3>
                <p className="text-xs text-on-surface-variant">
                  Le brouillon sera approuvé et publié comme article de connaissance.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-surface-container-low/50 border border-outline-variant/20 space-y-2 text-xs">
              <p className="font-bold text-on-surface">{kbDraftToApprove.title}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-on-surface-variant">
                <span>Problème : <strong className="text-on-surface">{kbDraftToApprove.problem}</strong></span>
                <span>Cause : <strong className="text-on-surface">{kbDraftToApprove.cause}</strong></span>
                <span className="col-span-2">Solution : <strong className="text-on-surface">{kbDraftToApprove.solution}</strong></span>
              </div>
              {kbDraftToApprove.keywords?.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Tags className="w-3 h-3" />
                  {kbDraftToApprove.keywords.map(k => (
                    <span key={k} className="px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/30 text-[10px]">#{k}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => { setShowKbApproveModal(false); setKbDraftToApprove(null); }}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={approvingKb}
                onClick={handleKbApproveConfirm}                 className="px-5 py-2.5 rounded-xl text-xs font-bold btn-primary shadow-lg transition-all flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{approvingKb ? 'Publication en cours...' : 'Confirmer la publication'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE REJET CONNAISSANCE */}
      {showKbRejectModal && kbDraftToReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold">Rejeter le brouillon de connaissance</h3>
            </div>
            <p className="text-xs text-on-surface-variant">
              Veuillez indiquer la raison du rejet pour : <strong className="text-on-surface">{kbDraftToReject.title}</strong>
            </p>
            <textarea
              className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
              rows={3}
              placeholder="Ex: Contenu incomplet, doublon, hors périmètre..."
              value={kbRejectReason}
              onChange={(e) => setKbRejectReason(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowKbRejectModal(false); setKbDraftToReject(null); }}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!kbRejectReason.trim() || rejectingKb}
                onClick={handleKbRejectConfirm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white shadow-md shadow-red-500/20 hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {rejectingKb ? 'Rejet en cours...' : 'Confirmer le rejet'}
              </button>
            </div>
          </div>
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

      {/* MODALE DE REJET DE CLÔTURE SUGGÉRÉE */}
      {showClosureRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold">Raison du refus de clôture</h3>
            </div>
            <p className="text-xs text-on-surface-variant">
              Veuillez indiquer pourquoi le ticket ne doit pas être clos. Cette raison alimente l'apprentissage IA de la plateforme.
            </p>
            <textarea
              className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
              rows={3}
              placeholder="Ex: Le problème persiste côté utilisateur..."
              value={closureRejectReason}
              onChange={(e) => setClosureRejectReason(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowClosureRejectModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!closureRejectReason.trim() || rejectingClosure}
                onClick={handleConfirmClosureReject}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white shadow-md shadow-red-500/20 hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {rejectingClosure ? 'Refus en cours...' : 'Confirmer le refus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE D'APPROBATION COMBINÉE (TICKET GLPI + RÉPONSE IA) */}      {showCombinedModal && combinedDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <Shield className="w-7 h-7 shrink-0" />
              <div>
                <h3 className="text-base font-bold">
                  {autonomousMode ? 'Ticket en attente d\'approbation' : 'Ticket non encore créé dans GLPI'}
                </h3>
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
              {autonomousMode ? (
                <>Souhaitez-vous <strong>approuver le ticket</strong> ET <strong>envoyer la réponse IA par email</strong> en une seule opération ?</>
              ) : (
                <>Souhaitez-vous <strong>approuver la création du ticket dans GLPI</strong> ET <strong>envoyer la réponse IA par email</strong> en une seule opération ?</>
              )}
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
                onClick={handleConfirmCombinedApproval}                 className="px-5 py-2.5 rounded-xl text-xs font-bold btn-primary shadow-lg transition-all flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{approvingCombined ? 'Approbation en cours...' : (autonomousMode ? 'Approuver + Envoyer Réponse' : 'Approuver GLPI + Envoyer Réponse')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
