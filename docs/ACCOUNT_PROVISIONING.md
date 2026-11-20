# Module « Opérations sur comptes applicatifs »

## Objectif

Quand un technicien crée un compte ou modifie les droits d'un compte existant sur une
application (Sage X3, Microsoft 365, Odoo…), il doit déclarer cette opération **avant** de
pouvoir marquer le ticket `SOLVED`. La déclaration est stockée en base (source de vérité)
puis répliquée vers **Budibase** (miroir asynchrone). Aucun mot de passe n'est stocké, ni en
base ni dans Budibase.

## Activation

Réservée au **SUPERADMIN** (pas de délégation par groupe de permissions) :

```http
PATCH /api/system/settings/account-provisioning
{
  "accountProvisioningEnabled": true,
  "accountProvisioningAiPrefill": true,
  "accountProvisioningRetrySeconds": 300
}
```

Champs `SystemSettings` :

| Champ | Défaut | Rôle |
|---|---|---|
| `accountProvisioningEnabled` | `false` | Master switch du module |
| `accountProvisioningAiPrefill` | `true` | Pré-remplissage IA du formulaire (jamais bloquant) |
| `accountProvisioningRetrySeconds` | `300` | Fréquence de rejeu des écritures Budibase (`0` = désactivé) |

## Modèle de données

- `ApplicationCatalog` : liste **fermée** des applications autorisées (`name`, `aliases`, `fields`, `isActive`).
  Le seed amorce Microsoft 365, Sage X3, Sage Paie, Odoo, GLPI, Active Directory **uniquement si le
  catalogue est vide** : une application supprimée par le SUPERADMIN n'est jamais recréée.
- `ApplicationCandidate` : file de validation des applications **citées hors catalogue**
  (`name`, `normalizedName` unique, `occurrences`, `status` `PENDING|PROMOTED|IGNORED`,
  `lastTicketId`, `promotedCatalogId`). L'IA ne crée jamais une application : elle propose,
  le SUPERADMIN promeut (ou fusionne, ou ignore).
- `AccountProvisioningRecord` : **un enregistrement par ticket** (`ticketId` unique).
  - `accounts` : `[{ applicationId, applicationName, operation, login, email, profile, rights, type, quantity, passwordDeliveryChannel, note }]`
    où `operation` vaut `CREATION` (défaut) ou `DROITS`.
  - `applications` : snapshot des applications concernées
  - `accountsCount` : somme des quantités (une mise à jour de droits compte 1)
  - `source` : `MANUAL` | `AI_PREFILL` | `NOT_APPLICABLE`
  - `budibaseStatus` : `PENDING` | `SYNCED` | `FAILED` | `SKIPPED`
  - `idempotencyKey` : SHA-256 déterministe (ticket + comptes) — un rejeu ne duplique pas la ligne Budibase.

### Télémétrie de qualité

Ces colonnes ne servent qu'à **mesurer** la qualité du pré-remplissage (voir Supervision) :

| Colonne | Contenu |
|---|---|
| `prefillSource` | `AI` \| `DETERMINISTIC` \| `null` (pas de pré-remplissage) |
| `prefillConfidence` | Confiance renvoyée par l'IA (0–1) |
| `prefillSnapshot` | Ce qui avait été **proposé** : applications, comptes, preuve, applications ignorées |
| `ignoredApplications` | Applications citées dans le ticket mais absentes du catalogue |

Aucune de ces colonnes ne contient de secret : `passwordDeliveryChannel` décrit seulement le
canal de remise (« remis en main propre », « appel téléphonique »…).

## API

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| `GET` | `/api/account-provisioning/catalog` | authentifié | Applications actives |
| `GET` | `/api/account-provisioning/catalog/all` | SUPERADMIN | Catalogue complet |
| `POST` | `/api/account-provisioning/catalog` | SUPERADMIN | Créer une application |
| `PATCH` | `/api/account-provisioning/catalog/:id` | SUPERADMIN | Modifier une application |
| `DELETE` | `/api/account-provisioning/catalog/:id` | SUPERADMIN | Désactivation logique |
| `DELETE` | `/api/account-provisioning/catalog/:id/permanent` | SUPERADMIN | Suppression définitive (refusée si des déclarations la référencent) |
| `GET` | `/api/account-provisioning/candidates?status=PENDING` | SUPERADMIN | Applications citées hors catalogue |
| `POST` | `/api/account-provisioning/candidates/:id/promote` | SUPERADMIN | Ajouter / fusionner dans le catalogue |
| `POST` | `/api/account-provisioning/candidates/:id/ignore` | SUPERADMIN | Ignorer définitivement |
| `GET` | `/api/account-provisioning/ticket/:ticketId` | authentifié | État (`required`, `completed`, `record`) |
| `GET` | `/api/account-provisioning/ticket/:ticketId/prefill` | TECHNICIAN+ | Proposition IA / déterministe |
| `POST` | `/api/account-provisioning/ticket/:ticketId` | TECHNICIAN+ | Déclarer les comptes |
| `GET` | `/api/account-provisioning/stats` | `automation.manage` | Indicateurs de qualité |
| `GET` | `/api/account-provisioning/records` | `automation.manage` | Supervision / pagination (`page`, `pageSize`, `status`, `source`, `ticketId`, `applicationId`) |
| `POST` | `/api/account-provisioning/records/:id/retry` | `automation.manage` | Rejouer une synchro |
| `POST` | `/api/account-provisioning/records/retry-pending` | SUPERADMIN | Rejeu global |

### Payload de déclaration

Créations et mises à jour de droits peuvent cohabiter dans le même envoi :

```json
{
  "accounts": [
    {
      "applicationId": 1,
      "operation": "CREATION",
      "type": "NOMINAL",
      "login": "j.doe",
      "email": "j.doe@prosuma.ci",
      "profile": "Comptable",
      "quantity": 2,
      "passwordDeliveryChannel": "Remis en main propre",
      "note": "Société PROSUMA"
    },
    {
      "applicationId": 2,
      "operation": "DROITS",
      "login": "a.kone",
      "profile": "Acheteur",
      "rights": "Validation des commandes",
      "quantity": 1
    }
  ],
  "source": "AI_PREFILL",
  "aiConfidence": 0.91,
  "prefillMeta": {
    "aiUsed": true,
    "classifier": "AI",
    "confidence": 0.91,
    "evidence": "Compte Sage X3 créé pour M. Doe",
    "accounts": [{ "applicationId": 1, "operation": "CREATION", "login": "j.doe", "profile": "Comptable", "quantity": 1 }],
    "applications": [{ "id": 1, "name": "Sage X3" }],
    "ignoredApplications": ["SAP"]
  }
}
```

`operation` est facultatif et vaut `CREATION` par défaut (rétrocompatible). Une ligne `DROITS`
désigne un compte **existant** dont les droits changent ; `quantity` y est obligatoirement `1`.

`prefillMeta` est facultatif et purement télémétrique : il est assaini côté serveur (bornes de
taille, liste blanche de champs) avant d'être stocké. Il ne modifie jamais la déclaration.

Réponse : `{ record, replayed, warnings }`. `warnings` contient les alertes **non bloquantes**
(voir Doublons) ; `replayed: true` signifie qu'un payload identique existait déjà.

### Champs obligatoires

Pour chaque compte déclaré, le backend exige :

| Règle | Erreur |
|---|---|
| Application présente et au catalogue | `ACCOUNT_PROVISIONING_UNKNOWN_APPLICATION` |
| `operation` valant `CREATION` ou `DROITS` (défaut `CREATION`) | `ACCOUNT_PROVISIONING_INVALID_OPERATION` |
| **Au moins un identifiant : `login` ou `email`** (le compte cible pour `DROITS`) | `ACCOUNT_PROVISIONING_IDENTIFIER_REQUIRED` |
| `email` valide s'il est renseigné | `400` |
| `profile` quand l'application définit une liste fermée — sauf si `rights` est renseigné sur une ligne `DROITS` | `ACCOUNT_PROVISIONING_FIELD_REQUIRED` |
| `quantity` entière entre 1 et 500 | `400` |
| `quantity = 1` pour une ligne `DROITS` | `ACCOUNT_PROVISIONING_RIGHTS_QUANTITY` |

Le « login ou email » couvre le cas des boîtes partagées, qui n'ont pas d'identifiant de
connexion. Le formulaire rejoue exactement ces règles avant l'envoi et surligne le champ fautif.

Une mise à jour de droits est décrite soit par le `profile` (valeur de la liste fermée quand
elle existe), soit par `rights` en texte libre (« accès module Paie », « validation des
factures »). Sur une application à profils fermés, fournir `rights` dispense du profil : cela
évite de forcer un choix faux quand le droit accordé n'est pas un profil du catalogue.

Aucun compte créé (échappatoire obligatoire pour les tickets hors périmètre) :

```json
{ "noAccountCreated": true }
```

Cette seconde forme satisfait le blocage de résolution et reste tracée (`source = "NOT_APPLICABLE"`).

## Qualité du catalogue

### Alias : résolution de chevauchement

Les alias servent à détecter l'application dans le texte du ticket. Deux règles évitent les
faux positifs :

1. **Le libellé le plus long gagne.** Si « Sage Paie » et « Sage X3 » (alias `sage x3`) sont
   détectés sur la même zone de texte, la correspondance la plus longue est retenue et
   l'overlap est écarté.
2. **Frontières de mots réelles.** La détection utilise `(^|[^a-z0-9])…([^a-z0-9]|$)` après
   normalisation (accents supprimés). `\b` n'est jamais utilisé après un accent, car `é`
   n'est pas un caractère de mot en JavaScript : « créé » ne matcherait pas.

Un alias **ambigu** est refusé ou signalé à l'écriture :

| Conflit | Effet |
|---|---|
| `duplicate` (alias déjà utilisé par une autre application) | **409** `ACCOUNT_PROVISIONING_ALIAS_DUPLICATE` |
| `contained` (alias contenu dans le nom/alias d'une autre application) | Accepté + `warnings[]` dans la réponse |
| `redundant` (alias identique au nom) | Accepté + `warnings[]` |

L'alias `sage` de Sage X3 a été retiré (il était contenu dans `sage paie` et provoquait une
double détection réelle). La migration `20261118130000_account_provisioning_quality` le retire
aussi des bases existantes.

### Champs et profils (`ApplicationCatalog.fields`)

```json
[
  { "key": "profile", "label": "Profil", "type": "select",
    "options": ["Comptable", "Acheteur"], "required": false }
]
```

- Champs reconnus : `login`, `email`, `profile`, `note`, `passwordDeliveryChannel`, `quantity`,
  `type`. Tout autre champ est ignoré (le modèle de données ne dérive pas).
- `required: true` → **400** `ACCOUNT_PROVISIONING_FIELD_REQUIRED` si la valeur est vide.
- `type: "select"` + `options` → **400** `ACCOUNT_PROVISIONING_FIELD_INVALID` hors liste ; la
  valeur est **canonicalisée** (« comptable » → « Comptable »), ce qui empêche les variantes
  de saisie de coexister.
- `type: "select"` + `options` **sans** `required: false` → la valeur est **obligatoire** :
  proposer une liste fermée n'a de sens que si l'on doit y choisir une valeur.
- Dans l'UI, le champ « Profil » devient une liste déroulante et le SUPERADMIN peut saisir les
  profils autorisés directement dans la carte Paramètres.

## Doublons

- **Dans la déclaration** : deux lignes avec la même application, la même **opération** et le même
  identifiant (casse ignorée) → **400** `ACCOUNT_PROVISIONING_DUPLICATE_ACCOUNT`. Une création et
  une mise à jour de droits sur le même compte sont deux lignes légitimes. L'UI surligne les
  lignes concernées avant l'envoi.
- **Entre tickets** : un identifiant déjà déclaré sur un autre ticket pour la même application
  produit un `warning` `DUPLICATE_LOGIN_OTHER_TICKET`. Seules les **créations** sont contrôlées :
  une mise à jour de droits vise par définition un compte déjà existant. La vérification est
  *best-effort* (`$queryRaw` sur `jsonb_array_elements`) : une erreur SQL est journalisée et
  **ne bloque jamais** l'enregistrement.

## Interface

- **Fiche ticket** : `AccountProvisioningModal` intercepte le passage à `SOLVED` pour un technicien
  et s'ouvre avant l'appel `PATCH /tickets/:id`. Si le réglage local n'est pas encore chargé, le
  `409` renvoyé par le backend ouvre aussi la modale (filet de sécurité).
  Chaque ligne se déclare en **« Création de compte »** ou **« Mise à jour de droits »** ; le
  second mode masque type/quantité/canal de remise et ajoute le champ « Droit accordé ».
  La modale affiche la preuve textuelle de l'IA, la confiance, un bandeau « confiance faible »
  le cas échéant, et les avertissements de doublons.
- **Paramètres → Avancé (SUPERADMIN)** : carte « Comptes applicatifs » (activation, pré-remplissage
  IA, fréquence de rejeu, catalogue avec alias et profils), carte **« Applications citées hors
  catalogue »** (promotion / fusion / ignorer) et carte **« Supervision des déclarations »**.
  Le catalogue affiche par défaut les seules applications actives ; le bouton
  « Afficher les désactivées (n) » révèle les autres. Chaque application est éditable
  (nom, alias, profils). La corbeille **désactive** une application active ; sur une application
  déjà désactivée elle propose la **suppression définitive**, refusée (409) si des déclarations
  y font référence — l'historique et les statistiques restent alors intacts.
- **Paramètres → Autres intégrations** : carte « Budibase » (URL, clé API chiffrée, App ID,
  Table ID, chemin des lignes, test de connexion).
- **Liste des tickets** : la résolution rapide affiche un message explicite invitant à ouvrir la
  fiche pour déclarer les comptes.

## Blocage de la résolution

Filet de sécurité **côté backend** (indépendant de l'UI) :

- `PATCH /api/tickets/:id` avec `status: "SOLVED"` → `409 ACCOUNT_PROVISIONING_REQUIRED`
  si le module est actif, que l'appelant est `TECHNICIAN` et qu'aucune déclaration n'existe.
- `POST /api/tickets/bulk-update` avec `status: "SOLVED"` → même refus, avec la liste
  `details.missingTicketIds` (empêche le contournement par action groupée).
- Les rôles `ADMIN`, `SUPERADMIN`, `HOTLINE` ne sont jamais bloqués.

Le frontend doit intercepter le changement de statut, ouvrir le formulaire, puis appeler
`POST /ticket/:ticketId` avant d'envoyer le `PATCH` de statut.

## Budibase

Configuration dans `ApiConfig` (`serviceName = "budibase"`) — la clé API est chiffrée
automatiquement (AES-256-GCM) par le middleware Prisma :

```json
{
  "serviceName": "budibase",
  "baseUrl": "http://localhost:10000",
  "apiKey": "<clé personnelle Budibase>",
  "isActive": true,
  "extra": {
    "appId": "app_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "tableId": "ta_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "rowsPath": "/api/public/v1/tables/{tableId}/rows"
  }
}
```

- **API publique v4** : les lignes sont sous `/api/public/v1/...`. L'ancien `/api/v1/...`
  renvoie `404`. `rowsPath` se configure depuis l'UI ; le défaut est
  `/api/public/v1/tables/{tableId}/rows`.
- **App ID obligatoire depuis v4** : chaque appel doit porter l'en-tête
  `x-budibase-app-id`. Sans lui, Budibase répond `400 Invalid app ID provided`. C'est
  l'identifiant visible dans l'URL du builder (`/builder/app/app_dev_...`).
- Appel **serveur uniquement** : `POST <baseUrl><rowsPath>` avec `x-budibase-api-key`,
  `x-budibase-app-id` et `Idempotency-Key`.
- **Test de connexion** : `POST /api/api-configs/:id/test-connection` interroge
  `POST <rowsPath>/search` avec `{ "limit": 1 }` (le `GET` est refusé en 405 par l'API
  publique v4). Il vérifie URL + clé + App ID + Table ID en une fois.
- Colonnes attendues côté table Budibase : `ticketId`, `ticketTitle`, `ticketStatus`,
  `applicationNames`, `applications` (JSON), `accounts` (JSON), `accountsCount`,
  `operations` (liste des natures : `CREATION`, `DROITS`), `hasRightsUpdate`,
  `source`, `aiConfidence`, `createdByEmail`, `declaredAt`, `idempotencyKey`.
- Si Budibase n'est pas configuré ou est indisponible : la déclaration locale reste valide,
  statut `SKIPPED`/`FAILED`, rejeu automatique par le scheduler
  (`scheduleSync('comptes applicatifs → Budibase', …)`).

### Mise en place de Budibase (v4)

1. Créer le compte admin, puis une application (`Create app`).
2. Dans l'app : `Data` → `Create table` → `declarations`, avec les colonnes ci-dessus.
   `ticketTitle` doit être la colonne d'affichage (`primaryDisplay`).
3. Récupérer les identifiants :
   - **App ID** : visible dans l'URL du builder ;
   - **Table ID** : visible dans l'écran `Data` / API de l'app (`ta_...`) ;
   - **Clé API** : `POST /api/global/self/api_key` (compte admin), ou l'écran
     `API` de l'application.
4. Renseigner **Paramètres → Autres intégrations → Budibase** puis cliquer **Tester**.

> **Automatisation.** `npm run budibase:setup` (ou `node scripts/setupBudibase.js`) crée
> l'application et la table, répare le schéma et génère la clé, puis affiche les valeurs à
> saisir. Le plan Budibase est limité à **une application** : si elle existe déjà mais n'est
> pas retrouvée par son nom (espace, casse), passer `BUDIBASE_APP_ID=app_dev_...`. En cas
> d'échec, le script affiche le corps de la réponse (`usage_limit_exceeded` inclus).

> **Piège des colonnes JSON/datetime (Budibase v4.0.1).** La validation de ligne passe
> les contraintes à `validate.js`, qui ne connaît que `string`, `number`, `boolean`,
> `object`, `array` et `date`. Une colonne `json` ou `datetime` dont les contraintes
> contiennent `"type": "json"` / `"type": "datetime"` fait échouer l'insertion avec
> `500 validate.validators.type.types.<type> must be a function`. Les contraintes de ces
> colonnes doivent donc être réduites à `{ "presence": false }` (la colonne conserve son
> type `json` / `datetime`). C'est appliqué à la table de référence ; à reproduire si la
> table est recréée par script.

### Vérification rapide (curl)

```bash
KEY="<clé API>"; APP="app_dev_..."; TABLE="ta_..."
# Création d'une ligne
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-budibase-api-key: $KEY" -H "x-budibase-app-id: $APP" \
  -d '{"ticketTitle":"test","ticketId":1}' \
  "http://localhost:10000/api/public/v1/tables/$TABLE/rows"
# Lecture (GET interdit : POST /search)
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-budibase-api-key: $KEY" -H "x-budibase-app-id: $APP" \
  -d '{"limit":5}' \
  "http://localhost:10000/api/public/v1/tables/$TABLE/rows/search"
```

### Production : connecter l'ERP et Budibase

Budibase n'est **jamais** configuré par variable d'environnement côté ERP : l'URL, la clé,
l'App ID et le Table ID vivent dans `ApiConfig` (chiffrés), donc un changement ne nécessite
aucun redéploiement. Les seules variables à préparer sont celles de l'installation
(`BUDIBASE_URL`, `BUDIBASE_EMAIL`, `BUDIBASE_PASSWORD` pour `npm run budibase:setup`).

#### Topologie recommandée A — même hôte Docker, réseau interne

```bash
docker compose -f docker-compose.dokploy.yml -f docker-compose.budibase.yml up -d
```

L'overlay `docker-compose.budibase.yml` ajoute le service `budibase` sur `ia-hub-network`,
avec un volume nommé `budibase_data` et **aucune exposition publique** (port lié à
`127.0.0.1`). L'ERP utilise alors :

| Champ ERP | Valeur |
|---|---|
| URL de base | `http://budibase:80` (nom de service Docker) |
| App ID / Table ID / clé | générés par `npm run budibase:setup` |
| Chemin des lignes | `/api/public/v1/tables/{tableId}/rows` |

Accès admin au builder sans ouvrir de port :

```bash
ssh -L 10000:127.0.0.1:10000 <user>@<hôte-production>
# puis http://localhost:10000/builder
```

C'est la topologie la plus simple et la plus sûre : trafic ERP → Budibase confiné au bridge
Docker, pas de TLS à gérer, pas d'API publique exposée sur Internet.

#### Topologie B — Budibase sur un serveur distant

C'est le cas où Budibase et l'ERP n'ont **ni le même hôte ni le même réseau Docker** : la
connexion se fait par une URL réseau, et aucune résolution de nom de service n'est possible.

**1. Déployer Budibase sur son serveur** (fichier `docker-compose.budibase-standalone.yml`) :

```bash
# sur le serveur Budibase
BUDIBASE_BIND=0.0.0.0 BUDIBASE_PORT=10000 \
  docker compose -f docker-compose.budibase-standalone.yml up -d

# contrôle local
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:10000/health   # 200
```

`BUDIBASE_BIND=127.0.0.1` si un reverse proxy HTTPS est placé devant (recommandé).

Le fichier fige `name: ia-hub-budibase` et le volume `budibase_data` : le nom du volume ne
dépend donc pas du dossier courant (`BUDIBASE_PROJECT` / `BUDIBASE_VOLUME` pour les changer).
Sauvegarder ce volume : il contient CouchDB, MinIO et Redis, c'est-à-dire l'application, sa
table et la clé API.

**2. Ouvrir uniquement le nécessaire côté pare-feu** — le serveur ERP doit joindre le port
Budibase, personne d'autre :

```bash
# exemple ufw : autoriser seulement l'IP du serveur ERP
ufw allow from 10.0.70.30 to any port 10000 proto tcp
ufw deny 10000/tcp
```

**3. Vérifier depuis le conteneur ERP**, pas seulement depuis l'hôte (c'est lui qui appelle
Budibase) :

```bash
docker compose exec app node -e \
  "fetch('http://10.0.70.20:10000/health').then(r=>console.log('HTTP',r.status)).catch(e=>{console.error('KO',e.message);process.exit(1)})"
```

Un échec ici (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`) est un problème réseau/pare-feu/DNS,
pas un problème de configuration ERP.

**4. Créer l'app, la table et la clé** — deux méthodes selon ce que tu veux exposer :

```bash
# a) depuis le serveur ERP : le builder doit être joignable depuis cette machine
cd erp-backend
BUDIBASE_URL=http://10.0.70.20:10000 \
BUDIBASE_EMAIL=automation@prosuma.ci BUDIBASE_PASSWORD='...' \
  npm run budibase:setup

# b) depuis le serveur Budibase (aucune exposition du builder) :
#    lancer le script en local, puis recopier App ID / Table ID / clé dans l'UI ERP
BUDIBASE_URL=http://127.0.0.1:10000 ... npm run budibase:setup
```

**5. Renseigner l'ERP** (Paramètres → Autres intégrations → Budibase) :

| Champ | Valeur |
|---|---|
| URL de base | `https://budibase.prosuma.ci` ou `http://10.0.70.20:10000` |
| App ID | `app_dev_...` affiché par le script |
| Table ID | `ta_...` affiché par le script |
| Clé API | clé du compte d'automatisation |
| Chemin des lignes | `/api/public/v1/tables/{tableId}/rows` |

Puis **Tester** : l'appel doit renvoyer 200. Il vérifie URL + clé + App ID + Table ID en une
seule requête (`POST /rows/search`).

**6. HTTPS et certificat** — si le réseau n'est pas totalement de confiance, ne pas laisser
l'API en clair (la clé voyage dans l'en-tête). Reverse proxy Caddy :

```caddyfile
budibase.prosuma.ci {
    reverse_proxy 127.0.0.1:10000
}
```

Nginx (les en-têtes `Upgrade` sont nécessaires au builder temps réel) :

```nginx
server {
    listen 443 ssl;
    server_name budibase.prosuma.ci;
    ssl_certificate     /etc/ssl/certs/budibase.crt;
    ssl_certificate_key /etc/ssl/private/budibase.key;
    location / {
        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Si le certificat est émis par une **AC interne**, le conteneur ERP doit la connaître :

```yaml
# docker-compose.dokploy.yml (service app)
environment:
  NODE_EXTRA_CA_CERTS: /app/certs/ca.pem
volumes:
  - ./certs:/app/certs:ro
```

Sans cela, la synchronisation échoue avec `unable to verify the first certificate` ou
`self-signed certificate in certificate chain` (statut `FAILED`, `lastError` explicite).

**7. Nom d'hôte** — si tu utilises `https://budibase.prosuma.ci`, vérifier que le DNS résout
**depuis le conteneur ERP** (`docker compose exec app node -e "require('dns').lookup('budibase.prosuma.ci',(e,a)=>console.log(e||a))"`). À défaut, utiliser l'IP avec un certificat
couvrant cette IP.

#### Checklist de mise en production

| Point | À faire |
|---|---|
| **Clé de chiffrement** | `SECRETS_ENCRYPTION_KEY` définie **avant** de créer l'`ApiConfig` et sauvegardée hors serveur. Sans elle, les secrets sont en clair ; si elle est perdue, ils sont irrécupérables. |
| **Compte Budibase dédié** | Créer un utilisateur d'automatisation (rôle builder/admin) et utiliser **sa** clé API. Une clé appartient à un utilisateur : si la personne part, l'intégration casse. |
| **Rotation de clé** | Générer une nouvelle clé, la saisir dans Paramètres → Autres intégrations → Budibase, enregistrer. Aucun redéploiement ; le scheduler prend la nouvelle clé au prochain envoi. |
| **Persistance** | Volume `budibase_data` sauvegardé (CouchDB + MinIO + Redis). Snapshot avant chaque mise à jour d'image. |
| **Version d'image** | Épingler `BUDIBASE_IMAGE=budibase/budibase:<tag validé>`. `latest` peut changer le comportement de l'API publique. |
| **Pas d'exposition publique** | En topologie A, le port reste sur `127.0.0.1`. En topologie B, filtrer par IP source. |
| **Supervision** | `GET /api/account-provisioning/stats` : surveiller `byBudibaseStatus.FAILED` et `lastError`. Rejeu automatique toutes les `accountProvisioningRetrySeconds` (300 s), **20 tentatives maximum**. |
| **Blocage après 20 échecs** | Corriger la config puis utiliser « Relancer » dans Paramètres → Avancé → Supervision, ou `POST /api/account-provisioning/records/:id/retry`. |
| **Indisponibilité** | La base PostgreSQL reste la source de vérité : la déclaration est enregistrée et le ticket résolu même si Budibase est down (`FAILED`, puis rejeu). |

#### Vérification de bout en bout en production

```bash
cd erp-backend
BUDIBASE_URL=https://budibase.prosuma.ci \
BUDIBASE_EMAIL=automation@prosuma.ci \
BUDIBASE_PASSWORD='...' \
npm run budibase:setup
```

Le script est idempotent, réutilise la clé existante, vérifie l'écriture/lecture et affiche les
valeurs à saisir. Terminer par **Tester** dans l'UI, puis déclarer une opération sur un ticket
et vérifier la ligne dans la table `declarations`.

## Détection des applications

**Entrées analysées** — au moment où la modale s'ouvre (donc au passage en `SOLVED`) :

1. le **titre** du ticket ;
2. son **contenu** (HTML converti en texte) ;
3. les **8 derniers suivis** (`Followup`), du plus ancien au plus récent.

Les **pièces jointes ne sont pas analysées** (ni images, ni PDF, ni documents). Le texte total
est tronqué à 6 000 caractères. La détection n'est pas recalculée à chaque nouvel envoi : elle
reflète l'état de la conversation au moment de l'ouverture de la modale.

**Chaîne de traitement** :

1. **Pré-filtre déterministe** — mots-clés « compte / accès / identifiant / login / droits… » et
   preuve au passé, en écartant négations et demandes. Sans pré-filtre ni alias détecté : aucun
   appel IA.
2. **Alias du catalogue** — correspondance sur mot entier, l'alias le plus long gagne
   (« Sage Paie » ne déclenche pas « Sage X3 »).
3. **IA contrainte** — un seul appel, sortie JSON validée contre le catalogue fermé.
4. **File de candidats** — les noms cités mais absents du catalogue sont renvoyés dans
   `unknownApplications`, écartés de la proposition, puis enregistrés dans `ApplicationCandidate`
   (une ligne par nom normalisé : casse, accents et ponctuation neutralisés). Le SUPERADMIN les
   promeut depuis **Paramètres → Avancé → Applications citées hors catalogue**, avec alias et
   profils, ou les fusionne avec une application existante, ou les ignore. Un candidat déjà
   promu ou ignoré n'est jamais ré-ouvert.

## IA : ce qui est fiable, ce qui ne l'est pas

Le pré-remplissage est **une aide, jamais une décision** :

1. **Pré-filtre déterministe** (mots-clés + alias du catalogue) : évite un appel IA inutile.
   Il distingue une **demande** (« merci de créer… », « il faudrait donner accès… ») d'une
   **réalisation attestée** (« le compte a été créé », « les droits ont été ajoutés ») et détecte
   les **négations** (« aucun compte créé », « aucun droit ajouté », « compte déjà existant »).
   Les mises à jour de droits comptent comme une opération à déclarer.
2. **Sortie structurée** : `callAI(prompt, maxTokens, { jsonSchema })` envoie
   `responseSchema` (Gemini) ou `response_format: json_object` (API compatibles OpenAI).
   Le schéma `AI_RESPONSE_SCHEMA` impose `isAccountProvisioning`, `confidence`, `reason`,
   `evidence` et `accounts[]` (`application` + `operation`, puis `login`, `email`, `profile`,
   `rights`, `type`, `quantity`), et accepte `unknownApplications[]` pour les logiciels cités
   hors catalogue.
3. **Validation stricte contre le catalogue** : une application inventée est ignorée
   (`ignoredApplications`), elle ne peut pas être enregistrée ; elle alimente la file de
   candidats validée par un administrateur.
4. **Preuve et seuil** : la réponse doit citer un extrait exact (`evidence`). En dessous de
   `MIN_ACCOUNTS_CONFIDENCE = 0.6`, les **comptes** ne sont pas pré-remplis (seules les
   applications sont proposées) et l'UI affiche un bandeau explicite.
5. **Arbitrage** : quand l'IA répond, c'est elle qui tranche la classification ; le pré-filtre
   déterministe ne sert que de **repli** (IA désactivée, en échec, quota atteint, ou hors
   pré-filtre). Les applications détectées par alias sont conservées pour information.
6. **Repli automatique** sur le pré-filtre si `aiEnabled=false`, `aiKillSwitch=true` ou budget
   tokens épuisé. Le formulaire reste toujours éditable et l'échappatoire « aucun compte »
   toujours disponible.

## Supervision et mesure

`GET /api/account-provisioning/stats` renvoie :

- `total`, répartition `bySource` et `byBudibaseStatus` ;
- `byOperation` (`CREATION` / `DROITS`) et `rightsUpdates` : nombre de mises à jour de droits ;
- `prefill` : nombre de pré-remplissages IA / déterministes, applications **acceptées** vs
  **corrigées**, comptes acceptés, déclarations vidées après pré-remplissage, `acceptanceRate` ;
- `topIgnoredApplications` : applications citées hors catalogue, à ajouter au référentiel.

La carte « Supervision des déclarations » affiche ces indicateurs, la liste paginée des
déclarations (filtre par statut Budibase) et permet de rejouer une synchronisation à l'unité
ou en lot.

## Évaluation hors ligne

```bash
cd erp-backend
npm run eval:account-provisioning          # jeu par défaut, exit 1 en cas d'échec
npm run eval:account-provisioning -- --verbose
npm run eval:account-provisioning -- --file scripts/fixtures/mon-jeu.json
```

Le script rejoue des tickets annotés sur la couche **déterministe** (aucun réseau, aucune base) et
affiche la matrice de confusion, la précision et le rappel des applications. Le jeu par défaut
(`scripts/fixtures/accountProvisioning.eval.json`) couvre 21 cas : demandes, réalisations
attestées, mise à jour de droits attestée, demande de droits non réalisée, négations,
chevauchement Sage Paie / Sage X3, multi-applications, fragments de mots.

## Tests

```bash
cd erp-backend
npx jest src/services/accountProvisioning.test.js
```

Couvre : normalisation, refus des secrets, idempotence, URL Budibase, parsing IA, preuve,
booléen explicite, mapping des alias, résolution de chevauchement, conflits d'alias, champs
obligatoires, listes fermées de profils, doublons de lignes, détection déterministe
(demande / attestation / négation).
