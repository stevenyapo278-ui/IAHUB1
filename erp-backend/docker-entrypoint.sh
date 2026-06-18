#!/bin/sh
set -e

echo "Attente de PostgreSQL..."
until pg_isready -h postgres -U erp_user -d erp_itsm > /dev/null 2>&1; do
  sleep 2
done
echo "PostgreSQL prêt."

echo "Migration de la base de données..."
npx prisma migrate deploy

echo "Seed initial..."
node prisma/seed.js 2>/dev/null || true

echo "Démarrage du serveur..."
exec node src/server.js
