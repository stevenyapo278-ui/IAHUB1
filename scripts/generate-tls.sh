#!/usr/bin/env bash
set -euo pipefail

# Génère une CA interne + un certificat serveur pour l'ERP (SAN : IP du serveur).
# Usage : ./scripts/generate-tls.sh [IP_OU_HOSTNAME]  (défaut : 10.0.70.126)
# Produit : certs/ca.crt (à distribuer aux postes via GPO), certs/server.crt + server.key (à monter dans le conteneur).

HOST="${1:-10.0.70.126}"
CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:$HOST"
else
  SAN="DNS:$HOST"
fi

openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" \
  -days 3650 -subj "/CN=IA-Hub CA Interne"

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