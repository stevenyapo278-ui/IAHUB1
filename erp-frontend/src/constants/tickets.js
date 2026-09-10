import { Flame, AlertTriangle, Info, ArrowDown, Sparkles, Radio, Calendar, Clock, CheckCircle2, User, Globe, Mail, Bot } from 'lucide-react';

export const STATUS_OPTIONS = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'];
export const MANUAL_STATUS_OPTIONS = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED'];
export const STATUS_LABELS = {
  NEW: 'Nouveau',
  OPEN: 'En cours',
  PLANNED: 'Planifié',
  PENDING: 'En attente',
  WAITING_FOR_USER: 'En attente demandeur',
  SOLVED: 'Résolu',
  CLOSED: 'Fermé',
};
export const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
export const TYPE_OPTIONS = [
  { value: 'INCIDENT', label: 'Incident' },
  { value: 'REQUEST', label: 'Demande' },
];
export const SOURCE_OPTIONS = ['Direct', 'Email', 'Formcreator', 'Helpdesk', 'Phone', 'Other'];
export const SOURCE_LABELS = {
  Direct: 'Direct',
  Email: 'Email',
  Formcreator: 'Formcreator',
  Helpdesk: 'Helpdesk',
  Phone: 'Téléphone',
  Other: 'Autre',
};
export const ORIGIN_OPTIONS = ['MANUAL', 'PORTAIL', 'EMAIL', 'CHATBOT'];
export const ORIGIN_CONFIG = {
  MANUAL: { label: 'Manuel', bg: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400 border border-slate-200 dark:border-slate-500/25', Icon: User },
  PORTAIL: { label: 'Portail', bg: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400 border border-teal-200 dark:border-teal-500/25', Icon: Globe },
  EMAIL: { label: 'Email', bg: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25', Icon: Mail },
  CHATBOT: { label: 'Chatbot', bg: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400 border border-violet-200 dark:border-violet-500/25', Icon: Bot },
};
export const URGENCY_IMPACT_OPTIONS = [
  { value: 'VERY_LOW', label: 'Très basse' },
  { value: 'LOW', label: 'Basse' },
  { value: 'MEDIUM', label: 'Moyenne' },
  { value: 'HIGH', label: 'Haute' },
  { value: 'VERY_HIGH', label: 'Très haute' },
  { value: 'MAJOR', label: 'Majeure' },
];

export const PRIORITY_CONFIG = {
  P1: { label: 'P1 - Critique', bg: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border border-red-200 dark:border-red-500/25 font-bold', Icon: Flame },
  P2: { label: 'P2 - Haute', bg: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25 font-bold', Icon: AlertTriangle },
  P3: { label: 'P3 - Moyenne', bg: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/25 font-bold', Icon: Info },
  P4: { label: 'P4 - Basse', bg: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25 font-bold', Icon: ArrowDown },
};

export const STATUS_CONFIG = {
  NEW: { label: 'Nouveau', bg: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25 font-bold', Icon: Sparkles },
  OPEN: { label: 'En cours (Attribué)', bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/25 font-bold', Icon: Radio },
  PLANNED: { label: 'En cours (Planifié)', bg: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border border-purple-200 dark:border-purple-500/25 font-bold', Icon: Calendar },
  PENDING: { label: 'En attente', bg: 'bg-amber-50 text-amber-800 dark:bg-yellow-500/15 dark:text-yellow-400 border border-amber-300 dark:border-yellow-500/25 font-bold', Icon: Clock },
  WAITING_FOR_USER: { label: 'En attente demandeur', bg: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-400 border border-sky-300 dark:border-sky-500/25 font-bold', Icon: Clock },
  SOLVED: { label: 'Résolu', bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25 font-bold', Icon: CheckCircle2 },
  CLOSED: { label: 'Fermé', bg: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400 border border-slate-300 dark:border-slate-500/25 font-bold', Icon: Clock },
};

export function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}
