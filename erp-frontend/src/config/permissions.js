// "users.manage" ne contrôle que l'affichage des liens "Utilisateurs"/"Groupes de droits" dans la
// barre latérale (cosmétique) — la vraie protection de ces routes reste le rôle ADMIN/SUPERADMIN
// (authorizeAdmin côté backend, non délégable via groupe). Ne pas s'y fier comme seul rempart.
export const PERMISSION_DEFINITIONS = [
  { key: 'tickets.delete', label: 'Supprimer un ticket' },
  { key: 'tickets.bulkDelete', label: 'Supprimer des tickets en masse' },
  { key: 'tickets.assign', label: 'Assigner un ticket' },
  { key: 'tickets.approve', label: 'Approuver / rejeter un ticket' },
  { key: 'users.manage', label: 'Gérer les utilisateurs (affichage du lien uniquement)' },
  { key: 'teams.manage', label: 'Gérer les équipes' },
  { key: 'settings.ai', label: 'Paramètres : Intelligence Artificielle' },
  { key: 'settings.email', label: 'Paramètres : Email (Outlook / IMAP)' },
  { key: 'settings.integrations', label: 'Paramètres : Autres intégrations' },
  { key: 'knowledge.manage', label: 'Gérer la base de connaissances' },
  { key: 'inbox.sync', label: 'Synchroniser la boîte mail' },
  { key: 'glpi.manage', label: 'Gérer la synchronisation GLPI' },
  { key: 'prompts.manage', label: 'Modifier les prompts IA' },
  { key: 'emaildrafts.manage', label: 'Approuver / rejeter les réponses email IA' },
  { key: 'automation.manage', label: "Gérer l'automatisation (auto-envoi, auto-approbation, synchro GLPI)" },
];
