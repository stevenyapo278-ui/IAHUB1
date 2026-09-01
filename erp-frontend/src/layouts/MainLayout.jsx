import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Ticket,
  Users,
  Inbox,
  BookOpen,
  Activity,
  MailCheck,
  BrainCircuit,
  FileText,
  User,
  ShieldCheck,
  Shield,
  Terminal,
  Settings,
  History,
  ShieldAlert,
  LogOut,
  Search,
  Bell,
  Sun,
  Moon,
  Pin,
  Bot,
  Sparkles,
  MapPin,
  Tag,
  Boxes,
  ChevronRight,
  Gauge,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { hasPermission } from '../utils/permissions';
import ForcePasswordChange from '../components/ForcePasswordChange';
import ConfirmDialog from '../components/ConfirmDialog';
import GlobalSearch from '../components/GlobalSearch';
import NotificationPanel from '../components/NotificationPanel';
import { useNotifications } from '../context/NotificationContext';
import { saveSessionLocation } from '../utils/sessionLocation';

// ChatWidget est chargé à la demande : il tire Recharts (~390 Ko) via son graphique,
// on ne l'inclut donc pas dans le bundle initial de l'application.
const ChatWidget = lazy(() => import('../components/ChatWidget'));

const platformItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, color: 'text-amber-400', end: true, permission: null },
  { to: '/portal', label: 'Portail', icon: Ticket, color: 'text-teal-400', permission: null },
  { to: '/tickets', label: 'Tickets', icon: Ticket, color: 'text-gold-400', permission: null },
  { to: '/problems', label: 'Problèmes', icon: AlertTriangle, color: 'text-amber-400', permission: null },
  { to: '/email-drafts', label: 'Centre de Validation', icon: ShieldCheck, color: 'text-amber-400', permission: 'emaildrafts.manage', fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { to: '/inbox', label: 'Boîte mail', icon: Inbox, color: 'text-sky-400', permission: 'inbox.sync', fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { to: '/knowledge-base', label: 'Base de connaissances', icon: BookOpen, color: 'text-purple-400', permission: null },
  { to: '/ticket-evolution', label: 'Évolution tickets', icon: TrendingUp, color: 'text-cyan-400', permission: null, fallbackRoles: ['ADMIN', 'TECHNICIAN', 'HOTLINE'] },
];

const orgItems = [
  { to: '/teams', label: 'Équipes', icon: Users, color: 'text-emerald-400', permission: 'teams.manage', fallbackRoles: ['ADMIN'] },
  { to: '/users', label: 'Utilisateurs', icon: User, color: 'text-emerald-400', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/technician-stats', label: 'Perf. techniciens', icon: Gauge, color: 'text-orange-400', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { to: '/skills', label: 'Compétences', icon: BrainCircuit, color: 'text-teal-400', permission: null, fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/categories', label: 'Catégories', icon: Tag, color: 'text-gold-400', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { to: '/locations', label: 'Lieux', icon: MapPin, color: 'text-amber-400', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE'] },
  { to: '/assets', label: 'Inventaire', icon: Boxes, color: 'text-blue-400', permission: null },
];

const systemItems = [
  { to: '/supervision', label: 'Supervision IA', icon: Activity, color: 'text-indigo-400', permission: 'inbox.sync', fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/ai-weekly-reports', label: 'Apprentissage IA', icon: BrainCircuit, color: 'text-purple-400', permission: null, fallbackRoles: ['ADMIN', 'HOTLINE'] },
  { to: '/prompts', label: 'Prompts IA', icon: Terminal, color: 'text-violet-400', permission: 'prompts.manage', fallbackRoles: ['ADMIN'] },
  { to: '/permission-groups', label: 'Groupes de droits', icon: ShieldCheck, color: 'text-cyan-400', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/settings', label: 'Paramètres', icon: Settings, color: 'text-gray-400', permission: ['settings.ai', 'settings.email', 'settings.integrations', 'automation.manage'], fallbackRoles: ['ADMIN'] },
  { to: '/documentation', label: 'Documentation', icon: FileText, color: 'text-blue-400', permission: null },
  { to: '/logs', label: 'Journal activité', icon: History, color: 'text-rose-400', permission: null, roles: ['ADMIN', 'SUPERADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { to: '/audit', label: 'Audit système', icon: Shield, color: 'text-amber-400', permission: null, fallbackRoles: ['ADMIN'] },
];

const ROUTE_SEMANTICS = {
  '/': { zone: 'main', idx: 0 },
  '/portal': { zone: 'main', idx: 1 },
  '/tickets': { zone: 'main', idx: 1 },
  '/problems': { zone: 'main', idx: 2 },
  '/email-drafts': { zone: 'main', idx: 3 },
  '/inbox': { zone: 'main', idx: 4 },
  '/knowledge-base': { zone: 'main', idx: 5 },
  '/teams': { zone: 'org', idx: 0 },
  '/users': { zone: 'org', idx: 1 },
  '/technician-stats': { zone: 'org', idx: 2 },
  '/skills': { zone: 'org', idx: 3 },
  '/categories': { zone: 'org', idx: 4 },
  '/locations': { zone: 'org', idx: 5 },
  '/assets': { zone: 'org', idx: 6 },
  '/supervision': { zone: 'admin', idx: 0 },
  '/ai-weekly-reports': { zone: 'admin', idx: 1 },
  '/prompts': { zone: 'admin', idx: 2 },
  '/permission-groups': { zone: 'admin', idx: 3 },
  '/settings': { zone: 'admin', idx: 4 },
  '/documentation': { zone: 'admin', idx: 5 },
  '/logs': { zone: 'admin', idx: 6 },
  '/audit': { zone: 'admin', idx: 7 },
};

function resolveSemantics(pathname) {
  if (ROUTE_SEMANTICS[pathname]) return ROUTE_SEMANTICS[pathname];
  const match = Object.entries(ROUTE_SEMANTICS)
    .filter(([key]) => key !== '/')
    .sort(([a], [b]) => b.length - a.length)
    .find(([key]) => pathname.startsWith(key));
  return match ? match[1] : null;
}

const ZONE_ORDER = ['main', 'org', 'admin'];

function getPageBreadcrumb(pathname) {
  const allItems = [...platformItems, ...orgItems, ...systemItems];
  const item = allItems.find((i) => i.to === pathname || (i.to !== '/' && pathname.startsWith(i.to)));
  if (!item) {
    if (pathname.startsWith('/tickets/')) {
      return { section: 'Plateforme', label: 'Détail Ticket', icon: Ticket, color: 'text-amber-400' };
    }
    return { section: 'IA Hub', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-400' };
  }
  let section = 'Plateforme';
  if (orgItems.some((i) => i.to === item.to)) section = 'Organisation';
  if (systemItems.some((i) => i.to === item.to)) section = 'Administration';
  return { section, label: item.label, icon: item.icon, color: item.color };
}

const pageVariants = {
  initial: ({ direction: dir, axis }) => ({
    [axis]: dir > 0 ? '40%' : dir < 0 ? '-40%' : 0,
    opacity: 0,
  }),
  animate: {
    x: 0,
    y: 0,
    opacity: 1,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
  },
  exit: ({ direction: dir, axis }) => ({
    [axis]: dir > 0 ? '-20%' : dir < 0 ? '20%' : 0,
    opacity: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function MainLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const { unreadCount } = useNotifications();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    return localStorage.getItem('sidebarPinned') === 'true';
  });
  const [badgeCounts, setBadgeCounts] = useState({ tickets: 0, drafts: 0 });
  const sidebarRef = useRef(null);
  const userMenuRef = useRef(null);
  const notifBtnRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    function fetchSidebarBadges() {
      Promise.all([
        api.get('/tickets?status=OPEN&limit=1').catch(() => null),
        api.get('/dashboard/pending-ai-drafts').catch(() => null),
      ]).then(([ticketsRes, draftsRes]) => {
        setBadgeCounts({
          tickets: ticketsRes?.data?.total || 0,
          drafts: Array.isArray(draftsRes?.data) ? draftsRes.data.length : 0,
        });
      });
    }
    fetchSidebarBadges();
    const interval = setInterval(fetchSidebarBadges, 30000);
    return () => clearInterval(interval);
  }, [user]);

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

  const filterItems = (items) => items.filter((item) => {
    // Restriction par rôle explicite (roles) ou fallbackRoles — SUPERADMIN voit tout
    if (item.permission === null && (item.roles || item.fallbackRoles)) {
      if (user && user.role === 'SUPERADMIN') return true;
      const allowed = item.roles || item.fallbackRoles;
      return allowed.includes(user?.role);
    }
    if (item.permission === null) return true;
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some((key) => hasPermission(user, key, item.fallbackRoles));
  });

  const visibleOrgItems = filterItems(orgItems);
  const visibleSystemItems = filterItems(systemItems);

  const hasAdminAccess = visibleSystemItems.length > 0;
  const allSecondaryItems = [...visibleOrgItems, ...visibleSystemItems];
  const isInSecondarySection = allSecondaryItems.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  );
  const currentSecondaryItem = allSecondaryItems.find(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  );

  const navigationType = useNavigationType();
  const [transition, setTransition] = useState({ direction: 1, axis: 'y' });
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    if (user) {
      saveSessionLocation(user.id, location.pathname, location.search);
    }
  }, [user, location.pathname, location.search]);

  useEffect(() => {
    const prev = resolveSemantics(prevPathRef.current);
    const curr = resolveSemantics(location.pathname);
    let dir = 1;
    let axis = 'y';
    if (prev && curr) {
      if (prev.zone === curr.zone) {
        axis = 'y';
        dir = navigationType === 'POP' ? (curr.idx < prev.idx ? -1 : 1) : (curr.idx > prev.idx ? 1 : -1);
      } else {
        axis = 'x';
        const prevZoneIdx = ZONE_ORDER.indexOf(prev.zone);
        const currZoneIdx = ZONE_ORDER.indexOf(curr.zone);
        dir = navigationType === 'POP' ? (currZoneIdx < prevZoneIdx ? -1 : 1) : (currZoneIdx > prevZoneIdx ? 1 : -1);
      }
    } else {
      dir = 1;
    }
    setTransition({ direction: dir, axis });
    prevPathRef.current = location.pathname;
  }, [location.pathname, navigationType]);

  const isSidebarExpanded = sidebarPinned || sidebarHovered;
  const sidebarW = isSidebarExpanded ? 240 : 64;

  function toggleSidebarPin() {
    setSidebarPinned((prev) => {
      const next = !prev;
      localStorage.setItem('sidebarPinned', next);
      return next;
    });
  }

  const currentPage = getPageBreadcrumb(location.pathname);
  const PageIcon = currentPage.icon;

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
      <GlobalSearch />

      {/* SIDEBAR */}
      <aside
        ref={sidebarRef}
        className={`app-sidebar ${isSidebarExpanded ? 'expanded' : ''}`}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => { setSidebarHovered(false); setShowAdminMenu(false); }}
      >
        {/* Logo */}
        <div className="sidebar-logo flex items-center gap-3">
          <div className="sidebar-logo-icon">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <span className="sidebar-logo-text">
            IA Hub
          </span>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <div className="sidebar-group-label">Plateforme</div>
          {platformItems.map((item) => {
            const count = item.to === '/tickets' ? badgeCounts.tickets : item.to === '/email-drafts' ? badgeCounts.drafts : 0;
            return (
              <SidebarItem
                key={item.to}
                item={item}
                user={user}
                isSidebarExpanded={isSidebarExpanded}
                count={count}
              />
            );
          })}

          {(visibleOrgItems.length > 0 || visibleSystemItems.length > 0) && (
            <div className="sidebar-separator" />
          )}

          {visibleOrgItems.length > 0 && (
            <>
              <div className="sidebar-group-label">Organisation</div>
              {isSidebarExpanded ? (
                visibleOrgItems.map((item) => (
                  <SidebarItem key={item.to} item={item} user={user} isSidebarExpanded={isSidebarExpanded} />
                ))
              ) : (
                <CompactSectionButton
                  items={visibleOrgItems}
                  isActive={isInSecondarySection}
                  currentItem={currentSecondaryItem}
                  label="Organisation"
                  icon={Users}
                  expanded={showAdminMenu}
                  onToggle={() => setShowAdminMenu(!showAdminMenu)}
                  onClose={() => setShowAdminMenu(false)}
                />
              )}
            </>
          )}

          {visibleSystemItems.length > 0 && (
            <>
              <div className="sidebar-group-label">Administration</div>
              {isSidebarExpanded ? (
                visibleSystemItems.map((item) => (
                  <SidebarItem key={item.to} item={item} user={user} isSidebarExpanded={isSidebarExpanded} />
                ))
              ) : (
                <CompactSectionButton
                  items={visibleSystemItems}
                  isActive={isInSecondarySection}
                  currentItem={currentSecondaryItem}
                  label="Administration"
                  icon={ShieldAlert}
                  expanded={showAdminMenu}
                  onToggle={() => setShowAdminMenu(!showAdminMenu)}
                  onClose={() => setShowAdminMenu(false)}
                />
              )}
            </>
          )}
        </nav>

        {/* Pin toggle */}
        <button
          onClick={toggleSidebarPin}
          className="sidebar-pin-btn hover:text-indigo-400 transition-colors"
          title={sidebarPinned ? 'Détacher la sidebar' : 'Épingler la sidebar'}
        >
          <Pin className={`w-4 h-4 transition-transform ${sidebarPinned ? 'rotate-45 text-indigo-400' : ''}`} />
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
            <p className="text-xs font-medium text-white/80 truncate">{user?.fullName}</p>
            <p className="text-[10px] text-white/30 truncate capitalize">{user?.role?.toLowerCase()}</p>
          </div>

          {showUserMenu && (
            <div className="sidebar-dropdown" style={{ bottom: '100%', left: 0, top: 'auto', marginBottom: 8 }}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); handleLogout(); }}
                className="sidebar-dropdown-item text-red-400/80 hover:text-red-400 flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Déconnexion</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div
        className="flex-1 flex flex-col overflow-hidden transition-all duration-200"
        style={{ marginLeft: sidebarW }}
      >
        <header
          className="h-14 flex items-center justify-between px-6 shrink-0 border-b backdrop-blur-md sticky top-0 z-30 transition-all duration-200"
          style={{
            backgroundColor: 'var(--color-surface-container-lowest)',
            borderColor: 'var(--color-outline-variant)',
          }}
        >
          {/* Dynamic Breadcrumb Header */}
          <div className="flex items-center gap-2 text-xs font-medium min-w-0">
            <span className="text-slate-400 font-normal hidden sm:inline-block">
              {currentPage.section}
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0 hidden sm:inline-block" />
            <div className="flex items-center gap-2 truncate">
              {PageIcon && <PageIcon className={`w-4 h-4 shrink-0 ${currentPage.color || 'text-indigo-400'}`} />}
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm tracking-tight truncate">
                {currentPage.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search trigger */}
            <button
              onClick={triggerGlobalSearch}
              className="flex items-center gap-2 h-9 px-3.5 rounded-xl text-xs font-medium transition-all hover:border-indigo-500/50 hover:shadow-sm group"
              style={{
                backgroundColor: 'var(--color-surface-container)',
                color: 'var(--color-on-surface-variant)',
                border: '1px solid var(--color-outline-variant)',
              }}
            >
              <Search className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-indigo-400 transition-colors" />
              <span className="hidden md:inline">Rechercher dans l'IA Hub...</span>
              <span className="md:hidden">Rechercher...</span>
              <kbd className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/60 font-mono font-semibold opacity-75 group-hover:opacity-100">
                Ctrl K
              </kbd>
            </button>

            {/* Notifications */}
            <div className="relative" ref={notifBtnRef}>
              <button
                onClick={toggleNotifications}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-surface-container-high hover:border-indigo-500/40 border border-outline-variant/60 group"
                title={`Alertes${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
              >
                <Bell className="w-4 h-4 text-on-surface-variant group-hover:text-indigo-400 transition-colors" />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[9.5px] font-bold text-white shadow-md animate-pulse"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              <NotificationPanel open={showNotifications} onClose={() => setShowNotifications(false)} />
            </div>

            {/* Theme toggle — Soleil ↔ Lune avec rotation premium */}
            <button
              onClick={toggleTheme}
              className="theme-toggle-btn w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-surface-container-high hover:border-indigo-500/40 border border-outline-variant/60 active:scale-90"
              title={theme === 'dark' ? 'Basculer en Mode clair' : 'Basculer en Mode sombre'}
              aria-label={theme === 'dark' ? 'Basculer en Mode clair' : 'Basculer en Mode sombre'}
            >
              <span className={`theme-toggle-icon ${theme === 'dark' ? 'active' : ''}`} aria-hidden="true">
                <Sun className="w-4 h-4 text-amber-400" />
              </span>
              <span className={`theme-toggle-icon ${theme !== 'dark' ? 'active' : ''}`} aria-hidden="true">
                <Moon className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />
              </span>
            </button>
          </div>
        </header>

        <main
          className="flex-1 min-w-0 relative bg-inherit overflow-y-auto overflow-x-hidden"
          style={{ backgroundColor: 'var(--color-background)' }}
        >
          <Outlet />
        </main>
      </div>

      {user?.mustChangePassword && <ForcePasswordChange />}

      <ConfirmDialog
        open={showLogoutConfirm}
        title="Déconnexion"
        message="Êtes-vous sûr de vouloir vous déconnecter ?"
        confirmLabel="Se déconnecter"
        cancelLabel="Annuler"
        danger
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <Suspense fallback={null}>
        <ChatWidget />
      </Suspense>
    </div>
  );
}

function CompactSectionButton({ items, isActive, currentItem, label, icon: Icon, expanded, onToggle, onClose }) {
  const location = useLocation();
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`sidebar-item ${isActive ? 'active' : ''}`}
        style={{ justifyContent: 'center' }}
      >
        <span className="sidebar-item-icon">
          <Icon className="w-[18px] h-[18px] text-white/50" />
        </span>
        <span className="sidebar-item-label">
          {currentItem?.label || label}
        </span>
      </button>
      {expanded && (
        <div className="sidebar-dropdown" style={{ top: 0 }}>
          {items.map((item) => {
            const isItemActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
            const ItemIcon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                viewTransition
                onClick={onClose}
                className={`sidebar-dropdown-item flex items-center gap-2 ${isItemActive ? 'active' : ''}`}
              >
                <ItemIcon className="w-4 h-4" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SidebarItem({ item, user, isSidebarExpanded, count }) {
  if (item.permission !== null) {
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    if (!keys.some((key) => hasPermission(user, key, item.fallbackRoles))) return null;
  }

  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      viewTransition
      className={({ isActive }) =>
        `sidebar-item ${isActive ? 'active' : ''}`
      }
    >
      <span className="sidebar-item-icon relative">
        <Icon className="w-[18px] h-[18px] text-white/50" style={item.active ? {} : {}} />
        {!isSidebarExpanded && count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
        )}
      </span>
      <span className="sidebar-item-label flex-1 truncate">{item.label}</span>
      {isSidebarExpanded && count > 0 && (
        <span className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 shrink-0">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  );
}
