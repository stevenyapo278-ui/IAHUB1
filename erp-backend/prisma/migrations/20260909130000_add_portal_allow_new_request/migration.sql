-- Réglage d'affichage du portail : masquer/afficher le bouton « Nouvelle demande »
-- (Paramètres > Avancé). true (défaut) = le bouton est visible ; false = soumission
-- désactivée depuis le portail (le suivi des tickets reste disponible).
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "portalAllowNewRequest" BOOLEAN NOT NULL DEFAULT true;
