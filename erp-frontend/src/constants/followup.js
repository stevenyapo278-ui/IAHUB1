// Champs guidés du « Rapport d'intervention » (procédure à suivre après
// chaque intervention) — insérés dans le suivi via FollowupTemplateDialog.
export const REPORT_FIELDS = [
  { key: 'constat', label: 'Constat', placeholder: 'Ex. : Dysfonctionnement de l’équipement signalé.' },
  { key: 'cause', label: 'Cause', placeholder: 'Ex. : Selon le diagnostic, une action humaine a endommagé une pièce.' },
  { key: 'action', label: 'Action', placeholder: 'Ex. : Intervention du prestataire, remplacement de la pièce. Rapport d’intervention en pièce jointe.' },
  { key: 'resultat', label: 'Résultat', placeholder: 'Ex. : Intervention réalisée. Merci de confirmer que l’équipement fonctionne normalement.' },
];
