import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, User, MapPin, Search, ChevronDown, ChevronRight, X, Ticket,
  ExternalLink, LocateFixed, Loader2, Plus, RotateCcw, AlertCircle,
  Copy, Check, Sparkles, Pin, RefreshCw, Share2, Network, BrainCircuit,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../api/client';
import { FAN_MAX, fanLayout, linkPath, itemColor, itemFade } from '../explorer/fanLayout';
import {
  KNOWN_KINDS, PAIR_KINDS, CENTER_TYPE_LABEL, CATEGORY_ICONS, CATEGORY_LABELS,
  KIND_ICONS, KIND_LABELS, STATUS_LABELS, KNOWN_MODES,
} from '../explorer/labels';
import MindMapMode from '../explorer/MindMapMode';

// Mode réseau de neurones : chunk lazy (three.js isolé de la page /explorer)
const NeuralMode = lazy(() => import('../explorer/NeuralMode'));

// ─── Exploration en 3 niveaux ───────────────────────────────────────────────
// Centre (n'importe quel kind du registre backend) → catégories (compteurs) →
// éventail d'éléments. Stage sombre permanent (radial + cercles concentriques)
// façon prototype ; sous 768px : liste en accordéon sans SVG. Toute la géométrie
// est analytique (aucune mesure DOM) → recalcul pur à chaque changement de
// taille/sélection.

// Géométrie du stage (coordonnées en px, viewBox SVG identique)
// Hauteur 620 : 9 rangées × spread mini 68 + marges (fanLayout clamp).
const STAGE_H = 620;
const STAGE_MIN_W = 930;
const G = { CX: 24, CW: 204, CH: 84, CATX: 272, CATW: 208, CATH: 64, GAP: 12, CARD: 236, CARD_H: 60 };
const FAN_X = G.CATX + G.CATW + 8;

const centerY = STAGE_H / 2;
const catTop = (i, n) => centerY - G.CATH / 2 + (i - (n - 1) / 2) * (G.CATH + G.GAP);
const catCenterY = (i, n) => centerY + (i - (n - 1) / 2) * (G.CATH + G.GAP);
const initials = (label = '?') =>
  label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// Compte à rebours SLA : >4 h slate, >1 h ambre, <1 h rouge, dépassé pulsé
function slaCountdown(dueAt, now) {
  if (!dueAt) return null;
  const diff = new Date(dueAt).getTime() - now;
  const breached = diff <= 0;
  const abs = Math.abs(diff);
  const m = Math.floor(abs / 60000);
  const label = m >= 60
    ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
    : `${m} min`;
  const tone = breached ? 'red' : diff > 4 * 3600000 ? 'slate' : diff > 3600000 ? 'amber' : 'red';
  return { breached, label: breached ? `SLA dépassé (+${label})` : `SLA : ${label}`, tone };
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success('Lien de cette vue copié');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible');
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copier le lien de cette vue"
      title="Copier le lien de cette vue"
      className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-2.5 hover:border-primary/40 transition"
    >
      {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
    </button>
  );
}

export default function ExplorerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const reduce = useReducedMotion();

  // Centre courant : kind valide attendu, id numérique OU string
  // (expediteur = email, origine/type = enum en majuscules)
  const rawCenter = searchParams.get('center');
  const centerType = KNOWN_KINDS.includes(rawCenter) ? rawCenter : 'technicien';
  const rawId = searchParams.get('id');
  const centerId = rawId
    ? (/^\d+$/.test(rawId) ? Number.parseInt(rawId, 10) : rawId)
    : null;

  // Centre épinglé (intersection) : réservé au croisement technicien × lieu
  const pinParamType = searchParams.get('pinType');
  const pinType = (pinParamType === 'lieu' || pinParamType === 'technicien') ? pinParamType : null;
  const pinId = Number.parseInt(searchParams.get('pinId'), 10) || null;
  const isPairCenter = PAIR_KINDS.includes(centerType);
  const hasPin = !!(pinType && pinId && isPairCenter && PAIR_KINDS.includes(pinType) && pinType !== centerType);

  // Mode d'affichage (?mode=graph|mind|neural) — défaut : graphe
  const rawMode = searchParams.get('mode');
  const mode = KNOWN_MODES.includes(rawMode) ? rawMode : 'graph';
  const setMode = (m) => {
    setSearchParams((prev) => {
      const next = Object.fromEntries(prev.entries());
      next.mode = m;
      return next;
    });
  };
  // Fusionne des paramètres en conservant le mode d'affichage courant
  const withMode = (params) => {
    const md = searchParams.get('mode');
    return md ? { ...params, mode: md } : params;
  };

  const [entities, setEntities] = useState([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesError, setEntitiesError] = useState(null);
  const [entitiesTick, setEntitiesTick] = useState(0);

  const [centerData, setCenterData] = useState(null);
  const [centerLoading, setCenterLoading] = useState(false);
  const [centerError, setCenterError] = useState(null);
  const [centerTick, setCenterTick] = useState(0);

  const [selectedCat, setSelectedCat] = useState(null);
  const [fan, setFan] = useState(null);
  const [fanLoading, setFanLoading] = useState(false);
  const [fanError, setFanError] = useState(null);
  const [fanTick, setFanTick] = useState(0);

  const [selectedItem, setSelectedItem] = useState(null);
  const [hoverCat, setHoverCat] = useState(null);
  const [hoverItem, setHoverItem] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [listAll, setListAll] = useState(null);

  // Boucle infinie : fil des centres visités (retour arrière au clic, cap à 8)
  const [trail, setTrail] = useState([]); // [{ type, id, label }]

  // Recherche traversante (tickets / techniciens / lieux / équipements)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingCat, setPendingCat] = useState(null); // catégorie à déployer après un saut

  // Sélecteur de centre épinglé (liste de l'autre type, chargée à l'ouverture)
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [pinOptions, setPinOptions] = useState(null);

  // Synthèse IA du nœud courant
  const [aiCard, setAiCard] = useState(null); // null | {loading} | {text} | {error}

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 767px)').matches
  );
  const [stageW, setStageW] = useState(STAGE_MIN_W);
  const stageRef = useRef(null);
  const fanSeq = useRef(0); // séquence des requêtes éventail (évite fanLoading bloqué)

  // ── Pack vivant : fraîcheur des données + horloge SLA ────────────────────
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const softRefresh = useRef(false); // true = recharger SANS effacer la sélection

  function refreshNow(manual = false) {
    if (manual) setRefreshing(true);
    softRefresh.current = true;
    setEntitiesTick((t) => t + 1);
    setCenterTick((t) => t + 1);
    setFanTick((t) => t + 1);
    setLastRefresh(Date.now());
    if (manual) window.setTimeout(() => setRefreshing(false), 700);
  }

  // Événements temps réel (Socket.IO → window) + poll de sécurité + horloge
  useEffect(() => {
    const onTicketsChanged = () => refreshNow();
    window.addEventListener('tickets:changed', onTicketsChanged);
    const poll = window.setInterval(() => refreshNow(), 45000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener('tickets:changed', onTicketsChanged);
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  // ── Breakpoint mobile ────────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // ── Largeur du stage (ResizeObserver) ────────────────────────────────────
  useEffect(() => {
    if (isMobile || !stageRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect?.width || 0);
      if (w > 0) setStageW(w);
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [isMobile]);

  // ── Recherche traversante (debounce 300 ms) ──────────────────────────────
  useEffect(() => {
    const q = searchQuery.trim();
    const t = window.setTimeout(async () => {
      if (q.length < 2) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const { data } = await api.get('/graph/search', { params: { q } });
        setSearchResults(data.matches || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  // ── Options de l'épingle : l'autre type de centre (chargées à l'ouverture) ──
  useEffect(() => {
    if (!pinPickerOpen || pinOptions) return undefined;
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(centerType === 'lieu' ? '/graph/techniciens' : '/graph/lieux');
        if (alive) setPinOptions(data);
      } catch {
        if (alive) setPinOptions([]);
      }
    })();
    return () => { alive = false; };
  }, [pinPickerOpen, pinOptions, centerType]);

  // ── Sélecteurs (s'échangent quand on change de type de centre) ───────────
  useEffect(() => {
    let alive = true;
    (async () => {
      // Hors technicien/lieu : pas de sélecteur de centre — on atteint ces
      // kinds par la recherche traversante ou par les sauts du graphe.
      if (!PAIR_KINDS.includes(centerType)) {
        setEntities([]);
        setEntitiesError(null);
        setEntitiesLoading(false);
        return;
      }
      setEntitiesLoading(true);
      setEntitiesError(null);
      try {
        const { data } = await api.get(centerType === 'lieu' ? '/graph/lieux' : '/graph/techniciens');
        if (!alive) return;
        setEntities(data);
        // Centre par défaut : premier élément si l'URL n'en porte pas encore
        if (!centerId && Array.isArray(data) && data.length > 0) {
          setSearchParams(withMode({ center: centerType, id: String(data[0].id) }), { replace: true });
        }
      } catch {
        if (alive) setEntitiesError('Impossible de charger la liste');
      } finally {
        if (alive) setEntitiesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [centerType, centerId, entitiesTick, setSearchParams]);

  // ── Niveau 1 : centre + catégories ───────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const soft = softRefresh.current;
      softRefresh.current = false;
      if (!soft) {
        setCenterData(null);
        setSelectedCat(null);
        setFan(null);
        setSelectedItem(null);
        setFanError(null);
      }
      if (!centerId) { setCenterLoading(false); setCenterError(null); return; }
      if (!soft) setCenterLoading(true);
      setCenterError(null);
      try {
        const { data } = await api.get(
          hasPin
            ? `/graph/pair/${centerType}/${centerId}/${pinType}/${pinId}`
            : `/graph/${centerType}/${encodeURIComponent(centerId)}`
        );
        if (!alive) return;
        // Saut depuis la recherche : déployer la catégorie du chemin
        if (pendingCat) {
          if (data.categories?.some((c) => c.key === pendingCat)) setSelectedCat(pendingCat);
          setPendingCat(null);
        }
        // La sélection n'existe plus dans les compteurs (centre changé en douce) → fermer
        if (soft && selectedCat && !data.categories?.some((c) => c.key === selectedCat)) {
          setSelectedCat(null);
          setFan(null);
        }
        setCenterData(data);
      } catch (err) {
        if (alive) setCenterError(err?.response?.data?.error || 'Chargement impossible');
      } finally {
        if (alive && !soft) setCenterLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [centerType, centerId, pinType, pinId, centerTick]);

  // ── Niveau 3 : éventail (chargé au clic sur une catégorie) ───────────────
  // fanSeq : si la sélection est vidée pendant la requête (changement de centre),
  // le finally doit quand même éteindre fanLoading (sinon « Déploiement… » bloqué).
  useEffect(() => {
    if (!selectedCat || !centerId) return undefined;
    let alive = true;
    const seq = ++fanSeq.current;
    (async () => {
      setFanLoading(true);
      setFanError(null);
      try {
        const { data } = await api.get(
          hasPin
            ? `/graph/pair/${centerType}/${centerId}/${pinType}/${pinId}/${selectedCat}`
            : `/graph/${centerType}/${encodeURIComponent(centerId)}/${selectedCat}`
        );
        if (alive) setFan(data);
      } catch {
        if (alive) setFanError('Chargement des éléments impossible');
      } finally {
        if (fanSeq.current === seq) setFanLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [centerType, centerId, pinType, pinId, selectedCat, fanTick]);

  // ── Géométrie (pur : taille du stage + sélection) ────────────────────────
  const geom = useMemo(() => {
    if (!centerData) return null;
    const n = centerData.categories.length;
    const W = Math.max(stageW, STAGE_MIN_W);
    const curves = centerData.categories.map((c, i) => ({
      key: c.key,
      d: linkPath(G.CX + G.CW + 6, centerY, G.CATX - 6, catCenterY(i, n)),
    }));

    const fanItems = [];
    let more = null;
    if (fan && fan.items.length > 0) {
      const idx = Math.max(0, centerData.categories.findIndex((c) => c.key === selectedCat));
      const ox = FAN_X;
      const oy = catCenterY(idx, n);
      const shown = fan.items.slice(0, FAN_MAX);
      const rest = Math.max(0, (fan.total || fan.items.length) - shown.length);
      const slots = shown.length + (rest > 0 ? 1 : 0);
      const geo = fanLayout(ox, oy, slots, W, STAGE_H, { cardW: G.CARD, reach: 300 });
      shown.forEach((item, i) => {
        fanItems.push({ item, x: geo[i].x1, y: geo[i].y1, d: geo[i].d, color: itemColor(item), fade: itemFade(i, slots) });
      });
      if (rest > 0 && geo[shown.length]) {
        more = { x: geo[shown.length].x1, y: geo[shown.length].y1, d: geo[shown.length].d, rest, fade: itemFade(shown.length, slots) };
      }
    }
    return { W, n, curves, fanItems, more };
  }, [centerData, fan, selectedCat, stageW]);

  const activeCat = centerData?.categories?.find((c) => c.key === selectedCat) || null;
  const visibleEntities = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) => String(e.fullName || e.label || '').toLowerCase().includes(q));
  }, [entities, pickerQuery]);
  const currentEntity = entities.find((e) => e.id === centerId) || null;

  // ── Actions ──────────────────────────────────────────────────────────────
  function selectCategory(key) {
    setSelectedCat((prev) => (prev === key ? null : key));
    setSelectedItem(null);
    setFan(null);
    setFanError(null);
  }

  // Changer de centre en conservant le centre épinglé (s'il reste valide)
  function applyCenter(type, id) {
    setSearchParams((prev) => {
      const next = { center: type, id: String(id) };
      const md = prev.get('mode');
      if (md) next.mode = md; // conserve le mode d'affichage (graphe/mind/neural)
      const pt = prev.get('pinType');
      const pi = prev.get('pinId');
      if (pt && pi && pt !== type) {
        next.pinType = pt;
        next.pinId = pi;
      }
      return next;
    });
  }

  // Saut de boucle : mémorise le centre actuel dans le fil, puis redevient le centre.
  // Le fil est borné à 8 pas (assez pour explorer sans polluer le fil d'Ariane).
  // On referme la catégorie AVANT le changement d'URL : sinon l'effet éventail
  // rejoue l'ancienne catégorie sur le nouveau centre → requête 400 inutile.
  function hop(type, id) {
    if (centerId != null && !(centerType === type && centerId === id)) {
      const entry = {
        type: centerType,
        id: centerId,
        label: centerData?.center?.label || CENTER_TYPE_LABEL[centerType],
      };
      setTrail((prev) => [...prev, entry].slice(-8));
    }
    setSelectedItem(null);
    setSelectedCat(null);
    setFan(null);
    setFanError(null);
    applyCenter(type, id);
  }

  // Retour arrière : tronque le fil jusqu'à l'étape cliquée et redevient centre
  function jumpTrail(i) {
    const target = trail[i];
    if (!target) return;
    setTrail(trail.slice(0, i));
    setSelectedItem(null);
    setSelectedCat(null);
    setFan(null);
    setFanError(null);
    applyCenter(target.type, target.id);
  }

  function clearTrail() { setTrail([]); }

  function chooseCenter(id) {
    applyCenter(centerType, id);
    clearTrail(); // choix explicite = nouvelle exploration
    setPickerOpen(false);
    setPickerQuery('');
  }

  // Épingler l'autre type de centre → mode intersection
  function pinCenter(type, id) {
    setSearchParams((prev) => {
      const next = Object.fromEntries(prev.entries());
      next.pinType = type;
      next.pinId = String(id);
      return next;
    });
    setPinPickerOpen(false);
  }

  function unpin() {
    setSearchParams((prev) => {
      const next = Object.fromEntries(prev.entries());
      delete next.pinType;
      delete next.pinId;
      return next;
    });
  }

  // Saut vers le match : ouvre le centre du chemin + déploie sa catégorie
  function goToMatch(m) {
    setSearchOpen(false);
    setSearchQuery('');
    if (!m.path) {
      if (m.kind === 'ticket') { navigate(`/tickets/${m.id}`); return; }
      toast.info('Aucun centre connu pour cet élément');
      return;
    }
    setPendingCat(m.path.category);
    setSelectedCat(null); // pendingCat ré-ouvrira après le chargement du centre
    setFan(null);
    setFanError(null);
    applyCenter(m.path.center.type, m.path.center.id);
    clearTrail(); // téléport depuis la recherche = nouvelle exploration
  }

  function activateItem(item) {
    // Nœud de navigation (lieu / technicien) : un clic rejoint ce centre
    // → la boucle s'enchaîne sans panneau d'intermédiaire.
    if (item.recenter && (item.kind === 'lieu' || item.kind === 'technicien')) {
      hop(item.recenter.center, item.recenter.id);
      return;
    }
    // Tickets / équipements : détail (fiche + sauts possibles)
    setSelectedItem(item);
  }

  // Infobulle : annonce le comportement du clic (saut direct vs détail)
  const itemHint = (item) => (
    item.recenter && (item.kind === 'lieu' || item.kind === 'technicien')
      ? `Explorer « ${item.label} » (clic)`
      : 'Voir le détail et les sauts'
  );

  // Sauts depuis l'élément sélectionné, hors centre courant ni épingle
  // (pas de boucle sur soi : on ne propose jamais de revenir là où on est)
  const visibleJumps = (selectedItem?.jumps || []).filter(
    (j) => !(j.center === centerType && j.id === centerId)
      && !(hasPin && j.center === pinType && j.id === pinId)
  );

  // mode 'fiche' → page applicative ; mode 'recenter' → recentrer le graphe
  function itemAction(action) {
    if (!selectedItem) return;
    if (action === 'fiche' && selectedItem.href) { navigate(selectedItem.href); return; }
    if (action === 'recenter' && selectedItem.recenter) {
      const { center, id } = selectedItem.recenter;
      setSelectedItem(null);
      hop(center, id);
    }
  }

  // URL d'une catégorie du centre courant (éventail, carte mentale, liste complète)
  function categoryUrl(catKey) {
    return hasPin
      ? `/graph/pair/${centerType}/${centerId}/${pinType}/${pinId}/${catKey}`
      : `/graph/${centerType}/${encodeURIComponent(centerId)}/${catKey}`;
  }

  // Chargement paresseux d'une catégorie (mode carte mentale)
  async function loadCategory(catKey) {
    const { data } = await api.get(categoryUrl(catKey));
    return { items: data.items || [], total: data.total ?? 0 };
  }

  async function openListAll(catKey = selectedCat) {
    if (!centerId || !catKey) return;
    setListAll({ loading: true, items: [], total: 0 });
    try {
      const { data } = await api.get(categoryUrl(catKey), { params: { all: '1' } });
      setListAll({ loading: false, items: data.items, total: data.total });
    } catch {
      setListAll({ loading: false, items: [], total: 0, error: true });
    }
  }

  function activateFromList(item) {
    setListAll(null);
    activateItem(item);
  }

  // Synthèse IA : résume le centre (ou le croisement) en 3 lignes + 1 reco
  async function generateSummary() {
    if (!centerId || aiCard?.loading) return;
    setAiCard({ loading: true });
    try {
      const body = { center: { type: centerType, id: centerId, label: centerData?.center?.label || undefined } };
      if (hasPin && pinId) body.pin = { type: pinType, id: pinId, label: centerData?.pin?.label || undefined };
      const { data } = await api.post('/graph/summarize', body);
      setAiCard({ text: data.summary });
    } catch (err) {
      setAiCard({ error: err?.response?.data?.error || 'IA indisponible' });
    }
  }

  // ── Barre d'en-tête + sélecteur ──────────────────────────────────────────
  const CenterIcon = KIND_ICONS[centerType] || User;
  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
          aria-label="Choisir un centre d'exploration"
          className="flex max-w-[19rem] items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm font-medium hover:border-primary/40 transition"
        >
          <CenterIcon size={16} className="text-primary shrink-0" />
          <span className="truncate">{currentEntity ? (currentEntity.label || currentEntity.fullName) : (centerData?.center?.label || 'Choisir un centre…')}</span>
          <ChevronDown size={15} className="shrink-0 opacity-60" />
        </button>
        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setPickerOpen(false)} aria-hidden="true" />
            <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-xl">
              {!isPairCenter ? (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide opacity-60">
                    Centre « {CENTER_TYPE_LABEL[centerType]} »
                  </p>
                  <p className="text-sm opacity-70">
                    Joignable par la recherche traversante ou par les sauts du graphe. Revenir à un axe :
                  </p>
                  <div className="flex gap-2">
                    {PAIR_KINDS.map((t) => {
                      const I = KIND_ICONS[t];
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setSearchParams(withMode({ center: t })); clearTrail(); setPickerOpen(false); }}
                          className="flex items-center gap-1.5 rounded-xl border border-outline-variant/40 px-3 py-2 text-sm font-medium hover:border-primary/50 transition"
                        >
                          <I size={14} /> {CENTER_TYPE_LABEL[t]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative mb-2">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
                    <input
                      autoFocus
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder={`Rechercher un ${CENTER_TYPE_LABEL[centerType].toLowerCase()}…`}
                      className="w-full rounded-lg border border-outline-variant/30 bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
                    />
                  </div>
                  <ul role="listbox" className="max-h-64 overflow-y-auto -mx-1">
                    {entitiesLoading && (
                      <li className="flex items-center gap-2 px-3 py-2 text-sm opacity-60"><Loader2 size={14} className="animate-spin" /> Chargement…</li>
                    )}
                    {entitiesError && (
                      <li className="px-3 py-2 text-sm text-danger">{entitiesError}</li>
                    )}
                    {!entitiesLoading && !entitiesError && visibleEntities.length === 0 && (
                      <li className="px-3 py-2 text-sm opacity-60">Aucun résultat</li>
                    )}
                    {visibleEntities.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={e.id === centerId}
                          onClick={() => chooseCenter(e.id)}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-primary/10 ${e.id === centerId ? 'text-primary' : ''}`}
                        >
                          <span className="truncate">{e.label || e.fullName}</span>
                          <span className="shrink-0 rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] tabular-nums opacity-80">{e.openCount}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div role="group" aria-label="Type de centre" className="flex rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-1">
        {['technicien', 'lieu'].map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={centerType === t}
            onClick={() => { setSearchParams(withMode({ center: t })); clearTrail(); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${centerType === t ? 'bg-primary text-primary-foreground shadow-sm' : 'opacity-70 hover:opacity-100'}`}
          >
            {t === 'lieu' ? <MapPin size={14} /> : <User size={14} />}
            {CENTER_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Centre épinglé : chip actif ou bouton d'épinglage (l'autre type) */}
      {hasPin ? (
        <div className="flex items-center gap-1.5 rounded-xl border border-violet-400/40 bg-violet-500/10 py-2 pl-3 pr-1.5 text-sm">
          <Pin size={14} className="shrink-0 text-violet-400" />
          <span className="max-w-[11rem] truncate font-medium">
            {centerData?.pin?.label || `${CENTER_TYPE_LABEL[pinType] || ''} n°${pinId}`}
          </span>
          <button
            type="button"
            onClick={unpin}
            aria-label="Retirer le centre épinglé"
            title="Retirer le centre épinglé"
            className="rounded-lg p-1 hover:bg-white/10 transition"
          >
            <X size={14} />
          </button>
        </div>
      ) : isPairCenter ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPinPickerOpen((o) => !o)}
            aria-expanded={pinPickerOpen}
            title="Épingler un 2ᵉ centre pour croiser les données"
            className="flex items-center gap-1.5 rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm font-medium transition hover:border-primary/40"
          >
            <Pin size={15} className="opacity-70" /> Épingler
          </button>
          {pinPickerOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setPinPickerOpen(false)} aria-hidden="true" />
              <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-xl">
                <p className="mb-2 text-xs uppercase tracking-wide opacity-60">
                  Épingler un {centerType === 'lieu' ? 'technicien' : 'lieu'} (croisement)
                </p>
                <ul role="listbox" className="max-h-64 overflow-y-auto -mx-1">
                  {!pinOptions && (
                    <li className="flex items-center gap-2 px-3 py-2 text-sm opacity-60">
                      <Loader2 size={14} className="animate-spin" /> Chargement…
                    </li>
                  )}
                  {pinOptions && pinOptions.length === 0 && (
                    <li className="px-3 py-2 text-sm opacity-60">Aucun élément</li>
                  )}
                  {pinOptions && pinOptions.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => pinCenter(centerType === 'lieu' ? 'technicien' : 'lieu', e.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-primary/10"
                      >
                        <span className="truncate">{e.label || e.fullName}</span>
                        <span className="shrink-0 rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] tabular-nums opacity-80">
                          {e.openCount}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Mode d'affichage : graphe · carte mentale · réseau de neurones */}
      {!isMobile && (
        <div role="group" aria-label="Mode d'affichage" className="flex rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-1">
          {[
            { key: 'graph', label: 'Graphe', Icon: Share2 },
            { key: 'mind', label: 'Carte mentale', Icon: Network },
            { key: 'neural', label: 'Neurones', Icon: BrainCircuit },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === key ? 'bg-primary text-primary-foreground shadow-sm' : 'opacity-70 hover:opacity-100'}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Recherche traversante */}
      <div className="relative min-w-[13rem] flex-1 sm:max-w-[19rem]">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
        <input
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Rechercher un ticket, problème, équipe…"
          aria-label="Recherche traversante"
          className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-primary/50"
        />
        {searchOpen && searchQuery.trim().length >= 2 && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setSearchOpen(false)} aria-hidden="true" />
            <div className="absolute left-0 top-full z-30 mt-2 w-[26rem] max-w-[85vw] rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-2 shadow-xl">
              {searching && (
                <p className="flex items-center gap-2 px-3 py-2 text-sm opacity-60">
                  <Loader2 size={14} className="animate-spin" /> Recherche…
                </p>
              )}
              {!searching && searchResults.length === 0 && (
                <p className="px-3 py-2 text-sm opacity-60">Aucun résultat pour « {searchQuery.trim()} »</p>
              )}
              {!searching && searchResults.map((m) => {
                const Icon = KIND_ICONS[m.kind] || Ticket;
                return (
                  <button
                    key={`${m.kind}-${m.id}`}
                    type="button"
                    onClick={() => goToMatch(m)}
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-primary/10"
                  >
                    <Icon size={15} className="mt-0.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.ref ? `${m.ref} · ${m.label}` : m.label}
                      </span>
                      <span className="block truncate text-xs opacity-60">
                        {m.path
                          ? `→ ${m.path.center.label} › ${CATEGORY_LABELS[m.path.category] || m.path.category}`
                          : 'Hors graphe'}
                        {m.meta ? ` · ${m.meta}` : ''}
                      </span>
                    </span>
                    <ChevronRight size={14} className="mt-1 shrink-0 opacity-40" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Synthèse IA du nœud (technicien / lieu uniquement) */}
      {isPairCenter && (
        <button
          type="button"
          onClick={generateSummary}
          disabled={!centerId || !!aiCard?.loading}
          title="Résumer ce nœud avec l'IA"
          className="flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {aiCard?.loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          Synthèse IA
        </button>
      )}
    </div>
  );

  // ── Panneau de détail (sous le graphe) ───────────────────────────────────
  const detailPanel = selectedItem && (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4"
      role="region"
      aria-label="Détail de l'élément"
    >
      <div className="flex items-start gap-3">
        {(() => {
          const Icon = KIND_ICONS[selectedItem.kind] || Ticket;
          return (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `${itemColor(selectedItem)}22`, color: itemColor(selectedItem) }}>
              <Icon size={18} />
            </span>
          );
        })()}
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide opacity-60">{KIND_LABELS[selectedItem.kind]}</p>
          <p className="truncate font-semibold">{selectedItem.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm opacity-80">
            {selectedItem.ref && <span className="tabular-nums">{selectedItem.ref}</span>}
            {selectedItem.meta && <span className="truncate">{selectedItem.meta}</span>}
            {selectedItem.priority && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: `${itemColor(selectedItem)}22`, color: itemColor(selectedItem) }}>
                {selectedItem.priority}
              </span>
            )}
            {selectedItem.status && <span>{STATUS_LABELS[selectedItem.status] || selectedItem.status}</span>}
            {(() => {
              const s = slaCountdown(selectedItem.slaDueAt, now);
              if (s) {
                return (
                  <span className={`font-medium tabular-nums ${s.tone === 'red' ? 'text-danger' : s.tone === 'amber' ? 'text-amber-600' : ''} ${s.breached ? 'animate-pulse' : ''}`}>
                    {s.label}
                  </span>
                );
              }
              if (selectedItem.slaBreachedAt || selectedItem.slaBreached) return <span className="text-danger">SLA dépassé</span>;
              return null;
            })()}
            {selectedItem.count != null && <span className="tabular-nums">{selectedItem.count} ticket(s)</span>}
          </div>
        </div>
        <button type="button" onClick={() => setSelectedItem(null)} aria-label="Fermer le détail"
          className="rounded-lg p-1.5 opacity-60 hover:opacity-100 hover:bg-surface-container-highest transition">
          <X size={16} />
        </button>
      </div>
      {(selectedItem.href || selectedItem.recenter || visibleJumps.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {/* Sauts de boucle : rejoint l'autre nœud lié sans quitter le graphe */}
          {visibleJumps.map((j) => {
            const JIcon = KIND_ICONS[j.center] || User;
            return (
              <button
                key={`${j.center}-${j.id}`}
                type="button"
                onClick={() => hop(j.center, j.id)}
                title={`Explorer « ${j.label} »`}
                className="flex items-center gap-1.5 rounded-xl border border-outline-variant/40 px-3 py-2 text-sm font-medium hover:border-primary/50 hover:text-primary transition"
              >
                <JIcon size={14} className="shrink-0" />
                <span className="max-w-[11rem] truncate">{j.label}</span>
              </button>
            );
          })}
          {selectedItem.href && (
            <button
              type="button"
              onClick={() => itemAction('fiche')}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
            >
              <ExternalLink size={15} />
              Ouvrir la fiche
            </button>
          )}
          {selectedItem.recenter && (
            <button
              type="button"
              onClick={() => itemAction('recenter')}
              className="flex items-center gap-2 rounded-xl border border-outline-variant/40 px-4 py-2 text-sm font-medium hover:border-primary/50 hover:text-primary transition"
            >
              <LocateFixed size={15} />
              Centrer ici
            </button>
          )}
        </div>
      )}
    </motion.div>
  );

  // ── Liste « + N autres » (modale) ────────────────────────────────────────
  const listModal = listAll && (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Tous les éléments">
      <div className="w-full max-w-lg rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{activeCat?.label} — tous les éléments</p>
            <p className="text-xs opacity-60">{listAll.total} au total · affichage limité</p>
          </div>
          <button type="button" onClick={() => setListAll(null)} aria-label="Fermer la liste"
            className="rounded-lg p-1.5 opacity-60 hover:opacity-100 hover:bg-surface-container-highest transition">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[24rem] space-y-1 overflow-y-auto">
          {listAll.loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm opacity-60"><Loader2 size={16} className="animate-spin" /> Chargement…</div>
          )}
          {listAll.error && !listAll.loading && (
            <div className="py-6 text-center text-sm text-danger">Chargement impossible</div>
          )}
          {!listAll.loading && !listAll.error && listAll.items.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => activateFromList(item)}
              title={itemHint(item)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-primary/10 transition"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: itemColor(item) }} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="shrink-0 text-xs opacity-60 truncate max-w-[8rem]">{item.ref || item.meta || (item.count != null ? `${item.count}` : '')}</span>
              <ChevronRight size={14} className="shrink-0 opacity-50" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── États du centre (partagés stage / mobile) ────────────────────────────
  const centerEmpty = !centerLoading && !centerError && !centerData && (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-slate-300">{centerId ? 'Centre introuvable' : 'Choisissez un centre pour démarrer'}</p>
      <button type="button" onClick={() => setPickerOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition">
        <Search size={15} /> Choisir un centre
      </button>
    </div>
  );
  const centerErr = centerError && (
    <div className="flex flex-col items-center gap-3 text-center">
      <AlertCircle size={22} className="text-danger" />
      <p className="text-sm text-slate-300">{centerError}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setCenterTick((t) => t + 1)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition">
          <RotateCcw size={15} /> Réessayer
        </button>
        <button type="button" onClick={() => setPickerOpen(true)}
          className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 transition">
          Choisir un centre
        </button>
      </div>
    </div>
  );

  // ── Rangée d'élément (mobile) ────────────────────────────────────────────
  const itemRow = (item) => (
    <button
      key={`${item.kind}-${item.id}`}
      type="button"
      onClick={() => activateItem(item)}
      title={itemHint(item)}
      className="flex w-full items-center gap-3 border-t border-outline-variant/20 px-4 py-3 text-left hover:bg-primary/5 transition"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: itemColor(item) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.label}</span>
        <span className="block truncate text-xs opacity-60">{item.ref ? `${item.ref} · ` : ''}{item.meta || (item.count != null ? `${item.count} ticket(s)` : '')}</span>
        {(() => {
          const s = slaCountdown(item.slaDueAt, now);
          if (!s) return null;
          return (
            <span className={`block truncate text-[11px] font-medium tabular-nums ${s.tone === 'red' ? 'text-danger' : s.tone === 'amber' ? 'text-amber-600' : 'opacity-60'} ${s.breached ? 'animate-pulse' : ''}`}>
              {s.label}
            </span>
          );
        })()}
      </span>
      <ChevronRight size={15} className="shrink-0 opacity-50" />
    </button>
  );

  const ageS = Math.max(0, Math.round((now - lastRefresh) / 1000));
  const ageLabel = ageS < 5 ? 'à l’instant' : ageS < 60 ? `il y a ${ageS} s` : `il y a ${Math.round(ageS / 60)} min`;

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => navigate('/')} aria-label="Retour au tableau de bord"
            className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-2.5 hover:border-primary/40 transition">
            <ArrowLeft size={17} />
          </button>
          <div className="mr-auto min-w-0">
            <h1 className="text-xl font-semibold">Exploration</h1>
            <p className="text-sm opacity-60">Suivez le fil entre tickets, problèmes, équipes, compétences et lieux — en 3 niveaux</p>
          </div>

          {/* Fraîcheur des données + actions */}
          <div className="flex items-center gap-2">
            <span
              role="status"
              className="flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container-lowest px-3 py-1.5 text-xs tabular-nums text-slate-500"
              title="Dernière actualisation (événements temps réel + vérification toutes les 45 s)"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${ageS < 10 ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              Actualisé {ageLabel}
            </span>
            <button
              type="button"
              onClick={() => refreshNow(true)}
              aria-label="Actualiser les données"
              title="Actualiser"
              className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-2.5 hover:border-primary/40 transition"
            >
              <RotateCcw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <CopyLinkButton />
          </div>
        </header>

        {toolbar}

        {/* Fil d'Ariane : centres visités › Centre › Catégorie › Élément */}
        {(activeCat || selectedItem || trail.length > 0) && (
          <nav aria-label="Fil d'exploration" className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
            {/* Retours arrière : cliquer une étape du fil revient dessus et tronque la suite */}
            {trail.map((t, i) => (
              <span key={`${t.type}-${t.id}-${i}`} className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => jumpTrail(i)}
                  title={`Revenir à ${t.label}`}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 opacity-70 hover:bg-surface-container-highest hover:opacity-100 transition"
                >
                  {(() => {
                    const TIcon = KIND_ICONS[t.type] || User;
                    return <TIcon size={13} className="shrink-0" />;
                  })()}
                  <span className="max-w-[10rem] truncate">{t.label}</span>
                </button>
                <ChevronRight size={13} className="opacity-40" />
              </span>
            ))}
            <button
              type="button"
              onClick={() => { setSelectedItem(null); setSelectedCat(null); setFan(null); }}
              className="rounded-lg px-2 py-1 font-medium text-primary hover:bg-primary/10 transition"
            >
              {centerData?.center?.label || CENTER_TYPE_LABEL[centerType]}
            </button>
            {trail.length > 0 && (
              <button
                type="button"
                onClick={clearTrail}
                title="Effacer le fil d'exploration"
                aria-label="Effacer le fil d'exploration"
                className="ml-1 rounded-lg p-1 opacity-50 hover:bg-surface-container-highest hover:opacity-100 transition"
              >
                <X size={13} />
              </button>
            )}
            {activeCat && (
              <>
                <ChevronRight size={13} className="opacity-40" />
                <button
                  type="button"
                  onClick={() => { setSelectedItem(null); setSelectedCat(null); setFan(null); }}
                  className="rounded-lg px-2 py-1 hover:bg-surface-container-highest transition"
                >
                  {activeCat.label}
                </button>
              </>
            )}
            {selectedItem && (
              <>
                <ChevronRight size={13} className="opacity-40" />
                <span className="max-w-[16rem] truncate px-2 py-1 opacity-70">
                  {selectedItem.ref ? `${selectedItem.ref} · ` : ''}{selectedItem.label}
                </span>
              </>
            )}
          </nav>
        )}

        {/* ── Desktop : carte mentale (mode=mind) ──────────────────────── */}
        {!isMobile && mode === 'mind' && (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-2">
            <MindMapMode
              key={`${centerType}:${centerId}`}
              centerType={centerType}
              centerId={centerId}
              centerData={centerData}
              loading={centerLoading}
              error={centerErr}
              empty={centerEmpty}
              loadCategory={loadCategory}
              onItem={activateItem}
              onMore={openListAll}
              onPickCenter={() => setPickerOpen(true)}
            />
          </div>
        )}

        {/* ── Desktop : réseau de neurones (mode=neural, WebGL) ────────── */}
        {!isMobile && mode === 'neural' && (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-2">
            <Suspense
              fallback={
                <div className="flex h-[620px] items-center justify-center gap-2 text-sm text-slate-400">
                  <Loader2 size={16} className="animate-spin" /> Chargement du mode neurones…
                </div>
              }
            >
              <NeuralMode
                key={`${centerType}:${centerId}`}
                centerType={centerType}
                centerId={centerId}
                centerData={centerData}
                loading={centerLoading}
                error={centerErr}
                empty={centerEmpty}
                loadCategory={loadCategory}
                onItem={activateItem}
                onPickCenter={() => setPickerOpen(true)}
              />
            </Suspense>
          </div>
        )}

        {/* ── Desktop : stage graphe (défaut) ───────────────────────────── */}
        {!isMobile && mode === 'graph' && (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-2">
            <div
              ref={stageRef}
              role="region"
              aria-label="Graphe d'exploration"
              className="relative overflow-hidden rounded-xl"
              style={{
                height: STAGE_H,
                minWidth: STAGE_MIN_W,
                background: 'radial-gradient(1100px 520px at 26% 42%, #16213a 0%, #0b1120 55%, #070b14 100%)',
              }}
            >
              {geom && (
                <svg
                  width={geom.W}
                  height={STAGE_H}
                  viewBox={`0 0 ${geom.W} ${STAGE_H}`}
                  className="absolute inset-0 pointer-events-none"
                  aria-hidden="true"
                >
                  <defs>
                    <filter id="exp-glow" x="-120%" y="-120%" width="340%" height="340%">
                      <feGaussianBlur stdDeviation="2.4" result="b" />
                      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>

                  {/* Cercles concentriques autour du centre */}
                  {[110, 180, 250, 320].map((r) => (
                    <circle key={r} cx={G.CX + G.CW / 2} cy={centerY} r={r}
                      fill="none" stroke="rgba(96,165,250,0.07)" strokeWidth="1" />
                  ))}

                  {/* Courbes centre → catégories */}
                  {geom.curves.map((c) => {
                    const active = selectedCat === c.key || hoverCat === c.key;
                    return (
                      <path key={c.key} d={c.d} fill="none"
                        stroke={active ? 'rgba(96,165,250,0.75)' : 'rgba(148,163,184,0.22)'}
                        strokeWidth={active ? 2 : 1.4} />
                    );
                  })}

                  {/* Éventail : courbes animées (pathLength) + points lumineux */}
                  {geom.fanItems.map((f, i) => {
                    const hovered = hoverItem === i;
                    const dimmed = hoverItem !== null && !hovered;
                    return (
                      <motion.path
                        key={`${selectedCat}-${f.item.kind}-${f.item.id}`}
                        d={f.d}
                        fill="none"
                        stroke={f.color}
                        strokeWidth={hovered ? 2.6 : 1.5}
                        strokeLinecap="round"
                        filter={hovered ? 'url(#exp-glow)' : undefined}
                        initial={{ pathLength: reduce ? 1 : 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: dimmed ? f.fade * 0.35 : f.fade }}
                        transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : i * 0.05 }}
                      />
                    );
                  })}
                  {geom.fanItems.map((f, i) => (
                    <circle key={`dot-${i}`} cx={f.x} cy={f.y} r={3.2} fill={f.color}
                      filter="url(#exp-glow)" opacity={f.fade} />
                  ))}
                  {geom.more && (
                    <path d={geom.more.d} fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="1.5"
                      strokeDasharray="4 4" opacity={geom.more.fade} />
                  )}
                </svg>
              )}

              {/* Carte centre */}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                title="Choisir un centre"
                className="absolute flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-left text-slate-100 backdrop-blur transition hover:border-primary/50"
                style={{ left: G.CX, top: hasPin ? centerY - G.CH - 6 : centerY - G.CH / 2, width: G.CW, height: G.CH }}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/25 text-sm font-bold text-slate-100">
                  {centerData ? initials(centerData.center.label) : '…'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{centerData?.center?.label || 'Centre'}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {CENTER_TYPE_LABEL[centerType]}{centerData?.center?.sub && centerData.center.sub !== 'Lieu' ? ` · ${STATUS_LABELS[centerData.center.sub] || centerData.center.sub}` : ''}
                  </span>
                </span>
              </button>

              {/* Carte centre épinglé (croisement des 2 axes) */}
              {hasPin && (
                <div
                  className="absolute flex items-center gap-3 rounded-2xl border border-dashed border-violet-400/50 bg-violet-500/10 px-4 text-left text-slate-100 backdrop-blur"
                  style={{ left: G.CX, top: centerY + 6, width: G.CW, height: G.CH }}
                  title="Centre épinglé : le croisement des deux axes est affiché"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-500/30 text-sm font-bold text-slate-100">
                    {centerData?.pin ? initials(centerData.pin.label) : '…'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {centerData?.pin?.label || 'Chargement…'}
                    </span>
                    <span className="block truncate text-xs text-violet-300/80">
                      {CENTER_TYPE_LABEL[pinType]}
                      {centerData?.pin?.sub && centerData.pin.sub !== 'Lieu' ? ` · ${centerData.pin.sub}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={unpin}
                    aria-label="Retirer le centre épinglé"
                    className="rounded-lg p-1 opacity-60 transition hover:bg-white/10 hover:opacity-100"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              {/* Cartes catégories */}
              {centerData && geom && centerData.categories.map((c, i) => {
                const Icon = CATEGORY_ICONS[c.key] || Ticket;
                const isSel = selectedCat === c.key;
                const dim = selectedCat !== null && !isSel && hoverCat !== c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => selectCategory(c.key)}
                    aria-pressed={isSel}
                    onMouseEnter={() => setHoverCat(c.key)}
                    onMouseLeave={() => setHoverCat(null)}
                    className="absolute flex items-center justify-between gap-3 rounded-xl border px-3 backdrop-blur transition"
                    style={{
                      left: G.CATX,
                      top: catTop(i, geom.n),
                      width: G.CATW,
                      height: G.CATH,
                      opacity: dim ? 0.5 : 1,
                      borderColor: isSel ? 'rgba(96,165,250,0.75)' : 'rgba(255,255,255,0.10)',
                      background: isSel ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm text-slate-200">
                      <Icon size={16} className="shrink-0" style={{ color: isSel ? '#60a5fa' : undefined }} />
                      <span className="truncate">{c.label}</span>
                    </span>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                      style={{ background: 'rgba(255,255,255,0.10)', color: isSel ? '#93c5fd' : '#cbd5e1' }}>
                      {fanLoading && isSel ? <Loader2 size={11} className="animate-spin" /> : c.count}
                    </span>
                  </button>
                );
              })}

              {/* États du centre */}
              {centerLoading && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-400">
                  <Loader2 size={16} className="animate-spin" /> Chargement du centre…
                </div>
              )}
              {!centerLoading && centerErr}
              {!centerLoading && !centerError && centerEmpty}

              {/* États de l'éventail */}
              {centerData && !selectedCat && !centerLoading && (
                <p className="absolute text-sm text-slate-400"
                  style={{ left: FAN_X + 24, top: centerY - 10 }}>
                  Cliquez sur une catégorie pour déployer son éventail →
                </p>
              )}
              {fanLoading && (
                <div className="absolute flex items-center gap-2 text-sm text-slate-400"
                  style={{ left: FAN_X + 16, top: centerY - 10 }}>
                  <Loader2 size={15} className="animate-spin" /> Déploiement…
                </div>
              )}
              {fanError && !fanLoading && (
                <div className="absolute flex flex-col gap-2" style={{ left: FAN_X + 16, top: centerY - 44 }}>
                  <p className="text-sm text-red-400">{fanError}</p>
                  <button type="button" onClick={() => setFanTick((t) => t + 1)}
                    className="flex w-fit items-center gap-2 rounded-xl border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 transition">
                    <RotateCcw size={14} /> Réessayer
                  </button>
                </div>
              )}
              {centerData && selectedCat && !fanLoading && !fanError && fan && fan.items.length === 0 && (
                <p className="absolute text-sm text-slate-400" style={{ left: FAN_X + 16, top: centerY - 10 }}>
                  Aucun élément dans cette catégorie
                </p>
              )}

              {/* Cartes d'éventail */}
              {geom && geom.fanItems.map((f, i) => {
                const Icon = KIND_ICONS[f.item.kind] || Ticket;
                const hovered = hoverItem === i;
                return (
                  <motion.button
                    key={`${f.item.kind}-${f.item.id}`}
                    type="button"
                    onClick={() => activateItem(f.item)}
                    title={itemHint(f.item)}
                    onMouseEnter={() => setHoverItem(i)}
                    onMouseLeave={() => setHoverItem(null)}
                    initial={{ opacity: reduce ? f.fade : 0, x: reduce ? 0 : -12 }}
                    animate={{ opacity: hovered ? 1 : f.fade, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : 0.1 + i * 0.05 }}
                    className="absolute flex items-center gap-2.5 rounded-xl border px-3 text-left backdrop-blur"
                    style={{
                      left: f.x + 10,
                      top: f.y - G.CARD_H / 2,
                      width: G.CARD,
                      height: G.CARD_H,
                      borderColor: hovered ? f.color : 'rgba(255,255,255,0.10)',
                      background: hovered ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.055)',
                      boxShadow: hovered ? `0 0 16px ${f.color}33` : 'none',
                    }}
                  >
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: f.color }} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-100">
                        <Icon size={13} className="shrink-0 opacity-70" />
                        <span className="truncate">{f.item.ref || f.item.label}</span>
                        {f.item.priority && (
                          <span className="shrink-0 rounded px-1 text-[10px] font-bold"
                            style={{ background: `${f.color}26`, color: f.color }}>{f.item.priority}</span>
                        )}
                      </span>
                      <span className="truncate text-[11px] text-slate-400">
                        {f.item.ref ? f.item.label : (f.item.meta || (f.item.count != null ? `${f.item.count} ticket(s)` : ''))}
                      </span>
                      {(() => {
                        const s = slaCountdown(f.item.slaDueAt, now);
                        if (!s) return null;
                        return (
                          <span className={`truncate text-[10px] font-medium tabular-nums ${s.tone === 'red' ? 'text-red-400' : s.tone === 'amber' ? 'text-amber-400' : 'text-slate-500'} ${s.breached ? 'animate-pulse' : ''}`}>
                            {s.label}
                          </span>
                        );
                      })()}
                    </span>
                  </motion.button>
                );
              })}

              {/* Nœud « + N autres » */}
              {geom && geom.more && (
                <motion.button
                  type="button"
                  onClick={openListAll}
                  initial={{ opacity: reduce ? geom.more.fade : 0 }}
                  animate={{ opacity: geom.more.fade }}
                  className="absolute flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-white/[0.04] text-xs text-slate-300 backdrop-blur transition hover:border-primary/60 hover:text-slate-100"
                  style={{ left: geom.more.x + 10, top: geom.more.y - 18, width: G.CARD, height: 36 }}
                >
                  <Plus size={14} />
                  {geom.more.rest} autre{geom.more.rest > 1 ? 's' : ''}
                </motion.button>
              )}
            </div>
          </div>
        )}

        {/* ── Mobile : accordéon ───────────────────────────────────────── */}
        {isMobile && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold">
                {centerData ? initials(centerData.center.label) : '…'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{centerData?.center?.label || (centerLoading ? 'Chargement…' : 'Aucun centre')}</span>
                <span className="block text-xs opacity-60">{CENTER_TYPE_LABEL[centerType]}</span>
              </span>
              <button type="button" onClick={() => setPickerOpen(true)}
                className="rounded-xl border border-outline-variant/30 px-3 py-2 text-xs font-medium hover:border-primary/40 transition">
                Changer
              </button>
            </div>

            {hasPin && (
              <div className="flex items-center gap-2 rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/10 px-4 py-3 text-sm">
                <Pin size={14} className="shrink-0 text-violet-500" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{centerData?.pin?.label || 'Centre épinglé…'}</span>
                  <span className="text-xs opacity-60"> · croisement actif</span>
                </span>
                <button type="button" onClick={unpin} aria-label="Retirer le centre épinglé"
                  className="rounded-lg p-1 hover:bg-surface-container-highest transition">
                  <X size={15} />
                </button>
              </div>
            )}

            {centerErr}
            {centerEmpty}

            {centerData && centerData.categories.map((c) => {
              const Icon = CATEGORY_ICONS[c.key] || Ticket;
              const isSel = selectedCat === c.key;
              return (
                <div key={c.key} className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
                  <button
                    type="button"
                    onClick={() => selectCategory(c.key)}
                    aria-expanded={isSel}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <Icon size={17} className={isSel ? 'text-primary' : 'opacity-70'} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.label}</span>
                    <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                      {fanLoading && isSel ? <Loader2 size={11} className="animate-spin" /> : c.count}
                    </span>
                    <ChevronDown size={16} className={`shrink-0 opacity-60 transition-transform ${isSel ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {isSel && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: reduce ? 0 : 0.25 }}
                      >
                        {fanLoading && (
                          <div className="flex items-center gap-2 px-4 py-3 text-sm opacity-60"><Loader2 size={14} className="animate-spin" /> Chargement…</div>
                        )}
                        {fanError && !fanLoading && (
                          <div className="px-4 py-3">
                            <p className="mb-2 text-sm text-danger">{fanError}</p>
                            <button type="button" onClick={() => setFanTick((t) => t + 1)}
                              className="flex items-center gap-2 rounded-xl border border-outline-variant/30 px-3 py-1.5 text-sm">
                              <RotateCcw size={14} /> Réessayer
                            </button>
                          </div>
                        )}
                        {fan && !fanLoading && !fanError && fan.items.length === 0 && (
                          <p className="px-4 py-3 text-sm opacity-60">Aucun élément</p>
                        )}
                        {fan && !fanLoading && fan.items.map(itemRow)}
                        {fan && !fanLoading && fan.total > fan.items.length && (
                          <button type="button" onClick={openListAll}
                            className="flex w-full items-center justify-center gap-1.5 border-t border-outline-variant/20 px-4 py-3 text-sm font-medium text-primary">
                            <Plus size={15} /> Voir les {fan.total - fan.items.length} autres
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}

        {detailPanel}
      </div>

      {/* Carte flottante : synthèse IA du nœud */}
      <AnimatePresence>
        {aiCard && (
          <motion.aside
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: reduce ? 0 : 0.25 }}
            className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] rounded-2xl border border-primary/30 bg-surface-container-lowest p-4 shadow-2xl"
            role="dialog"
            aria-label="Synthèse IA"
          >
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-primary" />
              <p className="mr-auto text-sm font-semibold">Synthèse IA</p>
              <button
                type="button"
                onClick={() => setAiCard(null)}
                aria-label="Fermer la synthèse"
                className="rounded-lg p-1.5 opacity-60 transition hover:bg-surface-container-highest hover:opacity-100"
              >
                <X size={15} />
              </button>
            </div>
            {aiCard.loading && (
              <p className="flex items-center gap-2 py-3 text-sm opacity-70">
                <Loader2 size={15} className="animate-spin" /> Analyse du contexte…
              </p>
            )}
            {aiCard.error && !aiCard.loading && (
              <div className="py-1">
                <p className="text-sm text-danger">{aiCard.error}</p>
                <button
                  type="button"
                  onClick={generateSummary}
                  className="mt-3 flex items-center gap-1.5 rounded-xl border border-outline-variant/30 px-3 py-1.5 text-sm transition hover:border-primary/40"
                >
                  <RefreshCw size={14} /> Réessayer
                </button>
              </div>
            )}
            {aiCard.text && !aiCard.loading && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{aiCard.text}</p>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {listModal}
    </div>
  );
}
