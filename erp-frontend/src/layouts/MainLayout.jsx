import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hasPermission } from '../utils/permissions';
import ForcePasswordChange from '../components/ForcePasswordChange';
import { useVoiceAlerts } from '../hooks/useVoiceAlerts';
import PageTransition from '../components/PageTransition';

// permission: null = visible à tout utilisateur connecté, quel que soit son rôle/groupe (ex:
// Dashboard, Tickets, Boîte mail — jamais masqué). Sinon, le lien n'apparaît que si
// hasPermission(user, permission, fallbackRoles) est vrai — voir utils/permissions.js.
const navItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true, permission: null },
  { to: '/tickets', label: 'Tickets', icon: 'confirmation_number', permission: null },
  { to: '/teams', label: 'Équipes', icon: 'groups', permission: null },
  { to: '/inbox', label: 'Boîte mail', icon: 'inbox', permission: null },
  { to: '/supervision', label: 'Supervision IA', icon: 'monitor_heart', permission: 'inbox.sync', fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/email-drafts', label: 'Réponses à valider', icon: 'mark_email_unread', permission: 'emaildrafts.manage', fallbackRoles: ['ADMIN', 'TECHNICIAN'] },
  { to: '/knowledge-base', label: 'Base de connaissances', icon: 'menu_book', permission: null },
  { to: '/users', label: 'Utilisateurs', icon: 'person', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/permission-groups', label: 'Groupes de droits', icon: 'admin_panel_settings', permission: 'users.manage', fallbackRoles: ['ADMIN'] },
  { to: '/prompts', label: 'Prompts IA', icon: 'smart_toy', permission: 'prompts.manage', fallbackRoles: ['ADMIN'] },
  { to: '/settings', label: 'Paramètres', icon: 'settings', permission: ['settings.ai', 'settings.email', 'settings.integrations', 'automation.manage'], fallbackRoles: ['ADMIN'] },
];

export default function MainLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  // Tourne en arrière-plan sur toutes les pages (pas seulement le Dashboard) tant qu'un utilisateur
  // est connecté — sinon l'alerte vocale ne se déclencherait que pendant que cette page est ouverte.
  useVoiceAlerts();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const visibleItems = navItems.filter((item) => {
    if (item.permission === null) return true;
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some((key) => hasPermission(user, key, item.fallbackRoles));
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <motion.nav
        initial={{ x: -64, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="fixed left-0 top-0 h-full w-64 glass-panel flex flex-col z-20"
      >
        <div className="p-lg flex items-center gap-sm">
          <motion.div
            initial={{ scale: 0.8, rotate: -5 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.4, type: "spring", bounce: 0.5, delay: 0.1 }}
            className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary to-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-primary/20"
          >
            <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>
              dashboard
            </span>
          </motion.div>
          <div>
            <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface">ERP ITSM</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Management Console</p>
          </div>
        </div>

        <div className="px-md pb-md">
          <motion.button
            whileHover={{ scale: 1.02, translateY: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/tickets?new=1')}
            className="w-full bg-gradient-to-r from-primary to-indigo-600 text-white py-sm rounded-xl font-label-md hover:opacity-90 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all flex items-center justify-center gap-sm"
          >
            <span className="material-symbols-outlined">add</span>
            Nouveau ticket
          </motion.button>
        </div>

        {/* ── Nav links avec indicateur animé ─────────────────────────────── */}
        <ul className="flex-1 overflow-y-auto py-sm px-sm space-y-xs">
          {visibleItems.map((item, index) => (
            <motion.li
              key={item.to}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.15 + index * 0.05 }}
              className="relative"
            >
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative flex items-center gap-md px-md py-sm rounded-xl font-body-md text-body-md transition-all duration-300 ease-out z-10 ${
                    isActive
                      ? 'text-primary font-semibold'
                      : 'text-on-surface-variant hover:text-on-surface hover:translate-x-1'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Pill indicateur glissante */}
                    {isActive && (
                      <motion.span
                        layoutId="nav-active-pill"
                        className="absolute inset-0 bg-primary/10 dark:bg-primary/15 border border-primary/10 dark:border-primary/20 rounded-xl"
                        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                        style={{ zIndex: -1 }}
                      />
                    )}
                    <motion.span
                      className="material-symbols-outlined transition-transform duration-200"
                      animate={isActive ? { scale: 1.1 } : { scale: 1 }}
                      style={{
                        fontVariationSettings: `'FILL' ${isActive ? 1 : 0}`,
                      }}
                    >
                      {item.icon}
                    </motion.span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </motion.li>
          ))}
        </ul>

        {/* ── Footer sidebar ────────────────────────────────────────────────── */}
        <div className="p-md border-t border-outline-variant">
          <div className="px-md pb-sm">
            <p className="font-body-md text-body-md text-on-surface font-medium truncate">{user?.fullName}</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{user?.role}</p>
          </div>

          {/* ── Bouton dark / light mode ── */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            className="w-full flex items-center gap-md px-md py-sm rounded-xl text-on-surface-variant font-body-md text-body-md transition-all duration-300 hover:bg-primary/5 hover:text-primary mb-xs"
          >
            <motion.span
              key={theme}
              initial={{ rotate: -30, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {theme === 'dark' ? 'light_mode' : 'dark_mode'}
            </motion.span>
            {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleLogout}
            className="w-full flex items-center gap-md px-md py-sm rounded-xl text-on-surface-variant font-body-md text-body-md transition-all duration-300 hover:bg-red-500/10 hover:text-red-500"
          >
            <span className="material-symbols-outlined">logout</span>
            Déconnexion
          </motion.button>
        </div>
      </motion.nav>

      {/* ── Contenu principal avec AnimatePresence SPA ───────────────────── */}
      <main className="ml-64 flex-1 h-full overflow-y-auto p-container-margin w-full overflow-x-hidden">
        <AnimatePresence mode="wait">
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </AnimatePresence>
      </main>

      {user?.mustChangePassword && <ForcePasswordChange />}
    </div>
  );
}

