import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/tickets', label: 'Tickets', icon: 'confirmation_number' },
  { to: '/teams', label: 'Équipes', icon: 'groups' },
  { to: '/inbox', label: 'Boîte mail', icon: 'inbox' },
  { to: '/knowledge-base', label: 'Base de connaissances', icon: 'menu_book' },
  { to: '/users', label: 'Utilisateurs', icon: 'person', adminOnly: true },
  { to: '/permission-groups', label: 'Groupes de droits', icon: 'admin_panel_settings', adminOnly: true },
  { to: '/settings', label: 'Paramètres', icon: 'settings', adminOnly: true },
];

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="fixed left-0 top-0 h-full w-64 bg-surface-container-lowest border-r border-outline-variant flex flex-col z-20 transition-all duration-300">
        <div className="p-lg flex items-center gap-sm">
          <div className="w-10 h-10 rounded-none border border-outline-variant bg-on-surface flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-surface" style={{ fontVariationSettings: "'FILL' 1" }}>
              dashboard
            </span>
          </div>
          <div>
            <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface">ERP ITSM</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Management Console</p>
          </div>
        </div>

        <div className="px-md pb-md">
          <button
            onClick={() => navigate('/tickets?new=1')}
            className="w-full bg-on-surface text-surface py-sm rounded-none font-label-md hover:opacity-80 transition-colors flex items-center justify-center gap-sm"
          >
            <span className="material-symbols-outlined">add</span>
            Nouveau ticket
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto py-sm px-sm space-y-xs">
          {navItems
            .filter((item) => !item.adminOnly || user?.role === 'ADMIN')
            .map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-md px-md py-sm rounded-none font-body-md text-body-md transition-colors duration-200 ${
                      isActive
                        ? 'bg-surface-container-high text-on-surface font-headline-sm text-headline-sm'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`
                  }
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontVariationSettings: `'FILL' ${item.icon === 'dashboard' ? 1 : 0}` }}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
        </ul>

        <div className="p-md border-t border-outline-variant">
          <div className="px-md pb-sm">
            <p className="font-body-md text-body-md text-on-surface font-medium truncate">{user?.fullName}</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-md px-md py-sm rounded-lg text-on-surface-variant font-body-md text-body-md hover:bg-surface-container-high transition-colors duration-200"
          >
            <span className="material-symbols-outlined">logout</span>
            Déconnexion
          </button>
        </div>
      </nav>

      <main className="ml-64 flex-1 h-full overflow-y-auto p-container-margin w-full">
        <Outlet />
      </main>
    </div>
  );
}
