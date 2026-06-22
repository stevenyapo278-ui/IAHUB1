import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../utils/permissions';
import AiProvidersTab from './AiProvidersTab';
import EmailAccountsTab from './EmailAccountsTab';
import OtherApisTab from './OtherApisTab';
import AutomationTab from './AutomationTab';
import AdvancedTab from './AdvancedTab';

// Chaque onglet est masqué si l'utilisateur n'a ni la permission dédiée (via son groupe de droits)
// ni un rôle de repli — même règle que la navigation latérale (cf. MainLayout.jsx), pour qu'un
// groupe décochant "Intelligence Artificielle" retire vraiment l'onglet, y compris pour un ADMIN.
const BASE_TABS = [
  { id: 'ai', label: 'Intelligence Artificielle', permission: 'settings.ai' },
  { id: 'email', label: 'Email (Outlook / IMAP)', permission: 'settings.email' },
  { id: 'other', label: 'Autres intégrations', permission: 'settings.integrations' },
  { id: 'automation', label: 'Automatisation', permission: 'automation.manage' },
];

export default function Settings() {
  const { user } = useAuth();
  const visibleBaseTabs = BASE_TABS.filter((tab) => hasPermission(user, tab.permission, ['ADMIN']));
  // Onglet "Avancé" réservé au SUPERADMIN — masqué pour ADMIN, pas seulement désactivé, car ces
  // réglages (config serveur, auto-envoi IA, fréquences de sync) ont un impact large s'ils sont
  // mal configurés.
  const TABS = user?.role === 'SUPERADMIN' ? [...visibleBaseTabs, { id: 'advanced', label: 'Avancé' }] : visibleBaseTabs;
  const TAB_IDS = TABS.map((t) => t.id);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = TAB_IDS.includes(tabParam) ? tabParam : TAB_IDS[0];

  function setActiveTab(id) {
    setSearchParams({ tab: id });
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-md">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Paramètres avancés</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-xs">
            Gère les intégrations externes et les fournisseurs d'intelligence artificielle.
          </p>
        </div>
        <div className="flex bg-surface-container-low p-xs rounded-none border border-outline-variant">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-lg py-sm rounded-none font-headline-sm text-headline-sm transition-all ${
                activeTab === tab.id
                  ? 'bg-surface-container-lowest border border-outline-variant text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div>
        {activeTab === 'ai' && <AiProvidersTab />}
        {activeTab === 'email' && <EmailAccountsTab />}
        {activeTab === 'other' && <OtherApisTab />}
        {activeTab === 'automation' && <AutomationTab />}
        {activeTab === 'advanced' && user?.role === 'SUPERADMIN' && <AdvancedTab />}
      </div>
    </div>
  );
}
