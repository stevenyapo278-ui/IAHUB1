import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, SearchX, ArrowUp, ArrowDown, CornerDownLeft, Ticket, User, Users } from 'lucide-react';
import api from '../api/client';

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ tickets: [], users: [], teams: [] });
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Cmd+K / Ctrl+K pour ouvrir
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setResults({ tickets: [], users: [], teams: [] });
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

  // Debounce search
  useEffect(() => {
    if (!query.trim()) {
      setResults({ tickets: [], users: [], teams: [] });
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const [ticketsRes, usersRes, teamsRes] = await Promise.all([
          api.get(`/tickets?title=${encodeURIComponent(query)}&limit=5`).catch(() => ({ data: [] })),
          api.get(`/users?search=${encodeURIComponent(query)}&limit=5`).catch(() => ({ data: [] })),
          api.get(`/teams?search=${encodeURIComponent(query)}&limit=5`).catch(() => ({ data: [] })),
        ]);

        const tickets = Array.isArray(ticketsRes.data) ? ticketsRes.data : [];
        const users = Array.isArray(usersRes.data) ? usersRes.data : [];
        const teams = Array.isArray(teamsRes.data) ? teamsRes.data : [];

        setResults({ tickets, users, teams });
        setSelectedIndex(0);
      } catch (err) {
        console.error('[GlobalSearch] Erreur:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Résultats plats pour la navigation clavier — on garde les sections séparées pour l'affichage
  const sections = [
    { type: 'ticket', label: 'Tickets', items: results.tickets, icon: Ticket },
    { type: 'user', label: 'Utilisateurs', items: results.users, icon: User },
    { type: 'team', label: 'Équipes', items: results.teams, icon: Users },
  ];

  const allResults = sections.flatMap((section) =>
    section.items.map((item) => ({
      type: section.type,
      plugin: section,
      raw: item,
      ...(section.type === 'ticket'
        ? { label: `#${item.id} — ${item.title}`, path: `/tickets/${item.id}`, priority: item.priority }
        : section.type === 'user'
        ? { label: item.fullName || item.email, path: `/users`, sublabel: item.role }
        : { label: item.name, path: `/teams`, sublabel: `${item._count?.members || item.memberCount || 0} membres` }),
    }))
  );

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

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15%] p-4">
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
            className="relative w-full max-w-xl z-10"
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
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Rechercher tickets, utilisateurs, équipes..."
                  className="flex-1 bg-transparent border-none outline-none text-sm font-medium"
                  style={{ color: 'var(--color-on-surface)' }}
                />
                {loading && (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--color-on-surface-variant)' }} />
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

              {/* Results */}
              <div className="max-h-[300px] overflow-y-auto p-2 space-y-0.5">
                {query.trim() && allResults.length === 0 && !loading && (
                  <div className="flex flex-col items-center gap-2 py-10">
                    <SearchX className="w-8 h-8 opacity-30" style={{ color: 'var(--color-muted-foreground)' }} />
                    <p className="text-[13px] font-medium" style={{ color: 'var(--color-on-surface-variant)' }}>Aucun résultat trouvé</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-muted-foreground)' }}>Essayez un autre terme de recherche</p>
                  </div>
                )}

                {!query.trim() && (
                  <div className="py-10 text-center">
                    <p className="text-[13px] font-medium" style={{ color: 'var(--color-muted-foreground)' }}>
                      Tapez pour rechercher...
                    </p>
                    <div className="flex items-center justify-center gap-4 mt-3 text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
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

                {sections.map((section) =>
                  section.items.length > 0 ? (
                    <div key={section.type}>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-on-surface-variant)' }}>
                        {section.label}
                      </p>
                      {allResults
                        .filter((r) => r.type === section.type)
                        .map((item, itemIdx) => {
                          const globalIdx = allResults.indexOf(item);
                          return (
                            <ResultItemComponent
                              key={`${section.type}-${itemIdx}`}
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

const SECTION_ICONS = {
  ticket: Ticket,
  user: User,
  team: Users,
};

function ResultItemComponent({ item, isSelected, onSelect }) {
  if (!item) return null;

  const SectionIcon = SECTION_ICONS[item.type] || Search;

  const badgeColor = item.priority === 'P1' ? 'text-red-500 bg-red-500/10 border-red-500/20' 
    : item.priority === 'P2' ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
    : item.priority === 'P3' ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
    : '';

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
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--color-surface-container)' }}>
        <SectionIcon className="w-4 h-4" style={{ color: 'var(--color-muted-foreground)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate block">{item.label}</span>
        {item.sublabel && (
          <span className="text-[11px]" style={{ color: 'var(--color-muted-foreground)' }}>{item.sublabel}</span>
        )}
      </div>
      {item.type === 'ticket' && item.priority && (
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md border ${badgeColor}`}>
          {item.priority}
        </span>
      )}
    </motion.button>
  );
}
