import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { hasPermission } from '../../utils/permissions';
import AiProvidersTab from './AiProvidersTab';
import EmailAccountsTab from './EmailAccountsTab';
import OtherApisTab from './OtherApisTab';
import AutomationTab from './AutomationTab';
import AdvancedTab from './AdvancedTab';
import TemplatesTab from './TemplatesTab';
import CustomFieldsTab from './CustomFieldsTab';
import { Settings as SettingsIcon, Cpu, Mail, Zap, Globe, Sliders, FileText, ListChecks } from 'lucide-react';

const BASE_TABS = [
  { id: 'ai', label: 'Intelligence Artificielle', desc: 'Fournisseurs, modèles et clés API Gemini', icon: Cpu, permission: 'settings.ai' },
  { id: 'email', label: 'Comptes Emails', desc: 'Outlook, Microsoft 365, IMAP / SMTP', icon: Mail, permission: 'settings.email' },
  { id: 'other', label: 'Autres intégrations', desc: 'GLPI, Supabase et webhooks n8n', icon: Globe, permission: 'settings.integrations' },
  { id: 'automation', label: 'Automatisation', desc: 'Relances, signatures et alertes', icon: Zap, permission: 'automation.manage' },
  { id: 'templates', label: 'Modèles de tickets', desc: 'Modèles réutilisables pour créer des tickets', icon: FileText, permission: 'tickets.assign' },
  { id: 'custom-fields', label: 'Champs personnalisés', desc: 'Champs dynamiques par catégorie (équivalent GLPI Forms)', icon: ListChecks, permission: 'tickets.manage' },
];

export default function Settings() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();

  const visibleBaseTabs = BASE_TABS.filter((tab) => hasPermission(user, tab.permission, ['ADMIN']));
  const TABS =
    user?.role === 'SUPERADMIN'
      ? [...visibleBaseTabs, { id: 'advanced', label: 'Avancé', desc: 'Configuration système & fréquences', icon: Sliders }]
      : visibleBaseTabs;
  const TAB_IDS = TABS.map((t) => t.id);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = TAB_IDS.includes(tabParam) ? tabParam : TAB_IDS[0];

  function setActiveTab(id) {
    setSearchParams({ tab: id });
  }

  const tabVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -12, transition: { duration: 0.15 } },
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top Bar Sticky Header ───────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-amber-500/10 rounded-lg">
            <SettingsIcon className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Paramètres Système</h1>
            <p className="text-[11px] text-on-surface-variant">Configuration globale, automatisations & clés d'intégrations</p>
          </div>
        </div>

        {/* Tab Selector Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-surface-container border border-outline-variant/30 overflow-x-auto no-scrollbar">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const IconComp = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 text-slate-950 shadow-md'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                <IconComp className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Content Area ───────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            variants={tabVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="space-y-6"
          >
            {/* Tab Header Sub-bar */}
            <div className="p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex items-start gap-3">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                {(() => {
                  const ActiveIcon = TABS.find(t => t.id === activeTab)?.icon;
                  return ActiveIcon ? <ActiveIcon className="w-5 h-5" /> : null;
                })()}
              </div>
              <div>
                <h2 className="text-sm font-bold text-on-surface">
                  {TABS.find(t => t.id === activeTab)?.label}
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                  {activeTab === 'ai' && "Configurez les fournisseurs d'IA, leurs modèles, et les clés API associées (rotation de clés, Gemini)."}
                  {activeTab === 'email' && "Configurez les boîtes mail utilisées pour la réception/réponse aux tickets (Outlook / M365, IMAP/SMTP)."}
                  {activeTab === 'other' && "Gérez les autres intégrations externes (Supabase, GLPI) et connectez des webhooks n8n."}
                  {activeTab === 'automation' && "Contrôlez les automatisations IA, accusés de réception, signatures d'email et alertes vocales."}
                  {activeTab === 'templates' && "Créez et gérez des modèles de tickets réutilisables par l'équipe."}
                  {activeTab === 'custom-fields' && "Définissez des champs personnalisés rendus à la création d'un ticket selon la catégorie (équivalent GLPI Forms)."}
                  {activeTab === 'advanced' && "Réglages système avancés réservés au super-administrateur (intervalles de sync, durées de rétention)."}
                </p>
              </div>
            </div>

            {/* Tab Component Content */}
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-6 shadow-sm">
              {activeTab === 'ai' && <AiProvidersTab />}
              {activeTab === 'email' && <EmailAccountsTab />}
              {activeTab === 'other' && <OtherApisTab />}
              {activeTab === 'automation' && <AutomationTab />}
              {activeTab === 'templates' && <TemplatesTab />}
              {activeTab === 'custom-fields' && <CustomFieldsTab />}
              {activeTab === 'advanced' && user?.role === 'SUPERADMIN' && <AdvancedTab />}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
