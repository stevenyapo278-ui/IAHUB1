# IA Hub — Automatisation Helpdesk ITSM

Plateforme de gestion des tickets IT avec analyse IA des emails, création automatique de tickets GLPI, détection d'incidents similaires et relances automatiques.

> **Vous installez l'application pour la première fois sur votre poste ou un serveur ?** Suivez plutôt le guide simplifié [INSTALLATION.md](INSTALLATION.md), pensé pour un utilisateur non-développeur. Ce README couvre les détails techniques (architecture, migrations, permissions, développement).

## Stack

| Composant | Technologie |
|---|---|
| Backend | Node.js 20 + Express + Prisma |
| Base de données | PostgreSQL 16 + pgvector |
| Frontend | React + Vite + Tailwind CSS |
| IA | Multi-fournisseurs : Gemini, OpenAI, Anthropic, NVIDIA NIM, Mistral (analyse, déduplication, embeddings avec bascule automatique entre fournisseurs actifs) |
| ITSM | GLPI via API REST |
| Email | Microsoft Graph API (OAuth2) |

---

## Lancer avec Docker (recommandé)

### Prérequis

- **Windows / Mac** : installer [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inclut Docker Compose). Sur Windows, WSL2 doit être activé (proposé automatiquement à l'installation).
- **Linux** : installer Docker Engine + le plugin Compose v2 :
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # puis se déconnecter/reconnecter (ou redémarrer la session)
  ```
  Vérifier ensuite que `docker compose version` répond (sans tiret — c'est le plugin intégré, pas l'ancien `docker-compose`).
- Aucun autre outil requis : pas besoin de Node.js, npm, ni PostgreSQL sur la machine — tout tourne dans des conteneurs.
- Ports disponibles : **3000** (frontend), **4000** (API), **5433** (PostgreSQL) — et **8080** uniquement si un GLPI est créé via l'option 1 du script.

Si `./start.sh` renvoie `Permission denied`, rendre le script exécutable :
```bash
chmod +x start.sh
```

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
| Dashboard | http://localhost:3000 |
| API | http://localhost:4000 |
| Base de données | localhost:5433 |

### Identifiants par défaut

Un seul compte est créé automatiquement par le script de seed (`erp-backend/prisma/seed.js`) au premier démarrage sur une base vide (`docker compose up -d`), s'il n'existe pas déjà en base — c'est le seul compte **SUPERADMIN** garanti d'exister dès l'installation :

```
Email    : superadmin@prosuma.ci
Password : 12345678
```

À la première connexion, ce compte sert à créer tous les autres comptes (ADMIN, technicien, etc.) depuis **Utilisateurs**, et à leur attribuer des droits via **Groupes de droits** — voir [Rôles et groupes de droits](#rôles-et-groupes-de-droits-permissions).

Si ce compte ne fonctionne pas (ex: base déjà initialisée par un seed plus ancien, mot de passe changé manuellement), recrée-le directement en base :

```bash
docker exec ia-hub-backend node -e "
const bcrypt = require('bcryptjs');
const prisma = require('./src/prismaClient');
(async () => {
  const passwordHash = await bcrypt.hash('12345678', 10);
  const user = await prisma.user.upsert({
    where: { email: 'superadmin@prosuma.ci' },
    create: { email: 'superadmin@prosuma.ci', passwordHash, fullName: 'Super Admin Prosuma', role: 'SUPERADMIN' },
    update: { passwordHash, role: 'SUPERADMIN' },
  });
  console.log('Super-admin prêt :', user.email);
  process.exit();
})();
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

### Migrations de base de données

Les migrations Prisma s'appliquent **automatiquement** à chaque démarrage du conteneur backend (via `docker-entrypoint.sh`, qui lance `npx prisma migrate deploy`) — pas besoin de commande manuelle dans le cas normal. Un simple `git pull` suivi de `docker compose up -d --build` suffit.

Si malgré tout le backend plante au démarrage avec une erreur du type `The column "Ticket.xxx" does not exist in the current database` (P2022) alors que les logs indiquent `No pending migrations to apply`, cela signifie que le `git pull` n'a pas récupéré les derniers fichiers de migration (`erp-backend/prisma/migrations/`). Dans ce cas :

```bash
# 1. Vérifier qu'on est bien sur la bonne branche et à jour
git branch --show-current
git pull origin <ta-branche>

# 2. Vérifier que les fichiers de migration sont bien présents
ls erp-backend/prisma/migrations/

# 3. Forcer la reconstruction sans cache puis relancer
docker compose build --no-cache backend
docker compose up -d backend

# 4. Vérifier dans les logs que les migrations s'appliquent
docker logs ia-hub-backend --tail=30
```

Si une migration doit être appliquée manuellement dans le conteneur (cas rare, déboguage) :

```bash
docker compose run --rm --entrypoint sh backend -c "npx prisma migrate deploy"
```

### Seed (`erp-backend/prisma/seed.js`)

Exécuté automatiquement au démarrage du conteneur backend (`docker-entrypoint.sh`, après les migrations), idempotent (peut être relancé sans dupliquer ce qui existe déjà) :

- Crée les 7 équipes par défaut (Réseau, Système, Sécurité, Applicatif, Logiciel, Matériel, Téléphonie).
- Crée le compte SUPERADMIN par défaut `superadmin@prosuma.ci` / `12345678` s'il n'existe pas déjà.
- Crée les fournisseurs IA (OpenAI, Anthropic, Gemini, NVIDIA, Mistral) et leurs modèles par défaut.
- Crée le groupe de droits **Techniciens** avec les permissions historiques du rôle TECHNICIAN, et y rattache automatiquement tout compte TECHNICIAN existant sans groupe.

La création de techniciens à partir d'un mapping GLPI statique (`GLPI_TECHNICIANS`) a été retirée du seed — ce mapping n'existe plus dans `src/utils/glpiMapping.js` (le seed plantait avant d'atteindre la création du SUPERADMIN). Les techniciens/équipes liés à GLPI sont désormais synchronisés en continu via `syncTeamsFromGlpi`/`syncCategoriesFromGlpi` ([erp-backend/src/services/glpiTicketCreator.js](erp-backend/src/services/glpiTicketCreator.js)), appelés périodiquement depuis `server.js`.

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

### Option 2 — Se connecter à un GLPI déjà existant

```bash
./start.sh
# choisir 2
```

Cette option **ne crée aucun conteneur GLPI** — elle démarre uniquement `docker-compose.yml` (postgres, backend, frontend), GLPI restant géré ailleurs.

### Connecter GLPI au backend — uniquement via l'UI

La connexion GLPI (URL, User Token, App Token) se configure **exclusivement depuis l'interface**, jamais via `.env` ou un script — c'est la seule source de vérité, pour éviter qu'une valeur en dur n'écrase ce que tu configures :

**Settings → Autres intégrations** :

1. Dans "Ajouter une intégration", renseigner :
   - **Nom du service** : `glpi`
   - **URL de base** : `http://glpi/apirest.php` (si GLPI tourne dans ce docker-compose, option 1) ou l'URL complète de ton instance externe (option 2)
   - **Clé API** : ton **User Token**
   - **App Token (GLPI)** : ce champ apparaît automatiquement quand le nom du service est `glpi` — renseigner ton **App Token**
2. Cliquer **Ajouter**.
3. Cliquer **Synchroniser GLPI** sur la ligne créée pour valider la connexion immédiatement.

Si la config existe déjà, modifie directement les champs "Clé API" et "App Token" sur la ligne du tableau (la valeur se sauvegarde en quittant le champ).

### Synchronisation automatique

Une fois GLPI configuré et actif, le backend synchronise les tickets GLPI → ERP automatiquement **toutes les 20 secondes** ([erp-backend/src/server.js](erp-backend/src/server.js)) — un ticket créé ou modifié dans GLPI apparaît quasi instantanément dans l'ERP, sans action manuelle.

### Persistance des données GLPI (option 1 uniquement)

- La base de données GLPI (tickets, utilisateurs, configuration) est stockée dans le volume Docker `glpi_mysql_data` — elle survit aux `docker compose down` et aux rebuilds.
- La configuration de connexion GLPI (`config_db.php`) est stockée dans le volume `glpi_config`.
- `docker compose down -v` supprime ces volumes et donc **toutes les données GLPI** — à utiliser uniquement pour une réinitialisation complète.

---

## Configuration post-installation

Une fois connecté au dashboard, configurer dans **Paramètres** :

### Intelligence Artificielle (obligatoire)
Settings → Intelligence Artificielle → ajouter au moins un fournisseur actif avec une clé API.

Fournisseurs supportés : **Gemini**, **OpenAI**, **Anthropic**, **NVIDIA NIM**, **Mistral**.

Clé gratuite Gemini sur [aistudio.google.com](https://aistudio.google.com).

Pour chaque fournisseur, les modèles se déclarent avec un type **CHAT** (analyse d'emails, génération de réponses) ou **EMBEDDING** (recherche sémantique dans la base de connaissances) — un même fournisseur peut avoir un modèle par défaut différent pour chaque type. Anthropic ne propose pas d'API d'embeddings et est ignoré automatiquement pour cet usage.

Si plusieurs fournisseurs/modèles d'embedding actifs sont configurés, le backend les essaie dans l'ordre jusqu'à obtenir un vecteur de la dimension attendue par la base (1024) — pas besoin de désactiver les autres en cas d'ajout d'un nouveau fournisseur.

Les prompts utilisés pour chaque tâche IA (analyse d'email, génération de réponse, déduplication, etc.) sont éditables sans toucher au code : **Prompts IA** dans le menu.

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
  -d '{"email":"superadmin@prosuma.ci","password":"12345678"}' \
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
| Base de connaissances | Recherche sémantique + génération d'articles depuis tickets résolus, remplacement/suppression de documents |
| Journal d'audit | Historique complet de chaque action sur un ticket |
| Suppression de tickets | Individuelle ou en masse, soumise aux permissions `tickets.delete`/`tickets.bulkDelete` (voir Groupes de droits) |
| Auto-assignation des tickets | Le technicien le moins chargé de l'équipe correspondant à la catégorie détectée est assigné automatiquement (création email ou manuelle) |
| Charge par équipe | Visualisation du nombre de tickets actifs par technicien, page Équipes |
| Auto-approbation GLPI | Approuve automatiquement la solution d'un ticket marqué résolu côté GLPI si activé dans Paramètres |
| Alertes vocales | Annonce vocale configurable (activation, langue) des nouveaux tickets/brouillons à valider |
| Groupes de droits | Permissions fines par groupe — remplacent entièrement l'accès par rôle pour ADMIN/TECHNICIAN dès qu'un groupe est assigné (voir section dédiée) |
| Brouillons de réponse email | Validation humaine avant envoi, avec restauration possible d'un brouillon rejeté |

---

### Suppression de tickets

Contrôlée par les permissions `tickets.delete` (unitaire) et `tickets.bulkDelete` (en masse) — voir [Rôles et groupes de droits](#rôles-et-groupes-de-droits-permissions). SUPERADMIN les a toujours ; un ADMIN/TECHNICIAN doit appartenir à un groupe cochant ces permissions.

- **Un seul ticket** (`tickets.delete`) : depuis la page de détail d'un ticket (`/tickets/:id`), bouton "Supprimer", ou directement dans la liste via l'icône corbeille sur chaque ligne.
- **En masse** (`tickets.bulkDelete`) : sur la page Tickets, des cases à cocher apparaissent sur chaque ligne (et une case "tout sélectionner" dans l'en-tête). Une fois une ou plusieurs lignes sélectionnées, le bouton "Supprimer la sélection (N)" apparaît au-dessus du tableau. Une confirmation est demandée avant suppression définitive.

API correspondante :
- `DELETE /api/tickets/:id` — supprime un ticket (`tickets.delete` requis).
- `POST /api/tickets/bulk-delete` — supprime plusieurs tickets en une requête, body `{ "ids": [1, 2, 3] }` (`tickets.bulkDelete` requis).

Si le ticket était synchronisé avec GLPI (`glpiTicketId` renseigné), le ticket correspondant est aussi purgé côté GLPI (suppression définitive, `force_purge`). Si GLPI est inaccessible au moment de la suppression, le ticket est tout de même supprimé côté ERP (best-effort, non bloquant) — il peut alors rester orphelin dans GLPI.

---

## Rôles et groupes de droits (permissions)

### Rôles

| Rôle | Description |
|---|---|
| **SUPERADMIN** | Seul rôle bénéficiant d'un accès total inconditionnel, jamais affecté par un groupe de droits. Seul rôle pouvant créer/modifier/supprimer un **groupe de droits** et accéder à l'onglet **Avancé** des Paramètres (config serveur, fréquences de sync, auto-envoi IA). Un seul compte SUPERADMIN existe par défaut à l'installation (voir [Identifiants par défaut](#identifiants-par-défaut)) ; c'est lui qui crée les comptes ADMIN/techniciens suivants et leur assigne un groupe. |
| **ADMIN** | Aucun accès automatique aux fonctionnalités de gestion : ses permissions viennent **exclusivement** du ou des groupes de droits auxquels il est assigné (voir ci-dessous). Peut créer des utilisateurs et les assigner à des groupes existants, mais ne peut pas créer/modifier/supprimer un groupe. |
| **TECHNICIAN** | Même règle qu'ADMIN : aucune permission par défaut hors groupe. Le groupe **Techniciens**, créé automatiquement au premier démarrage, couvre l'accès historiquement accordé à ce rôle. |
| **REQUESTER** | Utilisateur final, sans accès à l'interface de gestion. |

### Groupes de droits

Menu **Groupes de droits** — création/modification/suppression réservée à **SUPERADMIN** ; un **ADMIN** peut consulter les groupes existants et y assigner/retirer des utilisateurs, mais pas changer leur contenu.

- Chaque groupe définit une liste de permissions cochables, parmi : gestion des tickets (suppression unitaire, suppression en masse, assignation, approbation — la **création** de ticket n'est pas une permission, elle est ouverte à tout compte connecté y compris REQUESTER), équipes, utilisateurs (affichage du lien uniquement, voir note ci-dessous), Paramètres → Intelligence Artificielle / Email (Outlook-IMAP) / Autres intégrations, base de connaissances, synchronisation boîte mail, synchronisation GLPI, **Prompts IA**, brouillons de réponse email, automatisations (relances, n8n).
- **Règle stricte, sans filet de sécurité par rôle : seules les permissions cochées dans les groupes d'un utilisateur déterminent ce qu'il peut faire — y compris pour un ADMIN.** Un utilisateur (ADMIN ou TECHNICIAN) qui n'appartient à **aucun** groupe n'a accès à rien au-delà des pages toujours visibles (Dashboard, Tickets, Équipes, Boîte mail, Base de connaissances — en lecture). **Tout nouveau compte créé doit donc être assigné à un groupe pour pouvoir agir.** Seul SUPERADMIN n'est jamais affecté par les groupes.
- Un utilisateur peut appartenir à **plusieurs groupes simultanément** : ses permissions effectives sont alors l'**union** des permissions de tous ses groupes. Attention en pratique : ajouter un compte ADMIN au groupe **Techniciens** (par exemple) lui rend les permissions de ce groupe en plus de celles de son groupe principal, même si elles sont décochées ailleurs — vérifier l'appartenance à tous les groupes avant de diagnostiquer un accès inattendu.
- Un groupe **Techniciens** est créé automatiquement au premier démarrage (seed), avec les permissions historiquement accordées au rôle TECHNICIAN, et tous les comptes TECHNICIAN existants y sont rattachés automatiquement.
- La barre latérale, les onglets de la page Paramètres, et les boutons/actions des pages Tickets/Détail ticket/Équipes (suppression, assignation, approbation...) se masquent dès que la permission correspondante n'est pas accordée — au prochain chargement de page, sans besoin de se reconnecter, **sauf changement de rôle** (ADMIN ↔ TECHNICIAN ↔ SUPERADMIN), qui ne prend effet qu'à la prochaine connexion car porté par le jeton de session.
- Les routes `Utilisateurs` et `Groupes de droits` (la page elle-même, pas son contenu) restent accessibles côté serveur à **tout compte de rôle ADMIN ou SUPERADMIN**, quel que soit le contenu de ses groupes — non délégable à TECHNICIAN. La permission `users.manage` ne pilote, côté frontend uniquement, que l'affichage des liens correspondants dans la barre latérale (purement cosmétique : la retirer du groupe d'un ADMIN masque le lien mais ne bloque pas l'accès direct à l'URL). Seule la création/modification/suppression d'un groupe reste strictement réservée à SUPERADMIN.

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
