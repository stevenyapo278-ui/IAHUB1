import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hasPermission } from '../utils/permissions';
import ForcePasswordChange from '../components/ForcePasswordChange';
import { useVoiceAlerts } from '../hooks/useVoiceAlerts';
import ConfirmDialog from '../components/ConfirmDialog';
import GlobalSearch from '../components/GlobalSearch';
import PageTransition from '../components/PageTransition';
import NotificationPanel from '../components/NotificationPanel';
import { useNotifications } from '../context/NotificationContext';

// permission: null = visible à tout utilisateur connecté, quel que soit son rôle/groupe (ex:
// Dashboard, Tickets, Boîte mail — jamais masqué). Sinon, le lien n'apparaît que si
// hasPermission(user, permission, fallbackRoles) est vrai — voir utils/permissions.js.
const platformItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true, permission: null },
  { to: '/tickets', label: 'Tickets', icon: 'confirmation_number', permission: null },
  { to: '/teams', label: 'Équipes', icon: 'groups', permission: null },
  { to: '/inbox', label: 'Boîte mail', icon: 'inbox', permission: null },
  { to: '/knowledge-base', label: 'Base de connaissances', icon: 'menu_book', permission: null },
];

const systemItems = [
  { to: '/supervision', label: 'Supervision IA', icon: 'monitor_heart', permission: 'inbox.sync', fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/email-drafts', label: 'Réponses à valider', icon: 'mark_email_unread', permission: 'emaildrafts.manage', fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/skills', label: 'Compétences', icon: 'psychology', permission: null },
  { to: '/documentation', label: 'Documentation', icon: 'menu_book', permission: null },
  { to: '/users', label: 'Utilisateurs', icon: 'person', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/permission-groups', label: 'Groupes de droits', icon: 'admin_panel_settings', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/prompts', label: 'Prompts IA', icon: 'smart_toy', permission: 'prompts.manage', fallbackRoles: ['ADMIN'] },
  { to: '/settings', label: 'Paramètres', icon: 'settings', permission: ['settings.ai', 'settings.email', 'settings.integrations', 'automation.manage'], fallbackRoles: ['ADMIN'] },
];

const SIDEBAR_EXPANDED_W = 240;
const SIDEBAR_COLLAPSED_W = 64;

function NavItem({ item, collapsed, user }) {
  if (item.permission !== null) {
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    if (!keys.some((key) => hasPermission(user, key, item.fallbackRoles))) return null;
  }

  return (
    <li className="relative group">
      <NavLink
        to={item.to}
        end={item.end}
        aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
        className={({ isActive }) =>
          `relative flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 z-10 ${
            collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
          } ${
            isActive
              ? 'text-[var(--efferd-text)] bg-[var(--efferd-card)] border border-[var(--efferd-border)]'
              : 'text-[var(--efferd-muted)] hover:text-[var(--efferd-text)] hover:bg-[var(--efferd-card)]'
          }`
        }
      >
        {({ isActive }) => (
          <>
            <span
              className="material-symbols-outlined shrink-0 relative z-10"
              style={{
                fontSize: '17px',
                width: '17px',
                height: '17px',
                fontVariationSettings: `'FILL' ${isActive ? 1 : 0}`,
              }}
            >
              {item.icon}
            </span>

            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.span
                  key="label"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="overflow-hidden whitespace-nowrap relative z-10"
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
          </>
        )}
      </NavLink>

      {/* Tooltip en mode collapsed */}
      {collapsed && (
        <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div
            className="text-[13px] font-medium px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap"
            style={{
              backgroundColor: 'var(--efferd-card)',
              border: '1px solid var(--efferd-border)',
              color: 'var(--efferd-text)',
            }}
          >
            {item.label}
          </div>
        </div>
      )}
    </li>
  );
}

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
  const [isMac, setIsMac] = useState(false);
  const adminMenuRef = useRef(null);
  const userMenuRef = useRef(null);
  const notifBtnRef = useRef(null);

  const toggleNotifications = useCallback(() => {
    setShowNotifications((prev) => !prev);
  }, []);

  useEffect(() => {
    try {
      setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    } catch {}
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (adminMenuRef.current && !adminMenuRef.current.contains(event.target)) {
        setShowAdminMenu(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleLogout() { setShowLogoutConfirm(true); }
  function confirmLogout() { logout(); navigate('/login'); }

  function triggerGlobalSearch() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  }

  // Filtrer les onglets système d'administration
  const visibleSystemItems = systemItems.filter((item) => {
    if (item.permission === null) return true;
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some((key) => hasPermission(user, key, item.fallbackRoles));
  });

  const hasAdminAccess = visibleSystemItems.length > 0;

  // Déterminer si on est dans une section admin ET quel item est actif
  const currentAdminItem = visibleSystemItems.find(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  );
  const isInAdminSection = !!currentAdminItem;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'var(--efferd-bg)' }}>

      {/* Recherche globale Cmd+K */}
      <GlobalSearch />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* FLOATING TOP NAVBAR */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <header className="floating-navbar-container">
        <nav className="floating-navbar">
          {/* Logo & Nom */}
          <div className="nav-logo-area">
            <div className="nav-logo-icon">
              <span className="material-symbols-outlined text-white" style={{ fontSize: '15px' }}>
                dashboard
              </span>
            </div>
            <span className="nav-company-name">ERP ITSM</span>
          </div>

          {/* Menu principal centré */}
          <div className="nav-center-menu">
            {platformItems.map((item) => {
              const isActive = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to));
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={`nav-pill-item ${isActive ? 'active' : 'icon-only'}`}
                >
                  <span
                    className="material-symbols-outlined nav-icon"
                    style={{ fontSize: '18px', fontVariationSettings: `'FILL' ${isActive ? 1 : 0}` }}
                  >
                    {item.icon}
                  </span>
                  {isActive && <span>{item.label}</span>}
                  {!isActive && <span className="nav-tooltip">{item.label}</span>}
                </NavLink>
              );
            })}

            {/* Menu Déroulant Administration */}
            {hasAdminAccess && (
              <div className="relative" ref={adminMenuRef}>
                <button
                  onClick={() => setShowAdminMenu(!showAdminMenu)}
                  className={`nav-pill-item ${isInAdminSection || showAdminMenu ? 'active' : 'icon-only'}`}
                  aria-label="Administration"
                >
                  <span
                    className="material-symbols-outlined nav-icon"
                    style={{ fontSize: '18px', fontVariationSettings: `'FILL' ${isInAdminSection ? 1 : 0}` }}
                  >
                    admin_panel_settings
                  </span>
                  {isInAdminSection && <span>{currentAdminItem.label}</span>}
                  {!isInAdminSection && <span className="nav-tooltip">Administration</span>}
                </button>

                {showAdminMenu && (
                  <div className="nav-dropdown-menu" style={{ right: 'auto', left: 0 }}>
                    {visibleSystemItems.map((item) => {
                      const isItemActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={() => setShowAdminMenu(false)}
                          className="nav-dropdown-item"
                          style={{
                            backgroundColor: isItemActive ? 'var(--color-surface-container-high)' : undefined,
                            fontWeight: isItemActive ? 600 : 500,
                          }}
                        >
                          <span
                            className="material-symbols-outlined icon"
                            style={{
                              fontSize: '16px',
                              color: isItemActive ? 'var(--nav-active-bg)' : undefined,
                              fontVariationSettings: `'FILL' ${isItemActive ? 1 : 0}`,
                            }}
                          >
                            {item.icon}
                          </span>
                          <span style={{ color: isItemActive ? 'var(--efferd-text)' : undefined }}>
                            {item.label}
                          </span>
                          {isItemActive && (
                            <span
                              className="ml-auto w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: 'var(--nav-active-bg)' }}
                            />
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Outils à droite */}
          <div className="nav-right-tools">
            {/* Barre de Recherche Épurée */}
            <div className="nav-search-bar" onClick={triggerGlobalSearch} title="Rechercher (Ctrl+K)">
              <svg className="nav-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
              <input type="text" placeholder="Search anything..." readOnly />
              <kbd className="nav-search-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </div>

            {/* Notifications */}
            <div className="relative" ref={notifBtnRef}>
              <button
                onClick={toggleNotifications}
                className="nav-action-btn"
                title={`Alertes${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
                style={{
                  color: showNotifications ? 'var(--efferd-text)' : undefined,
                }}
              >
                <span
                  className="material-symbols-outlined relative"
                  style={{
                    fontSize: '18px',
                    fontVariationSettings: `'FILL' ${unreadCount > 0 ? 1 : 0}`,
                  }}
                >
                  notifications
                </span>

                {/* Badge de notifications non lues */}
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold text-white"
                    style={{
                      backgroundColor: 'var(--nav-active-bg)',
                      boxShadow: '0 0 0 2px var(--color-surface-container-lowest)',
                    }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Panneau de notifications */}
              <NotificationPanel
                open={showNotifications}
                onClose={() => setShowNotifications(false)}
              />
            </div>

            {/* Changement de Thème */}
            <button
              onClick={toggleTheme}
              className="nav-action-btn"
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}>
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>

            {/* Avatar & Menu Profil */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="nav-user-avatar-trigger"
                title={user?.fullName}
              >
                <span className="nav-avatar-initials">
                  {user?.fullName?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </button>

              {showUserMenu && (
                <div className="nav-dropdown-menu">
                  <div className="nav-dropdown-header">
                    <p className="name truncate">{user?.fullName}</p>
                    <p className="role truncate">{user?.role}</p>
                  </div>
                  <NavLink
                    to="/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="nav-dropdown-item"
                  >
                    <span className="material-symbols-outlined icon" style={{ fontSize: '16px' }}>settings</span>
                    <span>Paramètres</span>
                  </NavLink>
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      handleLogout();
                    }}
                    className="nav-dropdown-item danger"
                  >
                    <span className="material-symbols-outlined icon" style={{ fontSize: '16px' }}>logout</span>
                    <span>Se déconnecter</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* ── Contenu principal avec transitions SPA ── */}
      <motion.main
        className="flex-1 h-full overflow-y-auto w-full overflow-x-hidden floating-layout-content"
        style={{ backgroundColor: 'var(--efferd-bg)' }}
      >
        <AnimatePresence initial={false} mode="wait">
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </AnimatePresence>
      </motion.main>

      {user?.mustChangePassword && <ForcePasswordChange />}

      <ConfirmDialog
        open={showLogoutConfirm}
        title="Déconnexion"
        message="Êtes-vous sûr de vouloir vous déconnecter ? Vous devrez vous reconnecter pour accéder à vos tickets et paramètres."
        confirmLabel="Se déconnecter"
        cancelLabel="Annuler"
        danger
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}
