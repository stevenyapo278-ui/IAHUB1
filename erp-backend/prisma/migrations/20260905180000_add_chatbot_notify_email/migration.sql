-- Add chatbotNotifyEmail to SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "chatbotNotifyEmail" TEXT;
