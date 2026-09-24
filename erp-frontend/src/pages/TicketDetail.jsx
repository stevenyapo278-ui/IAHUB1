import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { markTicketUpdated } from '../utils/recentlyUpdatedTickets';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission, canEditTickets } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import { playApproval, playRejection, playError } from '../utils/sounds';
import SearchableSelect from '../components/SearchableSelect';
import RemoteUserMultiSelect from '../components/RemoteUserMultiSelect';
import SlaBadge from '../components/SlaBadge';
import { flattenCategoryTree } from '../utils/categoryTree';
import {
  ArrowLeft, Clock, User, Tag, AlertTriangle, CheckCircle2,
  Trash2, Paperclip, MessageSquare, Sparkles, Shield, MapPin,
  RefreshCw, Mail, FileText, Check, X, Send, ChevronRight,
  Flame, Radio, Info, ArrowDown, UserCheck, HelpCircle, Layers, History,
  TrendingUp, Lock, Link2, Merge, Plus, GitBranch, Timer, Play, Square, ListChecks, Boxes,
  ChevronDown, Inbox, Pencil, Save, Search,
  ChevronsLeft, ChevronLeft, ChevronsRight, Eye, Copy, ShieldAlert, ShieldOff, Loader2, Image as ImageIcon,
  AtSign, File as FileIcon, Archive, Video, Music, Download, Unlock, ShieldCheck
} from 'lucide-react';
import {
  MANUAL_STATUS_OPTIONS, STATUS_LABELS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS,
  URGENCY_IMPACT_OPTIONS, PRIORITY_CONFIG, STATUS_CONFIG, ORIGIN_CONFIG, initials
} from '../constants/tickets';

import { sanitizeHtml } from '../utils/sanitize';

function extractCleanTextAndImages(content) {
  if (!content || typeof content !== 'string') return { text: '', images: [] };
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>|<!--IMAGE_\d+-->?/gi;
  const images = [];
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    if (match[0].startsWith('<img')) {
      images.push(match[0]);
    }
  }
  const text = content
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, '')
    .replace(/<!--IMAGE_\d+-->?/gi, '')
    .trim();
  return { text, images };
}

// Variants du "défilement" entre tickets (carrousel) : le ticket sorti glisse dans le sens du voyage,
// le nouveau entre par le côté opposé — sortie rapide puis entrée longue et douce (ease-out quintique)
const TICKET_SLIDE_VARIANTS = {
  initial: (dir) => ({ x: dir === 'next' ? '20%' : '-20%', opacity: 0 }),
  animate: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  },
  exit: (dir) => ({
    x: dir === 'next' ? '-15%' : '15%',
    opacity: 0,
    transition: { duration: 0.12, ease: [0.4, 0, 1, 1] },
  }),
};

// Couleur d'accent pleine par statut — barre supérieure de la carte ticket et points de timeline
const STATUS_ACCENT = {
  NEW: 'bg-blue-500',
  OPEN: 'bg-indigo-500',
  PLANNED: 'bg-purple-500',
  PENDING: 'bg-amber-500',
  SOLVED: 'bg-emerald-500',
  CLOSED: 'bg-slate-400',
};

// Coordonnées du caret dans un textarea — miroir invisible (textarea-caret)
// Retourne {top,left,height} relatif au textarea (scroll inclus)
function getTextareaCaretCoordinates(textarea, position) {
  const properties = [
    'direction','boxSizing','width','height','overflowX','overflowY',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'fontStyle','fontVariant','fontWeight','fontStretch','fontSize','fontSizeAdjust','lineHeight','fontFamily',
    'textAlign','textTransform','textIndent','textDecoration','letterSpacing','wordSpacing','tabSize','MozTabSize'
  ];
  const isFirefox = typeof window !== 'undefined' && window.mozInnerScreenX != null;
  const div = document.createElement('div');
  div.id = 'textarea-caret-mirror';
  document.body.appendChild(div);
  const style = div.style;
  const computed = window.getComputedStyle ? window.getComputedStyle(textarea) : textarea.currentStyle;
  style.whiteSpace = 'pre-wrap';
  if (textarea.nodeName !== 'INPUT') style.wordWrap = 'break-word';
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.overflow = 'hidden';
  properties.forEach((prop) => { try { style[prop] = computed[prop]; } catch {} });
  if (isFirefox) {
    if (textarea.scrollHeight > parseInt(computed.height, 10)) style.overflowY = 'scroll';
  } else {
    style.overflow = 'hidden';
  }
  div.textContent = textarea.value.substring(0, position);
  if (textarea.nodeName === 'INPUT') div.textContent = div.textContent.replace(/\s/g, '\u00a0');
  const span = document.createElement('span');
  span.textContent = textarea.value.substring(position) || '.';
  div.appendChild(span);
  const coordinates = {
    top: span.offsetTop + parseInt(computed.borderTopWidth || '0', 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth || '0', 10),
    height: parseInt(computed.lineHeight || '18', 10) || 18,
  };
  document.body.removeChild(div);
  return coordinates;
}

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

// Tuile d'information compacte (icône + libellé + valeur) — utilisée pour les
// cartes d'information du ticket (demandeur, équipe, catégorie, lieu, etc.)
function InfoTile({ icon: Icon, label, value, tone = 'primary', title, copyable }) {
  const toneColor = {
    primary: 'text-primary',
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    violet: 'text-violet-500',
    slate: 'text-on-surface-variant',
  }[tone] || 'text-primary';

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copié !');
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error('Erreur de copie'); }
  };

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-outline-variant/30 bg-surface-container-low/50 px-3 py-2.5 min-w-0 transition-colors hover:bg-surface-container-low">
      <span className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-wider text-on-surface-variant">
        <Icon className={`w-3 h-3 ${toneColor} shrink-0`} />
        {label}
      </span>
      <div className="flex items-center gap-1 min-w-0">
        <span
          className="text-xs font-bold text-on-surface truncate flex-1 min-w-0"
          title={title || value}
        >
          {value || '—'}
        </span>
        {copyable && value && (
          <button
            onClick={handleCopy}
            className="shrink-0 p-1 rounded-md hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-primary"
            title="Copier le nom"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

// Puce méta discrète pour la rangée d'informations sous le titre du ticket
function MetaChip({ icon: Icon, children, tone }) {
  const toneClass = {
    red: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  }[tone] || 'bg-surface-container-low/70 text-on-surface-variant border-outline-variant/30';

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold ${toneClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate max-w-[220px]">{children}</span>
    </span>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { autonomousMode, settings: systemSettings } = useSystemSettings();
  const [ticket, setTicket] = useState(null);    const [followup, setFollowup] = useState('');
  const [followupPrivate, setFollowupPrivate] = useState(false);
  const [events, setEvents] = useState([]);

  // Mentions @ Outlook-like dans les suivis
  const followupRef = useRef(null);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionedUsers, setMentionedUsers] = useState([]);
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0, width: 320 });
  const mentionDebounceRef = useRef(null);

  // Suppression de suivi
  const [followupToDelete, setFollowupToDelete] = useState(null);
  const [deletingFollowup, setDeletingFollowup] = useState(false);

  // Tickets liés + fusion + modale « Relations » (tickets liés, problèmes racines, sous-tickets)
  const [relationsModalOpen, setRelationsModalOpen] = useState(false);
  const [relationsTab, setRelationsTab] = useState('tickets');
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [childModalOpen, setChildModalOpen] = useState(false);
  const [childForm, setChildForm] = useState({ title: '', content: '', priority: 'P3' });
  const [creatingChild, setCreatingChild] = useState(false);
  // Temps passé (timesheet)
  const [timeEntries, setTimeEntries] = useState([]);
  const [timeTotal, setTimeTotal] = useState(0);
  const [activeTimer, setActiveTimer] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [manualMinutes, setManualMinutes] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [savingTime, setSavingTime] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkType, setLinkType] = useState('RELATED');
  const [linkResults, setLinkResults] = useState([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeResults, setMergeResults] = useState([]);
  const [mergeSelected, setMergeSelected] = useState([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pastedImages, setPastedImages] = useState([]);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState([]);
  const [categories, setCategories] = useState([]);
  const flatCategories = useMemo(() => flattenCategoryTree(categories), [categories]);
  const categoryOptions = useMemo(() => {
    const opts = flatCategories.map((c) => ({
      value: c.name,
      label: c.label || c.name,
    }));
    if (ticket?.category && !opts.some((o) => o.value === ticket.category)) {
      opts.unshift({ value: ticket.category, label: ticket.category });
    }
    return opts;
  }, [flatCategories, ticket?.category]);
  // Définitions des champs personnalisés (pour résoudre libellés/valeurs dans le détail)
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [syncFailures, setSyncFailures] = useState([]);
  const [savingField, setSavingField] = useState(null);
  const [forwarding, setForwarding] = useState(false);
  const [conversationIdDraft, setConversationIdDraft] = useState('');
  const [savingConversationId, setSavingConversationId] = useState(false);
  const [conversationLocked, setConversationLocked] = useState(true);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const attachmentInputRef = useRef(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const [adjacent, setAdjacent] = useState({ first: null, prev: null, next: null, last: null });
  const slideDirectionRef = useRef('next'); // 'next' = vers la droite→gauche, 'prev' = gauche→droite
  // Demandeur principal — source de vérité : requesterIds[0] (tableau), fallback requesterId/sourceName
  // Assure la cohérence entre header, InfoTile et panneau droit (qui utilisent tous requesterIds)
  const primaryRequester = useMemo(() => {
    if (!ticket) return null;
    const ids = Array.isArray(ticket.requesterIds) && ticket.requesterIds.length > 0
      ? ticket.requesterIds
      : (ticket.requesterId ? [ticket.requesterId] : []);
    if (ids.length > 0) {
      const rid = ids[0];
      // Résoudre via les relations déjà chargées ou allUsers
      if (ticket.requester && ticket.requester.id === rid) return ticket.requester;
      if (ticket.secondaryRequester && ticket.secondaryRequester.id === rid) return ticket.secondaryRequester;
      if (ticket.createdBy && ticket.createdBy.id === rid) return ticket.createdBy;
      const fromAll = (allUsers || []).find((u) => u.id === rid);
      if (fromAll) return fromAll;
    }
    // Fallback : requester relation ou sourceName/SourceEmail (tickets email)
    if (ticket.requester) return ticket.requester;
    if (ticket.sourceName || ticket.sourceEmail) return { fullName: ticket.sourceName, email: ticket.sourceEmail };
    return null;
  }, [ticket, allUsers]);
  useEffect(() => {
    if (ticket) {
      setConversationIdDraft(ticket.outlookConversationId || '');
      // Verrouillé par défaut si déjà lié — évite la suppression accidentelle
      setConversationLocked(!!ticket.outlookConversationId);
    }
  }, [ticket?.outlookConversationId]);
  const [corrections, setCorrections] = useState([]);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [manualGlpiId, setManualGlpiId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkedProblems, setLinkedProblems] = useState([]);
  const [problemLinkModalOpen, setProblemLinkModalOpen] = useState(false);
  const [problemLinkSearch, setProblemLinkSearch] = useState('');
  const [problemLinkResults, setProblemLinkResults] = useState([]);
  const [problemLinkLoading, setProblemLinkLoading] = useState(false);
  const [linkingProblem, setLinkingProblem] = useState(null);
  const [escalating, setEscalating] = useState(false);
  const [escalateModalOpen, setEscalateModalOpen] = useState(false);
  const [escalateTargetTeamId, setEscalateTargetTeamId] = useState('');
  const [escalateTargetUserId, setEscalateTargetUserId] = useState('');
  const [escalateReason, setEscalateReason] = useState('');
  const [escalateTeams, setEscalateTeams] = useState([]);
  const [expandedEmails, setExpandedEmails] = useState(new Set());
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [showSaveLocationModal, setShowSaveLocationModal] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [editingFollowupId, setEditingFollowupId] = useState(null);
  const [editingFollowupContent, setEditingFollowupContent] = useState('');
  const [editingFollowupImages, setEditingFollowupImages] = useState([]);
  const [savingFollowupEdit, setSavingFollowupEdit] = useState(false);

  const [editingContent, setEditingContent] = useState(false);
  const [editingContentValue, setEditingContentValue] = useState('');
  const [editingContentImages, setEditingContentImages] = useState([]);
  const [editingContentNewImages, setEditingContentNewImages] = useState([]);
  const [savingContent, setSavingContent] = useState(false);

  const openEscalateModal = async () => {
    setEscalateTargetTeamId('');
    setEscalateTargetUserId('');
    setEscalateReason('');
    setEscalateModalOpen(true);
    try {
      const { data } = await api.get('/teams');
      setEscalateTeams(Array.isArray(data) ? data : data.items || []);
    } catch {
      setEscalateTeams([]);
    }
  };

  // Membres de l'équipe cible choisie dans la modale d'escalade (choix du technicien)
  // — seuls les TECHNICIENS actifs de l'équipe peuvent se voir attribuer un ticket.
  const targetTeamMembers = useMemo(() => {
    const team = escalateTeams.find((t) => String(t.id) === String(escalateTargetTeamId));
    return (team?.members || []).filter((m) => m.role === 'TECHNICIAN' && m.isActive !== false);
  }, [escalateTeams, escalateTargetTeamId]);

  const handleEscalate = async () => {
    setEscalating(true);
    try {
      const body = { reason: escalateReason.trim() || 'Escalade manuelle' };
      if (escalateTargetTeamId) body.targetTeamId = Number(escalateTargetTeamId);
      if (escalateTargetUserId) body.assignedToId = Number(escalateTargetUserId);
      const { data } = await api.post(`/tickets/${id}/escalate`, body);
      const parts = [];
      if (escalateTargetTeamId) {
        const team = escalateTeams.find((t) => String(t.id) === String(escalateTargetTeamId));
        parts.push(`équipe ${team?.name || escalateTargetTeamId}`);
      }
      if (escalateTargetUserId) {
        const tech = targetTeamMembers.find((m) => String(m.id) === String(escalateTargetUserId));
        parts.push(`technicien ${tech?.fullName || ''}`);
      }
      toast.success(parts.length > 0 ? `Ticket transféré (${parts.join(' → ')})` : 'Ticket escaladé');
      setEscalateModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'escalade");
    } finally {
      setEscalating(false);
    }
  };

  const handleLinkGlpi = async () => {
    if (!manualGlpiId) return;
    setLinking(true);
    try {
      await api.patch(`/tickets/${id}/glpi-link`, { glpiTicketId: Number(manualGlpiId) });
      toast.success(`Ticket GLPI #${manualGlpiId} lié avec succès`);
      setManualGlpiId('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec de la liaison GLPI');
    } finally {
      setLinking(false);
    }
  };

  // Plafond par RÔLE (miroir du garde-fou serveur allowTechnicianStatusOnly) : un TECHNICIAN
  // ne modifie jamais les éléments d'un ticket — il consulte et ajoute des suivis, quel que
  // soit son groupe de permissions. Exceptions :
  // - technicien assigné → peut changer le statut
  // - technicien dont l'équipe correspond au ticket → peut modifier tous les champs
  const canEditTicketsRole = canEditTickets(user);
  const isAssignedTechnician = user?.role === 'TECHNICIAN' &&
    ticket != null &&
    (
      ticket.assignedToId === user?.id ||
      (Array.isArray(ticket.assignees) && ticket.assignees.some((a) => a.id === user?.id))
    );
  const isTeamTicket = user?.role === 'TECHNICIAN' &&
    ticket != null &&
    ticket.teamId != null &&
    ticket.teamId === user?.teamId;
  const canAssign = (canEditTicketsRole || isTeamTicket) && (hasPermission(user, 'tickets.assign') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN');
  const canApprove = canEditTicketsRole && (hasPermission(user, 'tickets.approve') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN');
  // Escalade = transfert d'équipe : droit tickets.escalate (permission dédiée, délégable à une
  // personne précise via les groupes de droits — Administrateurs et Équipe Hotline l'ont par
  // défaut). Le plafond par rôle est conservé : un TECHNICIAN ne peut jamais escalader, même
  // avec la permission (miroir du garde-fou serveur forbidTechnicianTicketEdits).
  // Uniquement sur un ticket ACTIF : sur un ticket résolu/fermé/rejeté il n'y a plus de travail
  // à pousser vers une équipe — le bouton serait une source de misclicks et de notifications
  // parasites (le backend rejette aussi, défense en profondeur). WAITING_FOR_USER reste
  // escaladable : c'est un état actif (demandeur silencieux, relance nécessaire).
  const ESCALATABLE_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
  const canEscalate = canEditTicketsRole
    && hasPermission(user, 'tickets.escalate')
    && ESCALATABLE_STATUSES.includes(ticket?.status);
  const canDeleteRole = ['SUPERADMIN', 'ADMIN', 'HOTLINE'].includes(user?.role);
  const canDelete = canEditTicketsRole && (canDeleteRole || hasPermission(user, 'tickets.delete'));
  const canManageProblems = canEditTicketsRole && (hasPermission(user, 'problems.manage') || user?.role === 'SUPERADMIN');
  const canEdit = (canEditTicketsRole || isTeamTicket) && (hasPermission(user, 'tickets.edit') || user?.role === 'ADMIN' || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN' || isTeamTicket);
  const isRequesterOfTicket = ticket?.requesterIds?.includes(user?.id);
  const canForward = isAssignedTechnician || isRequesterOfTicket || ['SUPERADMIN', 'ADMIN'].includes(user?.role);

  const followupContainerRef = useRef(null);
  const followupBlobUrlsRef = useRef([]);

  const load = useCallback(() => {
    setError('');
    api
      .get(`/tickets/${id}`)
      .then(({ data }) => setTicket(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement du ticket'));
    api
      .get(`/tickets/${id}/events`)
      .then(({ data }) => {
        setEvents(data);
        setSyncFailures(data.filter((e) => e.type === 'GLPI_SYNC_FAILED'));
      })
      .catch(() => {});
    api
      .get(`/tickets/${id}/corrections`)
      .then(({ data }) => setCorrections(data))
      .catch(() => {});
    api
      .get(`/problems/by-ticket/${id}`)
      .then(({ data }) => setLinkedProblems(data))
      .catch(() => {});
  }, [id]);

  // On conserve le ticket affiché tant que les données du suivant ne sont pas prêtes,
  // pour que l'animation de sortie (AnimatePresence) puisse s'exécuter sur l'ancien contenu
  useEffect(() => {
    load();
  }, [id, load]);

  // Navigation ‹ › : hérite des filtres de la liste (passés en query params lors du clic
  // depuis /tickets). Sans paramètres, le serveur applique son défaut (non clôturés,
  // ni rejetés, ni corbeille) — les boutons ne font plus traverser toute la base.
  const [searchParams] = useSearchParams();
  // Conserve les filtres de liste entre deux sauts de navigation ‹ ›
  const navQueryString = useMemo(() => {
    const forwardable = ['status', 'priority', 'source', 'category', 'teamId', 'assignedToId', 'mine', 'aiProcessed', 'approvalStatus', 'closeSuggested', 'dateFrom', 'dateTo', 'search'];
    const p = new URLSearchParams();
    forwardable.forEach((k) => {
      const v = searchParams.get(k);
      if (v) p.set(k, v);
    });
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [searchParams]);
  useEffect(() => {
    const forwardable = ['status', 'priority', 'source', 'category', 'teamId', 'assignedToId', 'mine', 'aiProcessed', 'approvalStatus', 'closeSuggested', 'dateFrom', 'dateTo', 'search'];
    const navParams = new URLSearchParams();
    forwardable.forEach((k) => {
      const v = searchParams.get(k);
      if (v) navParams.set(k, v);
    });
    const qs = navParams.toString();
    api.get(`/tickets/${id}/adjacent${qs ? `?${qs}` : ''}`)
      .then(({ data }) => setAdjacent(data))
      .catch(() => setAdjacent({ first: null, prev: null, next: null, last: null }));
  }, [id, searchParams]);

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

  // Convertir les URLs relatives /uploads/ en absolues pour les images de suivi
  useEffect(() => {
    const container = followupContainerRef.current;
    if (!container) return;
    container.querySelectorAll('img[src^="/uploads/"]').forEach((img) => {
      if (img.getAttribute('data-abs-processed')) return;
      img.setAttribute('data-abs-processed', 'true');
      const src = img.getAttribute('src');
      if (!src) return;
      const absUrl = `${api.defaults.baseURL.replace(/\/api\/?$/, '')}${src}`;
      img.src = absUrl;
      img.style.cursor = 'pointer';
      img.style.maxHeight = '300px';
      img.style.objectFit = 'contain';
    });
  }, [ticket?.followups, ticket?.messages]);

  // Lightbox : clic sur une image de suivi pour l'agrandir
  useEffect(() => {
    const container = followupContainerRef.current;
    if (!container) return;
    function handleClick(e) {
      const img = e.target.closest('img');
      if (img && img.src) {
        e.preventDefault();
        setLightboxSrc(img.src);
      }
    }
    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [ticket?.followups, ticket?.messages]);

  async function downloadAttachment(attachment) {
    try {
      // Si la prévisualisation est déjà ouverte avec un blob, réutilise-le
      if (lightboxSrc?.attachment?.id === attachment.id && lightboxSrc?.src) {
        const a = document.createElement('a');
        a.href = lightboxSrc.src;
        a.download = attachment.filename || 'attachment';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('Téléchargement lancé');
        return;
      }
      const { data } = await api.get(`/tickets/${id}/attachments/${attachment.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success('Téléchargement lancé');
    } catch {
      setError('Échec du téléchargement de la pièce jointe');
    }
  }

  // Prévisualisation générique — remplace l'ancien openImageAttachment (images seules)
  async function openAttachment(attachment) {
    try {
      const { data } = await api.get(`/tickets/${id}/attachments/${attachment.id}/file`, { responseType: 'blob' });
      const mime = attachment.mimeType || data.type || '';
      const url = URL.createObjectURL(data);
      let textContent = null;
      const isTextLike = mime.startsWith('text/') || mime.includes('json') || mime.includes('csv') || mime.includes('xml') || /\.(txt|csv|log|json|xml|md|htm|html)$/i.test(attachment.filename);
      if (isTextLike) {
        try {
          textContent = await data.text();
          if (textContent.length > 80000) textContent = textContent.slice(0, 80000) + '\n\n… (fichier tronqué — télécharger pour voir l’intégralité)';
        } catch {}
      }
      setLightboxSrc({ src: url, filename: attachment.filename, mime, blob: data, attachment, textContent });
    } catch {
      setError('Impossible d\'ouvrir le fichier');
    }
  }

  async function openImageAttachment(attachment) {
    return openAttachment(attachment);
  }

  function getFileKind(attachment) {
    const mime = (attachment.mimeType || '').toLowerCase();
    const name = (attachment.filename || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('csv') || mime.includes('xml') || /\.(txt|csv|log|json|xml|md|htm|html)$/i.test(name)) return 'text';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || /\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'archive';
    if (mime.includes('msword') || mime.includes('officedocument') || mime.includes('presentation') || mime.includes('spreadsheet') || /\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp)$/i.test(name)) return 'office';
    return 'file';
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes === 0) return '0 o';
    const k = 1024;
    const sizes = ['o', 'Ko', 'Mo', 'Go'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/locations').then(({ data }) => setLocations(data)).catch(() => {});
    api.get('/glpi/users').then(({ data }) => setGlpiUsers(data)).catch(() => {});
    api.get('/users').then(({ data }) => setAllUsers(Array.isArray(data) ? data : (data?.users || []))).catch(() => {});
    api.get('/custom-fields').then(({ data }) => setCustomFieldDefs(data || [])).catch(() => {});
    if (!canAssign) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
  }, [canAssign]);

  async function updateField(field, value) {
    try {
      setSavingField(field);
      markTicketUpdated(Number(id));
      await api.patch(`/tickets/${id}`, { [field]: value });
      toast.success('Mise à jour enregistrée');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSavingField(null);
    }
  }

  // Extrait le nom du lieu (partie avant ":", "-", "/", "|") d'un titre
  function extractLocationFromTitle(title) {
    if (!title || typeof title !== 'string') return null;
    const trimmed = title.trim();

    // Ignore les préfixes de type mail / réponse / transfert
    if (/^(re|fw|fwd)\s*:/i.test(trimmed)) return null;

    // 1) Séparateur deux-points (ex: "DSI: ...", "DSI : ...", "MARCORY:...")
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      const candidate = parts[0].trim();
      const rest = parts.slice(1).join(':').trim();
      if (candidate.length >= 2 && candidate.length <= 35 && rest.length > 0) {
        return candidate;
      }
    }

    // 2) Séparateurs avec espaces : "MARCORY - ...", "DSI / ...", "PLATEAU | ..."
    const altMatch = trimmed.match(/^([A-Z0-9\s_'-]{2,35}?)\s*(?: - | \/ | \| )\s*(.+)$/i);
    if (altMatch) {
      const candidate = altMatch[1].trim();
      if (candidate.length >= 2 && altMatch[2].trim().length > 0) {
        return candidate;
      }
    }

    return null;
  }

  // Vérifie si un lieu correspond déjà dans la liste (match exact ou partiel)
  function findMatchingLocation(locName) {
    if (!locName) return null;
    const lower = locName.toLowerCase().trim();
    const exact = locations.find(
      (l) => l.name?.toLowerCase().trim() === lower || l.completename?.toLowerCase().trim() === lower
    );
    if (exact) return exact;

    const partial = locations.find(
      (l) =>
        l.name?.toLowerCase().includes(lower) ||
        l.completename?.toLowerCase().includes(lower)
    );
    return partial || null;
  }

  // Sauvegarder le titre + proposer d'enregistrer le lieu si nouveau
  async function handleTitleSave() {
    // Règle stricte : les titres de tickets sont toujours EN MAJUSCULES
    const newTitle = editingTitleValue.trim().toLocaleUpperCase('fr-FR');
    if (!newTitle || newTitle === ticket.title) {
      setEditingTitle(false);
      return;
    }
    try {
      setSavingField('title');
      await api.patch(`/tickets/${id}`, { title: newTitle });
      toast.success('Titre mis à jour');
      setEditingTitle(false);

      // Détecter si le lieu a changé
      const newLocName = extractLocationFromTitle(newTitle);
      const oldLocName = extractLocationFromTitle(ticket.title);
      if (newLocName && newLocName !== oldLocName) {
        const existing = findMatchingLocation(newLocName);
        if (existing) {
          // Lieu existant trouvé → l'associer automatiquement
          if (existing.id !== ticket.locationId) {
            await api.patch(`/tickets/${id}`, { locationId: existing.id, title: newTitle });
            toast.success(`Lieu "${existing.name}" associé au ticket`);
          }
        } else {
          // Nouveau lieu détecté → proposer de l'enregistrer
          setNewLocationName(newLocName);
          setShowSaveLocationModal(true);
        }
      }
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour du titre');
    } finally {
      setSavingField(null);
    }
  }

  // Enregistrer le nouveau lieu depuis la modale
  async function handleSaveNewLocation() {
    if (!newLocationName.trim()) return;
    try {
      const { data: location } = await api.post('/locations', { name: newLocationName.trim() });
      toast.success(`Lieu "${location.name}" créé et associé au ticket`);
      // Associer le lieu au ticket
      await api.patch(`/tickets/${id}`, { locationId: location.id });
      setShowSaveLocationModal(false);
      setNewLocationName('');
      load();
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Erreur lors de la création du lieu';
      toast.error(msg);
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

  // ── Mentions @ : logique autocomplete ──────────────────────────────────
  const fetchMentionResults = useCallback((q) => {
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
    mentionDebounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/users/mentionable', { params: { search: q, limit: 8 } });
        const list = Array.isArray(data) ? data : (data.users || []);
        setMentionResults(list);
        setMentionIndex(0);
      } catch {
        setMentionResults([]);
      }
    }, 180);
  }, []);

  function updateMentionState(value, cursorPos) {
    const before = value.slice(0, cursorPos);
    // Ignorer les mentions déjà validées (@Nom + espace) pour ne pas rouvrir le dropdown
    let lastCommittedEnd = -1;
    for (const u of mentionedUsers) {
      const needle = `@${u.fullName} `;
      let idx = value.indexOf(needle);
      while (idx !== -1) {
        const end = idx + needle.length;
        if (end <= cursorPos && end > lastCommittedEnd) lastCommittedEnd = end;
        idx = value.indexOf(needle, idx + 1);
      }
    }
    const subBefore = lastCommittedEnd >= 0 ? before.slice(lastCommittedEnd) : before;
    // Si pas de commit, subBefore == before ; sinon on coupe après le dernier commit
    // On cherche le dernier @ dans ce sous-texte
    const atIdx = subBefore.lastIndexOf('@');
    if (atIdx === -1) {
      setMentionQuery(null);
      return;
    }
    const query = subBefore.slice(atIdx + 1);
    // Fermer si @ suivi d'un email-like déjà complet ou trop long / newline
    if (query.includes('\n') || query.length > 40) {
      setMentionQuery(null);
      return;
    }
    // Le @ doit être en début de ligne ou précédé d'un espace (évite les emails)
    const charBeforeAt = atIdx > 0 ? subBefore[atIdx - 1] : null;
    if (charBeforeAt && charBeforeAt !== ' ' && charBeforeAt !== '\n' && charBeforeAt !== '\t') {
      setMentionQuery(null);
      return;
    }
    // Ouvrir le dropdown et lancer la recherche
    setMentionQuery(query);
    // Positionner le volet juste à la position du curseur (comme Outlook) — portail fixed
    if (followupRef.current) {
      const textarea = followupRef.current;
      const rect = textarea.getBoundingClientRect();
      const caret = getTextareaCaretCoordinates(textarea, cursorPos);
      const dropdownWidth = Math.min(360, Math.max(260, 320));
      const estHeight = 280;
      // caret.top/left sont relatifs au textarea, on convertit en viewport
      const caretLeft = rect.left + caret.left - textarea.scrollLeft;
      const caretTop = rect.top + caret.top - textarea.scrollTop;
      const dropdownLeft = Math.min(caretLeft, window.innerWidth - dropdownWidth - 12);
      const spaceBelowCaret = window.innerHeight - (caretTop + caret.height);
      const showAbove = spaceBelowCaret < 140 && caretTop > spaceBelowCaret;
      const top = showAbove ? caretTop - estHeight - 6 : caretTop + caret.height + 6;
      setMentionPos({
        top,
        left: Math.max(8, dropdownLeft),
        width: dropdownWidth,
      });
    }
    fetchMentionResults(query.trim());
  }

  function insertMention(user) {
    const el = followupRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart ?? followup.length;
    const before = followup.slice(0, cursorPos);
    const after = followup.slice(cursorPos);
    // Retrouver le dernier @ non committé (même logique que updateMentionState)
    let lastCommittedEnd = -1;
    for (const u of mentionedUsers) {
      const needle = `@${u.fullName} `;
      let idx = followup.indexOf(needle);
      while (idx !== -1) {
        const end = idx + needle.length;
        if (end <= cursorPos && end > lastCommittedEnd) lastCommittedEnd = end;
        idx = followup.indexOf(needle, idx + 1);
      }
    }
    const subBefore = lastCommittedEnd >= 0 ? before.slice(lastCommittedEnd) : before;
    const atIdxInSub = subBefore.lastIndexOf('@');
    if (atIdxInSub === -1) return;
    const atIdx = before.length - subBefore.length + atIdxInSub;
    const mentionText = `@${user.fullName} `;
    const newVal = followup.slice(0, atIdx) + mentionText + after;
    setFollowup(newVal);
    setMentionedUsers((prev) => (prev.some((u) => u.id === user.id) ? prev : [...prev, user]));
    setMentionQuery(null);
    setMentionResults([]);
    // replacer le curseur après la mention
    setTimeout(() => {
      el.focus();
      const newPos = atIdx + mentionText.length;
      el.setSelectionRange(newPos, newPos);
    }, 0);
  }

  function handleFollowupChange(e) {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? val.length;
    setFollowup(val);
    // Nettoyer les mentions supprimées : garder seulement celles encore présentes
    if (mentionedUsers.length > 0) {
      const still = mentionedUsers.filter((u) => val.includes(`@${u.fullName}`));
      if (still.length !== mentionedUsers.length) setMentionedUsers(still);
    }
    updateMentionState(val, pos);
  }

  function handleFollowupKeyDown(e) {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionResults.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionResults.length) % mentionResults.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const chosen = mentionResults[mentionIndex];
        if (chosen) insertMention(chosen);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    // Ctrl+Enter pour envoyer (existant)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAddFollowup(e);
    }
  }

  function handleFollowupSelect() {
    if (followupRef.current) {
      updateMentionState(followup, followupRef.current.selectionStart ?? followup.length);
    }
  }

  // Fermer le dropdown si clic en dehors du textarea + repositionner au scroll/resize
  useEffect(() => {
    if (mentionQuery === null) return;
    function onDocClick(e) {
      if (followupRef.current && !followupRef.current.contains(e.target)) {
        const dropdown = document.querySelector('.mention-dropdown');
        if (dropdown && dropdown.contains(e.target)) return;
        setMentionQuery(null);
      }
    }
    function updatePos() {
      if (followupRef.current) {
        const textarea = followupRef.current;
        const pos = textarea.selectionStart ?? followup.length;
        const rect = textarea.getBoundingClientRect();
        const caret = getTextareaCaretCoordinates(textarea, pos);
        const dropdownWidth = Math.min(360, Math.max(260, 320));
        const estHeight = 280;
        const caretLeft = rect.left + caret.left - textarea.scrollLeft;
        const caretTop = rect.top + caret.top - textarea.scrollTop;
        const dropdownLeft = Math.min(caretLeft, window.innerWidth - dropdownWidth - 12);
        const spaceBelowCaret = window.innerHeight - (caretTop + caret.height);
        const showAbove = spaceBelowCaret < 140 && caretTop > spaceBelowCaret;
        const top = showAbove ? caretTop - estHeight - 6 : caretTop + caret.height + 6;
        setMentionPos({ top, left: Math.max(8, dropdownLeft), width: dropdownWidth });
      }
    }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [mentionQuery]);

  async function handleAddFollowup(e) {
    e.preventDefault();
    if (!followup.trim() && pastedImages.length === 0) return;
    try {
      // Déterminer les mentions réellement présentes dans le texte final
      const finalMentioned = mentionedUsers.filter((u) => followup.includes(`@${u.fullName}`));
      const mentionedUserIds = finalMentioned.map((u) => u.id);

      // Transformer les @Nom en <span data-mention-id="..."> pour affichage + parsing backend
      let htmlContent = followup;
      for (const u of finalMentioned) {
        const esc = u.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`@${esc}(?![\\wÀ-ÿ])`, 'g');
        htmlContent = htmlContent.replace(re, `<span data-mention-id="${u.id}" class="mention">@${u.fullName}</span>`);
      }

      const hasImages = pastedImages.length > 0;
      let content = htmlContent;

      if (hasImages) {
        const fd = new FormData();
        // On envoie d'abord le HTML avec mentions, puis on ajoutera les marqueurs images
        if (followupPrivate) fd.append('isPrivate', 'true');
        if (mentionedUserIds.length > 0) fd.append('mentionedUserIds', JSON.stringify(mentionedUserIds));
        pastedImages.forEach((img, idx) => {
          fd.append('images', img.file);
          content += `\n\n<!--IMAGE_${idx}-->`;
        });
        fd.append('content', content);
        await api.post(`/tickets/${id}/followups`, fd);
      } else {
        const payload = { content, isPrivate: followupPrivate };
        if (mentionedUserIds.length > 0) payload.mentionedUserIds = mentionedUserIds;
        await api.post(`/tickets/${id}/followups`, payload);
      }

      toast.success(mentionedUserIds.length > 0 ? `Commentaire ajouté — ${mentionedUserIds.length} personne(s) notifiée(s)` : 'Commentaire ajouté');
      setFollowup('');
      setFollowupPrivate(false);
      setMentionedUsers([]);
      setMentionQuery(null);
      pastedImages.forEach((img) => URL.revokeObjectURL(img.dataUrl));
      setPastedImages([]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout du commentaire");
    }
  }

  async function toggleFollowupVisibility(followup) {
    try {
      await api.patch(`/tickets/${id}/followups/${followup.id}/visibility`, { isPrivate: !followup.isPrivate });
      toast.success(followup.isPrivate ? 'Commentaire rendu public' : 'Commentaire rendu privé');
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors du changement de visibilité");
    }
  }

  function startEditFollowup(f) {
    setEditingFollowupId(f.id);
    const { text, images } = extractCleanTextAndImages(f.content || '');
    setEditingFollowupContent(text);
    setEditingFollowupImages(images);
  }

  function cancelEditFollowup() {
    setEditingFollowupId(null);
    setEditingFollowupContent('');
    setEditingFollowupImages([]);
  }

  async function saveEditFollowup(followupId) {
    if (!editingFollowupContent.trim() && editingFollowupImages.length === 0) return;
    setSavingFollowupEdit(true);
    try {
      let finalContent = editingFollowupContent.trim();
      if (editingFollowupImages.length > 0) {
        finalContent += (finalContent ? '\n\n' : '') + editingFollowupImages.join('\n\n');
      }
      await api.patch(`/tickets/${id}/followups/${followupId}`, { content: finalContent });
      toast.success('Commentaire modifié');
      setEditingFollowupId(null);
      setEditingFollowupContent('');
      setEditingFollowupImages([]);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de la modification du commentaire");
    } finally {
      setSavingFollowupEdit(false);
    }
  }

  async function confirmDeleteFollowup() {
    if (!followupToDelete) return;
    setDeletingFollowup(true);
    try {
      await api.delete(`/tickets/${id}/followups/${followupToDelete}`);
      toast.success('Commentaire supprimé');
      setFollowupToDelete(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeletingFollowup(false);
    }
  }

  function startEditContent() {
    const { text, images } = extractCleanTextAndImages(ticket?.content || '');
    setEditingContentValue(text);
    setEditingContentImages(images);
    setEditingContentNewImages([]);
    setEditingContent(true);
  }

  async function uploadContentImages(files) {
    const fd = new FormData();
    for (const file of files) fd.append('images', file);
    try {
      const { data } = await api.post(`/tickets/${id}/content-images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data.images || [];
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur upload image");
      return [];
    }
  }

  async function handleAttachmentUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingAttachment(true);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    try {
      const { data } = await api.post(`/tickets/${id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`${files.length} fichier(s) joint(s)`);
      setTicket((prev) => ({ ...prev, attachments: data.attachments }));
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'ajout de la pièce jointe");
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  }

  function handleContentPaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((it) => it.type?.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map((it) => it.getAsFile()).filter(Boolean);
    if (files.length === 0) return;
    uploadContentImages(files).then((uploaded) => {
      if (uploaded.length > 0) {
        setEditingContentNewImages((prev) => [...prev, ...uploaded]);
      }
    });
  }

  function handleContentFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    uploadContentImages(files).then((uploaded) => {
      if (uploaded.length > 0) {
        setEditingContentNewImages((prev) => [...prev, ...uploaded]);
      }
    });
    e.target.value = '';
  }

  function removeContentNewImage(idx) {
    setEditingContentNewImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function removeContentExistingImage(idx) {
    setEditingContentImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSaveContent() {
    setSavingContent(true);
    try {
      let finalContent = editingContentValue.trim();
      // Réattacher les images existantes (non éditables)
      if (editingContentImages.length > 0) {
        finalContent += (finalContent ? '\n\n' : '') + editingContentImages.join('\n\n');
      }
      // Insérer les nouvelles images à la fin
      if (editingContentNewImages.length > 0) {
        const newImgTags = editingContentNewImages.map((img) => `<img src="${img.url}" alt="image" />`).join('\n');
        finalContent += (finalContent ? '\n\n' : '') + newImgTags;
      }
      await api.patch(`/tickets/${id}`, { content: finalContent });
      toast.success('Description du ticket modifiée');
      setEditingContent(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification de la description');
    } finally {
      setSavingContent(false);
    }
  }

  const linkedTickets = useMemo(() => [
    ...(ticket?.linksA || []).map((l) => ({ ...l, otherTicket: l.ticketB })),
    ...(ticket?.linksB || []).map((l) => ({ ...l, otherTicket: l.ticketA })),
  ], [ticket?.linksA, ticket?.linksB]);

  // Sous-tickets (liens PARENT/CHILD) : déduit le sens réel car le lien est stocké
  // avec idA < idB mais le type est exprimé du point de vue de idA (voir ticketLinks.js).
  const subTickets = useMemo(() => linkedTickets
    .filter((l) => l.type === 'PARENT' || l.type === 'CHILD')
    .map((l) => {
      const inLinksA = (ticket?.linksA || []).some((la) => la.id === l.id);
      const childIsOther = l.type === 'PARENT' ? inLinksA : !inLinksA;
      return { ...l, isParent: !childIsOther, isChild: childIsOther };
    }), [linkedTickets, ticket?.linksA]);
  const parentTicket = subTickets.find((s) => s.isParent)?.otherTicket || null;
  const children = subTickets.filter((s) => s.isChild);

  // Nombre total d'éléments liés (tickets + problèmes + sous-tickets/parent) pour le bouton Relations
  const relationsCount = linkedTickets.length + linkedProblems.length + children.length + (parentTicket ? 1 : 0);

  // ── Liaison Problème ──────────────────────────────────────────────
  async function searchLinkableProblems(q) {
    setProblemLinkLoading(true);
    try {
      const params = { limit: 10, page: 1 };
      if (q && q.trim()) params.search = q.trim();
      const { data } = await api.get('/problems', { params });
      setProblemLinkResults(data.problems || []);
    } catch { setProblemLinkResults([]); } finally { setProblemLinkLoading(false); }
  }
  const problemSearchTimerRef = useRef(null);
  function handleProblemLinkSearch(q) {
    setProblemLinkSearch(q);
    if (problemSearchTimerRef.current) clearTimeout(problemSearchTimerRef.current);
    problemSearchTimerRef.current = setTimeout(() => searchLinkableProblems(q), 300);
  }

  async function linkProblem(problemId) {
    setLinkingProblem(problemId);
    try {
      await api.post(`/problems/${problemId}/link-ticket`, { ticketId: Number(id) });
      toast.success('Problème lié au ticket');
      setProblemLinkModalOpen(false);
      setProblemLinkSearch('');
      setProblemLinkResults([]);
      api.get(`/problems/by-ticket/${id}`).then(({ data }) => setLinkedProblems(data)).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur liaison');
    } finally { setLinkingProblem(null); }
  }

  async function unlinkProblem(problemId) {
    try {
      await api.delete(`/problems/${problemId}/unlink-ticket/${id}`);
      toast.success('Problème détaché');
      api.get(`/problems/by-ticket/${id}`).then(({ data }) => setLinkedProblems(data)).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  }

  async function searchLinkableTickets(q) {
    setLinkLoading(true);
    try {
      const params = { limit: 10, page: 1, status: 'NOT_CLOSED' };
      if (q && q.trim()) params.search = q.trim();
      const { data } = await api.get('/tickets', { params });
      setLinkResults((data.items || []).filter((t) => t.id !== Number(id)));
    } catch { setLinkResults([]); } finally { setLinkLoading(false); }
  }
  const linkSearchTimerRef = useRef(null);
  function handleLinkSearch(q) {
    setLinkSearch(q);
    if (linkSearchTimerRef.current) clearTimeout(linkSearchTimerRef.current);
    linkSearchTimerRef.current = setTimeout(() => searchLinkableTickets(q), 300);
  }

  async function addLink(targetTicketId) {
    try {
      await api.post(`/tickets/${id}/links`, { targetTicketId, type: linkType });
      toast.success('Ticket lié');
      setLinkModalOpen(false);
      setLinkSearch('');
      setLinkResults([]);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec de la liaison');
    }
  }

  async function createChild(e) {
    e.preventDefault();
    setCreatingChild(true);
    try {
      await api.post(`/tickets/${id}/children`, childForm);
      toast.success('Sous-ticket créé');
      setChildModalOpen(false);
      setChildForm({ title: '', content: '', priority: 'P3' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec de la création du sous-ticket');
    } finally {
      setCreatingChild(false);
    }
  }

  // ── Temps passé (timesheet) ────────────────────────────────────────────
  const canTimesheet = hasPermission(user, 'tickets.timesheet') || user?.role === 'SUPERADMIN';

  async function loadTimeEntries() {
    try {
      const { data } = await api.get('/timesheet', { params: { ticketId: id } });
      setTimeEntries(data.entries || []);
      setTimeTotal(data.totalMinutes || 0);
    } catch { /* silencieux */ }
  }

  useEffect(() => {
    if (!canTimesheet || !id) return;
    loadTimeEntries();
    api.get('/timesheet/timer/active').then(({ data }) => {
      if (data.active && Number(data.ticketId) === Number(id)) {
        setActiveTimer({ ticketId: data.ticketId, startedAt: data.startedAt });
        setElapsedSec(Math.floor((Date.now() - new Date(data.startedAt)) / 1000));
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canTimesheet]);

  useEffect(() => {
    if (!activeTimer) return;
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - new Date(activeTimer.startedAt)) / 1000)), 1000);
    return () => clearInterval(t);
  }, [activeTimer]);

  // Charger la liste des tickets quand la modale de liaison s'ouvre
  useEffect(() => {
    if (linkModalOpen) searchLinkableTickets('');
  }, [linkModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Charger la liste des problèmes quand la modale de liaison problème s'ouvre
  useEffect(() => {
    if (problemLinkModalOpen) searchLinkableProblems('');
  }, [problemLinkModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startTimer() {
    try {
      await api.post('/timesheet/timer/start', { ticketId: Number(id) });
      setActiveTimer({ ticketId: Number(id), startedAt: new Date().toISOString() });
      setElapsedSec(0);
      toast.success('Minuteur démarré');
    } catch (err) {
      toast.error(err.response?.data?.error || "Impossible de démarrer le minuteur");
    }
  }

  async function stopTimer() {
    try {
      await api.post('/timesheet/timer/stop', { ticketId: Number(id), description: manualDesc.trim() || null });
      setActiveTimer(null);
      setManualDesc('');
      toast.success('Temps enregistré');
      loadTimeEntries();
    } catch (err) {
      toast.error(err.response?.data?.error || "Impossible d'arrêter le minuteur");
    }
  }

  async function addManualTime(e) {
    e.preventDefault();
    const minutes = parseInt(manualMinutes, 10);
    if (!Number.isInteger(minutes) || minutes < 1) {
      toast.error('Durée invalide (en minutes)');
      return;
    }
    setSavingTime(true);
    try {
      await api.post('/timesheet', { ticketId: Number(id), minutes, description: manualDesc.trim() || null });
      setManualMinutes('');
      setManualDesc('');
      toast.success('Temps ajouté');
      loadTimeEntries();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'ajout");
    } finally {
      setSavingTime(false);
    }
  }

  async function deleteTimeEntry(entryId) {
    try {
      await api.delete(`/timesheet/${entryId}`);
      toast.success('Entrée supprimée');
      loadTimeEntries();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  function fmtMinutes(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`;
  }

  function fmtElapsed(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  }

  async function removeLink(link) {
    try {
      await api.delete(`/tickets/${id}/links/${link.id}`);
      toast.success('Lien supprimé');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec de la suppression du lien');
    }
  }

  async function searchMergeableTickets(q) {
    if (!q.trim()) { setMergeResults([]); return; }
    setMergeLoading(true);
    try {
      const { data } = await api.get('/tickets', { params: { search: q, limit: 10 } });
      setMergeResults((data.items || []).filter((t) => t.id !== Number(id)));
    } catch { setMergeResults([]); } finally { setMergeLoading(false); }
  }

  function toggleMergeSelect(ticketId) {
    setMergeSelected((sel) => (sel.includes(ticketId) ? sel.filter((s) => s !== ticketId) : [...sel, ticketId]));
  }

  async function confirmMerge() {
    if (mergeSelected.length === 0) return toast.error('Sélectionnez au moins un ticket à fusionner');
    setMerging(true);
    try {
      const { data } = await api.post(`/tickets/${id}/merge`, { sourceTicketIds: mergeSelected });
      toast.success(`${data.merged} ticket(s) fusionné(s) dans #${id} (${data.movedItems} élément(s) déplacé(s))`);
      setMergeModalOpen(false);
      setMergeSelected([]);
      setMergeSearch('');
      setMergeResults([]);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec de la fusion');
    } finally {
      setMerging(false);
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

  async function handleForwardEmail() {
    setForwarding(true);
    try {
      const { data } = await api.post(`/tickets/${id}/forward-email`);
      toast.success(data.message || 'Réponse envoyée dans la conversation');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du transfert');
    } finally {
      setForwarding(false);
    }
  }

  async function handleSaveConversationId() {
    const wantsUnlink = !conversationIdDraft.trim() && !!ticket?.outlookConversationId;
    if (wantsUnlink) {
      setShowUnlinkConfirm(true);
      return;
    }
    setSavingConversationId(true);
    try {
      const { data } = await api.patch(`/tickets/${id}`, { outlookConversationId: conversationIdDraft.trim() || null });
      setTicket(data);
      toast.success(conversationIdDraft.trim() ? 'Fil lié au ticket (suivis mails automatiques)' : 'Liaison retirée');
      if (conversationIdDraft.trim()) setConversationLocked(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la liaison');
    } finally {
      setSavingConversationId(false);
    }
  }

  async function confirmUnlinkConversation() {
    setSavingConversationId(true);
    try {
      const { data } = await api.patch(`/tickets/${id}`, { outlookConversationId: null });
      setTicket(data);
      setConversationIdDraft('');
      setConversationLocked(false);
      setShowUnlinkConfirm(false);
      toast.success('Liaison du fil retirée');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression du lien');
    } finally {
      setSavingConversationId(false);
    }
  }

  function handleApprove() {
    setShowApproveModal(true);
  }

  async function handleApproveConfirm() {
    setApproving(true);
    try {
      const { data } = await api.post(`/tickets/${id}/approve`);
      playApproval();
      toast.success('Ticket approuvé');
      if (data.warning) {
        toast.warning(data.warning, { duration: 8000 });
      }
      setShowApproveModal(false);
      load();
    } catch (err) {
      playError();
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
      playRejection();
      toast.success('Ticket rejeté');
      setShowRejectModal(false);
      setRejectReason('');
      load();
    } catch (err) {
      playError();
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
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col gap-6 w-full max-w-none min-w-0 overflow-visible">
      {/* Top Header Bar (Fixe) */}
      <div className="flex items-center gap-3 pb-4 border-b border-outline-variant/30 shrink-0">
        <button
          onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/tickets'))}
          className="p-2 rounded-xl border border-outline-variant/40 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer shrink-0"
          title="Retour aux tickets"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Navigation entre tickets */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => {
              if (adjacent.first) {
                slideDirectionRef.current = 'prev';
                navigate(`/tickets/${adjacent.first}${navQueryString}`, { replace: true });
              }
            }}
            disabled={!adjacent.first}
            className="p-1.5 rounded-lg border border-outline-variant/30 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={adjacent.first ? `Premier ticket (#${adjacent.first})` : 'Déjà au premier ticket'}
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (adjacent.prev) {
                slideDirectionRef.current = 'prev';
                navigate(`/tickets/${adjacent.prev}${navQueryString}`, { replace: true });
              }
            }}
            disabled={!adjacent.prev}
            className="p-1.5 rounded-lg border border-outline-variant/30 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={adjacent.prev ? `Ticket précédent (#${adjacent.prev})` : 'Pas de ticket précédent'}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-bold text-on-surface-variant px-1.5 tabular-nums select-none">
            #{ticket.id}
          </span>
          <button
            onClick={() => {
              if (adjacent.next) {
                slideDirectionRef.current = 'next';
                navigate(`/tickets/${adjacent.next}${navQueryString}`, { replace: true });
              }
            }}
            disabled={!adjacent.next}
            className="p-1.5 rounded-lg border border-outline-variant/30 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={adjacent.next ? `Ticket suivant (#${adjacent.next})` : 'Pas de ticket suivant'}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (adjacent.last) {
                slideDirectionRef.current = 'next';
                navigate(`/tickets/${adjacent.last}${navQueryString}`, { replace: true });
              }
            }}
            disabled={!adjacent.last}
            className="p-1.5 rounded-lg border border-outline-variant/30 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={adjacent.last ? `Dernier ticket (#${adjacent.last})` : 'Déjà au dernier ticket'}
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Titre éditable — même ligne que navigation */}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editingTitleValue}
                onChange={(e) => setEditingTitleValue(e.target.value.toLocaleUpperCase('fr-FR'))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                autoFocus
                className="flex-1 text-base sm:text-lg font-bold text-on-surface bg-surface-container-low border border-primary/40 rounded-xl px-4 py-2 uppercase focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={handleTitleSave}
                disabled={savingField === 'title'}
                className="p-2 rounded-xl bg-primary text-on-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 shrink-0"
                title="Enregistrer"
              >
                <Save className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditingTitle(false)}
                className="p-2 rounded-xl border border-outline-variant/40 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer shrink-0"
                title="Annuler"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group/title min-w-0">
              <h1 className="text-base sm:text-lg font-black text-on-surface leading-tight tracking-tight line-clamp-1 uppercase truncate">{ticket.title}</h1>
              {canEdit && (
                <button
                  onClick={() => { setEditingTitleValue(ticket.title); setEditingTitle(true); }}
                  className="p-1.5 rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container transition-all opacity-0 group-hover/title:opacity-100 cursor-pointer shrink-0"
                  title="Modifier le titre"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Zone de contenu Ticket — carrousel directionnel (sortie + entrée) via AnimatePresence keyed par ticket.id */}
      <div className="relative overflow-visible min-w-0" style={{ minHeight: 400 }}>
        <AnimatePresence mode="popLayout" initial={false} custom={slideDirectionRef.current}>
          {ticket && (
            <motion.div
              key={ticket.id}
              custom={slideDirectionRef.current}
              variants={TICKET_SLIDE_VARIANTS}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full space-y-6"
              style={{ willChange: 'transform, opacity' }}
            >
            {/* Badges & Actions */}
            <div className="flex items-center gap-2 flex-wrap pb-4 border-b border-outline-variant/30">
                {ticket.glpiTicketId && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-surface-container-high dark:text-on-surface-variant border border-slate-200 dark:border-outline-variant/40 flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5" />
                    GLPI #{ticket.glpiTicketId}
                  </span>
                )}
                {ticket.escalationLevel > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-500/30">
                    Niv. escalade {ticket.escalationLevel}
                  </span>
                )}
                {canEscalate && (
                  <button
                    onClick={openEscalateModal}
                    disabled={escalating}
                    className="px-3 py-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300 hover:bg-orange-500/20 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                    title="Escalader ce ticket : transférer à l'équipe qui doit le gérer, choisir le technicien et alerter les responsables"
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    {escalating ? 'Escalade...' : 'Escalader'}
                  </button>
                )}
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
                <SlaBadge ticket={ticket} />
                {ticket.status === 'SOLVED' && ticket.solvedAt && canAssign && (() => {
                  const autoCloseDays = systemSettings?.solvedAutoCloseDays ?? 3;
                  if (autoCloseDays <= 0) return null;
                  const solvedDate = new Date(ticket.solvedAt);
                  const threshold = new Date(solvedDate);
                  threshold.setDate(threshold.getDate() + autoCloseDays);
                  const now = new Date();
                  const canClose = now >= threshold;
                  const remainingMs = threshold.getTime() - now.getTime();
                  const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
                  return (
                    <button
                      onClick={async () => {
                        try {
                          markTicketUpdated(Number(id));
                          await api.patch(`/tickets/${id}`, { status: 'CLOSED' });
                          toast.success('Ticket fermé avec succès');
                          load();
                        } catch (err) {
                          toast.error(err.response?.data?.error || 'Échec de la fermeture');
                        }
                      }}
                      disabled={!canClose}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                        canClose
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400 border border-slate-300 dark:border-slate-500/25 hover:bg-slate-200 dark:hover:bg-slate-500/25'
                          : 'bg-slate-50 text-slate-400 dark:bg-slate-500/5 dark:text-slate-500 border border-slate-200 dark:border-slate-500/10 cursor-not-allowed opacity-60'
                      }`}
                      title={canClose ? 'Appliquer la fermeture maintenant' : `Fermeture automatique dans ${remainingDays} jour${remainingDays > 1 ? 's' : ''}`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {canClose ? 'Appliquer la fermeture' : `Fermeture dans ${remainingDays}j`}
                    </button>
                  );
                })()}
                {linkedProblems.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {linkedProblems.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => navigate(`/problems/${p.id}`)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-200 dark:border-amber-500/25 hover:bg-amber-100 dark:hover:bg-amber-500/25 cursor-pointer transition-colors"
                        title={`Problème #${p.id}: ${p.title}`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        P#{p.id}
                      </button>
                    ))}
                  </div>
                )}
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

              {/* Méta strip : acteurs, dates et contexte */}
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low/70 text-[11px] font-semibold text-on-surface">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary border border-primary/25 flex items-center justify-center text-[8px] font-black shrink-0">
                    {initials(primaryRequester?.fullName || ticket.sourceName)}
                  </span>
                  <span className="truncate max-w-[200px]">{primaryRequester?.fullName || ticket.sourceName || ticket.sourceEmail || 'Demandeur inconnu'}</span>
                </span>
                <MetaChip icon={Clock}>{`Créé le ${new Date(ticket.createdAt).toLocaleString('fr-FR')}`}</MetaChip>
                {ticket.dueDate && (
                  <MetaChip
                    icon={Clock}
                    tone={new Date(ticket.dueDate) < new Date() && ticket.status !== 'CLOSED' && ticket.status !== 'SOLVED' ? 'red' : 'amber'}
                  >
                    {new Date(ticket.dueDate) < new Date() && ticket.status !== 'CLOSED' && ticket.status !== 'SOLVED'
                      ? `En retard depuis le ${new Date(ticket.dueDate).toLocaleString('fr-FR')}`
                      : `Échéance ${new Date(ticket.dueDate).toLocaleString('fr-FR')}`}
                  </MetaChip>
                )}
                {ticket.source && <MetaChip icon={Inbox}>{ticket.source}</MetaChip>}
                {ticket.origin && ORIGIN_CONFIG[ticket.origin] && (
                  <MetaChip icon={ORIGIN_CONFIG[ticket.origin].Icon}>{ORIGIN_CONFIG[ticket.origin].label}</MetaChip>
                )}
                <MetaChip icon={MapPin}>{ticket.locationName || 'Aucun lieu'}</MetaChip>
                {ticket.team?.name && <MetaChip icon={Layers}>{ticket.team.name}</MetaChip>}
              </div>

      {/* Sync Failure Banner (GLPI uniquement — masqué en mode autonome) */}
      {!autonomousMode && syncFailures.length > 0 && (
        <div className="border border-red-500/25 bg-red-500/10 rounded-xl p-4 flex items-start gap-3 text-red-700 dark:text-red-400">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-xs font-bold uppercase tracking-wider">Synchronisation GLPI incomplète</h4>
            <ul className="text-xs mt-1 space-y-1 list-disc pl-4">
              {syncFailures.map((e) => (
                <li key={e.id}>
                  {new Date(e.createdAt).toLocaleString('fr-FR')} — {e.payload?.action || 'action'} : {e.payload?.error || 'erreur inconnue'}
                </li>
              ))}
            </ul>
            {!ticket.glpiTicketId && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  placeholder="ID ticket GLPI (manuel)"
                  className="w-40 px-2.5 py-1.5 text-xs rounded-lg border border-red-500/30 bg-white dark:bg-surface-container-high text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                  value={manualGlpiId}
                  onChange={(e) => setManualGlpiId(e.target.value)}
                />
                <button
                  onClick={handleLinkGlpi}
                  disabled={linking || !manualGlpiId}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all disabled:opacity-40"
                >
                  {linking ? 'Liaison...' : 'Lier'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Command Center Layout (Katalyst style) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 min-w-0">
        {/* ── LEFT COLUMN: Properties & Metadata ────────────────────────── */}
        <div className="flex flex-col gap-5 min-w-0 order-2 xl:order-1">
          {/* Main Ticket Card */}
          <div className="bento-card overflow-hidden">
            {/* Barre d'accent selon le statut */}
            <div className={`h-1.5 w-full ${STATUS_ACCENT[ticket.status] || 'bg-primary'}`} />
            <div className="p-6 space-y-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </span>
                  Description
                  {ticket.aiProcessed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-purple-200 bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 text-[10px] font-bold">
                      <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                      Traité par IA
                    </span>
                  )}
                </h2>
                {ticket.category && (
                  <span className="bg-slate-100 text-slate-700 dark:bg-surface-container-high dark:text-on-surface-variant border border-slate-200 dark:border-outline-variant/40 text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    {ticket.category}
                  </span>
                )}
              </div>

              {/* Grille d'informations rapides */}
              <div className={`grid gap-2.5 ${(ticket.status === 'SOLVED' || ticket.status === 'CLOSED') ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
                <InfoTile icon={User} label="Demandeur" value={primaryRequester?.fullName || ticket.sourceEmail || '—'} copyable />
                <InfoTile icon={Layers} label="Équipe" value={ticket.team?.name || 'Non assignée'} />
                <InfoTile icon={MapPin} label="Lieu" value={ticket.locationName || '—'} tone="violet" />
                <InfoTile icon={Clock} label="Créé le" value={new Date(ticket.createdAt).toLocaleDateString('fr-FR')} tone="amber" />
                {(ticket.status === 'SOLVED' || ticket.status === 'CLOSED') && ticket.solvedAt && (
                  <InfoTile icon={CheckCircle2} label="Résolu le" value={new Date(ticket.solvedAt).toLocaleDateString('fr-FR')} tone="emerald" />
                )}
              </div>

              {/* Dates en ligne */}
              <div className="flex items-center gap-4 text-[11px] text-on-surface-variant flex-nowrap overflow-x-auto">
                <span className="flex items-center gap-1.5 shrink-0">
                  <Clock className="w-3 h-3 text-amber-500" />
                  <span className="font-semibold">Ouvert :</span>
                  <span className="font-mono">{new Date(ticket.firstOpenedAt || ticket.createdAt).toLocaleString('fr-FR')}</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <Clock className="w-3 h-3 text-blue-500" />
                  <span className="font-semibold">Créé :</span>
                  <span className="font-mono">{new Date(ticket.createdAt).toLocaleString('fr-FR')}</span>
                </span>
                <span
                  className="flex items-center gap-1.5 group relative shrink-0"
                  title={ticket.lastModifiedBy ? `Dernière modification par ${ticket.lastModifiedBy.fullName}` : undefined}
                >
                  <Clock className="w-3 h-3 text-emerald-500" />
                  <span className="font-semibold">Modifié :</span>
                  <span className="font-mono">{ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString('fr-FR') : '—'}</span>
                  {ticket.lastModifiedBy && (
                    <span className="text-on-surface-variant/60 hidden group-hover:inline">
                      par {ticket.lastModifiedBy.fullName}
                    </span>
                  )}
                </span>
                {ticket.solvedAt && (
                  <span className="flex items-center gap-1.5 shrink-0">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    <span className="font-semibold">Résolu :</span>
                    <span className="font-mono">{new Date(ticket.solvedAt).toLocaleString('fr-FR')}</span>
                  </span>
                )}
                {ticket.closedAt && (
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span className="font-semibold">Fermé :</span>
                    <span className="font-mono">{new Date(ticket.closedAt).toLocaleString('fr-FR')}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Ticket Description Content */}
            <div className="group/desc relative">
              {editingContent ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full min-h-[140px] p-3 rounded-xl border border-primary/40 bg-surface text-sm text-on-surface leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
                    rows={7}
                    value={editingContentValue}
                    onChange={(e) => setEditingContentValue(e.target.value)}
                    onPaste={handleContentPaste}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingContent(false);
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSaveContent();
                    }}
                    autoFocus
                  />
                  {(editingContentImages.length > 0 || editingContentNewImages.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                      {editingContentImages.map((url, i) => (
                        <div key={`old-${i}`} className="relative group/img">
                          <img src={url} alt="" className="h-16 w-16 object-cover rounded-lg border border-outline-variant/40" />
                          <button
                            type="button"
                            onClick={() => removeContentExistingImage(i)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity cursor-pointer"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                      {editingContentNewImages.map((img, i) => (
                        <div key={`new-${i}`} className="relative group/img">
                          <img src={img.url} alt="" className="h-16 w-16 object-cover rounded-lg border border-primary/40" />
                          <button
                            type="button"
                            onClick={() => removeContentNewImage(i)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity cursor-pointer"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/40 bg-surface-container text-on-surface-variant text-[10px] font-semibold hover:bg-surface-container-high transition-colors cursor-pointer">
                      <ImageIcon className="w-3 h-3" />
                      Ajouter une image
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleContentFileSelect} />
                    </label>
                    <button
                      type="button"
                      onClick={handleSaveContent}
                      disabled={savingContent}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-on-primary text-[10px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                    >
                      {savingContent ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingContent(false)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/40 bg-surface-container text-on-surface-variant text-[10px] font-semibold hover:bg-surface-container-high transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      Annuler
                    </button>
                    <span className="text-[9px] text-on-surface-variant/50 ml-1">Ctrl+Entrée pour sauvegarder · Échap pour annuler</span>
                  </div>
                </div>
              ) : (
                <>
                  {canEdit && ticket.source !== 'GLPI' && (
                    <button
                      type="button"
                      onClick={startEditContent}
                      title="Modifier la description"
                      className="absolute top-0 right-0 p-1 rounded-md border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface hover:border-outline transition-colors cursor-pointer opacity-0 group-hover/desc:opacity-100 z-10"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
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
                </>
              )}
            </div>

            {/* Attachments */}
              <div className="border-t border-outline-variant/30 pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-primary" />
                    Pièces jointes ({(ticket?.attachments || []).length})
                  </h4>
                  <input ref={attachmentInputRef} type="file" multiple className="hidden" onChange={handleAttachmentUpload} />
                  <button
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={uploadingAttachment}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold hover:bg-primary/15 transition-colors disabled:opacity-50"
                  >
                    {uploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Joindre
                  </button>
                </div>
                {ticket.attachments?.length > 0 ? (
                  <div className="flex flex-wrap gap-3">
                  {(ticket?.attachments || []).map((a) => {
                    const kind = getFileKind(a);
                    const fromEmail = a.source === 'INCOMING_EMAIL';
                    const isImage = kind === 'image';
                    if (isImage) {
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => openAttachment(a)}
                          title={`${fromEmail ? '(reçu par email) ' : ''}Cliquer pour prévisualiser`}
                          className="relative hover:scale-105 hover:shadow-lg transition-all duration-200 group cursor-pointer rounded-xl"
                        >
                          <AttachmentThumbnail ticketId={ticket.id} attachment={a} />
                          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/20 transition-all duration-200">
                            <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-all duration-200" />
                          </span>
                          {fromEmail && (
                            <span className="p-1 bg-surface rounded-full text-on-surface-variant shadow-sm border border-outline-variant/40 absolute top-1 right-1">
                              <Mail className="w-3 h-3 text-primary" />
                            </span>
                          )}
                        </button>
                      );
                    }
                    // Fichiers non-image : carte avec icône + prévisualisation au clic
                    const iconMap = {
                      pdf: <FileText className="w-5 h-5 text-red-500" />,
                      text: <FileText className="w-5 h-5 text-emerald-600" />,
                      video: <Video className="w-5 h-5 text-violet-500" />,
                      audio: <Music className="w-5 h-5 text-amber-500" />,
                      archive: <Archive className="w-5 h-5 text-orange-500" />,
                      office: <FileText className="w-5 h-5 text-blue-600" />,
                      file: <FileIcon className="w-5 h-5 text-slate-500" />,
                    };
                    const bgMap = {
                      pdf: 'bg-red-500/10 border-red-500/20',
                      text: 'bg-emerald-500/10 border-emerald-500/20',
                      video: 'bg-violet-500/10 border-violet-500/20',
                      audio: 'bg-amber-500/10 border-amber-500/20',
                      archive: 'bg-orange-500/10 border-orange-500/20',
                      office: 'bg-blue-500/10 border-blue-500/20',
                      file: 'bg-slate-500/10 border-slate-500/20',
                    };
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => openAttachment(a)}
                        title="Cliquer pour prévisualiser"
                        className="group flex items-center gap-3 pl-2 pr-3 py-2.5 border border-outline-variant/40 bg-surface-container-low/60 hover:bg-surface-container hover:border-primary/30 hover:shadow-md rounded-xl transition-all cursor-pointer text-left min-w-0"
                      >
                        <span className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 shadow-sm ${bgMap[kind] || bgMap.file}`}>
                          {iconMap[kind] || iconMap.file}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold text-on-surface truncate max-w-[190px] leading-tight">{a.filename}</span>
                          <span className="block text-[11px] font-medium text-on-surface-variant truncate">
                            {a.mimeType || kind.toUpperCase()} {a.size ? `· ${formatBytes(a.size)}` : ''} {fromEmail ? '· email' : ''}
                          </span>
                        </span>
                        <span className="w-7 h-7 rounded-lg bg-primary/10 group-hover:bg-primary text-primary group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                          <Eye className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
                ) : (
                  <p className="text-xs text-on-surface-variant italic">Aucune pièce jointe — cliquez sur Joindre pour ajouter un fichier.</p>
                )}
              </div>
          </div>

          {/* Tickets liés / Problèmes racines / Sous-tickets — regroupés dans une modale,
              ouverte depuis le bouton « Relations » (plus aucune carte encombrante par défaut) */}
          <button
            onClick={() => setRelationsModalOpen(true)}
            className="w-full bento-card p-4 flex items-center justify-between gap-3 hover-interactive transition-all group cursor-pointer"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Link2 className="w-4 h-4" />
              </span>
              <span className="text-left min-w-0">
                <span className="block text-xs font-extrabold uppercase tracking-wider text-on-surface">Tickets liés, Problèmes racines & Sous-tickets</span>
                <span className="block text-[11px] text-on-surface-variant mt-0.5">
                  {relationsCount > 0
                    ? `${relationsCount} élément${relationsCount > 1 ? 's' : ''} lié${relationsCount > 1 ? 's' : ''}`
                    : 'Aucun élément lié'}
                </span>
              </span>
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              {linkedTickets.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {linkedTickets.length} lié{linkedTickets.length > 1 ? 's' : ''}
                </span>
              )}
              {linkedProblems.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  {linkedProblems.length} probl.
                </span>
              )}
              {(children.length > 0 || parentTicket) && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  {children.length + (parentTicket ? 1 : 0)} sous
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-on-surface-variant group-hover:text-primary transition-colors" />
            </span>
          </button>

          </div>

          {/* (Problèmes racines et Sous-tickets déplacés dans la modale Relations) */}

          {/* Follow-up / Timeline Card */}
          <div className="bento-card p-6 space-y-6">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface border-b border-outline-variant/20 pb-3 flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4" />
              </span>
              Suivi & Échanges
            </h3>

            {/* Timeline entries */}
            <div className="relative pl-10 space-y-4" ref={followupContainerRef}>
              {/* Rail verticale de la timeline */}
              <div className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-primary/40 via-outline-variant/40 to-transparent" aria-hidden="true" />
              {(() => {
                const timeline = [
                  ...(ticket?.followups || []).map((f) => ({ kind: 'followup', date: f.createdAt, data: f })),
                  ...(ticket?.messages || []).map((m) => ({ kind: 'email', date: m.timestamp, data: m })),
                  ...(events || []).map((e) => ({ kind: 'event', date: e.createdAt, data: e })),
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
                    <div key={`f-${item.data.id}`} className="relative p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 flex gap-3">
                      <span className="absolute -left-[26px] top-5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest shrink-0" aria-hidden="true" />
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
                            {item.data.isPrivate && (
                              <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-400 font-bold border border-purple-500/25" title="Visible uniquement par l'équipe">
                                <Lock className="w-2.5 h-2.5 inline mr-0.5" />
                                PRIVÉ
                              </span>
                            )}
                            {canAssign && item.data.source !== 'glpi' && (
                              <button
                                onClick={() => toggleFollowupVisibility(item.data)}
                                title={item.data.isPrivate ? 'Rendre public' : 'Rendre privé'}
                                className={`p-1 rounded-md border transition-colors cursor-pointer ${
                                  item.data.isPrivate
                                    ? 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20'
                                    : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface hover:border-outline'
                                }`}
                              >
                                <Lock className="w-3 h-3" />
                              </button>
                            )}
                            {(canAssign || isAssignedTechnician) && item.data.source !== 'glpi' && item.data.authorId === user?.id && editingFollowupId !== item.data.id && (
                              <button
                                onClick={() => startEditFollowup(item.data)}
                                title="Modifier"
                                className="p-1 rounded-md border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface hover:border-outline transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                            {['ADMIN', 'SUPERADMIN'].includes(user?.role) && item.data.source !== 'glpi' && editingFollowupId !== item.data.id && (
                              <button
                                onClick={() => setFollowupToDelete(item.data.id)}
                                title="Supprimer"
                                className="p-1 rounded-md border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-red-600 hover:border-red-500/50 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <time className="text-[10px] font-mono text-on-surface-variant bg-surface-container border border-outline-variant/30 px-2 py-0.5 rounded-full">
                            {new Date(item.data.createdAt).toLocaleString('fr-FR')}
                            {item.data.updatedAt && (
                              <span className="text-on-surface-variant/60 ml-1">(modifié)</span>
                            )}
                          </time>
                        </div>
                        {editingFollowupId === item.data.id ? (
                          <div className="space-y-2">
                            <textarea
                              className="w-full min-h-[150px] p-3 rounded-xl border border-primary/40 bg-surface text-sm text-on-surface leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
                              rows={6}
                              value={editingFollowupContent}
                              onChange={(e) => setEditingFollowupContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') cancelEditFollowup();
                                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveEditFollowup(item.data.id);
                              }}
                              autoFocus
                            />
                            {editingFollowupImages.length > 0 && (
                              <div className="flex flex-wrap gap-2 p-2 rounded-xl border border-outline-variant/30 bg-surface-container-low/40">
                                {editingFollowupImages.map((img, idx) => (
                                  <div key={idx} className="relative group">
                                    <div dangerouslySetInnerHTML={{ __html: img }} className="[&>img]:max-w-[120px] [&>img]:max-h-[80px] [&>img]:rounded-lg [&>img]:border [&>img]:border-outline-variant/50" />
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => saveEditFollowup(item.data.id)}
                                disabled={savingFollowupEdit || (!editingFollowupContent.trim() && editingFollowupImages.length === 0)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-on-primary text-[10px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                              >
                                {savingFollowupEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Enregistrer
                              </button>
                              <button
                                onClick={cancelEditFollowup}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/40 bg-surface-container text-on-surface-variant text-[10px] font-semibold hover:bg-surface-container-high transition-colors cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                                Annuler
                              </button>
                              <span className="text-[9px] text-on-surface-variant/50 ml-1">Ctrl+Entrée pour sauvegarder · Échap pour annuler</span>
                            </div>
                          </div>
                        ) : item.data.content && (item.data.content.includes('<') || item.data.content.includes('&#') || item.data.content.includes('&lt;')) ? (
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
                  ) : item.kind === 'event' ? (
                    <div key={`e-${item.data.id}`} className="relative flex items-center gap-3 px-4 py-2.5 rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low/20">
                      <span className="absolute -left-[26px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-slate-400 ring-4 ring-surface-container-lowest shrink-0" aria-hidden="true" />
                      <div className="w-7 h-7 rounded-full border border-outline-variant/40 bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0">
                        {eventIcon(item.data.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] font-bold text-on-surface-variant">
                            {eventLabel(item.data.type)}
                            {item.data.actor && item.data.actor !== 'SYSTEM' && (
                              <span className="text-on-surface-variant/70 font-medium"> — {item.data.actor}</span>
                            )}
                          </span>
                          <time className="text-[9px] font-mono text-on-surface-variant/70">
                            {new Date(item.data.createdAt).toLocaleString('fr-FR')}
                          </time>
                        </div>
                        {eventDetail(item.data) && (
                          <p className="text-[10px] text-on-surface-variant/80 mt-0.5 leading-snug">{eventDetail(item.data)}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    (() => {
                      const emailExpanded = expandedEmails.has(item.data.id);
                      const toggleEmail = () => setExpandedEmails((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.data.id)) next.delete(item.data.id); else next.add(item.data.id);
                        return next;
                      });
                      const ts = new Date(item.data.timestamp);
                      const dateStr = ts.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                      const timeStr = ts.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                      const summaryText = item.data.summary || (
                        (item.data.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 120) +
                        ((item.data.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 120 ? '…' : '')
                      ) || item.data.subject;
                      return (
                        <div
                          key={`m-${item.data.id}`}
                          className={`relative rounded-2xl border transition-all duration-200 ${
                            emailExpanded
                              ? 'border-outline-variant/50 bg-surface-container-lowest shadow-md'
                              : 'border-outline-variant/30 bg-surface-container-lowest hover:border-outline-variant/50 hover:shadow-sm'
                          }`}
                        >
                          <span className="absolute -left-[26px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-sky-500 ring-4 ring-surface-container-lowest shrink-0" aria-hidden="true" />
                          {/* Header compact : toujours visible, cliquable pour déplier/replier */}
                          <button
                            type="button"
                            onClick={toggleEmail}
                            className="w-full flex items-center gap-3 p-3 text-left cursor-pointer select-none group/email"
                          >
                            {/* Icone direction */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm border ${
                              item.data.direction === 'INBOUND'
                                ? 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            }`}>
                              {item.data.direction === 'INBOUND' ? <Inbox className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                            </div>

                            {/* Titre = résumé tronqué + badge direction */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                  item.data.direction === 'INBOUND'
                                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                }`}>
                                  {item.data.direction === 'INBOUND' ? 'Reçu' : 'Envoyé'}
                                </span>
                                <span className="text-[10px] text-on-surface-variant/70 font-medium truncate">
                                  {item.data.direction === 'INBOUND' ? item.data.sender : (item.data.recipients?.[0] || '—')}
                                </span>
                              </div>
                              <p className={`text-xs font-semibold text-on-surface leading-snug ${emailExpanded ? '' : 'line-clamp-1'}`}>
                                {summaryText}
                              </p>
                            </div>

                            {/* Date + heure */}
                            <div className="flex flex-col items-end shrink-0 gap-0.5">
                              <time className="text-[10px] font-mono text-on-surface-variant bg-surface-container border border-outline-variant/30 px-2 py-0.5 rounded-full">
                                {dateStr}
                              </time>
                              <span className="text-[10px] font-mono text-on-surface-variant/70">{timeStr}</span>
                            </div>

                            {/* Chevron expand/collapse */}
                            <ChevronDown className={`w-4 h-4 text-on-surface-variant/50 transition-transform duration-200 shrink-0 ${emailExpanded ? 'rotate-180' : ''}`} />
                          </button>

                          {/* Contenu déplié */}
                          {emailExpanded && (
                            <div className="px-4 pb-4 pt-0 space-y-3 border-t border-outline-variant/20 mt-0">
                              {/* Ligne De → À */}
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] pt-3">
                                <div className="flex items-center gap-1">
                                  <span className="text-on-surface-variant/70 font-semibold">De :</span>
                                  <span className="text-on-surface font-bold truncate max-w-[260px]" title={item.data.sender}>{item.data.sender}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-on-surface-variant/70 font-semibold">À :</span>
                                  <span className="text-on-surface font-bold truncate max-w-[260px]" title={item.data.recipients?.join(', ')}>
                                    {item.data.recipients?.join(', ') || '—'}
                                  </span>
                                </div>
                              </div>

                              {/* Sujet */}
                              <div className="text-[11px] text-on-surface-variant font-semibold italic flex items-center gap-1.5">
                                <span className="text-on-surface-variant/50 not-italic">Objet :</span> {item.data.subject}
                              </div>

                              {/* Résumé IA (texte complet) */}
                              {(item.data.summary || item.data.body) && (
                                <div className="bg-blue-500/5 dark:bg-blue-500/8 border border-blue-500/15 rounded-xl px-3 py-2">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Sparkles className="w-3 h-3 text-blue-500 dark:text-blue-400" />
                                    <span className="text-[9px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">Résumé</span>
                                  </div>
                                  <p className="text-[11px] text-on-surface leading-relaxed font-medium">
                                    {item.data.summary || (
                                      <span className="text-on-surface-variant italic font-normal">
                                        {(item.data.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200)}
                                        {(item.data.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 200 ? '…' : ''}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              )}

                              {/* Statut du ticket au moment de l'email */}
                              {item.data.ticketStatusAtTime && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] text-on-surface-variant/70 font-semibold">Statut du ticket :</span>
                                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                    item.data.ticketStatusAtTime === 'SOLVED' || item.data.ticketStatusAtTime === 'CLOSED'
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                      : item.data.ticketStatusAtTime === 'NEW'
                                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {item.data.ticketStatusAtTime}
                                  </span>
                                </div>
                              )}

                              {/* Contenu HTML complet */}
                              {(item.data.bodyHtml || item.data.body) && (
                                <details className="group">
                                  <summary className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/70 font-semibold cursor-pointer select-none hover:text-on-surface-variant transition-colors">
                                    <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                                    <span>Voir le contenu complet</span>
                                  </summary>
                                  <div className="mt-2 pt-2 border-t border-outline-variant/20">
                                    {item.data.bodyHtml ? (
                                      <div
                                        className="leading-relaxed text-xs text-on-surface [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-2 [&_a]:text-blue-600 [&_a]:underline [&_p]:mb-1.5 [&_p]:last:mb-0 [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-0.5 [&_div]:mb-1 [&_b]:font-semibold"
                                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.data.bodyHtml) }}
                                      />
                                    ) : (
                                      <div className="text-xs text-on-surface whitespace-pre-wrap leading-relaxed">{item.data.body}</div>
                                    )}
                                  </div>
                                </details>
                              )}

                              {/* Lien vers la boîte mail */}
                              <div className="pt-1">
                                <Link
                                  to="/inbox"
                                  className="inline-flex items-center gap-1.5 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                                >
                                  <Mail className="w-3 h-3" />
                                  Voir dans la boîte mail
                                </Link>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )
                );
              })()}
            </div>

            {/* Add Comment Form */}
            {user?.role === 'TECHNICIAN' && ['SOLVED', 'CLOSED'].includes(ticket.status) ? (
              <div className="mt-4 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Ce ticket est résolu ou fermé. Un technicien ne peut plus y apporter de modification ou de suivi.</span>
              </div>
            ) : (
              <form onSubmit={handleAddFollowup} className="pt-4 border-t border-outline-variant/30 space-y-3">
                {canAssign && (
                <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={followupPrivate}
                    onChange={(e) => setFollowupPrivate(e.target.checked)}
                    className="cursor-pointer accent-purple-600 w-4 h-4"
                  />
                  <span className="text-[11px] font-semibold text-on-surface-variant flex items-center gap-1">
                    <Lock className="w-3 h-3 text-purple-500" />
                    Commentaire privé (invisible pour le demandeur)
                  </span>
                </label>
              )}
              <div className="relative">
                <textarea
                  ref={followupRef}
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/60 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y min-h-[220px]"
                  placeholder="Ajouter un commentaire ou suivi... Tapez @ pour mentionner quelqu'un (Ctrl+Entrée pour envoyer)"
                  rows={8}
                  value={followup}
                  onChange={handleFollowupChange}
                  onKeyDown={handleFollowupKeyDown}
                  onKeyUp={handleFollowupSelect}
                  onClick={handleFollowupSelect}
                  onPaste={handlePaste}
                />
              </div>
              {/* Dropdown mentions @ — portail premium, positionné à la caret */}
              {mentionQuery !== null && createPortal(
                <div
                  className="mention-dropdown"
                  style={{
                    position: 'fixed',
                    top: mentionPos.top,
                    left: mentionPos.left,
                    width: mentionPos.width,
                    zIndex: 9999,
                  }}
                >
                  {/* Header Outlook-like */}
                  <div className="flex items-center gap-2 px-2.5 py-2 mb-1 rounded-xl bg-primary/[0.06] border border-primary/10">
                    <span className="w-7 h-7 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0 shadow-sm">
                      <AtSign className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-extrabold tracking-wide text-primary leading-none">Mentionner quelqu’un</p>
                      <p className="text-[10px] font-medium text-on-surface-variant leading-none mt-0.5">
                        {mentionQuery.trim() ? `Filtre : “${mentionQuery.trim()}”` : 'Tapez un nom ou email'}
                      </p>
                    </div>
                    <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-surface border border-outline-variant/40 text-on-surface-variant hidden sm:inline-flex">
                      {mentionResults.length} résultat{mentionResults.length!==1?'s':''}
                    </span>
                  </div>

                  {mentionResults.length === 0 ? (
                    <div className="mx-1 my-2 rounded-xl border border-dashed border-outline-variant/40 bg-surface-container/50 px-3 py-6 text-center">
                      <div className="w-8 h-8 rounded-full bg-surface-container border border-outline-variant/30 flex items-center justify-center mx-auto mb-2">
                        <Search className="w-4 h-4 text-on-surface-variant/60" />
                      </div>
                      <p className="text-xs font-semibold text-on-surface">Aucun utilisateur trouvé</p>
                      <p className="text-[11px] text-on-surface-variant mt-1">Essayez un autre nom ou email</p>
                    </div>
                  ) : (
                    <div className="space-y-0.5 max-h-[220px] overflow-y-auto pr-0.5 -mr-0.5">
                      {mentionResults.map((u, idx) => {
                        const isActive = idx === mentionIndex;
                        const isAlready = mentionedUsers.some((m) => m.id === u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                            onMouseEnter={() => setMentionIndex(idx)}
                            className={`group w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-all duration-150 cursor-pointer ${
                              isActive
                                ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
                                : 'bg-transparent hover:bg-surface-container text-on-surface hover:shadow-sm'
                            }`}
                          >
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black shrink-0 border shadow-sm transition-colors ${
                              isActive
                                ? 'bg-white/20 text-white border-white/30'
                                : 'bg-primary/10 text-primary border-primary/15 group-hover:bg-primary/15'
                            }`}>
                              {initials(u.fullName)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={`text-[13px] font-bold leading-none truncate ${isActive ? 'text-white' : 'text-on-surface'}`}>{u.fullName}</p>
                              <p className={`text-[11px] font-medium truncate leading-none mt-1 ${isActive ? 'text-white/80' : 'text-on-surface-variant'}`}>{u.email}</p>
                            </div>
                            {isAlready ? (
                              <span className={`text-[10px] font-extrabold px-2 py-1 rounded-full shrink-0 flex items-center gap-1 ${isActive ? 'bg-white text-primary' : 'bg-primary/15 text-primary'}`}>
                                <Check className="w-3 h-3" /> mentionné
                              </span>
                            ) : isActive ? (
                              <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                                <ChevronRight className="w-4 h-4 text-white" />
                              </span>
                            ) : (
                              <span className="w-7 h-7 rounded-lg bg-surface-container border border-outline-variant/40 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <AtSign className="w-3.5 h-3.5 text-on-surface-variant" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between gap-2 px-1.5 py-1.5 rounded-xl bg-surface-container/60 border border-outline-variant/20">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium text-on-surface-variant">
                      <kbd className="px-1.5 py-0.5 rounded-md bg-surface border border-outline-variant/40 text-[10px] font-bold shadow-sm">↑↓</kbd>
                      <span>naviguer</span>
                      <kbd className="ml-1 px-1.5 py-0.5 rounded-md bg-surface border border-outline-variant/40 text-[10px] font-bold shadow-sm">↵</kbd>
                      <span>sélectionner</span>
                      <kbd className="ml-1 px-1 py-0.5 rounded-md bg-surface border border-outline-variant/40 text-[10px] font-bold shadow-sm">Échap</kbd>
                    </div>
                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-primary">
                      <AtSign className="w-3 h-3" /> Outlook
                    </span>
                  </div>
                </div>,
                document.body
              )}
              {/* Chips des personnes mentionnées — aperçu premium avant envoi */}
              {mentionedUsers.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/10 bg-primary/[0.04] px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider uppercase text-primary shrink-0">
                    <Mail className="w-3 h-3" /> Mentionnés
                  </span>
                  <span className="w-px h-4 bg-primary/15 shrink-0" aria-hidden />
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {mentionedUsers.filter((u) => followup.includes(`@${u.fullName}`)).map((u) => (
                      <span key={u.id} className="group inline-flex items-center gap-1.5 pl-1 pr-1 py-1 rounded-full bg-white dark:bg-surface border border-primary/15 shadow-sm text-[12px] font-bold text-primary">
                        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-primary/80 text-white flex items-center justify-center text-[9px] font-black shadow-sm">{initials(u.fullName)}</span>
                        <span className="pr-0.5">@{u.fullName}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFollowup((prev) => prev.replace(`@${u.fullName} `, '').replace(`@${u.fullName}`, ''));
                            setMentionedUsers((prev) => prev.filter((m) => m.id !== u.id));
                          }}
                          className="w-5 h-5 rounded-full bg-surface-container hover:bg-red-500 hover:text-white text-on-surface-variant flex items-center justify-center transition-colors cursor-pointer"
                          aria-label={`Retirer ${u.fullName}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-on-surface-variant shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> email automatique
                  </span>
                </div>
              )}

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
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl btn-primary text-xs font-bold disabled:opacity-40 transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Envoyer{pastedImages.length > 0 ? ` (${pastedImages.length} img.)` : ''}</span>
                </button>
              </div>
            </form>
            )}
          </div>


        </div>

        {/* ── RIGHT COLUMN: Actions, AI, Approvals ──────────────────────── */}
        <div className="flex flex-col gap-5 min-w-0 xl:w-[340px] xl:shrink-0 order-3 xl:sticky xl:top-6 xl:self-start">
          {/* Source Email Details */}
          {ticket.sourceEmail && (
            <div className="bento-card p-5 space-y-3">
              <h3 className="bento-card-header -mx-5 -mt-5 mb-0" style={{ borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit' }}>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" style={{ color: 'var(--color-info)' }} />
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-foreground)' }}>Email d'origine</span>
                </div>
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
              {ticket.messages?.length > 0 && canForward && (
                <button
                  onClick={handleForwardEmail}
                  disabled={forwarding}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-semibold disabled:opacity-50"
                >
                  {forwarding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {forwarding ? 'Envoi en cours...' : 'Transférer la conversation'}
                </button>
              )}
            </div>
           )}

          {/* Liaison fil email — verrouillée pour éviter la suppression accidentelle */}
          {!['REQUESTER', 'TECHNICIAN'].includes(user?.role) && (
            <div className={`bento-card p-5 space-y-3 transition-all ${ticket.outlookConversationId && conversationLocked ? 'border-emerald-500/20 shadow-sm' : ''}`}>
            <h3 className="bento-card-header -mx-5 -mt-5 mb-0 flex items-center justify-between" style={{ borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit' }}>
              <div className="flex items-center gap-2">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border shadow-sm ${ticket.outlookConversationId && conversationLocked ? 'bg-emerald-500/15 border-emerald-500/20 text-emerald-600' : 'bg-primary/10 border-primary/15 text-primary'}`}>
                  <Link2 className="w-4 h-4" />
                </span>
                <span className="text-xs font-extrabold tracking-wide" style={{ color: 'var(--color-foreground)' }}>Fil de conversation</span>
              </div>
              {ticket.outlookConversationId ? (
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black tracking-wider border ${conversationLocked ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25'}`}>
                  {conversationLocked ? <><Lock className="w-3 h-3" /> Verrouillé</> : <><Unlock className="w-3 h-3" /> Édition</>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold bg-surface-container border border-outline-variant/40 text-on-surface-variant">
                  <Link2 className="w-3 h-3" /> Non lié
                </span>
              )}
            </h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {ticket.outlookConversationId
                ? (conversationLocked
                    ? 'Fil verrouillé — les prochains mails de ce fil sont rattachés à ce ticket. Déverrouillez pour modifier.'
                    : 'Fil en édition — toute suppression nécessite une confirmation.')
                : 'Aucun fil lié. Collez un ID de conversation Outlook (depuis le mail) pour rattacher les suivis.'}
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  value={conversationIdDraft}
                  onChange={(e) => setConversationIdDraft(e.target.value)}
                  placeholder="AAQkAD..."
                  className={`w-full pl-3 pr-9 py-2.5 rounded-xl border text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                    conversationLocked && ticket.outlookConversationId
                      ? 'bg-surface-container-low border-dashed border-emerald-500/25 text-on-surface-variant cursor-not-allowed pr-9'
                      : 'bg-surface border-outline-variant text-on-surface'
                  }`}
                  disabled={savingConversationId || (conversationLocked && !!ticket.outlookConversationId)}
                  readOnly={conversationLocked && !!ticket.outlookConversationId}
                />
                {conversationLocked && ticket.outlookConversationId && (
                  <Lock className="w-3.5 h-3.5 text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                )}
              </div>
              {conversationLocked && ticket.outlookConversationId ? (
                <button
                  type="button"
                  onClick={() => setConversationLocked(false)}
                  className="px-4 py-2.5 rounded-xl bg-surface border border-outline-variant/40 hover:bg-surface-container text-on-surface text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5" /> Déverrouiller
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleSaveConversationId}
                    disabled={savingConversationId || conversationIdDraft.trim() === (ticket.outlookConversationId || '')}
                    className="px-4 py-2.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shrink-0 shadow-sm cursor-pointer"
                  >
                    {savingConversationId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    {ticket.outlookConversationId ? 'Enregistrer' : 'Lier'}
                  </button>
                  {ticket.outlookConversationId && (
                    <button
                      type="button"
                      onClick={() => { setConversationIdDraft(ticket.outlookConversationId || ''); setConversationLocked(true); }}
                      disabled={savingConversationId}
                      className="px-3 py-2.5 rounded-xl bg-surface border border-outline-variant/40 hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Annuler
                    </button>
                  )}
                </>
              )}
            </div>
            {/* Barre d’état verrouillée */}
            {ticket.outlookConversationId && conversationLocked && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/8 border border-emerald-500/15 px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 leading-snug truncate flex-1" title={ticket.outlookConversationId}>
                  Verrouillé : {ticket.outlookConversationId}
                </p>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(ticket.outlookConversationId); toast.success('ID copié'); }}
                  className="p-1 rounded-md hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 transition-colors shrink-0 cursor-pointer"
                  title="Copier l’ID"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {/* Avertissement édition + suppression */}
            {ticket.outlookConversationId && !conversationLocked && (
              <div className="flex flex-col gap-2 rounded-xl bg-amber-500/8 border border-amber-500/20 px-3 py-2.5">
                <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Mode édition — vider le champ et enregistrer supprimera le lien. Cette action est protégée par une confirmation.
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-on-surface-variant truncate" title={ticket.outlookConversationId}>Actuel : {ticket.outlookConversationId}</span>
                  <button
                    type="button"
                    onClick={() => setShowUnlinkConfirm(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 text-red-600 dark:text-red-400 text-[11px] font-bold transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Supprimer le lien
                  </button>
                </div>
              </div>
            )}
            {/* ConfirmDialog suppression */}
            <ConfirmDialog
              open={showUnlinkConfirm}
              onClose={() => setShowUnlinkConfirm(false)}
              onConfirm={confirmUnlinkConversation}
              title="Supprimer le fil de conversation ?"
              message={`Le ticket #${ticket.id} ne sera plus lié au fil Outlook.\nLes prochains mails de ce fil ne seront plus rattachés automatiquement. Cette action est réversible en recollant l’ID.`}
              confirmText="Supprimer le lien"
              confirmVariant="danger"
              loading={savingConversationId}
            />
          </div>
          )}

          {/* AI Suggestions */}
          {ticket.aiSuggestions?.length > 0 && (
            <div className="bento-card p-5 space-y-3" style={{ borderColor: 'color-mix(in srgb, #8b5cf6 20%, var(--color-border))', backgroundColor: 'color-mix(in srgb, #8b5cf6 3%, var(--color-card))' }}>
              <h3 className="text-xs font-semibold flex items-center gap-2 pb-3 border-b" style={{ color: '#8b5cf6', borderColor: 'color-mix(in srgb, #8b5cf6 15%, var(--color-border))' }}>
                <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                Suggestions IA
              </h3>
              <div className="space-y-2">
                {(ticket?.aiSuggestions || []).map((s) => (
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

          {/* Approval Workflow Card — only for AI-processed tickets or active approvals */}
          {(ticket.aiProcessed || ticket.approvalStatus === 'PENDING' || ticket.approvalStatus === 'REJECTED') && (
            <div className="bento-card p-5 space-y-4">
              <h3 className="text-xs font-semibold flex items-center gap-2 pb-3 border-b" style={{ color: 'var(--color-foreground)', borderColor: 'var(--color-border)' }}>
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

              {canApprove && ticket.approvalStatus === 'PENDING' ? (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleApprove}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-emerald-500/20 hover:brightness-110"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Approuver
                  </button>
                  {ticket.approvalStatus === 'PENDING' && (
                    <button
                      onClick={handleReject}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-500/10 cursor-pointer transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                      Rejeter
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Properties Card */}
          <div className="bento-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-outline-variant/15 dark:border-outline-variant/8 pb-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4" />
                </span>
                Propriétés du ticket
              </h3>
              <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-surface-container-high text-on-surface-variant uppercase tracking-wider">
                Modifiable
              </span>
            </div>

            <div className="space-y-4">
              {/* Zone 1 — Informations générales (grille 2 colonnes) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Type
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
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
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Catégorie
                </label>
                {canAssign ? (
                  <SearchableSelect
                    options={categoryOptions}
                    value={ticket.category || ''}
                    disabled={savingField === 'category'}
                    onChange={(val) => updateField('category', val)}
                    placeholder="Aucune catégorie"
                    searchPlaceholder="Rechercher une catégorie..."
                    ariaLabel="Catégorie du ticket"
                  />
                ) : (
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/15 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface">
                    {ticket.category || '-'}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Statut
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                  value={ticket.status}
                  disabled={(!canAssign && !isAssignedTechnician && !isTeamTicket) || savingField === 'status' || (user?.role === 'TECHNICIAN' && ['SOLVED', 'CLOSED'].includes(ticket.status))}
                  onChange={(e) => updateField('status', e.target.value)}
                >
                  {MANUAL_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Source de la demande
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
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
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Urgence
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
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
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Impact
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
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
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Priorité
                </label>
                <select
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
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
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  ID externe
                </label>
                <input
                  className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  defaultValue={ticket.externalId || ''}
                  disabled={!canAssign}
                  onBlur={(e) => updateField('externalId', e.target.value)}
                />
              </div>
              </div>

              {/* Zone 2 — Assignation & suivi */}
              <div className="border-t border-outline-variant/15 pt-4 space-y-3.5">

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Équipe
                </label>
                {canAssign ? (
                  <select
                    className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                    value={ticket.teamId || ''}
                    disabled={savingField === 'teamId'}
                    onChange={async (e) => {
                      const teamIdVal = e.target.value ? Number(e.target.value) : null;
                      await updateField('teamId', teamIdVal);
                      if (teamIdVal) {
                        const selectedTeam = teams.find((t) => t.id === teamIdVal);
                        const teamObserverIds = (selectedTeam?.defaultObservers || []).map((o) => o.id);
                        if (teamObserverIds.length > 0) {
                          try {
                            await api.patch(`/tickets/${id}`, { observerIds: teamObserverIds });
                            load();
                          } catch {}
                        }
                      }
                    }}
                  >
                    <option value="">Aucune</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/15 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface">
                    {ticket.team?.name || 'Non assignée'}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1">
                  Demandeurs
                </label>
                {canAssign ? (
                  <RemoteUserMultiSelect
                    value={ticket.requesterIds || (ticket.requesterId ? [ticket.requesterId] : [])}
                    onChange={async (vals) => {
                      try {
                        setSavingField('requesterIds');
                        await api.patch(`/tickets/${id}`, { requesterIds: vals });
                        toast.success('Demandeurs mis à jour');
                        load();
                      } catch (err) {
                        toast.error(err.response?.data?.error || 'Échec de la mise à jour');
                      } finally {
                        setSavingField(null);
                      }
                    }}
                    placeholder="Rechercher des demandeurs..."
                  />
                ) : (
                  <div className="w-full flex items-center gap-2 bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/15 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface">
                    {ticket.requester ? (
                      <>
                        <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold border border-primary/20">
                          {initials(ticket.requester.fullName)}
                        </div>
                        {ticket.requester.fullName}
                      </>
                    ) : (
                      <span className="text-on-surface-variant">{ticket.sourceName || 'Non spécifié'}</span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1 flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-blue-500" />
                  Attribué à {ticket.assignees?.length > 0 && `(${ticket.assignees.length})`}
                </label>
                {canAssign ? (
                  <RemoteUserMultiSelect
                    value={(ticket.assignees && ticket.assignees.length > 0) ? ticket.assignees.map((a) => a.id) : (ticket.assignedToId ? [ticket.assignedToId] : [])}
                    onChange={async (vals, selectedUsers) => {
                      try {
                        setSavingField('assigneeIds');
                        const firstUser = selectedUsers && selectedUsers[0];
                        const autoTeamId = firstUser ? (firstUser.teamId || firstUser.team?.id) : null;
                        const payload = { assigneeIds: vals };
                        if (autoTeamId && !ticket.teamId) payload.teamId = autoTeamId;
                        await api.patch(`/tickets/${id}`, payload);
                        toast.success('Techniciens assignés mis à jour');
                        load();
                      } catch (err) {
                        toast.error(err.response?.data?.error || 'Échec de la mise à jour');
                      } finally {
                        setSavingField(null);
                      }
                    }}
                    teamId={ticket.teamId || null}
                    onlyStaff={true}
                    placeholder="Rechercher des techniciens..."
                    disabled={savingField === 'assigneeIds'}
                  />
                ) : (
                  <div className="w-full flex items-center gap-1.5 bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/15 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface flex-wrap">
                    {((ticket.assignees && ticket.assignees.length > 0) ? ticket.assignees : (ticket.assignedTo ? [ticket.assignedTo] : [])).length > 0 ? (
                      ((ticket.assignees && ticket.assignees.length > 0) ? ticket.assignees : [ticket.assignedTo]).map((tech) => (
                        <span key={tech.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                          <div className="w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center text-[8px] font-bold">
                            {initials(tech.fullName)}
                          </div>
                          {tech.fullName}
                        </span>
                      ))
                    ) : (
                      <span className="text-on-surface-variant italic font-normal">Non assigné</span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1 flex items-center gap-1">
                  <Eye className="w-3 h-3 text-amber-500" />
                  Observateur(s) {ticket.observers?.length > 0 && `(${ticket.observers.length})`}
                </label>
                {canAssign ? (
                  <RemoteUserMultiSelect
                    value={(ticket.observers || []).map((o) => o.id)}
                    onChange={async (vals) => {
                      try {
                        setSavingField('observerIds');
                        await api.patch(`/tickets/${id}`, { observerIds: vals });
                        toast.success('Observateurs mis à jour');
                        load();
                      } catch (err) {
                        toast.error(err.response?.data?.error || 'Échec de la mise à jour');
                      } finally {
                        setSavingField(null);
                      }
                    }}
                    users={allUsers}
                    glpiUsers={glpiUsers}
                    placeholder="Rechercher un observateur..."
                    disabled={savingField === 'observerIds'}
                  />
                ) : (
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface flex items-center gap-2 flex-wrap">
                    <Eye className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    {(ticket.observers || []).length > 0 ? (
                      (ticket.observers || []).map((o) => (
                        <span key={o.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/25 text-[11px] font-semibold text-purple-700 dark:text-purple-400">
                          {o.fullName || o.email}
                        </span>
                      ))
                    ) : (
                      <span className="text-on-surface-variant italic font-normal">Aucun observateur</span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-primary" />
                  Lieu
                </label>
                {canAssign ? (
                  <SearchableSelect
                    options={locations}
                    value={ticket.locationId || ''}
                    disabled={savingField === 'locationId'}
                    onChange={async (val) => {
                      const selectedLoc = locations.find((l) => String(l.id) === String(val));
                      const locName = selectedLoc ? (selectedLoc.completename || selectedLoc.name) : null;
                      const suffix = ticket.title?.includes(' : ') ? ticket.title.split(' : ').slice(1).join(' : ') : ticket.title;
                      const newTitle = locName && suffix ? `${locName} : ${suffix}` : (locName || suffix || ticket.title);
                      try {
                        setSavingField('locationId');
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
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                    {ticket.locationName || <span className="text-on-surface-variant italic font-normal">INDÉTERMINÉ</span>}
                  </div>
                )}
              </div>


              </div>
            </div>
          </div>

          {/* Requester Details Card */}
          <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </span>
                Demandeur
              </h3>
            </div>

            <div className="space-y-3">
                {(() => {
                  // Tous les demandeurs : objet User complet si connu, sinon résolu depuis allUsers
                  const requesterIds = Array.isArray(ticket.requesterIds) && ticket.requesterIds.length > 0
                    ? ticket.requesterIds
                    : (ticket.requesterId ? [ticket.requesterId] : []);
                  const knownUsers = [
                    ...(ticket.requester ? [ticket.requester] : []),
                    ...(ticket.secondaryRequester ? [ticket.secondaryRequester] : []),
                  ];
                  const resolved = requesterIds.map((rid) =>
                    knownUsers.find((u) => u.id === rid) ||
                    (allUsers || []).find((u) => u.id === rid) ||
                    { id: rid, fullName: `Utilisateur #${rid}`, email: '' }
                  );
                  if (resolved.length === 0) {
                    return (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl border border-outline-variant/40 bg-surface-container text-on-surface flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                          {initials(ticket.sourceName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-on-surface truncate">{ticket.sourceName || ticket.sourceEmail || '-'}</p>
                          <p className="text-[11px] text-on-surface-variant font-medium truncate">{ticket.sourceEmail || '-'}</p>
                        </div>
                      </div>
                    );
                  }
                  return resolved.map((u, idx) => (
                    <div key={u.id ?? idx} className={`flex items-center gap-3 ${idx > 0 ? 'border-t border-outline-variant/15 pt-2.5' : ''}`}>
                      <div className="w-10 h-10 rounded-2xl border border-outline-variant/40 bg-surface-container text-on-surface flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                        {initials(u.fullName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        {idx === 0 && <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Demandeur principal</p>}
                        {idx > 0 && <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{idx + 1}{idx === 1 ? 'er' : 'e'} demandeur</p>}
                        <p className="text-xs font-bold text-on-surface truncate">{u.fullName || '-'}</p>
                        <p className="text-[11px] text-on-surface-variant font-medium truncate">{u.email || '-'}</p>
                      </div>
                    </div>
                  ));
                })()}
              </div>
          </div>

          {/* Champs personnalisés (lecture seule) */}
          {ticket.customFields && Object.keys(ticket.customFields).length > 0 && (
            <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
                <ListChecks className="w-4 h-4 text-primary" />
                Informations complémentaires
              </h3>
              <div className="grid grid-cols-1 gap-2.5">
                {Object.entries(ticket.customFields).map(([key, value]) => {
                  const def = customFieldDefs.find((d) => String(d.id) === String(key));
                  if (value === undefined || value === null || value === '') return null;
                  const label = def?.label || `Champ #${key}`;
                  const display = def?.type === 'CHECKBOX'
                    ? (String(value) === 'true' ? 'Oui' : 'Non')
                    : def?.type === 'SELECT' && Array.isArray(def.options)
                      ? String(value)
                      : String(value);
                  return (
                    <div key={key} className="flex items-start justify-between gap-3">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant shrink-0 pt-0.5">{label}</span>
                      <span className="text-xs font-semibold text-on-surface text-right break-words">{display}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Équipements liés (Inventaire) */}
          {ticket.assets?.length > 0 && (
            <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
                <Boxes className="w-4 h-4 text-primary" />
                Équipements liés ({(ticket?.assets || []).length})
                <Link to="/assets" className="ml-auto text-[10px] font-bold text-primary hover:underline">
                  Voir l'inventaire →
                </Link>
              </h3>
              <div className="space-y-2">
                {(ticket?.assets || []).map(({ asset }) => (
                  <div key={asset.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-outline-variant/20 bg-surface-container-low/30">
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                      <Boxes className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">{asset.name}</p>
                      {(asset.serialNumber || asset.inventoryNumber || asset.model) && (
                        <p className="text-[11px] text-on-surface-variant truncate">
                          {[asset.inventoryNumber, asset.serialNumber, asset.model].filter(Boolean).join(' — ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {asset.assetType && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{asset.assetType}</span>
                      )}
                      {asset.status && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          asset.status === 'BROKEN'
                            ? 'bg-red-500/10 text-red-500'
                            : asset.status === 'STOCK'
                              ? 'bg-blue-500/10 text-blue-500'
                              : asset.status === 'OUT_OF_SERVICE'
                                ? 'bg-surface-container text-on-surface-variant'
                                : 'bg-emerald-500/10 text-emerald-500'
                        }`}>{asset.status.replace(/_/g, ' ')}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
            </motion.div>
          )}
        </AnimatePresence>
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
                  <span className="font-semibold text-on-surface">
                    {(ticket.assignees && ticket.assignees.length > 0)
                      ? ticket.assignees.map((a) => a.fullName).join(', ')
                      : (ticket.assignedTo?.fullName || 'Non assigné')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Lieu</span>
                  <span className="font-semibold text-on-surface">{ticket.locationName || 'Non déterminé'}</span>
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
                className="px-5 py-2 rounded-xl text-xs font-bold btn-primary shadow-md disabled:opacity-50 transition-all flex items-center gap-1.5"
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
        message={`Supprimer définitivement le ticket #${id} ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Confirm Delete Followup Dialog */}
      <ConfirmDialog
        open={!!followupToDelete}
        title="Supprimer le commentaire"
        message="Supprimer définitivement ce commentaire ? Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        loading={deletingFollowup}
        onConfirm={confirmDeleteFollowup}
        onCancel={() => setFollowupToDelete(null)}
      />

      {/* MODALE ESCALADE : transfert vers une autre équipe + choix du technicien */}
      {escalateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-orange-600 dark:text-orange-400">
              <TrendingUp className="w-6 h-6" />
              <div>
                <h3 className="text-base font-bold">Escalader le ticket #{id}</h3>
                <p className="text-xs text-on-surface-variant">Transférer le ticket à l'équipe qui doit le gérer</p>
              </div>
            </div>

            <label className="block space-y-1.5">                <span className="text-xs font-bold text-on-surface">Équipe cible *</span>
                <select
                  value={escalateTargetTeamId}
                  onChange={(e) => { setEscalateTargetTeamId(e.target.value); setEscalateTargetUserId(''); }}
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                >
                  <option value="">— Choisir une équipe —</option>
                  {escalateTeams
                    .filter((t) => !ticket.team || t.id !== ticket.team.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {(t.members || []).filter((m) => m.isActive !== false).length} membre(s) · {typeof t._count?.tickets === 'number' ? `${t._count.tickets} ticket(s) actif(s)` : ''}
                      </option>
                    ))}
                </select>
                <span className="text-[10px] text-on-surface-variant">
                  Le ticket est transféré à cette équipe, qui devient responsable de sa prise en charge.
                </span>
            </label>

            {escalateTargetTeamId && (
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-on-surface">Technicien</span>
                <select
                  value={escalateTargetUserId}
                  onChange={(e) => setEscalateTargetUserId(e.target.value)}
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                >
                  <option value="">— Non assigné (à la charge de l'équipe) —</option>
                  {targetTeamMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.fullName}</option>
                  ))}
                </select>
                <span className="text-[10px] text-on-surface-variant">
                  Optionnel — seuls les techniciens de l'équipe cible sont proposés. Sans choix, le ticket reste au pool de l'équipe.
                </span>
              </label>
            )}

            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-on-surface">Motif</span>
              <textarea
                rows={2}
                placeholder="Ex : nécessite une expertise réseau, surcharge de l'équipe actuelle..."
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
              />
            </label>

            <p className="text-[10px] text-on-surface-variant flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-orange-500" />
              L'équipe cible, le technicien choisi et les responsables seront notifiés (application + email).
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEscalateModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!escalateTargetTeamId || escalating}
                onClick={handleEscalate}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white shadow-md shadow-orange-500/20 hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                <TrendingUp className="w-4 h-4" />
                {escalating ? 'Transfert en cours...' : 'Transférer le ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Lier un ticket */}
      {linkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setLinkModalOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Link2 className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-on-surface">Lier un ticket</h3>
                  <p className="text-[11px] text-on-surface-variant">Choisissez un type de lien puis recherchez le ticket cible</p>
                </div>
              </div>
              <button onClick={() => setLinkModalOpen(false)} className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Type de lien */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Type de lien</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { value: 'RELATED', label: 'Lié', icon: Link2, color: 'text-blue-500' },
                    { value: 'DUPLICATE_OF', label: 'Doublon', icon: Copy, color: 'text-orange-500' },
                    { value: 'BLOCKS', label: 'Bloque', icon: ShieldAlert, color: 'text-red-500' },
                    { value: 'BLOCKED_BY', label: 'Bloqué par', icon: ShieldOff, color: 'text-amber-500' },
                    { value: 'PARENT', label: 'Parent', icon: ArrowDown, color: 'text-indigo-500' },
                    { value: 'CHILD', label: 'Sous-ticket', icon: GitBranch, color: 'text-emerald-500' },
                  ].map(({ value, label, icon: Icon, color }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLinkType(value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                        linkType === value
                          ? 'border-primary bg-primary/5 text-primary shadow-sm'
                          : 'border-outline-variant/40 text-on-surface-variant hover:border-primary/30 hover:bg-surface-container'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 ${linkType === value ? 'text-primary' : color}`} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recherche */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Rechercher un ticket</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                  <input
                    type="text"
                    value={linkSearch}
                    onChange={(e) => handleLinkSearch(e.target.value)}
                    placeholder="Titre, n° de ticket, catégorie…"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-outline-variant/60 bg-surface text-on-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none placeholder:text-on-surface-variant/40"
                    autoFocus
                  />
                  {linkLoading && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-primary animate-spin" />}
                </div>
              </div>

              {/* Résultats */}
              <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
                {!linkLoading && linkResults.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-6 text-on-surface-variant/50">
                    <Search className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs font-medium">{linkSearch ? 'Aucun résultat pour "' + linkSearch + '"' : 'Tapez pour rechercher un ticket'}</p>
                  </div>
                )}
                {linkResults.map((t) => {
                  const prioColor = { P1: 'text-red-500 bg-red-500/10', P2: 'text-orange-500 bg-orange-500/10', P3: 'text-blue-500 bg-blue-500/10', P4: 'text-slate-500 bg-slate-500/10' };
                  const statusColor = {
                    NEW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                    OPEN: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                    PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    SOLVED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    CLOSED: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
                  };
                  return (
                    <button
                      key={t.id}
                      onClick={() => addLink(t.id)}
                      className="w-full flex items-start gap-3 p-3 rounded-xl border border-outline-variant/20 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer text-left group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="font-mono text-[10px] font-bold text-primary">#{t.id}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">{t.title}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusColor[t.status] || 'bg-slate-500/10 text-slate-500'}`}>{STATUS_CONFIG[t.status]?.label || t.status}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${prioColor[t.priority] || 'bg-slate-500/10 text-slate-500'}`}>{t.priority}</span>
                          {t.requester?.fullName && <span className="text-[10px] text-on-surface-variant">par {t.requester.fullName}</span>}
                          {t.team?.name && <span className="text-[10px] text-on-surface-variant/60">· {t.team.name}</span>}
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1">Lier →</span>
                    </button>
                  );
                })}
              </div>

              {linkResults.length > 0 && (
                <p className="text-[10px] text-on-surface-variant/50 text-center">{linkResults.length} ticket(s) affiché(s) — cliquez pour lier</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal : Lier à un problème */}
      {problemLinkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setProblemLinkModalOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-on-surface">Lier à un problème</h3>
                  <p className="text-[11px] text-on-surface-variant">Associez ce ticket à un problème racine existant</p>
                </div>
              </div>
              <button onClick={() => setProblemLinkModalOpen(false)} className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Recherche */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Rechercher un problème</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                  <input
                    type="text"
                    value={problemLinkSearch}
                    onChange={(e) => handleProblemLinkSearch(e.target.value)}
                    placeholder="Titre, n° de problème…"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-outline-variant/60 bg-surface text-on-surface text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:outline-none placeholder:text-on-surface-variant/40"
                    autoFocus
                  />
                  {problemLinkLoading && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 animate-spin" />}
                </div>
              </div>

              {/* Résultats */}
              <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
                {!problemLinkLoading && problemLinkResults.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-6 text-on-surface-variant/50">
                    <AlertTriangle className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs font-medium">{problemLinkSearch ? 'Aucun résultat pour "' + problemLinkSearch + '"' : 'Tapez pour rechercher un problème'}</p>
                  </div>
                )}
                {problemLinkResults.map((p) => {
                  const statusColor = {
                    NEW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                    IN_PROGRESS: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
                    SOLVED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    CLOSED: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
                  };
                  return (
                    <button
                      key={p.id}
                      onClick={() => linkProblem(p.id)}
                      disabled={linkingProblem === p.id}
                      className="w-full flex items-start gap-3 p-3 rounded-xl border border-outline-variant/20 hover:border-amber-400/40 hover:bg-amber-500/5 transition-all cursor-pointer text-left group disabled:opacity-50"
                    >
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="font-mono text-[10px] font-bold text-amber-600 dark:text-amber-400">P#{p.id}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">{p.title}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusColor[p.status] || 'bg-slate-500/10 text-slate-500'}`}>{p.status}</span>
                          {p.requester?.fullName && <span className="text-[10px] text-on-surface-variant">par {p.requester.fullName}</span>}
                          {p._count?.tickets > 0 && <span className="text-[10px] text-on-surface-variant/60">· {p._count.tickets} ticket(s)</span>}
                        </div>
                      </div>
                      {linkingProblem === p.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-amber-500 shrink-0 mt-1" />
                      ) : (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1">Lier →</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {problemLinkResults.length > 0 && (
                <p className="text-[10px] text-on-surface-variant/50 text-center">{problemLinkResults.length} problème(s) affiché(s) — cliquez pour lier</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal : Créer un sous-ticket */}
      {childModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setChildModalOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <GitBranch className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-on-surface">Créer un sous-ticket</h3>
                  <p className="text-[11px] text-on-surface-variant">Hérite automatiquement des propriétés du parent</p>
                </div>
              </div>
              <button onClick={() => setChildModalOpen(false)} className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Carte d'information du parent */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/15">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="font-mono text-[10px] font-bold text-primary">#{id}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-on-surface truncate">Ticket parent</p>
                  <p className="text-[11px] text-on-surface-variant truncate mt-0.5">{ticket.title}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {ticket.priority && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{ticket.priority}</span>}
                    {ticket.team?.name && <span className="text-[10px] text-on-surface-variant">· {ticket.team.name}</span>}
                    {ticket.requester?.fullName && <span className="text-[10px] text-on-surface-variant/60">· {ticket.requester.fullName}</span>}
                  </div>
                </div>
              </div>

              {/* Champs du formulaire */}
              <form onSubmit={createChild} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Titre *</label>
                  <input
                    type="text"
                    value={childForm.title}
                    onChange={(e) => setChildForm({ ...childForm, title: e.target.value })}
                    required
                    placeholder="Ex. : Remplacer l'écran de l'utilisateur"
                    className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/60 bg-surface text-on-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none placeholder:text-on-surface-variant/40"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Description</label>
                  <textarea
                    value={childForm.content}
                    onChange={(e) => setChildForm({ ...childForm, content: e.target.value })}
                    rows={3}
                    placeholder="Détails de la sous-tâche..."
                    className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/60 bg-surface text-on-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none resize-none placeholder:text-on-surface-variant/40"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Priorité</label>
                  <div className="flex gap-2">
                    {PRIORITY_OPTIONS.map((p) => {
                      const pColor = { P1: 'border-red-400 text-red-500 bg-red-500/5', P2: 'border-orange-400 text-orange-500 bg-orange-500/5', P3: 'border-blue-400 text-blue-500 bg-blue-500/5', P4: 'border-slate-400 text-slate-500 bg-slate-500/5' };
                      const pActive = { P1: 'border-red-500 bg-red-500/10 text-red-600 shadow-sm', P2: 'border-orange-500 bg-orange-500/10 text-orange-600 shadow-sm', P3: 'border-blue-500 bg-blue-500/10 text-blue-600 shadow-sm', P4: 'border-slate-500 bg-slate-500/10 text-slate-600 shadow-sm' };
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setChildForm({ ...childForm, priority: p })}
                          className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            childForm.priority === p ? (pActive[p] || '') : (pColor[p] || 'border-outline-variant/40 text-on-surface-variant')
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setChildModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-outline-variant/60 text-on-surface-variant text-xs font-bold hover:bg-surface-container transition-colors cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={creatingChild || !childForm.title.trim()}
                    className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {creatingChild ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                    {creatingChild ? 'Création…' : 'Créer le sous-ticket'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE RELATIONS : tickets liés · problèmes racines · sous-tickets ═══ */}
      {relationsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn" onClick={() => setRelationsModalOpen(false)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header + onglets */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-outline-variant/20 bg-surface-container-low/40">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-extrabold text-on-surface flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-primary" />
                  Relations du ticket #{id}
                </h3>
                <button
                  onClick={() => setRelationsModalOpen(false)}
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
                  title="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1 p-0.5 rounded-xl border border-outline-variant/30 bg-surface-muted w-fit">
                {[
                  { key: 'tickets', label: `Tickets liés (${linkedTickets.length})`, show: true },
                  { key: 'problems', label: `Problèmes racines (${linkedProblems.length})`, show: canManageProblems },
                  { key: 'children', label: `Sous-tickets (${children.length + (parentTicket ? 1 : 0)})`, show: true },
                ].filter((t) => t.show).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setRelationsTab(t.key)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      relationsTab === t.key
                        ? 'bg-surface text-on-surface shadow-sm border border-outline-variant/30'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Corps — contenu de l'onglet actif */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5">
              {relationsTab === 'tickets' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-on-surface-variant italic">
                      {linkedTickets.length === 0 ? 'Aucun ticket lié (doublons, incidents liés…).' : `${linkedTickets.length} ticket(s) lié(s)`}
                    </p>
                    {canAssign && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setMergeModalOpen(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-orange-500/30 text-orange-600 dark:text-orange-400 text-[11px] font-bold hover:bg-orange-500/5 transition-colors cursor-pointer"
                        >
                          <Merge className="w-3.5 h-3.5" />
                          Fusionner…
                        </button>
                        <button
                          onClick={() => setLinkModalOpen(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Lier un ticket
                        </button>
                      </div>
                    )}
                  </div>
                  {linkedTickets.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 hover:border-primary/40 transition-colors">
                      <Link2 className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/tickets/${l.otherTicket.id}`}
                          onClick={() => setRelationsModalOpen(false)}
                          className="text-xs font-bold text-on-surface hover:text-primary transition-colors line-clamp-1"
                        >
                          #{l.otherTicket.id} — {l.otherTicket.title}
                        </Link>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant uppercase tracking-wider">
                            {l.type}
                          </span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            l.otherTicket.status === 'SOLVED' || l.otherTicket.status === 'CLOSED'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          }`}>
                            {l.otherTicket.status}
                          </span>
                        </div>
                      </div>
                      {canAssign && (
                        <button
                          onClick={() => removeLink(l)}
                          className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/5 transition-colors cursor-pointer"
                          title="Supprimer le lien"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {relationsTab === 'problems' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-on-surface-variant italic">
                      {linkedProblems.length === 0 ? 'Aucun problème racine lié. Regroupez les incidents similaires.' : `${linkedProblems.length} problème(s) racine(s)`}
                    </p>
                    {canManageProblems && (
                      <button
                        onClick={() => setProblemLinkModalOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500 text-white text-[11px] font-bold hover:bg-amber-600 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Lier un problème
                      </button>
                    )}
                  </div>
                  {linkedProblems.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border border-amber-200/40 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-500/5 hover:border-amber-400/60 transition-colors">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => { setRelationsModalOpen(false); navigate(`/problems/${p.id}`); }}
                          className="text-xs font-bold text-on-surface hover:text-amber-600 dark:hover:text-amber-400 transition-colors line-clamp-1 text-left cursor-pointer"
                        >
                          #{p.id} — {p.title}
                        </button>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            p.status === 'SOLVED' || p.status === 'CLOSED'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          }`}>
                            {p.status}
                          </span>
                          <span className="text-[9px] font-semibold text-on-surface-variant">
                            {p._count?.tickets || 0} ticket(s) lié(s)
                          </span>
                        </div>
                      </div>
                      {canManageProblems && (
                        <button
                          onClick={() => unlinkProblem(p.id)}
                          className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/5 transition-colors cursor-pointer"
                          title="Détacher le problème"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {relationsTab === 'children' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-on-surface-variant italic">
                      {!parentTicket && children.length === 0 ? 'Aucun sous-ticket. Découpez un incident complexe en sous-tâches.' : `${children.length} sous-ticket(s)${parentTicket ? ' · ticket parent lié' : ''}`}
                    </p>
                    {canAssign && (
                      <button
                        onClick={() => setChildModalOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Créer un sous-ticket
                      </button>
                    )}
                  </div>
                  {parentTicket && (
                    <div className="flex items-center gap-3 p-3 rounded-xl border border-indigo-500/25 bg-indigo-500/5">
                      <GitBranch className="w-3.5 h-3.5 text-indigo-500 shrink-0 rotate-180" />
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/tickets/${parentTicket.id}`}
                          onClick={() => setRelationsModalOpen(false)}
                          className="text-xs font-bold text-on-surface hover:text-primary transition-colors line-clamp-1"
                        >
                          #{parentTicket.id} — {parentTicket.title}
                        </Link>
                        <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mt-0.5">
                          Ticket parent
                        </div>
                      </div>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                        parentTicket.status === 'SOLVED' || parentTicket.status === 'CLOSED'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      }`}>
                        {parentTicket.status}
                      </span>
                    </div>
                  )}

                  {children.length > 0 && (
                    <div className="border-l-2 border-outline-variant/40 ml-4 pl-4 space-y-2">
                      {children.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 hover:border-primary/40 transition-colors">
                          <GitBranch className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                          <div className="flex-1 min-w-0">
                            <Link
                              to={`/tickets/${c.otherTicket.id}`}
                              onClick={() => setRelationsModalOpen(false)}
                              className="text-xs font-bold text-on-surface hover:text-primary transition-colors line-clamp-1"
                            >
                              #{c.otherTicket.id} — {c.otherTicket.title}
                            </Link>
                            <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mt-0.5">
                              Sous-ticket
                            </div>
                          </div>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            c.otherTicket.status === 'SOLVED' || c.otherTicket.status === 'CLOSED'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          }`}>
                            {c.otherTicket.status}
                          </span>
                          {canAssign && (
                            <button
                              onClick={() => removeLink(c)}
                              className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/5 transition-colors cursor-pointer"
                              title="Retirer le lien parent/enfant"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal : Fusionner des tickets dans celui-ci */}
      {mergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                <Merge className="w-4 h-4 text-primary" />
                Fusionner des tickets dans #{id}
              </h3>
              <button onClick={() => { setMergeModalOpen(false); setMergeSelected([]); }} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              Les commentaires, emails, pièces jointes et observateurs des tickets sélectionnés seront
              déplacés vers #{id}, puis les tickets sources seront supprimés. <b>Action irréversible.</b>
            </p>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                type="text"
                value={mergeSearch}
                onChange={(e) => { setMergeSearch(e.target.value); searchMergeableTickets(e.target.value); }}
                placeholder="Rechercher un ticket à fusionner..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
              />
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {mergeLoading && <p className="text-xs text-on-surface-variant text-center py-3">Recherche…</p>}
              {!mergeLoading && mergeResults.length === 0 && (
                <p className="text-xs text-on-surface-variant/70 italic text-center py-3">
                  {mergeSearch ? 'Aucun résultat' : 'Tapez pour rechercher un ticket'}
                </p>
              )}
              {mergeResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggleMergeSelect(t.id)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer text-left ${
                    mergeSelected.includes(t.id) ? 'border-primary bg-primary/10' : 'border-outline-variant/30 hover:border-primary/50 hover:bg-surface-container'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={mergeSelected.includes(t.id)}
                    onChange={() => toggleMergeSelect(t.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-primary w-4 h-4 cursor-pointer shrink-0"
                  />
                  <span className="font-mono text-[10px] font-bold text-primary shrink-0">#{t.id}</span>
                  <span className="flex-1 min-w-0 text-xs font-semibold text-on-surface truncate">{t.title}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant shrink-0">{t.status}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setMergeModalOpen(false); setMergeSelected([]); }}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={mergeSelected.length === 0 || merging}
                onClick={confirmMerge}
                className="px-4 py-2 rounded-xl text-xs font-bold btn-danger shadow-md disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Merge className="w-3.5 h-3.5" />
                {merging ? 'Fusion…' : `Fusionner (${mergeSelected.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale : enregistrer le nouveau lieu détecté dans le titre */}
      {showSaveLocationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                Nouveau lieu détecté
              </h3>
              <button onClick={() => { setShowSaveLocationModal(false); setNewLocationName(''); }} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-on-surface-variant leading-relaxed">
              Le titre contient le lieu <b className="text-on-surface">« {newLocationName} »</b> qui n'existe pas encore dans la liste des lieux. Voulez-vous l'enregistrer pour l'associer automatiquement aux futurs tickets ?
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newLocationName}
                onChange={(e) => setNewLocationName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNewLocation(); }}
                className="flex-1 px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs font-semibold focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                placeholder="Nom du lieu"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowSaveLocationModal(false); setNewLocationName(''); }}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all cursor-pointer"
              >
                Non merci
              </button>
              <button
                type="button"
                disabled={!newLocationName.trim()}
                onClick={handleSaveNewLocation}
                className="px-4 py-2 rounded-xl text-xs font-bold btn-primary shadow-md disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5" />
                Enregistrer le lieu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prévisualisation fichier — image, PDF, texte, vidéo, audio, etc. */}
      {lightboxSrc && (() => {
        const isString = typeof lightboxSrc === 'string';
        const src = isString ? lightboxSrc : lightboxSrc.src;
        const filename = isString ? '' : (lightboxSrc.filename || '');
        const mime = isString ? 'image/*' : (lightboxSrc.mime || '');
        const attachment = isString ? null : lightboxSrc.attachment;
        const textContent = !isString ? lightboxSrc.textContent : null;
        const kind = attachment ? getFileKind(attachment) : (mime?.startsWith('image/') || isString ? 'image' : 'file');
        const isImage = kind === 'image';
        const isPdf = kind === 'pdf';
        const isText = kind === 'text';
        const isVideo = kind === 'video';
        const isAudio = kind === 'audio';
        const close = () => {
          if (!isString && lightboxSrc?.src) try { URL.revokeObjectURL(lightboxSrc.src); } catch {}
          setLightboxSrc(null);
        };
        const openInNewTab = () => {
          if (src) window.open(src, '_blank', 'noopener,noreferrer');
        };
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={close}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
            tabIndex={0}
            autoFocus
          >
            <div
              className={`relative flex flex-col w-full max-w-5xl max-h-[90vh] rounded-2xl overflow-hidden shadow-2xl border ${isImage || isVideo ? 'bg-black border-white/10' : 'bg-surface border-outline-variant/30'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className={`flex items-center gap-3 px-4 py-3 border-b shrink-0 ${isImage || isVideo ? 'bg-black/60 border-white/10' : 'bg-surface-container-low border-outline-variant/30'}`}>
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border shadow-sm ${
                  isImage ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
                  isPdf ? 'bg-red-500/15 border-red-500/20 text-red-500' :
                  isText ? 'bg-emerald-500/15 border-emerald-500/20 text-emerald-600' :
                  isVideo ? 'bg-violet-500/20 border-violet-500/30 text-violet-400' :
                  isAudio ? 'bg-amber-500/15 border-amber-500/20 text-amber-600' :
                  'bg-primary/10 border-primary/20 text-primary'
                }`}>
                  {isImage ? <ImageIcon className="w-5 h-5" /> : isPdf ? <FileText className="w-5 h-5" /> : isVideo ? <Video className="w-5 h-5" /> : isAudio ? <Music className="w-5 h-5" /> : isText ? <FileText className="w-5 h-5" /> : <FileIcon className="w-5 h-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold truncate ${isImage || isVideo ? 'text-white' : 'text-on-surface'}`}>{filename || 'Aperçu'}</p>
                  <p className={`text-xs truncate ${isImage || isVideo ? 'text-white/60' : 'text-on-surface-variant'}`}>{mime || kind.toUpperCase()} {attachment?.size ? `· ${formatBytes(attachment.size)}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {src && (
                    <button type="button" onClick={openInNewTab} title="Ouvrir dans un nouvel onglet" className={`p-2 rounded-xl border transition-all cursor-pointer ${isImage || isVideo ? 'bg-white/10 hover:bg-white/20 text-white border-white/15' : 'bg-surface hover:bg-surface-container border-outline-variant/40 text-on-surface-variant hover:text-on-surface'}`}>
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
                  {attachment && (
                    <button type="button" onClick={() => downloadAttachment(attachment)} title="Télécharger" className={`p-2 rounded-xl border transition-all cursor-pointer ${isImage || isVideo ? 'bg-white/10 hover:bg-white/20 text-white border-white/15' : 'bg-primary text-on-primary hover:opacity-90 border-primary shadow-sm'}`}>
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  <button type="button" onClick={close} className={`p-2 rounded-xl border transition-all cursor-pointer ${isImage || isVideo ? 'bg-white/10 hover:bg-white/20 text-white border-white/15' : 'bg-surface hover:bg-surface-container border-outline-variant/40 text-on-surface-variant hover:text-on-surface'}`}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Contenu */}
              <div className={`flex-1 overflow-auto flex items-center justify-center ${isImage || isVideo ? 'bg-black p-4' : 'bg-surface p-0'} min-h-[280px]`}>
                {isImage ? (
                  <img src={src} alt={filename || 'Aperçu'} className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-2xl" />
                ) : isPdf ? (
                  <iframe src={src} title={filename} className="w-full h-[72vh] min-h-[420px] bg-white rounded-b-2xl" />
                ) : isVideo ? (
                  <video src={src} controls className="max-w-full max-h-[70vh] rounded-xl" />
                ) : isAudio ? (
                  <div className="w-full max-w-lg p-8 flex flex-col items-center gap-4">
                    <span className="w-20 h-20 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center"><Music className="w-10 h-10 text-amber-500" /></span>
                    <p className="text-sm font-bold text-on-surface text-center">{filename}</p>
                    <audio src={src} controls className="w-full" />
                  </div>
                ) : isText && textContent != null ? (
                  <div className="w-full h-full overflow-auto p-4 bg-surface-container-low/40">
                    <pre className="text-xs font-mono text-on-surface whitespace-pre-wrap break-words leading-relaxed bg-surface border border-outline-variant/30 rounded-xl p-4 max-h-[65vh] overflow-auto shadow-inner">{textContent || '(fichier vide)'}</pre>
                  </div>
                ) : (
                  <div className="w-full p-8 flex flex-col items-center gap-4 text-center">
                    <span className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center shadow-sm">
                      {kind === 'archive' ? <Archive className="w-10 h-10 text-orange-500" /> : kind === 'office' ? <FileText className="w-10 h-10 text-blue-600" /> : <FileIcon className="w-10 h-10 text-slate-500" />}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-on-surface">{filename}</p>
                      <p className="text-xs text-on-surface-variant mt-1">{mime || 'Fichier'} {attachment?.size ? `· ${formatBytes(attachment.size)}` : ''}</p>
                      <p className="text-xs text-on-surface-variant/70 mt-2 max-w-md">La prévisualisation n’est pas disponible pour ce type de fichier. Ouvrez-le ou téléchargez-le pour le consulter.</p>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button type="button" onClick={openInNewTab} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/40 bg-surface hover:bg-surface-container text-on-surface text-xs font-semibold transition-colors cursor-pointer">
                        <Eye className="w-4 h-4" /> Ouvrir
                      </button>
                      {attachment && (
                        <button type="button" onClick={() => downloadAttachment(attachment)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:opacity-90 transition-opacity cursor-pointer">
                          <Download className="w-4 h-4" /> Télécharger
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer filename */}
              {filename && !isText && (
                <div className={`px-4 py-2 border-t text-xs font-mono truncate text-center shrink-0 ${isImage || isVideo ? 'bg-black/40 border-white/10 text-white/60' : 'bg-surface-container-low border-outline-variant/30 text-on-surface-variant'}`}>
                  {filename}
                </div>
              )}
            </div>
          </div>
        );
      })()}


    </div>
  );
}

function eventIcon(type) {
  switch (type) {
    case 'CREATED': return <Plus className="w-3 h-3" />;
    case 'STATUS_CHANGED': return <RefreshCw className="w-3 h-3" />;
    case 'PRIORITY_CHANGED': return <Flame className="w-3 h-3" />;
    case 'ASSIGNED': return <UserCheck className="w-3 h-3" />;
    case 'EMAIL_RECEIVED': case 'EMAIL_SENT': return <Mail className="w-3 h-3" />;
    case 'FOLLOWUP_ADDED': return <MessageSquare className="w-3 h-3" />;
    case 'FOLLOWUP_DELETED': return <Trash2 className="w-3 h-3" />;
    case 'AI_ANALYZED': case 'AI_DRAFT_GENERATED': case 'AI_FOLLOWUP_DRAFT_GENERATED':
    case 'AI_AUTO_REPLY_IGNORED': case 'AI_CONVERSATION_ESCALATED': return <Sparkles className="w-3 h-3" />;
    case 'KNOWLEDGE_CREATED': return <FileText className="w-3 h-3" />;
    case 'REOPENED': return <HelpCircle className="w-3 h-3" />;
    case 'ESCALATED': case 'ESCALATION_REQUESTED': return <TrendingUp className="w-3 h-3" />;
    case 'REMINDER_SENT': return <Clock className="w-3 h-3" />;
    case 'CLOSED_AUTO': case 'CLOSURE_SUGGESTED': return <CheckCircle2 className="w-3 h-3" />;
    case 'CLOSURE_VALIDATED': return <Shield className="w-3 h-3" />;
    case 'CLOSURE_REJECTED': return <X className="w-3 h-3" />;
    case 'APPROVED': return <Shield className="w-3 h-3" />;
    case 'REJECTED': return <X className="w-3 h-3" />;
    case 'SLA_BREACHED': return <AlertTriangle className="w-3 h-3 text-red-500" />;
    case 'SLA_UPDATED': return <Clock className="w-3 h-3" />;
    case 'MERGED_INTO': case 'MERGED_FROM': return <Layers className="w-3 h-3" />;
    case 'LINKED': case 'UNLINKED': return <Link2 className="w-3 h-3" />;
    case 'GLPI_SYNC_FAILED': return <AlertTriangle className="w-3 h-3 text-red-500" />;
    default: return <History className="w-3 h-3" />;
  }
}

function eventLabel(type) {
  const labels = {
    CREATED: 'Ticket créé',
    STATUS_CHANGED: 'Statut modifié',
    PRIORITY_CHANGED: 'Priorité modifiée',
    ASSIGNED: 'Ticket assigné',
    EMAIL_RECEIVED: 'Email reçu',
    EMAIL_SENT: 'Email envoyé',
    FOLLOWUP_ADDED: 'Commentaire ajouté',
    FOLLOWUP_DELETED: 'Commentaire supprimé',
    AI_ANALYZED: 'Analyse IA',
    AI_DRAFT_GENERATED: 'Brouillon IA généré',
    AI_FOLLOWUP_DRAFT_GENERATED: 'Brouillon de réponse IA',
    AI_AUTO_REPLY_IGNORED: 'Réponse auto IA ignorée',
    AI_CONVERSATION_ESCALATED: 'Conversation escaladée vers un humain',
    KNOWLEDGE_CREATED: 'Article de connaissance créé',
    REOPENED: 'Ticket rouvert',
    ESCALATED: 'Ticket escaladé',
    ESCALATION_REQUESTED: 'Escalade demandée',
    REMINDER_SENT: 'Relance envoyée',
    CLOSED_AUTO: 'Clôture automatique',
    CLOSURE_SUGGESTED: 'Clôture suggérée',
    CLOSURE_VALIDATED: 'Clôture validée',
    CLOSURE_REJECTED: 'Clôture rejetée',
    APPROVED: 'Approuvé (Hotline)',
    REJECTED: 'Rejeté (Hotline)',
    SLA_BREACHED: 'SLA dépassé',
    SLA_UPDATED: 'SLA mis à jour',
    MERGED_INTO: 'Fusionné dans un autre ticket',
    MERGED_FROM: 'Ticket fusionné ici',
    LINKED: 'Ticket lié',
    UNLINKED: 'Lien supprimé',
    GLPI_SYNC_FAILED: 'Échec synchronisation GLPI',
    FOLLOWUP_MADE_PRIVATE: 'Commentaire rendu privé',
    FOLLOWUP_MADE_PUBLIC: 'Commentaire rendu public',
    REPLY_ON_CLOSED_SUGGESTED: 'Réponse suggérée (ticket fermé)',
  };
  return labels[type] || type;
}

function eventDetail(event) {
  const p = event.payload || {};
  const parts = [];
  if (p.oldStatus && p.newStatus) parts.push(`${p.oldStatus} → ${p.newStatus}`);
  if (p.oldPriority && p.newPriority) parts.push(`${p.oldPriority} → ${p.newPriority}`);
  if (p.action) parts.push(p.action);
  if (p.reason) parts.push(p.reason);
  if (p.error) parts.push(p.error);
  if (p.dueAt) parts.push(`Échéance : ${new Date(p.dueAt).toLocaleString('fr-FR')}`);
  if (p.level) parts.push(`Niveau ${p.level}`);
  if (p.targetTicketId) parts.push(`Ticket #${p.targetTicketId}`);
  return parts.join(' · ');
}
