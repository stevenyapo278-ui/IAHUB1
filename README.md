# IA Hub — Automatisation Helpdesk ITSM

Plateforme de gestion des tickets IT avec analyse IA des emails, création automatique de tickets GLPI, détection d'incidents similaires et relances automatiques.

## Stack

| Composant | Technologie |
|---|---|
| Backend | Node.js 20 + Express + Prisma |
| Base de données | PostgreSQL 16 + pgvector |
| Frontend | React + Vite + Tailwind CSS |
| IA | Google Gemini (analyse, déduplication) |
| ITSM | GLPI via API REST |
| Email | Microsoft Graph API (OAuth2) |

---

## Lancer avec Docker (recommandé)

### Prérequis
- Docker + Docker Compose installés
- Ports 80, 4000, 5432 disponibles

### 1. Cloner le repo

```bash
git clone <repo-url>
cd Projet_IA_Hub
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
# Editer .env avec vos valeurs
```

`.env` à la racine :
```env
JWT_SECRET=mon_secret_jwt_tres_long_et_aleatoire
MICROSOFT_REDIRECT_URI=http://localhost:4000/api/oauth/outlook/callback
VITE_API_URL=http://localhost:4000/api
```

### 3. Lancer

```bash
./start.sh
```

Le script demande comment gérer GLPI :

```
1) Je n'ai pas encore de GLPI -> en créer un nouveau (conteneur dédié)
2) J'ai déjà un GLPI qui tourne -> me connecter dessus (aucun conteneur GLPI créé)
```

- **Option 1** : démarre un GLPI neuf (+ sa base MariaDB) en plus du reste de la stack. Voir [Première installation de GLPI](#première-installation-de-glpi-premier-démarrage-uniquement).
- **Option 2** : demande l'URL de l'API REST GLPI, l'App Token et le User Token de ton instance existante, les enregistre dans `.env`, et démarre la stack **sans créer de conteneur GLPI**.

Alternative sans script (démarre uniquement la stack de base, sans GLPI) :

```bash
docker compose up -d
```

Les services démarrent dans l'ordre :
1. PostgreSQL (avec pgvector activé automatiquement)
2. GLPI, si l'option 1 a été choisie (+ sa base MariaDB)
3. Backend (migrations appliquées + seed au démarrage)
4. Frontend (build React servi par Nginx)

### Accès

| Service | URL |
|---|---|
| Dashboard | http://localhost |
| API | http://localhost:4000 |
| Base de données | localhost:5432 |

### Identifiants par défaut

Ces comptes sont créés automatiquement par le script de seed (`erp-backend/prisma/seed.js`) à chaque démarrage (`docker compose up -d`), s'ils n'existent pas déjà en base.

```
Email    : admin@example.com
Password : ChangeMe123!
```

```
Email    : admin@prosuma.ci
Password : 1234
```

Si aucun de ces comptes ne fonctionne (ex: base de données déjà initialisée par un seed plus ancien, mot de passe changé manuellement), recrée un admin directement en base :

```bash
docker exec ia-hub-backend node -e "
const bcrypt = require('bcryptjs');
const prisma = require('./src/prismaClient');
(async () => {
  const passwordHash = await bcrypt.hash('1234', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@prosuma.ci' },
    create: { email: 'admin@prosuma.ci', passwordHash, fullName: 'Admin Prosuma', role: 'ADMIN' },
    update: { passwordHash, role: 'ADMIN' },
  });
  console.log('Admin prêt :', user.email);
  process.exit();
})();
"
```

Ou directement en SQL via `psql` (le hash correspond au mot de passe `1234`) :

```bash
docker exec ia-hub-postgres psql -U erp_user -d erp_itsm -c "
INSERT INTO \"User\" (email, \"passwordHash\", \"fullName\", role, \"createdAt\", \"updatedAt\")
VALUES ('admin@prosuma.ci', '\$2a\$10\$v5oqXMZI1b5dytp0BBgtDe/tolP3PMCg0M4dhXZ8PZ4WlnyQiZOVS', 'Admin Prosuma', 'ADMIN', NOW(), NOW())
ON CONFLICT (email) DO UPDATE SET \"passwordHash\" = EXCLUDED.\"passwordHash\", role = 'ADMIN';
"
```

### Commandes utiles

```bash
# Voir les logs
docker compose logs -f

# Logs d'un service spécifique
docker compose logs -f backend

# Arrêter
docker compose down

# Arrêter et supprimer les données
docker compose down -v

# Reconstruire après changement de code
docker compose up -d --build
```

---

## Mode développement (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

- Backend sur http://localhost:4000 avec rechargement automatique
- Frontend sur http://localhost:5173 avec rechargement automatique

---

## Lancer sans Docker (local)

### Prérequis
- Node.js 18+
- PostgreSQL 16+ avec extension pgvector

### Base de données

```bash
sudo -u postgres psql <<EOF
CREATE USER erp_user WITH PASSWORD 'erp_password';
CREATE DATABASE erp_itsm OWNER erp_user;
GRANT ALL PRIVILEGES ON DATABASE erp_itsm TO erp_user;
EOF

sudo -u postgres psql -d erp_itsm -c "CREATE EXTENSION IF NOT EXISTS vector;"
sudo -u postgres psql -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Backend

```bash
cd erp-backend
npm install
cp .env.example .env   # puis éditer .env
npx prisma migrate deploy
npx prisma db seed
npm run dev
# → http://localhost:4000
```

### Frontend

```bash
cd erp-frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:4000/api
npm run dev
# → http://localhost:5173
```

---

## GLPI — nouveau ou existant

`./start.sh` pose la question au démarrage : créer un GLPI neuf ou se connecter à un GLPI déjà existant. Les deux cas sont gérés par des fichiers Docker Compose séparés :

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | Stack de base : PostgreSQL, backend, frontend — sans GLPI |
| `docker-compose.glpi.yml` | Override **optionnel** : ajoute les services `glpi` + `glpi-db` |

### Option 1 — Créer un nouveau GLPI

```bash
./start.sh
# choisir 1
```

Équivalent manuel :

```bash
docker compose -f docker-compose.yml -f docker-compose.glpi.yml up -d --build
```

| Service | URL |
|---|---|
| GLPI | http://localhost:8080 |

Première installation (une seule fois) :

1. Ouvrir http://localhost:8080 et suivre l'assistant d'installation GLPI.
2. À l'étape base de données, renseigner : host `glpi-db`, user `glpi`, password `glpi_pass`, base `glpi`.
3. Terminer l'installation (créer le compte admin GLPI, choisir la langue, etc.).
4. Activer l'API REST : Configuration → Générale → onglet **API** → activer "API REST".
5. Créer un **App Token** : Configuration → Générale → onglet **API** → ajouter un client API (ou utiliser celui par défaut "full access from localhost").
6. Générer un **User Token** : Administration → Utilisateurs → (ton compte) → onglet "Jetons API" → générer un nouveau jeton API.

Puis relancer `./start.sh` et choisir l'option 2 pour enregistrer ces tokens (ou éditer `.env` directement, voir ci-dessous).

### Option 2 — Se connecter à un GLPI déjà existant

```bash
./start.sh
# choisir 2, puis renseigner : URL de l'API REST, App Token, User Token
```

Cette option **ne crée aucun conteneur GLPI** — elle enregistre la configuration dans `.env` et démarre uniquement `docker-compose.yml` (postgres, backend, frontend). Si l'URL fournie pointe sur `localhost`, le script la convertit automatiquement en `host.docker.internal` pour que le conteneur backend puisse l'atteindre.

Équivalent manuel — renseigner dans le `.env` à la racine du projet :

```env
GLPI_URL=http://host.docker.internal:8080/apirest.php
GLPI_APP_TOKEN=<ton App Token>
GLPI_USER_TOKEN=<ton User Token>
```

Puis :

```bash
docker compose up -d --build backend
```

### Configuration automatique

Dans les deux cas, le script de seed (`erp-backend/prisma/seed.js`) lit `GLPI_URL` / `GLPI_APP_TOKEN` / `GLPI_USER_TOKEN` depuis l'environnement et configure automatiquement la connexion GLPI en base à chaque démarrage — pas besoin de repasser par Settings → GLPI dans l'interface.

### GLPI configuré manuellement (alternative)

Si tu préfères passer par l'interface au lieu des variables d'environnement, configurer dans **Paramètres** :

Settings → GLPI → renseigner :
- URL de base (ex: `http://glpi/apirest.php` si GLPI tourne dans ce docker-compose, ou l'URL de ton instance externe)
- User Token
- App Token

### Persistance des données GLPI (option 1 uniquement)

- La base de données GLPI (tickets, utilisateurs, configuration) est stockée dans le volume Docker `glpi_mysql_data` — elle survit aux `docker compose down` et aux rebuilds.
- La configuration de connexion GLPI (`config_db.php`) est stockée dans le volume `glpi_config`.
- `docker compose down -v` supprime ces volumes et donc **toutes les données GLPI** — à utiliser uniquement pour une réinitialisation complète.

---

## Configuration post-installation

Une fois connecté au dashboard, configurer dans **Paramètres** :

### Intelligence Artificielle (obligatoire)
Settings → Intelligence Artificielle → Gemini → Ajouter une clé API

Obtenir une clé gratuite sur [aistudio.google.com](https://aistudio.google.com)

### Outlook (optionnel)
Pour recevoir et analyser les vrais emails :
1. Créer une app dans Azure AD (portail.azure.com)
2. Permissions requises : `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`
3. Settings → Comptes email → Ajouter un compte OUTLOOK
4. Renseigner Client ID, Tenant ID, Client Secret
5. Cliquer "Connecter Outlook"

---

## Tester le pipeline sans Outlook

```bash
# Obtenir un token
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Simuler un email entrant → analyse IA + création ticket GLPI
curl -s -X POST http://localhost:4000/api/inbox/simulate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "subject": "Imprimante en panne bureau 3",
    "body": "Bonjour, l imprimante HP du bureau 3 affiche erreur papier depuis ce matin.",
    "from": "user@prosuma.ci",
    "fromName": "Utilisateur Test"
  }'
```

---

## Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| Analyse email IA | Catégorie, priorité P1-P4, résumé, détection spam |
| Création ticket GLPI | Automatique à la réception d'un email |
| Déduplication | Gemini compare les nouveaux emails avec les tickets ouverts des 4 dernières heures |
| Threading | Suivi des réponses sur le même fil email |
| Accusé de réception | Email automatique envoyé à l'utilisateur |
| Relances automatiques | J+2, J+5, J+10, fermeture automatique J+15 |
| Base de connaissances | Recherche sémantique + génération d'articles depuis tickets résolus |
| Journal d'audit | Historique complet de chaque action sur un ticket |

---

## Structure du projet

```
Projet_IA_Hub/
├── docker-compose.yml        # Production
├── docker-compose.dev.yml    # Développement (hot reload)
├── init-db.sql               # Activation pgvector au démarrage
├── .env.example              # Variables d'environnement à copier
│
├── erp-backend/
│   ├── Dockerfile
│   ├── docker-entrypoint.sh  # Migrations + seed au démarrage
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── src/
│       ├── routes/           # Endpoints API
│       ├── services/         # Pipeline email, analyse IA, GLPI, relances
│       └── utils/            # Gemini, Graph API, embeddings
│
└── erp-frontend/
    ├── Dockerfile
    ├── nginx.conf
    └── src/
        ├── pages/            # Dashboard, Tickets, Inbox, Settings...
        └── layouts/
```
