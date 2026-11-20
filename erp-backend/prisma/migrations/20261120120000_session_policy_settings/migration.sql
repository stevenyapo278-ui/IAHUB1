-- Politique de session configurable depuis Paramètres > Avancé > Sessions.
--
-- Les colonnes sont nullables : NULL signifie « aucune surcharge UI », la valeur
-- est alors lue depuis AUTH_IDLE_TIMEOUT_MINUTES / AUTH_SESSION_MAX_HOURS, puis
-- depuis le défaut codé en dur (480 min / 12 h). 0 = contrôle désactivé.

ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "sessionIdleTimeoutMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "sessionMaxHours" INTEGER;
