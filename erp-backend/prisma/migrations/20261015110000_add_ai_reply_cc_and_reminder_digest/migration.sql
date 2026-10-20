-- =============================================================================
-- Copies (CC) des réponses IA + mode récapitulatif (digest) des rappels techniciens
-- =============================================================================
-- Quand un demandeur écrit uniquement à la boîte IA (sans copier les humains ou
-- les listes de diffusion), la réponse de l'IA part vers lui seul. Ces réglages
-- permettent d'ajouter des destinataires en copie sur les emails sortants IA.

-- ── SystemSettings : copies (CC) des réponses IA ─────────────────────────────
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiReplyCcEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiReplyCcEmails" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiReplyCcMode" TEXT NOT NULL DEFAULT 'ALWAYS';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiReplyCcInternalDomains" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiReplyCcIncludeTeamGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiReplyCcOnAcknowledgement" BOOLEAN NOT NULL DEFAULT true;

-- ── SystemSettings : mode d'envoi des rappels techniciens ────────────────────
-- UNITARY = un email par ticket (comportement d'origine)
-- DIGEST  = un seul email récapitulatif par destinataire, tableau de ses tickets
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "techReminderMode" TEXT NOT NULL DEFAULT 'DIGEST';

-- ── Ticket : opt-out par ticket des copies (CC) IA ───────────────────────────
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "skipAiReplyCc" BOOLEAN NOT NULL DEFAULT false;
