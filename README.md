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
docker compose up -d
```

C'est tout. Les services démarrent dans l'ordre :
1. PostgreSQL (avec pgvector activé automatiquement)
2. Backend (migrations appliquées + seed au démarrage)
3. Frontend (build React servi par Nginx)

### Accès

| Service | URL |
|---|---|
| Dashboard | http://localhost |
| API | http://localhost:4000 |
| Base de données | localhost:5432 |

### Identifiants par défaut

```
Email    : admin@example.com
Password : ChangeMe123!
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

## Configuration post-installation

Une fois connecté au dashboard, configurer dans **Paramètres** :

### GLPI (obligatoire)
Settings → GLPI → renseigner :
- URL de base (ex: `http://glpi.local/apirest.php`)
- User Token
- App Token

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
