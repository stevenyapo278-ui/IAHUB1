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
npx prisma migrate resolve --applied 20260908102000_add_missing_columns 2>/dev/null || true

# Migration login theme : appliquer directement via SQL si la colonne est absente
# (contourne le drift DB où Prisma croit la migration déjà appliquée)
COLONNE=$(PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -t -A -c "SELECT 1 FROM information_schema.columns WHERE table_name='SystemSettings' AND column_name='loginThemeMode'" 2>/dev/null || true)
if [ "$COLONNE" != "1" ]; then
  echo "Colonne loginThemeMode absente — application directe du SQL..."
  set +e
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"SystemSettings\" ADD COLUMN IF NOT EXISTS \"loginThemeMode\" TEXT NOT NULL DEFAULT 'daily_rotation';"
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"SystemSettings\" ADD COLUMN IF NOT EXISTS \"loginThemeFixedVariant\" TEXT NOT NULL DEFAULT 'classic';"
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"SystemSettings\" ADD COLUMN IF NOT EXISTS \"loginThemeEnabledVariants\" TEXT[] NOT NULL DEFAULT ARRAY['classic','split','hero','minimal']::TEXT[];"
  set -e
  # Vérification
  COLONNE_APRES=$(PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -t -A -c "SELECT 1 FROM information_schema.columns WHERE table_name='SystemSettings' AND column_name='loginThemeMode'" 2>/dev/null || true)
  if [ "$COLONNE_APRES" = "1" ]; then
    echo "Colonnes loginTheme ajoutées avec succès."
  else
    echo "ERREUR: les colonnes loginTheme n'ont pas pu être ajoutées!"
  fi
else
  echo "Colonne loginThemeMode déjà présente — rien à faire."
fi

# Colonnes secondaryRequester / location / emailFailureNotificationRecipients
# (contourne le drift DB — ces colonnes peuvent manquer si les migrations n'ont pas été appliquées)
COL_SR=$(PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -t -A -c "SELECT 1 FROM information_schema.columns WHERE table_name='Ticket' AND column_name='secondaryRequesterId'" 2>/dev/null || true)
COL_LOC=$(PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -t -A -c "SELECT 1 FROM information_schema.columns WHERE table_name='Ticket' AND column_name='locationId'" 2>/dev/null || true)
COL_EFR=$(PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -t -A -c "SELECT 1 FROM information_schema.columns WHERE table_name='SystemSettings' AND column_name='emailFailureNotificationRecipients'" 2>/dev/null || true)
if [ "$COL_SR" != "1" ] || [ "$COL_LOC" != "1" ] || [ "$COL_EFR" != "1" ]; then
  echo "Colonnes Ticket/SystemSettings manquantes — application directe du SQL..."
  set +e
  [ "$COL_LOC" != "1" ] && PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"Ticket\" ADD COLUMN IF NOT EXISTS \"locationId\" INTEGER;"
  [ "$COL_LOC" != "1" ] && PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"Ticket\" ADD COLUMN IF NOT EXISTS \"locationName\" TEXT;"
  [ "$COL_SR" != "1" ] && PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"Ticket\" ADD COLUMN IF NOT EXISTS \"secondaryRequesterId\" INTEGER;"
  [ "$COL_SR" != "1" ] && PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "CREATE INDEX IF NOT EXISTS \"Ticket_secondaryRequesterId_idx\" ON \"Ticket\"(\"secondaryRequesterId\");"
  [ "$COL_SR" != "1" ] && PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_secondaryRequesterId_fkey') THEN ALTER TABLE \"Ticket\" ADD CONSTRAINT \"Ticket_secondaryRequesterId_fkey\" FOREIGN KEY (\"secondaryRequesterId\") REFERENCES \"User\"(\"id\") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END \$\$;"
  [ "$COL_EFR" != "1" ] && PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"SystemSettings\" ADD COLUMN IF NOT EXISTS \"emailFailureNotificationRecipients\" TEXT[] DEFAULT ARRAY[]::TEXT[];"
  set -e
  echo "Colonnes Ticket/SystemSettings ajoutées avec succès."
fi

# Colonne requesterIds (tableau de demandeurs)
COL_RIDS=$(PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -t -A -c "SELECT 1 FROM information_schema.columns WHERE table_name='Ticket' AND column_name='requesterIds'" 2>/dev/null || true)
if [ "$COL_RIDS" != "1" ]; then
  echo "Colonne Ticket.requesterIds manquante — application directe du SQL..."
  set +e
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "ALTER TABLE \"Ticket\" ADD COLUMN IF NOT EXISTS \"requesterIds\" INTEGER[] DEFAULT ARRAY[]::INTEGER[];"
  # Backfill depuis requesterId + secondaryRequesterId
  PGCONNECT_TIMEOUT=5 psql "${PG_URL}" -c "UPDATE \"Ticket\" SET \"requesterIds\" = (CASE WHEN \"requesterId\" IS NOT NULL AND \"secondaryRequesterId\" IS NOT NULL THEN ARRAY[\"requesterId\", \"secondaryRequesterId\"] WHEN \"requesterId\" IS NOT NULL THEN ARRAY[\"requesterId\"] ELSE ARRAY[]::INTEGER[] END) WHERE \"requesterId\" IS NOT NULL OR \"secondaryRequesterId\" IS NOT NULL;"
  set -e
  echo "Colonne Ticket.requesterIds ajoutée avec succès."
fi

echo "Migration de la base de données..."
npx prisma migrate deploy || echo "⚠️  migrate deploy a échoué (DB drift ou migration manquante), on continue avec le schéma existant"

echo "Génération du client Prisma..."
npx prisma generate 2>&1 || echo "⚠️  prisma generate a échoué, on utilise le client pré-généré"

echo "Seed initial..."
node prisma/seed.js 2>/dev/null || true

echo "Démarrage du serveur..."
exec node src/server.js
