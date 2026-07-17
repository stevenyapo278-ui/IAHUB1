#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example "$ENV_FILE"
  else
    # Crée un .env minimal avec les valeurs par défaut du développement
    cat > "$ENV_FILE" <<-EOF
# IA Hub — Configuration minimale de développement
POSTGRES_USER=erp_user
POSTGRES_PASSWORD=erp_password
POSTGRES_DB=erp_itsm
DATABASE_URL=postgresql://erp_user:erp_password@localhost:5433/erp_itsm?schema=public
JWT_SECRET=dev_jwt_secret_change_in_production_$(openssl rand -hex 8 2>/dev/null || date +%s)
JWT_EXPIRES_IN=8h
CORS_ORIGIN=*
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:4000
PORT=4000
EOF
  fi
  # Génère un JWT_SECRET aléatoire si le fichier était un .env.example
  if grep -q "^JWT_SECRET=.*changemoi\|^JWT_SECRET=your_jwt_secret_here\|^JWT_SECRET=\$" "$ENV_FILE" 2>/dev/null; then
    JWT_SECRET_VALUE=$(openssl rand -hex 32 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)
    sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET_VALUE}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  fi
  echo "✓ Fichier .env créé avec un JWT_SECRET généré automatiquement."
fi

# Source les variables du .env pour les réutiliser dans le script
set -a && source "$ENV_FILE" && set +a

echo "=== IA Hub — Démarrage ==="
echo ""
echo "1) Démarrer toute la stack Docker (postgres + app + glpi-mcp) avec GLPI local"
echo "2) Démarrer la stack Docker sans GLPI"
echo "3) Démarrer en mode PRODUCTION Docker (postgres + app, optimisé)"
echo "4) Démarrer en mode PRODUCTION Docker avec GLPI local"
echo "5) Démarrer en mode DÉVELOPPEMENT LOCAL (hot reload, npm sur la machine hôte)"
echo ""
read -rp "Choix [1/2/3/4/5] : " choice

# ── Fonction : construction du frontend pour Docker ────────────────────
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

# ── Fonction : attente PostgreSQL ─────────────────────────────────────
wait_for_postgres() {
  local pg_url="${DATABASE_URL%%\?*}"
  echo "→ Attente de PostgreSQL..."
  for i in $(seq 1 30); do
    if PGCONNECT_TIMEOUT=5 psql "$pg_url" -c "SELECT 1" > /dev/null 2>&1; then
      echo "✓ PostgreSQL prêt"
      return 0
    fi
    sleep 1
  done
  echo "ERREUR: PostgreSQL n'a pas démarré dans les 30 secondes."
  echo "  Vérifiez que Docker tourne et que le conteneur postgres est lancé :"
  echo "    docker start ia-hub-postgres"
  echo "  Ou lancez-le : docker compose up -d postgres"
  exit 1
}

# ── Fonction : installation des dépendances npm ───────────────────────
install_deps() {
  echo ""
  echo "→ Installation des dépendances backend..."
  (cd erp-backend && npm ci)
  echo "✓ Dépendances backend installées"

  echo ""
  echo "→ Génération du client Prisma..."
  (cd erp-backend && npx prisma generate)
  echo "✓ Client Prisma généré"

  echo ""
  echo "→ Installation des dépendances frontend..."
  (cd erp-frontend && npm ci)
  echo "✓ Dépendances frontend installées"
}

# ══════════════════════════════════════════════════════════════════════
#  MODE DOCKER — cas 1 à 4
# ══════════════════════════════════════════════════════════════════════
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

  # ════════════════════════════════════════════════════════════════════
  #  MODE 5 : DÉVELOPPEMENT LOCAL — hot reload, npm sur la machine hôte
  # ════════════════════════════════════════════════════════════════════
  5)
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║   MODE DÉVELOPPEMENT LOCAL                                 ║"
    echo "║   • Backend : http://localhost:4000 (nodemon, hot reload)   ║"
    echo "║   • Frontend: http://localhost:5173 (Vite, HMR)             ║"
    echo "║   • PostgreSQL: port 5433 (conteneur Docker dédié)         ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    PROJECT_ROOT=$(pwd)

    # ── Trap pour le Ctrl+C : nettoie les processus enfants ─────────
    BACKEND_PID=""
    FRONTEND_PID=""
    cleanup() {
      echo ""
      echo "→ Arrêt des serveurs..."
      [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null && echo "  ✓ Backend arrêté" || true
      [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && echo "  ✓ Frontend arrêté" || true
      rm -f /tmp/ia-hub-dev/backend.pid /tmp/ia-hub-dev/frontend.pid 2>/dev/null || true
      echo ""
      echo "Pour relancer : ./start.sh"
    }
    trap cleanup EXIT

    # ── Vérifications ──────────────────────────────────────────────
    if ! command -v node &>/dev/null; then
      echo "ERREUR: Node.js est requis. Installez-le via nvm ou votre gestionnaire de paquets."
      exit 1
    fi
    if ! command -v npm &>/dev/null; then
      echo "ERREUR: npm est requis."
      exit 1
    fi
    if ! command -v docker &>/dev/null; then
      echo "ERREUR: Docker est requis pour PostgreSQL."
      exit 1
    fi
    if ! command -v psql &>/dev/null; then
      echo "ERREUR: psql (postgresql-client) est requis."
      echo "  Ubuntu/Debian : sudo apt install postgresql-client"
      echo "  macOS         : brew install libpq"
      exit 1
    fi

    # ── PostgeSQL via Docker (conteneur isolé) ─────────────────────
    echo "→ Démarrage de PostgreSQL (conteneur Docker)..."
    if docker ps --format '{{.Names}}' | grep -q "^ia-hub-postgres$"; then
      echo "✓ PostgreSQL déjà en cours d'exécution"
    else
      docker run -d \
        --name ia-hub-postgres \
        --restart unless-stopped \
        -e POSTGRES_USER="${POSTGRES_USER:-erp_user}" \
        -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-erp_password}" \
        -e POSTGRES_DB="${POSTGRES_DB:-erp_itsm}" \
        -p 5433:5432 \
        -v ia_hub_postgres_data:/var/lib/postgresql/data \
        pgvector/pgvector:pg16 \
        2>/dev/null || {
          # Si le conteneur existe déjà mais est arrêté, on le démarre
          docker start ia-hub-postgres 2>/dev/null || {
            echo "ERREUR: Impossible de démarrer PostgreSQL."
            exit 1
          }
        }
      echo "✓ Conteneur PostgreSQL démarré (port 5433)"
    fi

    # ── Attente que PostgreSQL soit prêt ────────────────────────────
    wait_for_postgres

    # ── Installation des dépendances ────────────────────────────────
    install_deps

    # ── Migration et seed ───────────────────────────────────────────
    echo ""
    echo "→ Migration de la base de données..."
    (cd erp-backend && npx prisma migrate deploy 2>/dev/null || npx prisma migrate dev --skip-seed --name init)
    echo "✓ Base de données migrée"

    echo ""
    echo "→ Seed initial..."
    (cd erp-backend && node prisma/seed.js 2>/dev/null || echo "  (seed déjà appliqué ou non disponible)")
    echo "✓ Seed effectué"

    # ── Fichier PID pour l'arrêt ────────────────────────────────────
    PID_DIR="/tmp/ia-hub-dev"
    mkdir -p "$PID_DIR"

    # ── Démarrage du backend (subshell pour préserver le répertoire) ─
    echo ""
    echo "→ Démarrage du backend (nodemon, port ${PORT:-4000})..."
    cd "$PROJECT_ROOT/erp-backend"
    npm run dev &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$PID_DIR/backend.pid"
    cd "$PROJECT_ROOT"

    # Petit délai le temps que le backend démarre
    sleep 2

    # ── Démarrage du frontend (subshell pour préserver le répertoire) ─
    echo "→ Démarrage du frontend (Vite, port 5173)..."
    cd "$PROJECT_ROOT/erp-frontend"
    npm run dev &
    FRONTEND_PID=$!
    echo "$FRONTEND_PID" > "$PID_DIR/frontend.pid"
    cd "$PROJECT_ROOT"

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║   ✓ MODE DÉVELOPPEMENT DÉMARRÉ                              ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Frontend  : http://localhost:5173                          ║"
    echo "║  Backend   : http://localhost:${PORT:-4000}/api                  ║"
    echo "║  PG Admin  : postgresql://localhost:5433                    ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Identifiants : superadmin@prosuma.ci / 12345678            ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Pour arrêter : ./stop.sh                                   ║"
    echo "║  Pour voir les logs backend : tail -f ne sera pas           ║"
    echo "║  nécessaire car nodemon/Vite écrivent dans le terminal.     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    # Attend que les processus enfants se terminent (Ctrl+C)
    echo "Appuyez sur Ctrl+C pour arrêter les serveurs (ou lancez ./stop.sh dans un autre terminal)."
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    ;;

  *)
    echo "Choix invalide."
    exit 1
    ;;
esac

# ── Affichage des infos pour les modes Docker (1-4) ──────────────────────
if [ "$choice" != "5" ]; then
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
fi
