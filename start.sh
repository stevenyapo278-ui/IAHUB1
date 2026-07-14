#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  # Génère un JWT_SECRET aléatoire pour éviter de garder la valeur placeholder de l'exemple.
  JWT_SECRET_VALUE=$(openssl rand -hex 32 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET_VALUE}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  echo "✓ Fichier .env créé avec un JWT_SECRET généré automatiquement."
fi

echo "=== IA Hub — Démarrage ==="
echo ""
echo "1) Démarrer toute la stack avec un GLPI local (conteneurs glpi + glpi-db)"
echo "2) Démarrer la stack sans GLPI (si vous l'installez vous-même en externe)"
echo "3) Démarrer en mode PRODUCTION (stack minimale, sans GLPI, optimisé Dokploy)"
echo ""
read -rp "Choix [1/2/3] : " choice

case "$choice" in
  1)
    echo ""
    echo "Démarrage avec GLPI local (conteneurs glpi + glpi-db)..."
    docker compose -f docker-compose.yml -f docker-compose.glpi.yml up -d --build
    LAUNCH_LOCAL_GLPI=true
    ;;
  2)
    echo ""
    echo "Démarrage de la stack sans GLPI..."
    docker compose up -d --build
    LAUNCH_LOCAL_GLPI=false
    ;;
  3)
    echo ""
    echo "Démarrage en mode PRODUCTION (stack minimale)..."
    docker compose -f docker-compose.production.yml up -d --build
    LAUNCH_LOCAL_GLPI=false
    ;;
  *)
    echo "Choix invalide."
    exit 1
    ;;
esac

# Charge les ports personnalisés depuis le .env si définis
if [ -f "$ENV_FILE" ]; then
  PORT=$(grep -E "^PORT=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '\r' || true)
  GLPI_PORT=$(grep -E "^GLPI_PORT=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '\r' || true)
  MCP_GLPI_PORT=$(grep -E "^MCP_GLPI_PORT=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '\r' || true)
fi

echo ""
echo "=== Stack démarrée ==="
echo "Dashboard ERP : http://localhost:${PORT:-4000}"

if [ "$LAUNCH_LOCAL_GLPI" = true ]; then
  echo "GLPI          : http://localhost:${GLPI_PORT:-8080}"
  echo "MCP GLPI      : http://localhost:${MCP_GLPI_PORT:-3333}"
  echo ""
  echo "Identifiants par défaut :"
  echo "  Email    : superadmin@prosuma.ci"
  echo "  Password : 12345678"
  echo ""
  echo "GLPI (première installation) :"
  echo "  1. Ouvre http://localhost:${GLPI_PORT:-8080}"
  echo "  2. Suis l'assistant MySQL : host=glpi-db, user=glpi, password=glpi_pass, db=glpi"
  echo "  3. Active l'API REST : Configuration > Générale > API"
  echo "  4. Génére App Token et User Token, puis connecte depuis Paramètres > Autres intégrations"
  echo ""
  echo "Arrêter : docker compose -f docker-compose.yml -f docker-compose.glpi.yml down"
elif [ "$LAUNCH_LOCAL_GLPI" = false ]; then
  echo "MCP GLPI      : http://localhost:${MCP_GLPI_PORT:-3333}" 2>/dev/null || true
  echo ""
  echo "Identifiants par défaut :"
  echo "  Email    : superadmin@prosuma.ci"
  echo "  Password : 12345678"
  echo ""
  echo "Arrêter : docker compose down"
fi
