// Défauts de visibilité de la barre latérale par rôle — SOURCE UNIQUE DE VÉRITÉ.
// Partagée entre l'onglet Paramètres > Navigation (NavigationTab.jsx) et les filtres
// réels de la sidebar (MainLayout.jsx, CustomizerDrawer.jsx) pour éviter toute dérive :
// ce que l'onglet Navigation affiche par défaut doit être exactement ce que la sidebar
// applique quand aucune entrée navigationConfig n'existe pour un chemin.
//
// Règle : SUPERADMIN voit toujours tout (forcé dans l'UI). Un chemin ABSENT de cette
// table n'a pas de restriction par défaut → visible pour tous les rôles.
const DEFAULT_VISIBILITY = {
  '/':                   ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/portal':             ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/tickets':            ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/problems':           ['HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/email-drafts':       ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/inbox':              ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/knowledge-base':     ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/ticket-evolution':   ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/teams':              ['ADMIN', 'SUPERADMIN'],
  '/users':              ['ADMIN', 'SUPERADMIN'],
  '/technician-stats':   ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/skills':             ['ADMIN', 'SUPERADMIN'],
  '/categories':         ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/locations':          ['HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/assets':             ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/ai-weekly-reports':  ['HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/prompts':            ['ADMIN', 'SUPERADMIN'],
  '/permission-groups':  ['ADMIN', 'SUPERADMIN'],
  '/settings':           ['ADMIN', 'SUPERADMIN'],
  '/documentation':      ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/logs':               ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/audit':              ['ADMIN', 'SUPERADMIN'],
};

export default DEFAULT_VISIBILITY;