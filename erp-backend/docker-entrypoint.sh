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

echo "Migration de la base de données..."
npx prisma migrate deploy

echo "Seed initial..."
node prisma/seed.js 2>/dev/null || true

echo "Démarrage du serveur..."
exec node src/server.js
