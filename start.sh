#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

echo "=== IA Hub — Démarrage ==="
echo ""
echo "1) Je n'ai pas encore de GLPI -> en créer un nouveau (conteneur dédié)"
echo "2) J'ai déjà un GLPI qui tourne, ou je le configurerai plus tard -> ne pas créer de conteneur GLPI"
echo ""
read -rp "Choix [1/2] : " choice

case "$choice" in
  1)
    echo ""
    echo "Un nouveau GLPI va être créé (conteneurs glpi + glpi-db)."
    docker compose -f docker-compose.yml -f docker-compose.glpi.yml up -d --build
    echo ""
    echo "GLPI démarre sur http://localhost:8080 — suis l'assistant d'installation"
    echo "(base: host=glpi-db, user=glpi, password=glpi_pass, db=glpi)."
    echo ""
    echo "Une fois GLPI installé et l'API REST activée (Configuration > Générale > API),"
    echo "connecte-le depuis l'interface IA Hub : Settings -> Autres intégrations"
    echo "(voir README, section GLPI)."
    ;;
  2)
    echo ""
    echo "Démarrage de la stack sans conteneur GLPI..."
    docker compose up -d --build
    echo ""
    echo "Connecte GLPI depuis l'interface IA Hub : Settings -> Autres intégrations"
    echo "(voir README, section GLPI)."
    ;;
  *)
    echo "Choix invalide."
    exit 1
    ;;
esac

echo ""
echo "=== Stack démarrée ==="
echo "Dashboard : http://localhost:3000"
echo "API       : http://localhost:4000"
