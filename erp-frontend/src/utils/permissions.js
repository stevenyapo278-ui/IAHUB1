// Réplique côté frontend la même règle que requirePermission() (backend) : seul SUPERADMIN passe
// toujours. Pour tous les autres rôles (ADMIN inclus), seules les permissions des groupes de droits
// de l'utilisateur comptent (user.permissions, renvoyé par /auth/login et /auth/me) — un utilisateur
// sans aucun groupe assigné (permissions === null) n'a donc aucune permission au-delà des pages
// toujours visibles (voir navItems de MainLayout.jsx). Le 3e paramètre (ancien fallbackRoles) est
// accepté mais ignoré, pour ne pas avoir à modifier chaque site d'appel existant.
export function hasPermission(user, key) {
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;

  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

// Plafond par RÔLE — miroir du garde-fou serveur forbidTechnicianTicketEdits (ticket.routes.js) :
// un TECHNICIAN (comme un REQUESTER) ne modifie JAMAIS les éléments d'un ticket (titre, contenu,
// statut, priorité, lieu, assignation, approbation, liens, suppression...). Il consulte le ticket
// et ajoute des suivis — rien d'autre. Ce plafond s'applique quel que soit le groupe de droits :
// aucune permission ne peut redonner ce droit à un technicien.
export function canEditTickets(user) {
  if (!user) return false;
  return !['TECHNICIAN', 'REQUESTER'].includes(user.role);
}
