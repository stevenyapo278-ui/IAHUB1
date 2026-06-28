import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../utils/permissions';
import Skeleton from '../../components/Skeleton';
import AiProvidersTab from './AiProvidersTab';
import EmailAccountsTab from './EmailAccountsTab';
import OtherApisTab from './OtherApisTab';
import AutomationTab from './AutomationTab';
import AdvancedTab from './AdvancedTab';

// Chaque onglet est masqué si l'utilisateur n'a ni la permission dédiée (via son groupe de droits)
// ni un rôle de repli — même règle que la navigation latérale (cf. MainLayout.jsx), pour qu'un
// groupe décochant "Intelligence Artificielle" retire vraiment l'onglet, y compris pour un ADMIN.
const BASE_TABS = [
  { id: 'ai', label: 'Intelligence Artificielle', icon: 'smart_toy', permission: 'settings.ai' },
  { id: 'email', label: 'Email (Outlook / IMAP)', icon: 'mail', permission: 'settings.email' },
  { id: 'other', label: 'Autres intégrations', icon: 'cable', permission: 'settings.integrations' },
  { id: 'automation', label: 'Automatisation', icon: 'sync', permission: 'automation.manage' },
];

export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  // Petit délai pour afficher le skeleton le temps que les tabs chargent leurs données
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const visibleBaseTabs = BASE_TABS.filter((tab) => hasPermission(user, tab.permission, ['ADMIN']));
  // Onglet "Avancé" réservé au SUPERADMIN — masqué pour ADMIN, pas seulement désactivé, car ces
  // réglages (config serveur, auto-envoi IA, fréquences de sync) ont un impact large s'ils sont
  // mal configurés.
  const TABS =
    user?.role === 'SUPERADMIN'
      ? [...visibleBaseTabs, { id: 'advanced', label: 'Avancé', icon: 'tune' }]
      : visibleBaseTabs;
  const TAB_IDS = TABS.map((t) => t.id);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = TAB_IDS.includes(tabParam) ? tabParam : TAB_IDS[0];

  function setActiveTab(id) {
    setSearchParams({ tab: id });
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col xl:flex-row xl:justify-between xl:items-end gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background font-bold">
            Paramètres
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Gérez les intégrations externes, l'automatisation et les fournisseurs d'intelligence artificielle.
          </p>
        </div>
        {loading ? (
          <div className="flex gap-2">
            <Skeleton variant="button" count={4} />
          </div>
        ) : (
          <div className="flex flex-wrap bg-surface-container-lowest p-md rounded-2xl border border-outline-variant/60 card-shadow gap-sm">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-xl border font-body-sm text-body-sm font-semibold transition-all duration-300 flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/5'
                    : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high/60 hover:text-on-surface'
                }`}
              >
                {tab.icon && (
                  <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                )}
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="mt-md">
        {loading ? (
          <Skeleton variant="card" className="h-[400px]" />
        ) : (
          <>
            {activeTab === 'ai' && <AiProvidersTab />}
            {activeTab === 'email' && <EmailAccountsTab />}
            {activeTab === 'other' && <OtherApisTab />}
            {activeTab === 'automation' && <AutomationTab />}
            {activeTab === 'advanced' && user?.role === 'SUPERADMIN' && <AdvancedTab />}
          </>
        )}
      </div>
    </div>
  );
}
