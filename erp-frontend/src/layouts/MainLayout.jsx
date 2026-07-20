import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hasPermission } from '../utils/permissions';
import ForcePasswordChange from '../components/ForcePasswordChange';
import { useVoiceAlerts } from '../hooks/useVoiceAlerts';
import ConfirmDialog from '../components/ConfirmDialog';
import GlobalSearch from '../components/GlobalSearch';
import NotificationPanel from '../components/NotificationPanel';
import ChatWidget from '../components/ChatWidget';
import { useNotifications } from '../context/NotificationContext';
import { saveSessionLocation } from '../utils/sessionLocation';

const platformItems = [
  { to: '/', label: 'Dashboard', icon: 'house', end: true, permission: null },
  { to: '/tickets', label: 'Tickets', icon: 'confirmation_number', permission: null },
  { to: '/teams', label: 'Equipes', icon: 'groups', permission: null },
  { to: '/inbox', label: 'Boite mail', icon: 'inbox', permission: null },
  { to: '/knowledge-base', label: 'Base de connaissances', icon: 'library_books', permission: null },
];

const systemItems = [
  { to: '/supervision', label: 'Supervision IA', icon: 'monitor_heart', permission: 'inbox.sync', fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/email-drafts', label: 'Reponses a valider', icon: 'mark_email_unread', permission: 'emaildrafts.manage', fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/skills', label: 'Competences', icon: 'psychology', permission: null },
  { to: '/documentation', label: 'Documentation', icon: 'description', permission: null },
  { to: '/users', label: 'Utilisateurs', icon: 'person', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/permission-groups', label: 'Groupes de droits', icon: 'shield', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/prompts', label: 'Prompts IA', icon: 'terminal', permission: 'prompts.manage', fallbackRoles: ['ADMIN'] },
  { to: '/settings', label: 'Parametres', icon: 'settings', permission: ['settings.ai', 'settings.email', 'settings.integrations', 'automation.manage'], fallbackRoles: ['ADMIN'] },
  { to: '/transition', label: 'Transition SOS', icon: 'swap_horiz', permission: 'glpi.manage', fallbackRoles: ['ADMIN'] },
  { to: '/logs', label: 'Journal activité', icon: 'summarize', permission: null },
];

const ROUTE_SEMANTICS = {
  '/': { zone: 'main', idx: 0 },
  '/tickets': { zone: 'main', idx: 1 },
  '/teams': { zone: 'main', idx: 2 },
  '/inbox': { zone: 'main', idx: 3 },
  '/knowledge-base': { zone: 'main', idx: 4 },
  '/supervision': { zone: 'admin', idx: 0 },
  '/email-drafts': { zone: 'admin', idx: 1 },
  '/skills': { zone: 'admin', idx: 2 },
  '/documentation': { zone: 'admin', idx: 3 },
  '/users': { zone: 'admin', idx: 4 },
  '/permission-groups': { zone: 'admin', idx: 5 },
  '/prompts': { zone: 'admin', idx: 6 },
  '/settings': { zone: 'admin', idx: 7 },
  '/transition': { zone: 'admin', idx: 8 },
  '/logs': { zone: 'admin', idx: 9 },
};

function resolveSemantics(pathname) {
  if (ROUTE_SEMANTICS[pathname]) return ROUTE_SEMANTICS[pathname];
  const match = Object.entries(ROUTE_SEMANTICS)
    .filter(([key]) => key !== '/')
    .sort(([a], [b]) => b.length - a.length)
    .find(([key]) => pathname.startsWith(key));
  return match ? match[1] : null;
}

const pageVariants = {
  enter: ({ dir, axis }) => ({
    [axis]: dir > 0 ? '40%' : dir < 0 ? '-40%' : 0,
    opacity: 0,
  }),
  center: {
    x: 0, y: 0,
    opacity: 1,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
  exit: ({ dir, axis }) => ({
    [axis]: dir > 0 ? '-20%' : dir < 0 ? '20%' : 0,
    opacity: 0,
    transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function MainLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  useVoiceAlerts();
  const { unreadCount } = useNotifications();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    return localStorage.getItem('sidebarPinned') === 'true';
  });
  const [tooltipData, setTooltipData] = useState(null);
  const sidebarRef = useRef(null);
  const userMenuRef = useRef(null);
  const notifBtnRef = useRef(null);

  const toggleNotifications = useCallback(() => {
    setShowNotifications((prev) => !prev);
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setShowAdminMenu(false);
    setShowUserMenu(false);
  }, [location.pathname]);

  function handleLogout() { setShowLogoutConfirm(true); }
  function confirmLogout() { logout(); navigate('/login'); }

  function triggerGlobalSearch() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  }

  const visibleSystemItems = systemItems.filter((item) => {
    if (item.permission === null) return true;
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some((key) => hasPermission(user, key, item.fallbackRoles));
  });

  const hasAdminAccess = visibleSystemItems.length > 0;
  const isInAdminSection = visibleSystemItems.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  );
  const currentAdminItem = visibleSystemItems.find(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  );

  const navigationType = useNavigationType();
  const [direction, setDirection] = useState({ dir: 0, axis: 'y' });
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    if (user) {
      saveSessionLocation(user.id, location.pathname, location.search);
    }
  }, [user, location.pathname, location.search]);

  useEffect(() => {
    const prev = resolveSemantics(prevPathRef.current);
    const curr = resolveSemantics(location.pathname);
    let dir = 0;
    let axis = 'y';
    if (prev && curr) {
      if (prev.zone === curr.zone) {
        axis = 'y';
        dir = navigationType === 'POP' ? (curr.idx < prev.idx ? -1 : 1) : (curr.idx > prev.idx ? 1 : -1);
      } else {
        axis = 'x';
        dir = navigationType === 'POP' ? -1 : 1;
      }
    }
    setDirection({ dir, axis });
    prevPathRef.current = location.pathname;
  }, [location.pathname, navigationType]);

  const isSidebarExpanded = sidebarPinned || sidebarHovered;
  const sidebarW = isSidebarExpanded ? 240 : 64;

  function toggleSidebarPin() {
    setSidebarPinned(prev => {
      const next = !prev;
      localStorage.setItem('sidebarPinned', next);
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>

      <GlobalSearch />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SIDEBAR — Dark, fixed left                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <aside
        ref={sidebarRef}
        className={`app-sidebar ${isSidebarExpanded ? 'expanded' : ''}`}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => { setSidebarHovered(false); setShowAdminMenu(false); }}
      >
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <span className="material-symbols-outlined text-white" style={{ fontSize: '18px' }}>
              smart_toy
            </span>
          </div>
          <span className="sidebar-logo-text">IA HUB</span>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {/* Platform section */}
          <div className="sidebar-group-label">Plateforme</div>
          {platformItems.map((item) => (
            <SidebarItem
              key={item.to}
              item={item}
              user={user}
              isSidebarExpanded={isSidebarExpanded}
            />
          ))}

          <div className="sidebar-separator" />

          {/* Admin section */}
          {hasAdminAccess && (
            <>
              <div className="sidebar-group-label">Administration</div>
              {isSidebarExpanded ? (
                visibleSystemItems.map((item) => (
                  <SidebarItem
                    key={item.to}
                    item={item}
                    user={user}
                    isSidebarExpanded={isSidebarExpanded}
                  />
                ))
              ) : (
                <div className="relative">
                  <button
                    onClick={() => setShowAdminMenu(!showAdminMenu)}
                    className={`sidebar-item ${isInAdminSection ? 'active' : ''}`}
                    style={{ justifyContent: isSidebarExpanded ? undefined : 'center' }}
                  >
                    <span className="sidebar-item-icon">
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                        admin_panel_settings
                      </span>
                    </span>
                    <span className="sidebar-item-label">
                      {currentAdminItem?.label || 'Administration'}
                    </span>
                  </button>
                  {showAdminMenu && (
                    <div className="sidebar-dropdown" style={{ top: 0 }}>
                      {visibleSystemItems.map((item) => {
                        const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={() => setShowAdminMenu(false)}
                            className={`sidebar-dropdown-item ${isActive ? 'active' : ''}`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                              {item.icon}
                            </span>
                            <span>{item.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </nav>

        {/* Pin toggle */}
        <button
          onClick={toggleSidebarPin}
          className="sidebar-pin-btn"
          title={sidebarPinned ? 'Détacher la sidebar' : 'Épingler la sidebar'}
          aria-label={sidebarPinned ? 'Détacher la sidebar' : 'Épingler la sidebar'}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: `'FILL' ${sidebarPinned ? 1 : 0}` }}>
            keep
          </span>
        </button>

        {/* User profile at bottom */}
        <div
          className="sidebar-user"
          onClick={() => setShowUserMenu(!showUserMenu)}
          ref={userMenuRef}
        >
          <div className="sidebar-user-avatar">
            {user?.fullName?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="sidebar-user-info min-w-0">
            <p className="text-xs font-semibold text-white truncate">{user?.fullName}</p>
            <p className="text-[10px] text-slate-400 truncate">{user?.role}</p>
          </div>

          {/* User dropdown */}
          {showUserMenu && (
            <div className="sidebar-dropdown" style={{ bottom: '100%', left: 0, top: 'auto', marginBottom: 8 }}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); handleLogout(); }}
                className="sidebar-dropdown-item"
                style={{ color: '#ef4444' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>logout</span>
                <span>Se deconnecter</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* MAIN CONTENT                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div
        className="flex-1 flex flex-col overflow-hidden transition-all duration-200"
        style={{ marginLeft: sidebarW }}
      >
        {/* Top bar — notifications, theme, global search trigger */}
        <header
          className="h-14 flex items-center justify-between px-6 shrink-0 border-b"
          style={{
            backgroundColor: 'var(--color-surface-container-lowest)',
            borderColor: 'var(--color-outline-variant)',
          }}
        >
          <div />
          <div className="flex items-center gap-2">
            {/* Search trigger */}
            <button
              onClick={triggerGlobalSearch}
              className="flex items-center gap-2 h-8 px-3 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: 'var(--color-surface-container)',
                color: 'var(--color-on-surface-variant)',
                border: '1px solid var(--color-outline-variant)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>search</span>
              <span>Rechercher...</span>
              <kbd className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/10 border border-white/10">Ctrl K</kbd>
            </button>

            {/* Notifications */}
            <div className="relative" ref={notifBtnRef}>
              <button
                onClick={toggleNotifications}
                className="relative w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-black/5"
                title={`Alertes${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '20px',
                    fontVariationSettings: `'FILL' ${unreadCount > 0 ? 1 : 0}`,
                    color: 'var(--color-on-surface-variant)',
                  }}
                >
                  notifications
                </span>
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold text-white"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              <NotificationPanel open={showNotifications} onClose={() => setShowNotifications(false)} />
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-black/5"
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-on-surface-variant)' }}>
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ backgroundColor: 'var(--color-background)' }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={location.pathname}
              custom={direction}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              style={{ willChange: 'transform, opacity', minHeight: '100%' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {user?.mustChangePassword && <ForcePasswordChange />}

      <ConfirmDialog
        open={showLogoutConfirm}
        title="Deconnexion"
        message="Etes-vous sur de vouloir vous deconnecter ?"
        confirmLabel="Se deconnecter"
        cancelLabel="Annuler"
        danger
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <ChatWidget />
    </div>
  );
}

/* ── Sidebar Item ──────────────────────────────────────────────────────────── */
function SidebarItem({ item, user, isSidebarExpanded }) {
  if (item.permission !== null) {
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    if (!keys.some((key) => hasPermission(user, key, item.fallbackRoles))) return null;
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `sidebar-item ${isActive ? 'active' : ''}`
      }
    >
      <span className="sidebar-item-icon">
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
          {item.icon}
        </span>
      </span>
      <span className="sidebar-item-label">{item.label}</span>
    </NavLink>
  );
}
