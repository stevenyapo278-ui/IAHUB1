import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, SearchX, ArrowUp, ArrowDown, CornerDownLeft,
  Ticket, User, Users, Boxes, BookOpen, AlertTriangle, MapPin,
  Zap, Clock, ChevronRight,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import useSystemSettings from '../hooks/useSystemSettings';
import { hasPermission } from '../utils/permissions';

// ── Configuration des sections de recherche ──────────────────────────────────
// Chaque section définit : endpoint, query param, label, icône, couleur, permission requise
const SEARCH_SECTIONS = [
  {
    type: 'ticket',
    label: 'Tickets',
    icon: Ticket,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    endpoint: '/tickets',
    queryParam: 'title',
    limit: 5,
    // La permission est vérifiable côté backend (REQUESTER/TECHNICIAN sont déjà filtrés)
    minRole: null, // tout le monde peut chercher des tickets
  },
  {
    type: 'user',
    label: 'Utilisateurs',
    icon: User,
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    endpoint: '/users',
    queryParam: 'search',
    limit: 5,
    minRole: null, // accessible à tous
  },
  {
    type: 'team',
    label: 'Équipes',
    icon: Users,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    endpoint: '/teams',
    queryParam: 'search',
    limit: 5,
    minRole: null,
  },
  {
    type: 'asset',
    label: 'Inventaire',
    icon: Boxes,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    endpoint: '/assets',
    queryParam: 'search',
    limit: 3,
    permission: 'assets.manage',
    fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'],
  },
  {
    type: 'knowledge',
    label: 'Base de connaissances',
    icon: BookOpen,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    endpoint: '/knowledge/search',
    queryParam: 'query', // POST body
    limit: 3,
    isPost: true,
    minRole: null, // accessible à tous
  },
  {
    type: 'problem',
    label: 'Problèmes',
    icon: AlertTriangle,
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    endpoint: '/problems',
    queryParam: 'search',
    limit: 3,
    fallbackRoles: ['ADMIN', 'HOTLINE', 'SUPERADMIN'],
  },
  {
    type: 'location',
    label: 'Lieux',
    icon: MapPin,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    endpoint: '/locations',
    queryParam: 'search',
    limit: 3,
    fallbackRoles: ['ADMIN', 'HOTLINE'],
  },
];

// ── Raccourcis clavier affichés dans l'état vide ─────────────────────────────
const QUICK_SHORTCUTS = [
  { path: '/tickets?new=1', label: 'Nouveau ticket', icon: '➕', keys: ['N'] },
  { path: '/tickets', label: 'Tickets', icon: '🎫', keys: ['T'] },
  { path: '/inbox', label: 'Inbox', icon: '📥', keys: ['I'] },
  { path: '/email-drafts', label: 'Validation', icon: '✅', keys: ['V'] },
  { path: '/knowledge-base', label: 'KB', icon: '📚', keys: ['K'] },
];

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | section type
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings: systemSettings } = useSystemSettings();
  const navConfig = systemSettings?.navigationConfig;

  // Vérifier si une section est accessible selon les permissions de l'utilisateur
  const isSectionAllowed = useCallback((section) => {
    if (user?.role === 'SUPERADMIN') return true;
    if (section.permission && !hasPermission(user, section.permission)) return false;
    if (section.fallbackRoles && !section.fallbackRoles.includes(user?.role)) return false;
    // Vérifier navigationConfig si la route de la section y figure
    if (navConfig && section.type === 'ticket' && navConfig['/tickets'] && !navConfig['/tickets'].includes(user?.role)) return false;
    if (navConfig && section.type === 'knowledge' && navConfig['/knowledge-base'] && !navConfig['/knowledge-base'].includes(user?.role)) return false;
    if (navConfig && section.type === 'problem' && navConfig['/problems'] && !navConfig['/problems'].includes(user?.role)) return false;
    return true;
  }, [user, navConfig]);

  // Sections visibles pour cet utilisateur
  const allowedSections = useMemo(() => SEARCH_SECTIONS.filter(isSectionAllowed), [isSectionAllowed]);

  // Cmd+K / Ctrl+K pour ouvrir
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setResults({});
        setActiveFilter('all');
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input quand la modale s'ouvre
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Raccourcis clavier rapides (quand la modale est ouverte et pas de requête)
  useEffect(() => {
    if (!open || query.trim()) return;
    function handleQuickKey(e) {
      if (e.target.tagName === 'INPUT') return;
      const shortcut = QUICK_SHORTCUTS.find((s) => s.keys.includes(e.key.toUpperCase()));
      if (shortcut) {
        e.preventDefault();
        setOpen(false);
        navigate(shortcut.path);
      }
    }
    window.addEventListener('keydown', handleQuickKey);
    return () => window.removeEventListener('keydown', handleQuickKey);
  }, [open, query, navigate]);

  // Recherche avec debounce — appels parallèles sur toutes les sections autorisées
  useEffect(() => {
    if (!query.trim()) {
      setResults({});
      setSelectedIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const promises = allowedSections.map(async (section) => {
          try {
            if (section.isPost) {
              // POST pour la recherche sémantique KB
              const res = await api.post(section.endpoint, {
                [section.queryParam]: query,
                limit: section.limit,
              });
              return { type: section.type, items: Array.isArray(res.data) ? res.data : (res.data?.results || []) };
            }
            const res = await api.get(section.endpoint, {
              params: { [section.queryParam]: query, limit: section.limit },
            });
            const data = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.tickets || []);
            return { type: section.type, items: data };
          } catch {
            return { type: section.type, items: [] };
          }
        });

        const resolved = await Promise.all(promises);
        const newResults = {};
        resolved.forEach(({ type, items }) => { newResults[type] = items; });
        setResults(newResults);
        setSelectedIndex(0);
      } catch (err) {
        console.error('[GlobalSearch] Erreur:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, allowedSections]);

  // Sections avec résultats + labels pour l'affichage
  const sections = useMemo(() => allowedSections.map((s) => ({
    ...s,
    items: results[s.type] || [],
  })), [allowedSections, results]);

  // Résultats plats pour navigation clavier
  const allResults = useMemo(() => {
    const filtered = activeFilter === 'all' ? sections : sections.filter((s) => s.type === activeFilter);
    return filtered.flatMap((section) =>
      section.items.map((item) => ({
        type: section.type,
        section,
        raw: item,
        ...formatResult(item, section.type),
      }))
    );
  }, [sections, activeFilter]);

  // Compteur total
  const totalCount = useMemo(() => allResults.length, [allResults]);

  const handleSelect = useCallback((item) => {
    setOpen(false);
    setQuery('');
    navigate(item.path);
  }, [navigate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      e.preventDefault();
      handleSelect(allResults[selectedIndex]);
    }
  }, [allResults, selectedIndex, handleSelect]);

  // Filtrer les sections avec résultats pour les raccourcis de filtre
  const activeSections = sections.filter((s) => s.items.length > 0);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12%] p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
            onClick={() => setOpen(false)}
          />

          {/* Search Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-2xl z-10"
          >
            <div
              className="rounded-2xl shadow-2xl border overflow-hidden"
              style={{
                backgroundColor: 'var(--color-surface-container-lowest)',
                borderColor: 'var(--color-outline-variant)',
              }}
            >
              {/* Input */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: 'var(--color-outline-variant)' }}>
                <Search className="w-4.5 h-4.5 shrink-0" style={{ color: 'var(--color-on-surface-variant)' }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActiveFilter('all'); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Rechercher tickets, utilisateurs, inventaire, KB, problèmes, lieux..."
                  className="flex-1 bg-transparent border-none outline-none text-sm font-medium"
                  style={{ color: 'var(--color-on-surface)' }}
                />
                {loading && (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--color-on-surface-variant)' }} />
                )}
                {query.trim() && totalCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)' }}>
                    {totalCount}
                  </span>
                )}
                <kbd
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold"
                  style={{
                    color: 'var(--color-muted-foreground)',
                    backgroundColor: 'var(--color-surface-container)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  ESC
                </kbd>
              </div>

              {/* Filtres par catégorie */}
              {query.trim() && activeSections.length > 1 && (
                <div className="flex items-center gap-1.5 px-4 py-2 border-b overflow-x-auto" style={{ borderColor: 'var(--color-outline-variant)' }}>
                  <button
                    onClick={() => setActiveFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all ${
                      activeFilter === 'all'
                        ? 'text-on-primary bg-primary'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Tout ({totalCount})
                  </button>
                  {activeSections.map((s) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.type}
                        onClick={() => setActiveFilter(s.type)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all ${
                          activeFilter === s.type
                            ? 'text-on-primary bg-primary'
                            : 'text-on-surface-variant hover:bg-surface-container-high'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {s.label} ({s.items.length})
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Résultats */}
              <div className="max-h-[400px] overflow-y-auto p-2 space-y-0.5">
                {/* État vide : raccourcis rapides */}
                {!query.trim() && (
                  <div className="py-8">
                    <div className="text-center mb-4">
                      <p className="text-[13px] font-medium" style={{ color: 'var(--color-muted-foreground)' }}>
                        Tapez pour rechercher ou utilisez un raccourci
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 px-2">
                      {QUICK_SHORTCUTS.map((sc) => (
                        <button
                          key={sc.path}
                          onClick={() => { setOpen(false); navigate(sc.path); }}
                          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all hover:bg-primary/8 border border-transparent hover:border-primary/20"
                        >
                          <span className="text-base">{sc.icon}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-semibold block" style={{ color: 'var(--color-on-surface)' }}>{sc.label}</span>
                          </div>
                          <kbd className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface-container)', border: '1px solid var(--color-border)', color: 'var(--color-muted-foreground)' }}>
                            {sc.keys[0]}
                          </kbd>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-5 text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
                      <span className="flex items-center gap-1.5">
                        <kbd className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-mono font-bold" style={{ backgroundColor: 'var(--color-surface-container)', border: '1px solid var(--color-border)' }}>
                          <ArrowUp className="w-2.5 h-2.5" />
                        </kbd>
                        <kbd className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-mono font-bold" style={{ backgroundColor: 'var(--color-surface-container)', border: '1px solid var(--color-border)' }}>
                          <ArrowDown className="w-2.5 h-2.5" />
                        </kbd>
                        Naviguer
                      </span>
                      <span className="flex items-center gap-1.5">
                        <kbd className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-mono font-bold" style={{ backgroundColor: 'var(--color-surface-container)', border: '1px solid var(--color-border)' }}>
                          <CornerDownLeft className="w-2.5 h-2.5" />
                        </kbd>
                        Ouvrir
                      </span>
                    </div>
                  </div>
                )}

                {/* Aucun résultat */}
                {query.trim() && allResults.length === 0 && !loading && (
                  <div className="flex flex-col items-center gap-2 py-10">
                    <SearchX className="w-8 h-8 opacity-30" style={{ color: 'var(--color-muted-foreground)' }} />
                    <p className="text-[13px] font-medium" style={{ color: 'var(--color-on-surface-variant)' }}>Aucun résultat trouvé</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-muted-foreground)' }}>Essayez un autre terme de recherche</p>
                  </div>
                )}

                {/* Résultats par section */}
                {sections.map((section) =>
                  section.items.length > 0 && (activeFilter === 'all' || activeFilter === section.type) ? (
                    <div key={section.type}>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--color-on-surface-variant)' }}>
                        <section.icon className="w-3 h-3" />
                        {section.label}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface-container)', color: 'var(--color-muted-foreground)' }}>
                          {section.items.length}
                        </span>
                      </p>
                      {allResults
                        .filter((r) => r.type === section.type)
                        .map((item) => {
                          const globalIdx = allResults.indexOf(item);
                          return (
                            <ResultItem
                              key={`${section.type}-${item.raw.id || item.raw.name || globalIdx}`}
                              item={item}
                              isSelected={selectedIndex === globalIdx}
                              onSelect={handleSelect}
                            />
                          );
                        })}
                    </div>
                  ) : null
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Formatter un résultat selon son type ─────────────────────────────────────
function formatResult(item, type) {
  switch (type) {
    case 'ticket':
      return {
        label: `#${item.id} — ${item.title}`,
        sublabel: [item.category, item.team?.name, item.assignedTo?.fullName].filter(Boolean).join(' · '),
        path: `/tickets/${item.id}`,
        priority: item.priority,
        status: item.status,
      };
    case 'user':
      return {
        label: item.fullName || item.email,
        sublabel: [item.role, item.team?.name].filter(Boolean).join(' · '),
        path: null, // pas de page détail user
        email: item.email,
      };
    case 'team':
      return {
        label: item.name,
        sublabel: `${item._count?.members || item.memberCount || 0} membres`,
        path: null,
      };
    case 'asset':
      return {
        label: item.name,
        sublabel: [item.assetType, item.serialNumber, item.location?.name].filter(Boolean).join(' · '),
        path: null,
        status: item.status,
      };
    case 'knowledge':
      return {
        label: item.title || item.name || 'Document',
        sublabel: [item.sourceType, item.status].filter(Boolean).join(' · '),
        path: '/knowledge-base',
        status: item.status,
      };
    case 'problem':
      return {
        label: `#${item.id} — ${item.title}`,
        sublabel: [item.status, item.priority].filter(Boolean).join(' · '),
        path: `/problems/${item.id}`,
        priority: item.priority,
        status: item.status,
      };
    case 'location':
      return {
        label: item.completename || item.name,
        sublabel: [item.town, item.address].filter(Boolean).join(' · '),
        path: null,
      };
    default:
      return { label: item.name || item.title || String(item.id), sublabel: '', path: null };
  }
}

// ── Couleurs des badges ──────────────────────────────────────────────────────
const PRIORITY_COLORS = {
  P1: 'text-red-500 bg-red-500/10 border-red-500/20',
  P2: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  P3: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  P4: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
};

const STATUS_COLORS = {
  OPEN: 'text-emerald-500 bg-emerald-500/10',
  NEW: 'text-sky-500 bg-sky-500/10',
  SOLVED: 'text-violet-500 bg-violet-500/10',
  CLOSED: 'text-slate-400 bg-slate-400/10',
  PENDING: 'text-amber-500 bg-amber-500/10',
  PROCESSING: 'text-sky-500 bg-sky-500/10',
  READY: 'text-emerald-500 bg-emerald-500/10',
  ERROR: 'text-red-500 bg-red-500/10',
};

const SECTION_ICONS = {
  ticket: Ticket,
  user: User,
  team: Users,
  asset: Boxes,
  knowledge: BookOpen,
  problem: AlertTriangle,
  location: MapPin,
};

// ── Composant résultat individuel ────────────────────────────────────────────
function ResultItem({ item, isSelected, onSelect }) {
  if (!item) return null;

  const SectionIcon = SECTION_ICONS[item.type] || Search;
  const sectionColor = item.section?.color || 'text-gray-400';
  const sectionBg = item.section?.bgColor || 'bg-gray-500/10';

  return (
    <motion.button
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onSelect(item)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all text-[13px]"
      style={{
        backgroundColor: isSelected ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'transparent',
        color: 'var(--color-on-surface)',
      }}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sectionBg}`}>
        <SectionIcon className={`w-4 h-4 ${sectionColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate block">{item.label}</span>
        {item.sublabel && (
          <span className="text-[11px] truncate block" style={{ color: 'var(--color-muted-foreground)' }}>{item.sublabel}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {item.priority && (
          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md border ${PRIORITY_COLORS[item.priority] || ''}`}>
            {item.priority}
          </span>
        )}
        {item.status && !item.priority && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${STATUS_COLORS[item.status] || 'bg-gray-500/10 text-gray-400'}`}>
            {item.status}
          </span>
        )}
        {isSelected && (
          <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />
        )}
      </div>
    </motion.button>
  );
}
