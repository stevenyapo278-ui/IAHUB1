-- Migration: add_technician_reminder_settings
-- Rappels email aux techniciens (Paramètres > Automatisation) : quand un ticket
-- ouvert dépasse un délai configuré (ex. 24 h) sans prise en charge, un email part
-- au technicien assigné — ou aux membres de l'équipe si le ticket n'est pas assigné.

ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "techReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "techReminderDelayHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "techReminderRepeatHours" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "techReminderOnNoActivity" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "techReminderOnUnassigned" BOOLEAN NOT NULL DEFAULT true;
