# Installer IA Hub sur son poste ou un serveur

Ce guide s'adresse à toute personne qui doit installer l'application — pas besoin de connaissances en développement. Pour les détails techniques avancés (migrations, structure du code, permissions), voir [README.md](README.md).

## Ce qu'il faut avant de commencer

| Besoin | Pourquoi |
|---|---|
| Un ordinateur (Windows, Mac ou Linux) ou un serveur Linux | C'est là que l'application va tourner |
| Une connexion internet | Pour télécharger les composants nécessaires |
| Docker installé | C'est l'outil qui fait tourner l'application — installation expliquée ci-dessous |
| Les ports 3000, 4000, 5433 libres (et 8080 si vous créez un GLPI) | Ces "numéros" doivent être disponibles sur la machine pour que l'application puisse fonctionner |

Vous n'avez **pas besoin** d'installer Node.js, une base de données, ou tout autre outil de développement : tout est inclus.

---

## Étape 1 — Installer Docker

### Sur Windows ou Mac
1. Téléchargez [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Lancez l'installateur et suivez les instructions.
3. Sur Windows, si l'installateur le demande, activez "WSL2" (proposé automatiquement).
4. Redémarrez l'ordinateur si demandé.
5. Lancez Docker Desktop et attendez qu'il affiche "Docker is running" (icône verte).

### Sur un serveur Linux
Ouvrez un terminal et exécutez :
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```
Puis déconnectez-vous et reconnectez-vous (ou redémarrez le serveur) pour que le changement prenne effet.

Pour vérifier que tout est bien installé, exécutez :
```bash
docker compose version
```
Si une version s'affiche, c'est bon.

---

## Étape 2 — Récupérer le projet

Si vous avez reçu une archive (.zip) du projet, décompressez-la dans un dossier de votre choix.

Si vous installez depuis Git :
```bash
git clone <url-du-dépôt>
cd Projet_IA_Hub
```

---

## Étape 3 — Lancer l'application

Ouvrez un terminal dans le dossier du projet, puis exécutez :

**Sur Mac/Linux :**
```bash
chmod +x start.sh
./start.sh
```

**Sur Windows**, utilisez le terminal "WSL" ou Git Bash (installé avec Docker Desktop) pour lancer la même commande.

Le script vous demande comment gérer GLPI (l'outil de tickets utilisé en arrière-plan) :
```
1) Je n'ai pas encore de GLPI -> en créer un nouveau
2) J'ai déjà un GLPI qui tourne, ou je le configurerai plus tard
```

- Si c'est votre **première installation** et que vous n'avez pas déjà un GLPI ailleurs, répondez **1**.
- Si votre entreprise a déjà un GLPI existant, répondez **2** (vous le connecterez plus tard depuis l'interface, voir Étape 5).

Le premier démarrage télécharge et prépare tout — cela peut prendre **plusieurs minutes**. C'est normal, ne fermez pas le terminal.

À la fin, vous verrez :
```
=== Stack démarrée ===
Dashboard : http://localhost:3000
API       : http://localhost:4000
```

---

## Étape 4 — Se connecter

1. Ouvrez votre navigateur web et allez sur **http://localhost:3000** (sur un serveur distant, remplacez `localhost` par l'adresse IP ou le nom du serveur).
2. Connectez-vous avec le compte créé automatiquement :
   ```
   Email    : superadmin@prosuma.ci
   Mot de passe : 12345678
   ```
3. **Changez ce mot de passe dès la première connexion** (menu Utilisateurs, ou directement proposé par l'application).

Ce premier compte est un **Super Administrateur** : il a tous les droits. C'est lui qui doit créer les autres comptes (administrateurs, techniciens...) et leur donner des droits via le menu **Groupes de droits**.

---

## Étape 5 — Configuration de base (à faire une fois)

Depuis le menu **Paramètres** :

### Intelligence Artificielle (obligatoire)
L'application a besoin d'au moins un fournisseur d'IA actif pour fonctionner (analyse des emails, création de tickets).
1. Allez dans **Paramètres → Intelligence Artificielle**.
2. Ajoutez un fournisseur (Gemini, OpenAI, Anthropic, NVIDIA NIM ou Mistral) avec une clé API.
   - Le plus simple pour démarrer : **Gemini**, avec une clé gratuite sur [aistudio.google.com](https://aistudio.google.com).

### GLPI (si vous avez répondu "2" à l'étape 3, ou pour connecter un GLPI existant)
1. Allez dans **Paramètres → Autres intégrations**.
2. Ajoutez un service nommé `glpi` avec l'URL de votre GLPI, votre clé API (User Token) et votre App Token.
3. Cliquez sur **Synchroniser GLPI**.

### Email Outlook (optionnel, pour recevoir de vrais emails automatiquement)
1. Allez dans **Paramètres → Email (Outlook / IMAP)**.
2. Ajoutez un compte et suivez les instructions de connexion (nécessite une app enregistrée sur le portail Azure de votre entreprise — demandez à votre service informatique si besoin).

---

## Et après ?

Une fois connecté en Super Administrateur, vous pouvez :
- Créer des comptes pour vos collègues (menu **Utilisateurs**).
- Créer des **groupes de droits** pour définir précisément ce que chaque personne peut voir/faire (menu **Groupes de droits**).
- Commencer à recevoir et traiter des tickets.

---

## En cas de problème

| Symptôme | Solution |
|---|---|
| `./start.sh` refuse de se lancer ("Permission denied") | Exécutez `chmod +x start.sh` puis recommencez |
| La page http://localhost:3000 ne s'affiche pas | Attendez 1-2 minutes après le démarrage, puis rafraîchissez. Si ça persiste, exécutez `docker compose logs -f` pour voir si une erreur s'affiche |
| Le mot de passe par défaut ne fonctionne plus | Voir la section "Identifiants par défaut" du [README.md](README.md#identifiants-par-défaut) pour le recréer |
| Vous devez arrêter l'application | `docker compose down` (les données restent conservées) |
| Vous devez tout réinitialiser (efface toutes les données) | `docker compose down -v` — **irréversible**, à utiliser avec précaution |

Pour toute question plus technique (mises à jour, sauvegardes, détails sur les permissions), consultez le [README.md](README.md).
