#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "=== IA Hub — Arrêt de la stack ==="
echo ""

# Arrêter tous les services (GLPI et mode production inclus)
echo "→ Arrêt des conteneurs..."
docker compose -f docker-compose.yml -f docker-compose.glpi.yml down 2>/dev/null \
  || docker compose -f docker-compose.production.yml down 2>/dev/null \
  || docker compose down 2>/dev/null \
  || echo "  Aucun conteneur en cours d'exécution."

echo ""
echo "✓ Stack arrêtée."
echo ""
echo "Pour relancer : ./start.sh"
echo "Pour supprimer les données (irréversible) : docker compose down -v"
