import {
  Activity, AlertOctagon, AlertTriangle, CheckCircle2, Clock, Hourglass,
  Mail, MessageSquare, Send, Sparkles, UserCheck, Users,
} from 'lucide-react';

// Définition partagée des lignes du « Pouls système » : utilisées par le bouton flottant
// (SystemPulse.jsx) ET par le widget du tableau de bord (PulseStatusWidget.jsx) pour que
// les deux affichent EXACTEMENT la même chose.
//
// Chaque ligne porte :
//   - roles : qui peut la voir (contenu différencié par rôle, comme navItems de MainLayout),
//   - perm  : la permission exigée pour OUVRIR la page liée (un compteur sans droit
//             d'accès ne sert à rien → la ligne disparaît).
// superadmin passe toujours (hasPermission côté utils/permissions.js).

const ALL = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN', 'REQUESTER'];
const STAFF = ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'];
const APPROVERS = ['SUPERADMIN', 'ADMIN', 'HOTLINE'];

export const PULSE_SECTIONS = [
  {
    id: 'tickets',
    title: 'Tickets',
    rows: [
      { key: 'openTickets', label: 'Ouverts', icon: Activity, to: '/tickets', tone: 'blue', roles: ALL, perm: 'tickets.view' },
      { key: 'slaBreached', label: 'SLA dépassés', icon: AlertTriangle, to: '/tickets?slaBreached=true', tone: 'red', roles: STAFF, perm: 'tickets.view' },
      { key: 'unassigned', label: 'Non assignés', icon: Users, to: '/tickets?assignedToId=none', tone: 'amber', roles: APPROVERS, perm: 'tickets.assign' },
      { key: 'myOpenTickets', label: 'Attribués à moi', icon: UserCheck, to: '/tickets?mine=true', tone: 'blue', roles: STAFF, perm: 'tickets.view' },
      // Demandeur : ses compteurs sont scoppés côté serveur (miroir de isRequesterOnly)
      { key: 'approvals', label: 'Mes demandes en attente', icon: Hourglass, to: '/tickets?approvalStatus=PENDING', tone: 'amber', roles: ['REQUESTER'], perm: 'tickets.view' },
    ],
  },
  {
    id: 'validation',
    title: 'File & validations',
    rows: [
      { key: 'approvals', label: 'Approbations en attente', icon: CheckCircle2, to: '/email-drafts?tab=tickets', tone: 'amber', roles: APPROVERS, perm: 'tickets.approve' },
      { key: 'replySuggestions', label: 'Suggestions de réponse', icon: MessageSquare, to: '/email-drafts?tab=replies', tone: 'blue', roles: APPROVERS, perm: 'tickets.approve' },
      { key: 'reminders', label: 'Relances auto', icon: Send, to: '/email-drafts?tab=reminders', tone: 'amber', roles: APPROVERS, perm: 'emaildrafts.manage' },
      { key: 'aiDrafts', label: 'Brouillons IA', icon: Sparkles, to: '/email-drafts?tab=drafts', tone: 'blue', roles: APPROVERS, perm: 'emaildrafts.manage' },
    ],
  },
  {
    id: 'inbox',
    title: 'Boîte de réception',
    rows: [
      { key: 'inboxErrors', label: 'Emails en échec', icon: AlertOctagon, to: '/inbox', tone: 'red', roles: STAFF, perm: 'inbox.sync' },
      { key: 'inboxUnread', label: 'Non lus', icon: Mail, to: '/inbox', tone: 'blue', roles: STAFF, perm: 'inbox.sync' },
      { key: 'inboxProcessing', label: 'En cours d’analyse', icon: Clock, to: '/inbox', tone: 'blue', roles: STAFF, perm: 'inbox.sync' },
    ],
  },
];

// Rouge = à traiter maintenant, ambre = à surveiller (pilote la pastille du bouton rond)
export const PULSE_CRITICAL = ['slaBreached', 'inboxErrors'];
export const PULSE_WARNING = ['approvals', 'reminders', 'aiDrafts', 'replySuggestions', 'unassigned', 'inboxProcessing'];

// Classes de statut PILOTÉES PAR LE THÈME choisi (skin + mode clair/sombre) :
// les tokens texte (tailwind.config.js) pointent vers --skin-* et les fonds teintés
// sont les utilitaires .bg-status-* définis dans index.css (color-mix sur --skin-*).
// Partagé par SystemPulse.jsx et PulseStatusWidget.jsx pour un rendu identique.
export const PULSE_TONE = {
  red: { text: 'text-danger', chip: 'bg-status-danger text-danger' },
  amber: { text: 'text-warning', chip: 'bg-status-warning text-warning' },
  blue: { text: 'text-info', chip: 'bg-status-info text-info' },
  green: { text: 'text-success', chip: 'bg-status-success text-success' },
};

// Pastilles d'état des intégrations (GLPI / Emails / IA / n8n)
export const PULSE_CHIP = {
  ok: PULSE_TONE.green.chip,
  warn: PULSE_TONE.amber.chip,
  ko: PULSE_TONE.red.chip,
};

// Sections visibles pour un utilisateur : rôle + permission, sections vides supprimées.
export function visiblePulseSections(user, hasPermission) {
  return PULSE_SECTIONS
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.roles.includes(user?.role) && hasPermission(user, row.perm)),
    }))
    .filter((section) => section.rows.length > 0);
}

// Agrégat d'alertes pour la pastille du bouton — seuls les compteurs RÉELLEMENT AFFICHÉS
// comptent (sinon un utilisateur verrait une pastille pour une ligne qu'il ne voit pas).
export function pulseAlerts(data, sections) {
  const visible = new Set(sections.flatMap((section) => section.rows.map((row) => row.key)));
  const sum = (keys) => keys.reduce((n, k) => (visible.has(k) ? n + (Number(data?.[k]) || 0) : n), 0);
  return { critical: sum(PULSE_CRITICAL), warning: sum(PULSE_WARNING) };
}
