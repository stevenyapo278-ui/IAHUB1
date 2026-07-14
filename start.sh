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
echo "1) Démarrer toute la stack (postgres + app + glpi-mcp) avec GLPI local"
echo "2) Démarrer la stack sans GLPI (si GLPI est installé en externe)"
echo "3) Démarrer en mode PRODUCTION (postgres + app, sans GLPI, optimisé)"
echo "4) Démarrer en mode PRODUCTION avec GLPI local (recommande)"
echo ""
read -rp "Choix [1/2/3/4] : " choice

# ── Construction du frontend pour les modes production ───────────────────
# Le frontend doit être pré-compilé sur l'hôte pour éviter les OOM dans Docker.
build_frontend() {
  if [ ! -f "erp-frontend/dist/index.html" ]; then
    if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
      echo ""
      echo "ERREUR: Node.js et npm sont requis pour compiler le frontend."
      echo "  - Sur le serveur : apt install nodejs npm"
      echo "  - Ou copiez erp-frontend/dist/ depuis une machine avec Node.js"
      exit 1
    fi
    echo ""
    echo "Construction du frontend (hôte) pour la production..."
    (cd erp-frontend && npm ci && VITE_API_URL=/api npm run build)
    echo "✓ Frontend compilé avec succès"
  else
    echo "✓ Frontend déjà compilé"
  fi
}

COMPOSE_FILES=""

case "$choice" in
  1)
    build_frontend
    echo ""
    echo "Démarrage avec GLPI local (conteneurs glpi + glpi-db)..."
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.glpi.yml"
    docker compose $COMPOSE_FILES up -d --build
    LAUNCH_LOCAL_GLPI=true
    ;;
  2)
    build_frontend
    echo ""
    echo "Démarrage de la stack sans GLPI..."
    COMPOSE_FILES="-f docker-compose.yml"
    docker compose $COMPOSE_FILES up -d --build
    LAUNCH_LOCAL_GLPI=false
    ;;
  3)
    build_frontend
    echo ""
    echo "Démarrage en mode PRODUCTION (stack minimale)..."
    COMPOSE_FILES="-f docker-compose.production.yml"
    docker compose $COMPOSE_FILES up -d --build
    LAUNCH_LOCAL_GLPI=false
    ;;
  4)
    build_frontend
    echo ""
    echo "Démarrage en mode PRODUCTION avec GLPI local..."
    COMPOSE_FILES="-f docker-compose.production.yml -f docker-compose.glpi.yml"
    docker compose $COMPOSE_FILES up -d --build
    LAUNCH_LOCAL_GLPI=true
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
  if [ "$choice" = "1" ]; then
    echo "MCP GLPI      : http://localhost:${MCP_GLPI_PORT:-3333}"
  fi
  echo ""
  echo "Identifiants par défaut :"
  echo "  Email    : superadmin@prosuma.ci"
  echo "  Password : 12345678"
  echo ""
  echo "GLPI (première installation) :"
  echo "  1. Ouvre http://localhost:${GLPI_PORT:-8080}"
  echo "  2. L'installation est automatique (env vars chargées depuis le .env)"
  echo "  3. Active l'API REST : Configuration > Générale > API"
  echo "  4. Génére App Token et User Token, puis connecte depuis Paramètres > Autres intégrations"
  echo ""
  echo "Arrêter : docker compose $COMPOSE_FILES down"
elif [ "$LAUNCH_LOCAL_GLPI" = false ]; then
  if [ "$choice" != "3" ]; then
    echo "MCP GLPI      : http://localhost:${MCP_GLPI_PORT:-3333}" 2>/dev/null || true
  fi
  echo ""
  echo "Identifiants par défaut :"
  echo "  Email    : superadmin@prosuma.ci"
  echo "  Password : 12345678"
  echo ""
  echo "Arrêter : docker compose $COMPOSE_FILES down"
fi
