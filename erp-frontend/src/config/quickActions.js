import { Inbox, LayoutDashboard, MailCheck, Plus, Search } from 'lucide-react';
import { hasPermission } from '../utils/permissions';

// Liste des actions du lanceur rapide (rail flottant + menu).
// Filtrées par rôle + permission — un utilisateur ne voit QUE ce qu'il a le droit
// d'ouvrir (mêmes règles que navItems de MainLayout.jsx).
const STAFF = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'];

export const ACTIONS = [
  { id: 'new-ticket', label: 'Nouveau ticket', icon: Plus, to: '/tickets?new=1', roles: STAFF, perm: 'tickets.view' },
  { id: 'inbox', label: 'Boîte de réception', icon: Inbox, to: '/inbox', roles: STAFF, perm: 'inbox.sync' },
  { id: 'validation', label: 'Centre de validation', icon: MailCheck, to: '/email-drafts', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE'], perm: 'emaildrafts.manage' },
  { id: 'search', label: 'Recherche globale', icon: Search, shortcut: 'Ctrl K' }, // aucune route : ouvre la modale
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, to: '/' },
];

export function visibleActions(user) {
  return ACTIONS
    .filter((a) => a.roles === undefined || a.roles.includes(user?.role))
    .filter((a) => !a.perm || hasPermission(user, a.perm));
}
