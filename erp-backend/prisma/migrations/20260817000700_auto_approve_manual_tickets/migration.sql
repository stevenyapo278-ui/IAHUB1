-- Auto-approbation des tickets créés manuellement (formulaire interne / portail) :
-- quand activé, ces tickets sont approuvés automatiquement à la création (approvalStatus = APPROVED)
-- sans passer par le Centre de Validation. Les tickets créés par email/IA restent soumis à validation.
ALTER TABLE "SystemSettings" ADD COLUMN "autoApproveManualTickets" BOOLEAN NOT NULL DEFAULT false;
