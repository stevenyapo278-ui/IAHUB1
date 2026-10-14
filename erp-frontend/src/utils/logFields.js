// Libellés lisibles des champs suivis dans les journaux de modification de
// ticket (TICKET_UPDATED, corrections de champs, audits) — partagé par
// ActivityStream (fiche ticket), ActivityLogs et AuditLogs.
export const FIELD_LABELS = {
  title: 'Titre', content: 'Description', status: 'Statut', priority: 'Priorité',
  category: 'Catégorie', teamId: 'Équipe', assignedToId: 'Technicien assigné',
  assignees: 'Techniciens assignés', requesterId: 'Demandeur',
  secondaryRequesterId: 'Demandeur secondaire', requesterIds: 'Demandeurs',
  sourceName: 'Nom émetteur', sourceEmail: 'Email émetteur', type: 'Type',
  urgency: 'Urgence', impact: 'Impact', source: 'Source', externalId: 'ID externe',
  approvalStatus: 'Approbation', isMajorIncident: 'Incident majeur',
  dueDate: 'Échéance', locationId: 'Lieu', locationName: 'Nom du lieu',
  observers: 'Observateurs', assets: 'Équipements',
  outlookConversationId: 'Fil de conversation', impactedSites: 'Sites impactés',
};

// Affiche une valeur de payload de façon lisible (booléens, listes, vide)
export function formatLogValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}
