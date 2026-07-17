#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "=== IA Hub — Arrêt ==="
echo ""

# ── Vérifier si le mode développement local tourne ──────────────────────
PID_DIR="/tmp/ia-hub-dev"
if [ -f "$PID_DIR/backend.pid" ] || [ -f "$PID_DIR/frontend.pid" ]; then
  echo "→ Arrêt des processus de développement local..."

  if [ -f "$PID_DIR/backend.pid" ]; then
    BACKEND_PID=$(cat "$PID_DIR/backend.pid")
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill "$BACKEND_PID" 2>/dev/null && echo "  ✓ Backend (PID $BACKEND_PID) arrêté"
    else
      echo "  - Backend déjà arrêté"
    fi
    rm -f "$PID_DIR/backend.pid"
  fi

  if [ -f "$PID_DIR/frontend.pid" ]; then
    FRONTEND_PID=$(cat "$PID_DIR/frontend.pid")
    if kill -0 "$FRONTEND_PID" 2>/dev/null; then
      kill "$FRONTEND_PID" 2>/dev/null && echo "  ✓ Frontend (PID $FRONTEND_PID) arrêté"
    else
      echo "  - Frontend déjà arrêté"
    fi
    rm -f "$PID_DIR/frontend.pid"
  fi

  # Tue aussi les processus node restants éventuels (nodemon, vite)
  pkill -f "nodemon src/server.js" 2>/dev/null || true
  pkill -f "vite" 2>/dev/null || true

  # Nettoie le dossier PID si vide
  rmdir "$PID_DIR" 2>/dev/null || true

  # Demander si on arrête aussi PostgreSQL
  echo ""
  if docker ps --format '{{.Names}}' | grep -q "^ia-hub-postgres$"; then
    read -rp "Arrêter le conteneur PostgreSQL ia-hub-postgres ? [y/N] : " stop_pg
    if [ "$stop_pg" = "y" ] || [ "$stop_pg" = "Y" ]; then
      docker stop ia-hub-postgres 2>/dev/null && echo "✓ PostgreSQL arrêté" || true
      read -rp "Supprimer également le volume de données PostgreSQL ? (irréversible) [y/N] : " rm_vol
      if [ "$rm_vol" = "y" ] || [ "$rm_vol" = "Y" ]; then
        docker rm -v ia-hub-postgres 2>/dev/null && echo "✓ Conteneur PostgreSQL supprimé avec son volume" || true
      fi
    else
      echo "  - PostgreSQL laissé en cours d'exécution"
      echo "  Pour l'arrêter plus tard : docker stop ia-hub-postgres"
    fi
  fi

  echo ""
  echo "✓ Développement local arrêté."
  exit 0
fi

# ── Arrêt des stacks Docker (modes production) ──────────────────────────
echo "→ Arrêt des conteneurs Docker..."
docker compose -f docker-compose.yml -f docker-compose.glpi.yml down 2>/dev/null \
  || docker compose -f docker-compose.production.yml down 2>/dev/null \
  || docker compose -f docker-compose.yml down 2>/dev/null \
  || docker compose down 2>/dev/null \
  || echo "  Aucun conteneur Docker en cours d'exécution."

echo ""
echo "✓ Stack arrêtée."
echo ""
echo "Pour relancer : ./start.sh"
echo "Pour supprimer les données (irréversible) : docker compose down -v"
