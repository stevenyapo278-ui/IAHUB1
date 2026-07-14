#!/usr/bin/env bash
# =============================================================================
# IA Hub — Cleanup complet
# Arrête et supprime tous les conteneurs, volumes et données liés au projet.
# Utilisation : ./cleanup.sh
# =============================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   IA Hub — Nettoyage complet${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# ── 1. Vérification ──────────────────────────────────────────────────────
echo -e "${YELLOW}Attention : Ce script va supprimer des données !${NC}"
echo ""
read -rp "Veux-tu continuer ? (y/N) : " confirm
if [[ ! "$confirm" =~ ^[YyOo]$ ]]; then
  echo "Abandon."
  exit 0
fi

# ── 2. Arrêt des conteneurs Docker ───────────────────────────────────────
echo ""
echo -e "${CYAN}[1/5] Arrêt des conteneurs en cours...${NC}"

# Arrêt via docker-compose (propre) — inclure l'override GLPI pour cibler les bons services
echo "  → Arrêt stack complète + GLPI..."
docker compose -f docker-compose.yml -f docker-compose.glpi.yml down --remove-orphans 2>/dev/null || true
echo "  → Arrêt stack production + GLPI..."
docker compose -f docker-compose.production.yml -f docker-compose.glpi.yml down --remove-orphans 2>/dev/null || true

# Arrêt manuel des conteneurs GLPI (au cas où ils tournent encore)
for container in ia-hub-glpi ia-hub-glpi-db ia-hub-glpi-mcp ia-hub-app ia-hub-postgres; do
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
    echo "  → Suppression du conteneur ${container}..."
    docker rm -f "${container}" 2>/dev/null || true
  fi
done

echo -e "  ${GREEN}✓ Conteneurs arrêtés et supprimés${NC}"

# ── 3. Suppression des volumes Docker ────────────────────────────────────
echo ""
echo -e "${CYAN}[2/5] Volumes Docker...${NC}"
echo -e "${YELLOW}  Attention : Les données PostgreSQL (comptes, tickets) seront perdues !${NC}"
read -rp "  Supprimer les volumes Docker aussi ? (y/N) : " del_volumes
if [[ "$del_volumes" =~ ^[YyOo]$ ]]; then
  echo "  → Suppression des volumes..."

  # Volumes nommés du projet
  for vol in $(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E '^(ia-hub|postgres_data|app_uploads|glpi_)' || true); do
    echo "    → Volume : ${vol}"
    docker volume rm "${vol}" 2>/dev/null || true
  done

  # Suppression des volumes orphelins (non liés à un conteneur)
  docker volume prune -f 2>/dev/null || true

  echo -e "  ${GREEN}✓ Volumes supprimés${NC}"
else
  echo -e "  ${YELLOW}⚠ Volumes conservés${NC}"
fi

# ── 4. Nettoyage des dossiers storage/ ───────────────────────────────────
echo ""
echo -e "${CYAN}[3/5] Dossiers storage/...${NC}"
echo -e "${YELLOW}  Attention : Les données GLPI (fichiers, base MySQL locale) seront perdues !${NC}"
read -rp "  Supprimer les dossiers storage/ (glpi + mysql) ? (y/N) : " del_storage
if [[ "$del_storage" =~ ^[YyOo]$ ]]; then
  echo "  → Suppression de storage/glpi..."
  rm -rf storage/glpi 2>/dev/null || true
  echo "  → Suppression de storage/mysql..."
  rm -rf storage/mysql 2>/dev/null || true
  echo "  → Création des dossiers vides..."
  mkdir -p storage/glpi storage/mysql
  echo -e "  ${GREEN}✓ Dossiers storage/ nettoyés${NC}"
else
  echo -e "  ${YELLOW}⚠ Dossiers storage/ conservés${NC}"
fi

# ── 5. Nettoyage des images Docker obsolètes ─────────────────────────────
echo ""
echo -e "${CYAN}[4/5] Images Docker obsolètes...${NC}"
read -rp "  Supprimer les anciennes images GLPI (diouxx/glpi) ? (y/N) : " del_images
if [[ "$del_images" =~ ^[YyOo]$ ]]; then
  echo "  → Suppression de l'image diouxx/glpi..."
  docker rmi diouxx/glpi:latest 2>/dev/null || echo "    (déjà supprimée)"
  echo -e "  ${GREEN}✓ Anciennes images supprimées${NC}"
else
  echo -e "  ${YELLOW}⚠ Anciennes images conservées${NC}"
fi

# ── 6. Vérification port 80 ─────────────────────────────────────────────
echo ""
echo -e "${CYAN}[5/5] Vérification du port 80...${NC}"
if ss -tlnp 'sport = :80' 2>/dev/null | grep -q LISTEN; then
  echo -e "  ${RED}⚠ Port 80 déjà utilisé !${NC}"
  echo "  Un autre service écoute sur le port 80."
  echo "  Tu peux :"
  echo "    1. Arrêter ce service (nginx, apache, etc.)"
  echo "    2. Ou utiliser un autre port pour GLPI :"
  echo "       Modifie docker-compose.glpi.yml : \"\${GLPI_PORT:-8080}:80\""
  echo "       Et mets GLPI_PORT=8080 dans le .env"
  echo ""
else
  echo -e "  ${GREEN}✓ Port 80 libre${NC}"
fi

# ── Résumé ──────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}  Nettoyage terminé !${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo "Pour redémarrer proprement :"
echo "  ./start.sh"
echo ""
echo "Ou manuellement :"
echo "  docker compose -f docker-compose.production.yml -f docker-compose.glpi.yml up -d --build"
echo ""
