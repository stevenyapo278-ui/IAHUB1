import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
    { type: 'ticket', label: 'Tickets', items: results.tickets, icon: 'confirmation_number' },
    { type: 'user', label: 'Utilisateurs', items: results.users, icon: 'person' },
    { type: 'team', label: 'Équipes', items: results.teams, icon: 'groups' },
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

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Search Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 z-50 w-full max-w-xl"
          >
            <div
              className="rounded-2xl shadow-2xl border overflow-hidden"
              style={{
                backgroundColor: 'var(--efferd-card)',
                borderColor: 'var(--efferd-border)',
              }}
            >
              {/* Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--efferd-border)' }}>
                <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '20px' }}>
                  search
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Rechercher tickets, utilisateurs, équipes..."
                  className="flex-1 bg-transparent border-none outline-none text-[14px] font-medium placeholder-on-surface-variant/50"
                  style={{ color: 'var(--efferd-text)' }}
                />
                {loading && (
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="material-symbols-outlined text-on-surface-variant"
                    style={{ fontSize: '18px' }}
                  >
                    sync
                  </motion.span>
                )}
                <kbd
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
                  style={{
                    color: 'var(--efferd-muted)',
                    backgroundColor: 'var(--efferd-bg)',
                    border: '1px solid var(--efferd-border)',
                  }}
                >
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div className="max-h-[300px] overflow-y-auto p-2 space-y-0.5">
                {query.trim() && allResults.length === 0 && !loading && (
                  <div className="flex flex-col items-center gap-2 py-8 text-on-surface-variant">
                    <span className="material-symbols-outlined text-[32px] opacity-40">search_off</span>
                    <p className="text-[13px] font-medium">Aucun résultat trouvé</p>
                    <p className="text-[11px] opacity-60">Essayez un autre terme de recherche</p>
                  </div>
                )}

                {!query.trim() && (
                  <div className="py-8 text-center">
                    <p className="text-[13px] font-medium" style={{ color: 'var(--efferd-muted)' }}>
                      Tapez pour rechercher...
                    </p>
                    <div className="flex items-center justify-center gap-3 mt-3 text-[10px]" style={{ color: 'var(--efferd-muted)' }}>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: 'var(--efferd-bg)', border: '1px solid var(--efferd-border)' }}>↑↓</kbd>
                        Naviguer
                      </span>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: 'var(--efferd-bg)', border: '1px solid var(--efferd-border)' }}>↵</kbd>
                        Ouvrir
                      </span>
                    </div>
                  </div>
                )}

                {sections.map((section) =>
                  section.items.length > 0 ? (
                    <div key={section.type}>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--efferd-muted)' }}>
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
        </>
      )}
    </AnimatePresence>
  );
}

function ResultItemComponent({ item, isSelected, onSelect }) {
  if (!item) return null;

  const iconMap = {
    ticket: 'confirmation_number',
    user: 'person',
    team: 'groups',
  };

  const badgeColor = item.priority === 'P1' ? 'text-red-500' 
    : item.priority === 'P2' ? 'text-amber-500' 
    : 'text-transparent';

  return (
    <motion.button
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onSelect(item)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors text-[13px]"
      style={{
        backgroundColor: isSelected ? 'var(--efferd-hover)' : 'transparent',
        color: 'var(--efferd-text)',
      }}
    >
      <span className="material-symbols-outlined shrink-0" style={{ fontSize: '16px', width: '16px', color: 'var(--efferd-muted)' }}>
        {iconMap[item.type] || 'search'}
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate block">{item.label}</span>
        {item.sublabel && (
          <span className="text-[11px]" style={{ color: 'var(--efferd-muted)' }}>{item.sublabel}</span>
        )}
      </div>
      {item.type === 'ticket' && item.priority && (
        <span className={`text-[10px] font-bold uppercase ${badgeColor}`}>
          {item.priority}
        </span>
      )}
    </motion.button>
  );
}
