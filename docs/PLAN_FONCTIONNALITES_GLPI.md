# Plan de mise en œuvre — Fonctionnalités GLPI manquantes

> Document de référence pour l'implémentation des fonctionnalités GLPI absentes de la plateforme
> (e-ticketing autonome sans GLPI). À consulter à chaque phase pour ne pas perdre le fil.

---

## 1. Vue d'ensemble

| Phase | Fonctionnalité | Priorité | Effort | Dépend de |
|-------|---------------|----------|--------|-----------|
| **P1** | Échéance manuelle (due date) | Haute | 2-3 h | — |
| **P2** | Sous-tickets / tickets enfants | Haute | 3-4 h | P1 (statuts) |
| **P3** | Temps passé / timesheet | Moyenne | 1-2 j | — |
| **P4** | Catégories arborescentes | Moyenne | 4-5 h | — |
| **P5** | Champs personnalisés (forms) | Basse | 1-2 j | P4 |
| **P6** | Inventaire d'assets (MVP natif) | Basse | ~1 sem | P1, P4 |

Ordre conseillé : **P1 → P2 → P3** (améliorent directement la création de tickets), puis **P4 → P5** (structuration), enfin **P6** (gros chantier).

---

## 2. Règles transverses (conventions à respecter)

- **Backend** : CommonJS (`require`/`module.exports`), identifiants en anglais, commentaires en français
- **Frontend** : ESM (`import`/`export`), JSX
- **Migrations** : ne jamais modifier une migration existante ; nouvelle migration `YYYYMMDDHHMMSS_description`
- **Seed** : idempotent (upserts) ; ne jamais ajouter de migration obligatoire dans le seed
- **Prisma** : toujours importer depuis `erp-backend/src/prismaClient.js`
- **Permissions** : toute nouvelle permission est ajoutée **à la fois** dans
  `erp-backend/src/config/permissions.js` **et** `erp-frontend/src/config/permissions.js`,
  puis utilisée via `requirePermission('key', [...])` côté API et `hasPermission(user, 'key')` côté UI
- **Mode autonome** : toutes les phases doivent fonctionner **sans GLPI** (le réglage `autonomousMode`
  neutralise `getActiveGlpiConfig()` — ne jamais casser ce point de passage unique)
- **GLPI URL** : toujours retirer le slash final (`config.baseUrl.replace(/\/+$/, '')`)
- **Vérification** : `npx prisma generate` + build frontend (`npm run build`) + tests backend
  (`npm test`) après chaque phase ; les 14 échecs de tests préexistants (mocks `getActiveProviders`)
  ne sont pas liés à ces phases

---

## 3. Phase 1 — ⏰ Échéance manuelle (due date)

**Objectif** : poser une date limite à la main sur un ticket (indépendamment du SLA automatique),
avec alerte en cas de dépassement.

### Backend
- [ ] `erp-backend/prisma/schema.prisma` → modèle `Ticket` : ajouter `dueDate DateTime?`
- [ ] Migration : `ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);`
- [ ] `erp-backend/src/routes/ticket.routes.js` :
  - création (`POST /tickets`) : accepter `dueDate`
  - mise à jour (`PATCH /:id`) : accepter `dueDate`
  - `GET /tickets` : accepter le filtre `due=overdue` (dueDate < now ET statut non résolu/clôturé)
- [ ] Scheduler dans `erp-backend/src/server.js` : nouveau `scheduleSync('due-dates', checkOverdueDueDates, ...)`
  - scan des tickets `dueDate < now` et statut non `SOLVED`/`CLOSED` → notification + `TicketEvent` + email
  - réutiliser `withHealthTracking` et `notifyUser` existants
- [ ] Exposer `dueDate` dans les payloads retournés (déjà inclus par défaut avec `findUnique` complet)

### Frontend
- [ ] `erp-frontend/src/pages/Tickets.jsx` : input date dans le formulaire de création
- [ ] `erp-frontend/src/pages/TicketDetail.jsx` : affichage/édition de l'échéance
- [ ] Badge échéance dans la liste et le kanban :
  - `⏰ 12/09` (à venir), `🟠 Bientôt` (< 24 h), `🔴 En retard` (dépassée + non clôturé)

### Critères d'acceptation
- [ ] Création d'un ticket avec échéance ; badge visible en liste
- [ ] Échéance dépassée → notification + événement dans le journal
- [ ] Filtre `due=overdue` renvoie uniquement les tickets en retard

---

## 4. Phase 2 — 👨‍👩‍👧 Sous-tickets / tickets enfants

**Objectif** : relation parent/enfant explicite avec clôture en cascade.

### Backend
- [x] Réutiliser `TicketLink` (mécanisme existant) en ajoutant les types `PARENT`/`CHILD`
  (vérifier l'enum des types de lien — sinon l'étendre dans `schema.prisma` + migration)
- [x] Règles de clôture : clôturer un parent → clôture des enfants (et inversement) ;
  configurable via `SystemSettings` (`closeChildrenWithParent`, défaut `false`)
- [x] `GET /tickets/:id` : inclure les sous-tickets liés (`links` déjà présents)
- [x] Notification aux participants quand un sous-ticket est créé depuis un parent

### Frontend
- [x] `erp-frontend/src/pages/TicketDetail.jsx` : onglet/section « Sous-tickets » :
  - arborescence visuelle (parent → enfants)
  - bouton « Créer un sous-ticket » : hérite catégorie, équipe, demandeur, priorité du parent

### Critères d'acceptation
- [x] Créer un enfant depuis un parent ; visible dans les deux sens
- [x] Clôture en cascade activable/désactivable dans Paramètres → Avancé

---

## 5. Phase 3 — ⏱️ Temps passé / timesheet

**Objectif** : suivi du temps passé par technicien sur chaque ticket (module « Plan » de GLPI).

### Backend
- [x] `erp-backend/prisma/schema.prisma` → nouveau modèle `TicketTimeEntry` :
  ```prisma
  model TicketTimeEntry {
    id           Int      @id @default(autoincrement())
    ticketId     Int
    ticket       Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
    userId       Int
    user         User     @relation(fields: [userId], references: [id])
    minutes      Int
    description  String?
    entryDate    DateTime @default(now())
    @@index([ticketId])
    @@index([userId])
  }
  ```
  + relations `Ticket.timeEntries` / `User.timeEntries`
- [x] Migration + `npx prisma generate`
- [x] Nouveau fichier `erp-backend/src/routes/timesheet.routes.js` :
  - `POST /timesheet` (ajout manuel), `POST /timesheet/timer/start` / `/stop`
    (timer : `{ ticketId, startedAt }` → crée l'entrée à l'arrêt)
  - `GET /timesheet?ticketId=&userId=&from=&to=` (agrégats : total, par jour)
  - `DELETE /timesheet/:id`
  - permission `tickets.timesheet` (backend + frontend configs)
- [x] Montage dans `erp-backend/src/app.js`

### Frontend
- [x] `erp-frontend/src/pages/TicketDetail.jsx` : panneau « Temps passé » :
  - timer live (start/stop), saisie manuelle (minutes + description), liste des entrées, total
- [ ] Widget/mini-rapport temps par technicien (optionnel : dans le Dashboard)

### Critères d'acceptation
- [x] Démarrer/arrêter un timer → entrée créée avec la bonne durée
- [x] Total par ticket affiché ; filtre par technicien/période fonctionnel

---

## 6. Phase 4 — 🗂️ Catégories arborescentes

**Objectif** : sous-catégories (`Matériel > Impression > Imprimante`).

### Backend
- [x] `erp-backend/prisma/schema.prisma` → `TicketCategory` : ajouter `parentId Int?` + auto-relation
- [x] Migration
- [x] `erp-backend/src/routes/glpi.routes.js` (routes catégories locales) :
  - CRUD gère `parentId`, empêche de supprimer une catégorie ayant des enfants
  - `GET /glpi/categories` renvoie l'arbre (ou liste plate + `parentId` pour construction côté client)
- [x] Sync GLPI (`erp-backend/src/services/glpiTicketCreator.js`) : mapper `itilcategories.parent_id`
  lors de `syncCategoriesFromGlpi`

### Frontend
- [x] `erp-frontend/src/pages/Categories.jsx` : vue **arbre** (pli/dépliage, indentations)
- [x] Sélecteur hiérarchique dans `Tickets.jsx` (création) et `TicketDetail.jsx` (édition)
  (breadcrumb `Matériel › Impression › Imprimante`)

### Critères d'acceptation
- [x] Création de sous-catégories ; arbre visible dans la page Catégories
- [x] Sélecteur de création de ticket navigable par niveau ; filtre par sous-catégorie

---

## 7. Phase 5 — 🧩 Champs personnalisés (forms)

**Objectif** : questionnaires par catégorie/type de demande (équivalent du plugin GLPI Forms).

### Backend
- [ ] `schema.prisma` : nouveau modèle `CustomFieldDefinition` :
  ```prisma
  model CustomFieldDefinition {
    id         Int      @id @default(autoincrement())
    label      String
    type       String   // TEXT | NUMBER | SELECT | DATE | TEXTAREA | CHECKBOX
    options    Json?    // pour SELECT : liste des choix
    required   Boolean  @default(false)
    categoryId Int?     // null = applicable à toutes les catégories
    category   TicketCategory? @relation(fields: [categoryId], references: [id], onDelete: Cascade)
    position   Int      @default(0)
    isActive   Boolean  @default(true)
  }
  ```
- [ ] `Ticket` : ajouter `customFields Json?` (valeurs `{ champId: valeur }`)
- [ ] Migrations + génération
- [ ] Routes CRUD `CustomFieldDefinition` (permission `tickets.manage`) + validation serveur à la
  création de ticket (champs requis présents)
- [ ] Export PDF du ticket : inclure les champs personnalisés

### Frontend
- [ ] `erp-frontend/src/pages/Settings/` : onglet « Champs personnalisés » (éditeur de définition)
- [ ] Rendu dynamique dans le formulaire de création (`Tickets.jsx`) selon la catégorie choisie
- [ ] Affichage en lecture dans `TicketDetail.jsx`

### Critères d'acceptation
- [ ] Définir un formulaire pour une catégorie → apparaît à la création d'un ticket de cette catégorie
- [ ] Champs requis bloquants ; valeurs visibles dans le détail et l'export PDF

---

## 8. Phase 6 — 💻 Inventaire d'assets (MVP natif)

**Objectif** : inventaire des équipements (postes, imprimantes, réseau, téléphones, logiciels,
licences) géré **en local** (mode autonome), relié aux tickets, avec import GLPI optionnel.

### 8.1 Backend — Modèle
- [ ] `erp-backend/prisma/schema.prisma` → nouveau modèle `Asset` :
  ```prisma
  model Asset {
    id               Int       @id @default(autoincrement())
    name             String
    assetType        String    // COMPUTER | PRINTER | NETWORK | SOFTWARE | LICENSE | PHONE | OTHER
    serialNumber     String?
    inventoryNumber  String?
    status           String    @default("IN_USE") // IN_USE | STOCK | BROKEN | OUT_OF_SERVICE
    manufacturer     String?
    model            String?
    glpiLocationId   Int?
    glpiLocation     GlpiLocation? @relation(fields: [glpiLocationId], references: [glpiLocationId])
    ownerId          Int?
    owner            User?     @relation(fields: [ownerId], references: [id])
    teamId           Int?
    team             Team?     @relation(fields: [teamId], references: [id])
    purchaseDate     DateTime?
    warrantyEnd      DateTime?
    notes            String?
    glpiAssetId      Int?      @unique // id GLPI d'origine (si importé)
    createdAt        DateTime  @default(now())
    updatedAt        DateTime  @updatedAt
    tickets          Ticket[]  // via la table de liaison ci-dessous

    @@index([assetType])
    @@index([status])
    @@index([glpiLocationId])
    @@index([ownerId])
  }
  ```
- [ ] Table de liaison `AssetTicket` :
  ```prisma
  model AssetTicket {
    assetId   Int
    asset     Asset  @relation(fields: [assetId], references: [id], onDelete: Cascade)
    ticketId  Int
    ticket    Ticket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
    @@id([assetId, ticketId])
    @@index([ticketId])
  }
  ```
  + relations inverses sur `Ticket` et `User` (vérifier les noms de relations existants)
- [ ] Migrations + `npx prisma generate`
- [ ] Permissions : `assets.manage` (backend + frontend configs)

### 8.2 Backend — Routes
- [ ] Nouveau fichier `erp-backend/src/routes/asset.routes.js` :
  - `GET /assets` : recherche (`q` sur nom/série/inventaire), filtres (`assetType`, `status`,
    `locationId`, `ownerId`, `ticketId`), pagination
  - `POST /assets`, `PATCH /assets/:id`, `DELETE /assets/:id` (permission `assets.manage`)
  - `GET /assets/search?q=` : autocomplétion légère pour le sélecteur de ticket
- [ ] `erp-backend/src/routes/ticket.routes.js` :
  - création : accepter `assetIds` → connect `AssetTicket`
  - `PATCH /:id` : accepter `assetIds`
  - `GET /tickets/:id` : inclure `assets`
- [ ] Montage dans `erp-backend/src/app.js`

### 8.3 Backend — Import GLPI (optionnel)
- [ ] `erp-backend/src/utils/glpiSync.js` : `syncAssetsFromGlpi()` en réutilisant `getActiveGlpiConfig()`
  + `initSession` :
  - `GET /Computer?range=...` (et `Printer`, `NetworkEquipment`, `Software`, `Phone` en V2)
  - mapper : `name`, `serial`, `otherserial` (n° inventaire), `locations_id` → `GlpiLocation`,
    `users_id_tech`/`users_id` → propriétaire, `date_achat`, `warranty_date`
  - upsert par `glpiAssetId` (idempotent), préfixe de type selon l'endpoint
- [ ] Scheduler dans `server.js` : intervalle 24 h + bouton manuel dans la page Inventaire
  (masqué si `autonomousMode`)

### 8.4 Frontend
- [ ] `erp-frontend/src/pages/Assets.jsx` (copie du modèle Locations/Categories) :
  - liste + recherche + filtres (type, statut, lieu) + CRUD (modal)
  - badges de type/statut colorés ; affichage garantie/échéance
- [ ] `erp-frontend/src/App.jsx` : route `assets` + menu dans `erp-frontend/src/layouts/MainLayout.jsx`
  (section « Organisation »)
- [ ] `erp-frontend/src/pages/Tickets.jsx` : sélecteur d'assets (SearchableMultiSelect) à la création
- [ ] `erp-frontend/src/pages/TicketDetail.jsx` : onglet « Éléments liés » (liste des assets + lien
  vers la page Inventaire)

### 8.5 Critères d'acceptation
- [ ] CRUD asset fonctionnel ; recherche par n° de série
- [ ] Lier des assets à un ticket à la création ; visibles dans le détail
- [ ] Page Inventaire accessible depuis le menu ; badges type/statut corrects
- [ ] (Si GLPI configuré) bouton d'import → les assets GLPI apparaissent sans doublons

---

## 9. Ordre de mise en œuvre & checkpoints

1. **P1** → commit `feat: échéance manuelle des tickets (dueDate + alertes)`
2. **P2** → commit `feat: sous-tickets et clôture en cascade`
3. **P3** → commit `feat: suivi du temps passé (timesheet + timer)`
4. **P4** → commit `feat: catégories arborescentes`
5. **P5** → commit `feat: champs personnalisés par catégorie`
6. **P6** → commit `feat: inventaire d'assets (MVP)`

Chaque phase se termine par :
- ✅ `npx prisma generate` (si migration)
- ✅ `npm run build` (frontend)
- ✅ tests backend non régressés
- ✅ vérification visuelle via le harnais CDP (proxy + instance) si le déploiement est dispo
- ✅ commit + push (sauf demande contraire)

---

## 10. Rappels utiles (chemins clés)

| Élément | Chemin |
|---------|--------|
| Schéma Prisma | `erp-backend/prisma/schema.prisma` |
| Migrations | `erp-backend/prisma/migrations/` |
| Seed idempotent | `erp-backend/prisma/seed.js` |
| Routes tickets | `erp-backend/src/routes/ticket.routes.js` |
| Sync GLPI + session | `erp-backend/src/utils/glpiSync.js` |
| Schedulers | `erp-backend/src/server.js` (`scheduleSync`) |
| Permissions backend | `erp-backend/src/config/permissions.js` |
| Permissions frontend | `erp-frontend/src/config/permissions.js` |
| Middleware auth/perm | `erp-backend/src/middleware/permissions.js` |
| Pages tickets | `erp-frontend/src/pages/Tickets.jsx`, `TicketDetail.jsx` |
| Page catégories | `erp-frontend/src/pages/Categories.jsx` |
| Routes SPA | `erp-frontend/src/App.jsx` |
| Menu | `erp-frontend/src/layouts/MainLayout.jsx` |
| Réglages avancés | `erp-frontend/src/pages/Settings/AdvancedTab.jsx` + `erp-backend/src/routes/advancedsettings.routes.js` |
