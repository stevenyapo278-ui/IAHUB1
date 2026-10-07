#!/usr/bin/env bash
set -euo pipefail

# Génère une CA interne + un certificat serveur pour l'ERP (SAN : IP du serveur).
# Usage : ./scripts/generate-tls.sh [IP_OU_HOSTNAME]  (défaut : 10.0.70.126)
# Produit : certs/ca.crt (à distribuer aux postes via GPO), certs/server.crt + server.key (à monter dans le conteneur).
#
# La CA n'est créée qu'une seule fois : rejouer le script ne fait que renouveler le
# certificat serveur, sinon la CA change et il faudrait repousser ca.crt sur tous les postes.

HOST="${1:-10.0.70.126}"
CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:$HOST"
else
  SAN="DNS:$HOST"
fi

if [[ -f "$CERT_DIR/ca.crt" && -f "$CERT_DIR/ca.key" ]]; then
  echo "CA existante conservée : $CERT_DIR/ca.crt (renouvellement du certificat serveur uniquement)"
else
  openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" \
    -days 3650 -subj "/CN=IA-Hub CA Interne"
fi

openssl req -newkey rsa:4096 -nodes \
  -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.csr" \
  -subj "/CN=$HOST" -addext "subjectAltName=$SAN"

openssl x509 -req -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/server.crt" -days 397 \
  -extfile <(printf "subjectAltName=%s\n" "$SAN")

rm -f "$CERT_DIR/server.csr"
chmod 600 "$CERT_DIR/server.key"
echo "Certificats générés dans $CERT_DIR :"
echo "  - ca.crt     (CA à pousser sur les postes via GPO)"
echo "  - server.crt / server.key (à monter dans le conteneur app)"
echo ""
echo "Déploiement Dokploy (dossier stable, survit aux redéploiements) :"
echo "  sudo mkdir -p /etc/dokploy/certs/ia-hub"
echo "  sudo cp certs/server.crt /etc/dokploy/certs/ia-hub/cert.pem"
echo "  sudo cp certs/server.key /etc/dokploy/certs/ia-hub/key.pem"
echo "  sudo chown -R 1000:1000 /etc/dokploy/certs/ia-hub   # user node de l'image"
echo "  sudo chmod 640 /etc/dokploy/certs/ia-hub/key.pem"