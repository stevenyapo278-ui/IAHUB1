// Constantes d'affichage partagées entre les modes de la page /explorer
// (graphe, carte mentale, réseau de neurones) — miroir de NODE_KINDS backend.
import {
  Ticket, MapPin, User, Package, AlertCircle, FolderTree, Users, UserCheck,
  Award, Globe, Flag, Tag, Timer, Link2, Compass, Route, Tags,
} from 'lucide-react';

// Tous les kinds centrables
export const KNOWN_KINDS = [
  'technicien', 'lieu', 'ticket', 'probleme', 'categorie',
  'equipe', 'demandeur', 'skill', 'expediteur', 'origine', 'type',
];
// Seuls technicien × lieu supportent le croisement (épingle) et le sélecteur
export const PAIR_KINDS = ['technicien', 'lieu'];

export const CENTER_TYPE_LABEL = {
  technicien: 'Technicien', lieu: 'Lieu', ticket: 'Ticket', probleme: 'Problème',
  categorie: 'Catégorie', equipe: 'Équipe', demandeur: 'Demandeur', skill: 'Compétence',
  expediteur: 'Expéditeur', origine: 'Origine', type: 'Type',
};

export const CATEGORY_ICONS = {
  tickets: Ticket, lieux: MapPin, techniciens: User, sla: Timer, equipements: Package,
  problemes: AlertCircle, demandeurs: UserCheck, equipe: Users, competences: Award,
  'sous-lieux': FolderTree, liens: Link2, acteurs: Users, contexte: Compass, lies: Link2,
  provenance: Route, membres: Users, hierarchie: FolderTree, domaine: Globe, categories: Tags,
};

export const CATEGORY_LABELS = {
  tickets: 'Tickets ouverts', lieux: 'Lieux', techniciens: 'Techniciens',
  sla: 'SLA dépassé', equipements: 'Équipements',
  problemes: 'Problèmes', demandeurs: 'Demandeurs', equipe: 'Équipe',
  competences: 'Compétences', 'sous-lieux': 'Sous-lieux', liens: 'Liens & problèmes',
  acteurs: 'Acteurs', contexte: 'Contexte', provenance: 'Provenance', lies: 'Liens directs',
  membres: 'Membres', hierarchie: 'Hiérarchie', domaine: 'Mêmes domaines', categories: 'Catégories',
};

export const KIND_ICONS = {
  ticket: Ticket, lieu: MapPin, technicien: User, asset: Package,
  probleme: AlertCircle, categorie: FolderTree, equipe: Users, demandeur: UserCheck,
  skill: Award, expediteur: Globe, origine: Flag, type: Tag,
};

export const KIND_LABELS = {
  ticket: 'Ticket', lieu: 'Lieu', technicien: 'Technicien', asset: 'Équipement',
  probleme: 'Problème', categorie: 'Catégorie', equipe: 'Équipe', demandeur: 'Demandeur',
  skill: 'Compétence', expediteur: 'Expéditeur', origine: 'Origine', type: 'Type',
};

export const STATUS_LABELS = {
  NEW: 'Nouveau', OPEN: 'Ouvert', PLANNED: 'Planifié', PENDING: 'En attente',
  WAITING_FOR_USER: 'Attente client', SOLVED: 'Résolu', CLOSED: 'Fermé',
  IN_PROGRESS: 'En cours', ASSIGNED: 'Assigné', WAITING: 'En attente', OBSERVED: 'Observé',
};

// Modes d'affichage (?mode=graph|mind|neural)
export const MODES = [
  { key: 'graph', label: 'Graphe' },
  { key: 'mind', label: 'Carte mentale' },
  { key: 'neural', label: 'Neurones' },
];
export const KNOWN_MODES = MODES.map((m) => m.key);
