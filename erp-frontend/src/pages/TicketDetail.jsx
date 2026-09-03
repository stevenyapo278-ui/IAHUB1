import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import { playApproval, playRejection, playError } from '../utils/sounds';
import SearchableSelect from '../components/SearchableSelect';
import RemoteUserSelect from '../components/RemoteUserSelect';
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
  ChevronsLeft, ChevronLeft, ChevronsRight, Eye, Copy, ShieldAlert, ShieldOff, Loader2
} from 'lucide-react';
import {
  STATUS_OPTIONS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS,
  URGENCY_IMPACT_OPTIONS, PRIORITY_CONFIG, STATUS_CONFIG, initials
} from '../constants/tickets';

import { sanitizeHtml } from '../utils/sanitize';

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
function InfoTile({ icon: Icon, label, value, tone = 'primary', title }) {
  const toneColor = {
    primary: 'text-primary',
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    violet: 'text-violet-500',
    slate: 'text-on-surface-variant',
  }[tone] || 'text-primary';

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-outline-variant/30 bg-surface-container-low/50 px-3 py-2.5 min-w-0 transition-colors hover:bg-surface-container-low">
      <span className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-wider text-on-surface-variant">
        <Icon className={`w-3 h-3 ${toneColor} shrink-0`} />
        {label}
      </span>
      <span
        className="text-xs font-bold text-on-surface truncate"
        title={title || value}
      >
        {value || '—'}
      </span>
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
  const { autonomousMode } = useSystemSettings();
  const [ticket, setTicket] = useState(null);    const [followup, setFollowup] = useState('');
  const [followupPrivate, setFollowupPrivate] = useState(false);
  const [events, setEvents] = useState([]);

  // Tickets liés + fusion
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
  const [error, setError] = useState('');
  const [teams, setTeams] = useState([]);
  const [categories, setCategories] = useState([]);
  const flatCategories = useMemo(() => flattenCategoryTree(categories), [categories]);
  // Définitions des champs personnalisés (pour résoudre libellés/valeurs dans le détail)
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [syncFailures, setSyncFailures] = useState([]);
  const [savingField, setSavingField] = useState(null);
  const [editingRequester, setEditingRequester] = useState(false);
  const [selectedRequesterId, setSelectedRequesterId] = useState('');
  const [customSourceName, setCustomSourceName] = useState('');
  const [customSourceEmail, setCustomSourceEmail] = useState('');
  const [adjacent, setAdjacent] = useState({ first: null, prev: null, next: null, last: null });
  const slideDirectionRef = useRef('next'); // 'next' = vers la droite→gauche, 'prev' = gauche→droite
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
  const [expandedEmails, setExpandedEmails] = useState(new Set());
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [showSaveLocationModal, setShowSaveLocationModal] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');

  const handleEscalate = async () => {
    setEscalating(true);
    try {
      const { data } = await api.post(`/tickets/${id}/escalate`, { reason: 'Escalade manuelle' });
      toast.success(`Ticket escaladé (niveau ${data.escalationLevel})`);
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

  const canAssign = hasPermission(user, 'tickets.assign') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canApprove = hasPermission(user, 'tickets.approve') || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';
  const canDelete = hasPermission(user, 'tickets.delete') || user?.role === 'SUPERADMIN';
  const canManageProblems = hasPermission(user, 'problems.manage') || user?.role === 'SUPERADMIN';
  const canEdit = hasPermission(user, 'tickets.edit') || user?.role === 'ADMIN' || user?.role === 'HOTLINE' || user?.role === 'SUPERADMIN';

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

  useEffect(() => {
    api.get(`/tickets/${id}/adjacent`)
      .then(({ data }) => setAdjacent(data))
      .catch(() => setAdjacent({ first: null, prev: null, next: null, last: null }));
  }, [id]);

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
      await api.patch(`/tickets/${id}`, { [field]: value });
      toast.success('Mise à jour enregistrée');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSavingField(null);
    }
  }

  const handleSaveRequester = async () => {
    try {
      setSavingField('requester');
      const payload = selectedRequesterId
        ? { requesterId: Number(selectedRequesterId) }
        : { requesterId: null, sourceName: customSourceName, sourceEmail: customSourceEmail };
      await api.patch(`/tickets/${id}`, payload);
      toast.success('Demandeur mis à jour');
      setEditingRequester(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Échec de la mise à jour du demandeur');
    } finally {
      setSavingField(null);
    }
  };

  // Extrait le nom du lieu (partie avant " : ") d'un titre
  function extractLocationFromTitle(title) {
    if (!title || !title.includes(' : ')) return null;
    return title.split(' : ')[0].trim();
  }

  // Vérifie si un lieu correspond déjà dans la liste
  function findMatchingLocation(locName) {
    if (!locName) return null;
    const lower = locName.toLowerCase();
    return locations.find(
      (l) => l.name?.toLowerCase() === lower || l.completename?.toLowerCase() === lower
    );
  }

  // Sauvegarder le titre + proposer d'enregistrer le lieu si nouveau
  async function handleTitleSave() {
    const newTitle = editingTitleValue.trim();
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
          if (existing.id !== ticket.glpiLocationId) {
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
        if (followupPrivate) fd.append('isPrivate', 'true');
        pastedImages.forEach((img, idx) => {
          fd.append('images', img.file);
          content += `\n\n<!--IMAGE_${idx}-->`;
        });
        // Re-build content with image markers
        fd.set('content', content);
        await api.post(`/tickets/${id}/followups`, fd);
      } else {
        await api.post(`/tickets/${id}/followups`, { content, isPrivate: followupPrivate });
      }

      toast.success('Commentaire ajouté');
      setFollowup('');
      setFollowupPrivate(false);
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
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col gap-6 max-w-7xl mx-auto overflow-x-hidden">
      {/* Top Header Bar (Fixe) */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-outline-variant/30 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/tickets'))}
            className="p-2 rounded-xl border border-outline-variant/40 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
            title="Retour aux tickets"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Navigation entre tickets : premier ← → dernier par ordre de numéro */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                if (adjacent.first) {
                  slideDirectionRef.current = 'prev';
                  navigate(`/tickets/${adjacent.first}`, { replace: true });
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
                  navigate(`/tickets/${adjacent.prev}`, { replace: true });
                }
              }}
              disabled={!adjacent.prev}
              className="p-1.5 rounded-lg border border-outline-variant/30 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={adjacent.prev ? `Ticket précédent (#${adjacent.prev})` : 'Pas de ticket précédent'}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (adjacent.next) {
                  slideDirectionRef.current = 'next';
                  navigate(`/tickets/${adjacent.next}`, { replace: true });
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
                  navigate(`/tickets/${adjacent.last}`, { replace: true });
                }
              }}
              disabled={!adjacent.last}
              className="p-1.5 rounded-lg border border-outline-variant/30 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={adjacent.last ? `Dernier ticket (#${adjacent.last})` : 'Déjà au dernier ticket'}
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Zone de contenu Ticket — carrousel directionnel (sortie + entrée) via AnimatePresence keyed par ticket.id */}
      <div className="relative overflow-hidden" style={{ minHeight: 400 }}>
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
            {/* Header info (Titre #ID, badges, actions) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-outline-variant/30">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-primary bg-primary/10 border border-primary/20 rounded-lg px-2 py-0.5 leading-6">#{ticket.id}</span>
                    {ticket.glpiTicketId && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-surface-container-high dark:text-on-surface-variant border border-slate-200 dark:border-outline-variant/40 flex items-center gap-1">
                        <RefreshCw className="w-2.5 h-2.5" />
                        GLPI #{ticket.glpiTicketId}
                      </span>
                    )}
                  </div>
                  {editingTitle ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingTitleValue}
                        onChange={(e) => setEditingTitleValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleTitleSave();
                          if (e.key === 'Escape') setEditingTitle(false);
                        }}
                        autoFocus
                        className="flex-1 text-lg font-bold text-on-surface bg-surface-container-low border border-primary/40 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        onClick={handleTitleSave}
                        disabled={savingField === 'title'}
                        className="p-2 rounded-xl bg-primary text-on-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                        title="Enregistrer"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingTitle(false)}
                        className="p-2 rounded-xl border border-outline-variant/40 bg-surface text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
                        title="Annuler"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group/title">
                      <h1 className="text-xl sm:text-2xl font-black text-on-surface leading-tight tracking-tight line-clamp-2">{ticket.title}</h1>
                      {canEdit && (
                        <button
                          onClick={() => { setEditingTitleValue(ticket.title); setEditingTitle(true); }}
                          className="p-1.5 rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container transition-all opacity-0 group-hover/title:opacity-100 cursor-pointer"
                          title="Modifier le titre"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Badges & Actions */}
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {ticket.escalationLevel > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-500/30">
                    Niv. escalade {ticket.escalationLevel}
                  </span>
                )}
                <button
                  onClick={handleEscalate}
                  disabled={escalating}
                  className="px-3 py-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300 hover:bg-orange-500/20 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                  title="Escalader ce ticket : alerte les admins et monte le niveau de prise en charge"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  {escalating ? 'Escalade...' : 'Escalader'}
                </button>
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
            </div>

              {/* Méta strip : acteurs, dates et contexte */}
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low/70 text-[11px] font-semibold text-on-surface">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary border border-primary/25 flex items-center justify-center text-[8px] font-black shrink-0">
                    {initials(ticket.requester?.fullName || ticket.sourceName)}
                  </span>
                  <span className="truncate max-w-[200px]">{ticket.requester?.fullName || ticket.sourceName || ticket.sourceEmail || 'Demandeur inconnu'}</span>
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
                <MetaChip icon={MapPin}>{ticket.glpiLocationName || 'Aucun lieu'}</MetaChip>
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
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
        {/* ── LEFT COLUMN: Properties & Metadata ────────────────────────── */}
        <div className="flex flex-col gap-5 order-2 xl:order-1">
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
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <InfoTile icon={User} label="Demandeur" value={ticket.requester?.fullName || ticket.sourceName || ticket.sourceEmail || '—'} />
                <InfoTile icon={Layers} label="Équipe" value={ticket.team?.name || 'Non assignée'} />
                <InfoTile icon={MapPin} label="Lieu" value={ticket.glpiLocationName || '—'} tone="violet" />
                <InfoTile icon={Clock} label="Créé le" value={new Date(ticket.createdAt).toLocaleDateString('fr-FR')} tone="amber" />
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
                <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-on-surface mb-3 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-primary" />
                  Pièces jointes ({(ticket?.attachments || []).length})
                </h4>
                <div className="flex flex-wrap gap-3">
                  {(ticket?.attachments || []).map((a) => {
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

          {/* Tickets liés */}
          <div className="bento-card p-5">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-outline-variant/20 mb-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" />
                Tickets liés
                {linkedTickets.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {linkedTickets.length}
                  </span>
                )}
              </h3>
              {canAssign && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMergeModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-500/30 text-orange-600 dark:text-orange-400 text-[11px] font-bold hover:bg-orange-500/5 transition-colors cursor-pointer"
                  >
                    <Merge className="w-3.5 h-3.5" />
                    Fusionner…
                  </button>
                  <button
                    onClick={() => setLinkModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Lier un ticket
                  </button>
                </div>
              )}
            </div>

            {linkedTickets.length === 0 ? (
              <p className="text-xs text-on-surface-variant/70 italic py-2">
                Aucun ticket lié. Liez les tickets liés (doublons, incidents liés…) pour garder la trace.
              </p>
            ) : (
              <div className="space-y-2">
                {linkedTickets.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 hover:border-primary/40 transition-colors">
                    <Link2 className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/tickets/${l.otherTicket.id}`}
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
          </div>

          {/* Problèmes liés */}
          {canManageProblems && (
          <div className="bento-card p-5">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-outline-variant/20 mb-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Problèmes racines
                {linkedProblems.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    {linkedProblems.length}
                  </span>
                )}
              </h3>
                <button
                  onClick={() => setProblemLinkModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[11px] font-bold hover:bg-amber-600 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Lier un problème
                </button>
            </div>
            {linkedProblems.length === 0 ? (
              <p className="text-xs text-on-surface-variant/70 italic py-2">
                Aucun problème lié. Liez ce ticket à un problème racine pour regrouper les incidents similaires.
              </p>
            ) : (
              <div className="space-y-2">
                {linkedProblems.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border border-amber-200/40 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-500/5 hover:border-amber-400/60 transition-colors">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => navigate(`/problems/${p.id}`)}
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
          </div>
          )}

          {/* Sous-tickets (parent/enfant) */}
          <div className="bento-card p-5">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-outline-variant/20 mb-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-on-surface flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-primary" />
                Sous-tickets
                {(children.length > 0 || parentTicket) && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {children.length}
                  </span>
                )}
              </h3>
              {canAssign && (
                <button
                  onClick={() => setChildModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Créer un sous-ticket
                </button>
              )}
            </div>

            {!parentTicket && children.length === 0 ? (
              <p className="text-xs text-on-surface-variant/70 italic py-2">
                Aucun sous-ticket. Créez des sous-tickets pour découper un incident complexe en sous-tâches.
              </p>
            ) : (
              <div className="space-y-2">
                {parentTicket && (
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-indigo-500/25 bg-indigo-500/5">
                    <GitBranch className="w-3.5 h-3.5 text-indigo-500 shrink-0 rotate-180" />
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/tickets/${parentTicket.id}`}
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
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl btn-primary text-xs font-bold disabled:opacity-40 transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Envoyer{pastedImages.length > 0 ? ` (${pastedImages.length} img.)` : ''}</span>
                </button>
              </div>
            </form>
          </div>


        </div>

        {/* ── RIGHT COLUMN: Actions, AI, Approvals ──────────────────────── */}
        <div className="flex flex-col gap-5 order-3">
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

          {/* Approval Workflow Card */}
          {ticket.approvalStatus !== 'NOT_REQUIRED' && (
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

              {(canApprove && ticket.approvalStatus === 'PENDING') || (canApprove && ticket.approvalStatus === 'APPROVED' && !ticket.glpiTicketId) ? (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleApprove}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all ${
                      ticket.approvalStatus === 'APPROVED' && !ticket.glpiTicketId
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-amber-500/20 hover:brightness-110'
                        : 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-emerald-500/20 hover:brightness-110'
                    }`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {!autonomousMode && ticket.approvalStatus === 'APPROVED' && !ticket.glpiTicketId ? 'Réessayer synchro GLPI' : 'Approuver'}
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
                  <select
                    className="w-full bg-surface border border-slate-200 dark:border-outline-variant/25 rounded-xl px-3 py-2 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
                    value={ticket.category || ''}
                    disabled={savingField === 'category'}
                    onChange={(e) => updateField('category', e.target.value)}
                  >
                    <option value="">-----</option>
                    {flatCategories.map((o) => (
                      <option key={o.id} value={o.name}>{o.label}</option>
                    ))}
                  </select>
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
                  disabled={!canAssign || savingField === 'status'}
                  onChange={(e) => updateField('status', e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
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
                  Attribué à
                </label>
                {canAssign ? (
                  <RemoteUserSelect
                    value={ticket.assignedToId || ''}
                    valueLabel={ticket.assignedTo?.fullName}
                    disabled={savingField === 'assignedToId'}
                    onChange={(val) => updateField('assignedToId', val ? Number(val) : null)}
                    placeholder="Non assigné"
                    searchPlaceholder="Rechercher un technicien..."
                  />
                ) : (
                  <div className="w-full flex items-center gap-2 bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/15 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface">
                    {ticket.assignedTo ? (
                      <>
                        <div className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[9px] font-bold border border-blue-500/20">
                          {initials(ticket.assignedTo.fullName)}
                        </div>
                        {ticket.assignedTo.fullName}
                      </>
                    ) : (
                      <span className="text-on-surface-variant italic">Non assigné</span>
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
                  <div className="w-full bg-slate-100 dark:bg-surface-container-low border border-slate-200 dark:border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                    {ticket.glpiLocationName || <span className="text-on-surface-variant italic font-normal">Non déterminé</span>}
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
              {canEdit && !editingRequester && (
                <button
                  onClick={() => {
                    setSelectedRequesterId(ticket.requesterId ? String(ticket.requesterId) : '');
                    setCustomSourceName(ticket.sourceName || '');
                    setCustomSourceEmail(ticket.sourceEmail || '');
                    setEditingRequester(true);
                  }}
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all cursor-pointer"
                  title="Modifier le demandeur"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {editingRequester ? (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">
                    Sélectionner un utilisateur :
                  </label>
                  <select
                    value={selectedRequesterId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedRequesterId(val);
                      if (val) {
                        const found = allUsers.find(u => String(u.id) === val) || glpiUsers.find(u => String(u.id) === val);
                        if (found) {
                          setCustomSourceName(found.fullName || '');
                          setCustomSourceEmail(found.email || '');
                        }
                      }
                    }}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                  >
                    <option value="">-- Expéditeur externe (Nom / Email) --</option>
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                {!selectedRequesterId && (
                  <div className="space-y-2 pt-1 border-t border-outline-variant/20">
                    <div>
                      <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">Nom de l'expéditeur :</label>
                      <input
                        type="text"
                        value={customSourceName}
                        onChange={(e) => setCustomSourceName(e.target.value)}
                        placeholder="ex: Jean Dupont"
                        className="w-full text-xs font-medium px-3 py-1.5 rounded-lg border border-outline-variant/60 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">Email de l'expéditeur :</label>
                      <input
                        type="email"
                        value={customSourceEmail}
                        onChange={(e) => setCustomSourceEmail(e.target.value)}
                        placeholder="ex: jean.dupont@entreprise.com"
                        className="w-full text-xs font-medium px-3 py-1.5 rounded-lg border border-outline-variant/60 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2 justify-end">
                  <button
                    onClick={() => setEditingRequester(false)}
                    className="px-3 py-1.5 rounded-xl border border-outline-variant/40 text-xs font-semibold text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSaveRequester}
                    disabled={savingField === 'requester'}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Enregistrer
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl border border-outline-variant/40 bg-surface-container text-on-surface flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                  {initials(ticket.requester?.fullName || ticket.sourceName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-on-surface truncate">{ticket.requester?.fullName || ticket.sourceName || ticket.sourceEmail || '-'}</p>
                  <p className="text-[11px] text-on-surface-variant font-medium truncate">{ticket.requester?.email || ticket.sourceEmail || '-'}</p>
                </div>
              </div>
            )}
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
                  <span className="font-semibold text-on-surface">{ticket.assignedTo?.fullName || 'Non assigné'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant block mb-0.5">Lieu</span>
                  <span className="font-semibold text-on-surface">{ticket.glpiLocationName || 'Non déterminé'}</span>
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
        message={`Supprimer définitivement le ticket #${id} ? Cette action est irréversible et supprime aussi le ticket GLPI lié.`}
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

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
