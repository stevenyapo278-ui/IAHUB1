import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  { id: 'ai', label: 'Intelligence Artificielle', desc: 'Fournisseurs, modèles et clés API', icon: 'smart_toy', permission: 'settings.ai' },
  { id: 'email', label: 'Comptes Emails', desc: 'Outlook, Microsoft 365, IMAP / SMTP', icon: 'mail', permission: 'settings.email' },
  { id: 'other', label: 'Autres intégrations', desc: 'GLPI, Supabase et webhooks n8n', icon: 'cable', permission: 'settings.integrations' },
  { id: 'automation', label: 'Automatisation', desc: 'Relances, signatures et alertes', icon: 'sync', permission: 'automation.manage' },
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
      ? [...visibleBaseTabs, { id: 'advanced', label: 'Avancé', desc: 'Configuration système & fréquences', icon: 'tune' }]
      : visibleBaseTabs;
  const TAB_IDS = TABS.map((t) => t.id);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = TAB_IDS.includes(tabParam) ? tabParam : TAB_IDS[0];

  function setActiveTab(id) {
    setSearchParams({ tab: id });
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0 },
  };

  const tabVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 120, damping: 20 } },
    exit: { opacity: 0, y: -16, transition: { duration: 0.15 } },
  };

  return (
    <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.05 } } }} className="p-lg flex flex-col gap-lg">
      <motion.header variants={itemVariants} className="flex flex-col gap-xs pb-sm">
        <h2 className="font-display-lg text-display-lg text-on-background font-bold">
          Paramètres
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">
          Gérez la configuration globale, les canaux de communication et les ressources intelligentes de votre console d'administration.
        </p>
      </motion.header>

      {/* Horizontal Tabs Container */}
      <div className="w-full">
        {loading ? (
          <Skeleton variant="button" className="h-16 w-full" />
        ) : (
          <div className="flex flex-row overflow-x-auto md:overflow-visible bg-surface-container-lowest p-sm rounded-2xl border border-outline-variant/60 card-shadow gap-sm no-scrollbar mb-lg">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <motion.button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className={`flex-1 min-w-[220px] text-left p-4 rounded-xl border transition-all duration-300 flex items-start gap-3 relative ${
                    isActive
                      ? 'border-primary/20 bg-primary/5 text-primary shadow-sm shadow-primary/5'
                      : 'border-transparent text-on-surface-variant hover:bg-surface-container-high/60 hover:text-on-surface'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="settings-active-indicator"
                      className="absolute left-4 right-4 bottom-0 h-[3px] rounded-full bg-primary"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                  {tab.icon && (
                    <span className="material-symbols-outlined text-xl mt-0.5" style={{ fontVariationSettings: `'FILL' ${isActive ? 1 : 0}` }}>{tab.icon}</span>
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="font-body-md text-body-md font-bold leading-tight">{tab.label}</span>
                    <span className="font-body-sm text-[11px] text-on-surface-variant/80 mt-1 leading-tight line-clamp-1">{tab.desc}</span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* Full Width Active Tab Content */}
      <div className="w-full">
        {loading ? (
          <Skeleton variant="card" className="h-[400px]" />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              variants={tabVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow p-lg space-y-lg"
            >
              {/* Active Tab Header Title and Description inside the panel */}
              <div className="border-b border-outline-variant/40 pb-md">
                <div className="flex items-center gap-2 text-primary">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {TABS.find(t => t.id === activeTab)?.icon}
                  </span>
                  <h3 className="font-headline-lg text-headline-lg font-bold text-on-surface">
                    {TABS.find(t => t.id === activeTab)?.label}
                  </h3>
                </div>
                <p className="font-body-md text-body-md text-on-surface-variant mt-2 leading-relaxed">
                  {activeTab === 'ai' && "Configurez les fournisseurs d'IA, leurs modèles, et les clés API associées. Vous pouvez ajouter plusieurs clés pour un même fournisseur ou modèle (rotation, comptes différents) et choisir laquelle est utilisée par défaut."}
                  {activeTab === 'email' && "Configurez les boîtes mail utilisées pour la réception/réponse aux tickets (Outlook / Microsoft 365, Gmail ou IMAP/SMTP générique). Ces informations sont utilisées par le workflow de triage automatique."}
                  {activeTab === 'other' && "Gérez les autres intégrations externes (Supabase, GLPI, etc.) utilisées par l'ERP et connectez des webhooks n8n pour déclencher des automatisations externes."}
                  {activeTab === 'automation' && "Contrôlez les actions que l'intelligence artificielle peut effectuer en autonomie, gérez les accusés de réception, modifiez les signatures d'email et configurez les alertes vocales."}
                  {activeTab === 'advanced' && "Réglages système avancés réservés au super-administrateur. Une mauvaise configuration sur les adresses de serveur ou les intervalles de synchronisation peut impacter le bon fonctionnement de l'application."}
                </p>
              </div>

              {/* Tab component content */}
              <div>
                {activeTab === 'ai' && <AiProvidersTab />}
                {activeTab === 'email' && <EmailAccountsTab />}
                {activeTab === 'other' && <OtherApisTab />}
                {activeTab === 'automation' && <AutomationTab />}
                {activeTab === 'advanced' && user?.role === 'SUPERADMIN' && <AdvancedTab />}
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}
