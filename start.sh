#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

# Met à jour (ou ajoute) une variable dans le fichier .env
set_env_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

echo "=== IA Hub — Configuration GLPI ==="
echo ""
echo "1) Je n'ai pas encore de GLPI -> en créer un nouveau (conteneur dédié)"
echo "2) J'ai déjà un GLPI qui tourne -> me connecter dessus (aucun conteneur GLPI créé)"
echo ""
read -rp "Choix [1/2] : " choice

case "$choice" in
  1)
    echo ""
    echo "Un nouveau GLPI va être créé (conteneurs glpi + glpi-db)."
    set_env_var "GLPI_URL" "http://glpi/apirest.php"

    docker compose -f docker-compose.yml -f docker-compose.glpi.yml up -d --build

    echo ""
    echo "GLPI démarre sur http://localhost:8080 — suis l'assistant d'installation"
    echo "(base: host=glpi-db, user=glpi, password=glpi_pass, db=glpi)."
    echo ""
    echo "Une fois GLPI installé et l'API REST activée (Configuration > Générale > API),"
    echo "récupère un App Token et un User Token, puis relance ce script et choisis"
    echo "l'option 2 pour les enregistrer — ou édite directement le fichier .env :"
    echo "  GLPI_APP_TOKEN=..."
    echo "  GLPI_USER_TOKEN=..."
    echo "puis : docker compose up -d --build backend"
    ;;
  2)
    echo ""
    read -rp "URL de l'API REST GLPI (ex: http://localhost:8080/apirest.php) : " glpi_url
    read -rp "App Token : " glpi_app_token
    read -rp "User Token : " glpi_user_token

    # Si l'URL pointe sur localhost, le conteneur backend doit l'atteindre via host.docker.internal
    glpi_url="${glpi_url/localhost/host.docker.internal}"
    glpi_url="${glpi_url/127.0.0.1/host.docker.internal}"

    set_env_var "GLPI_URL" "$glpi_url"
    set_env_var "GLPI_APP_TOKEN" "$glpi_app_token"
    set_env_var "GLPI_USER_TOKEN" "$glpi_user_token"

    echo ""
    echo "Configuration enregistrée dans .env. Démarrage de la stack (sans conteneur GLPI)..."

    docker compose up -d --build

    echo ""
    echo "Connexion à GLPI testée au démarrage du backend (voir : docker compose logs backend)."
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
