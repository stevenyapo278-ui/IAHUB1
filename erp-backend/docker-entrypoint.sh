#!/bin/sh
set -e

echo "Attente de PostgreSQL..."

# DATABASE_URL contient des paramètres Prisma (?schema=public) que psql ne comprend pas.
# On extrait uniquement la partie URL de base (avant le premier '?').
PG_URL="${DATABASE_URL%%\?*}"

until PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "SELECT 1" > /dev/null 2>&1; do
  sleep 2
done
echo "PostgreSQL prêt."

echo "Résolution des éventuelles migrations en échec..."
npx prisma migrate resolve --rolled-back 20260727000000_add_missing_columns 2>/dev/null || true
npx prisma migrate resolve --rolled-back 20260727000100_add_remaining_missing_columns 2>/dev/null || true
npx prisma migrate resolve --rolled-back 20260820110000_enforce_single_permission_group_per_user 2>/dev/null || true

# Migration login theme : appliquer directement via SQL si la colonne est absente
# (contourne le drift DB où Prisma croit la migration déjà appliquée)
COLONNE=$(PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -t -A -c "SELECT 1 FROM information_schema.columns WHERE table_name='SystemSettings' AND column_name='loginThemeMode'" 2>/dev/null || true)
if [ "$COLONNE" != "1" ]; then
  echo "Colonne loginThemeMode absente — application directe du SQL..."
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "loginThemeMode" TEXT NOT NULL DEFAULT '\''daily_rotation'\'';' 2>/dev/null || true
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "loginThemeFixedVariant" TEXT NOT NULL DEFAULT '\''classic'\'';' 2>/dev/null || true
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "loginThemeEnabledVariants" TEXT[] NOT NULL DEFAULT ARRAY['\''classic'\'','\''split'\'','\''hero'\'','\''minimal'\'']::TEXT[];' 2>/dev/null || true
  echo "Colonnes loginTheme ajoutées."
else
  echo "Colonne loginThemeMode déjà présente — rien à faire."
fi

echo "Migration de la base de données..."
npx prisma migrate deploy || echo "⚠️  migrate deploy a échoué (DB drift ou migration manquante), on continue avec le schéma existant"

echo "Génération du client Prisma..."
npx prisma generate

echo "Seed initial..."
node prisma/seed.js 2>/dev/null || true

echo "Démarrage du serveur..."
exec node src/server.js
