-- Page de connexion configurable par SUPERADMIN (Option 2 : fixe / rotation quotidienne / aléatoire)
ALTER TABLE "SystemSettings" ADD COLUMN "loginThemeMode" TEXT NOT NULL DEFAULT 'daily_rotation';
ALTER TABLE "SystemSettings" ADD COLUMN "loginThemeFixedVariant" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "SystemSettings" ADD COLUMN "loginThemeEnabledVariants" TEXT[] NOT NULL DEFAULT ARRAY['classic','split','hero','minimal']::TEXT[];
