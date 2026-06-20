import { useSearchParams } from 'react-router-dom';
import AiProvidersTab from './AiProvidersTab';
import EmailAccountsTab from './EmailAccountsTab';
import OtherApisTab from './OtherApisTab';
import AutomationTab from './AutomationTab';

const TABS = [
  { id: 'ai', label: 'Intelligence Artificielle' },
  { id: 'email', label: 'Email (Outlook / IMAP)' },
  { id: 'other', label: 'Autres intégrations' },
  { id: 'automation', label: 'Automatisation' },
];

const TAB_IDS = TABS.map((t) => t.id);

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = TAB_IDS.includes(tabParam) ? tabParam : 'ai';

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
      </div>
    </div>
  );
}
