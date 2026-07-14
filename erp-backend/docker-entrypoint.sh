#!/bin/sh
set -e

echo "Attente de PostgreSQL..."

# Attente de PostgreSQL : on utilise psql avec l'URL complète plutôt que pg_isready
# qui ne supporte pas bien les connexions via DATABASE_URL (mots de passe complexes,
# ports personnalisés, schémas...).
# La variable PGPASSWORD est automatiquement extraite par psql de l'URL.
until PGCONNECT_TIMEOUT=5 psql "${DATABASE_URL}" -c "SELECT 1" > /dev/null 2>&1; do
  sleep 2
done
echo "PostgreSQL prêt."

echo "Migration de la base de données..."
npx prisma migrate deploy

echo "Seed initial..."
node prisma/seed.js 2>/dev/null || true

echo "Démarrage du serveur..."
exec node src/server.js
