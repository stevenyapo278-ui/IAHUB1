# Guide de configuration — Projet IA Hub

```text
Plateforme de ticketing ITSM avec pipeline email → IA → GLPI
```

---

## 1. Connexion GLPI

**Menu :** `Settings → Intégrations → GLPI`

| Champ | Description |
|---|---|
| URL de base | `https://glpi.exemple.com/apirest.php` |
| App Token | Token d'application généré dans GLPI : `Configuration → Générale → API → App-token` |
| User Token | Token utilisateur : `Administration → Utilisateurs → [ton profil] → Token d'accès API` |

Tester la connexion après configuration. Un statut `✓ Connecté` doit s'afficher.

---

## 2. Comptes Email (Outlook)

**Menu :** `Settings → Intégrations → Email`

Chaque compte Outlook suit le flux OAuth 2.0 :

1. Créer une application dans [Azure Portal](https://portal.azure.com) (Entra ID)
2. Ajouter les permissions : `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`
3. Renseigner dans la plateforme :
   - **Client ID** (Azure)
   - **Client Secret** (Azure)
   - **Tenant ID** (Azure)
   - **Email** du compte à connecter
4. Cliquer **Autoriser** → redirection vers Microsoft → connexion → retour automatique
5. Le refresh token est stocké en base et mis à jour automatiquement

> Le pipeline relève les emails toutes les X secondes (configurable dans `Settings → Advanced → Fréquences de synchronisation → Relevé des emails`).

---

## 3. Fournisseurs IA

**Menu :** `Settings → Intelligence Artificielle`

### Providers supportés

| Provider | Type | URL par défaut |
|---|---|---|
| OpenAI | OpenAI-compatible | `https://api.openai.com/v1` |
| NVIDIA | OpenAI-compatible | `https://api.nvcf.nvidia.com/v1` |
| Mistral | OpenAI-compatible | `https://api.mistral.ai/v1` |
| Gemini | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` |
| Anthropic | Claude | `https://api.anthropic.com` |

### Configuration minimale

1. Ajouter un provider (nom, URL, clé API)
2. Activer le provider
3. Ajouter au moins un modèle (nom exact attendu par l'API du provider)
4. Marquer un modèle comme **par défaut**

> La plateforme utilise le premier provider actif disposant d'au moins une clé API valide.

---

## 4. Règles de Triage Automatique

**Menu :** `Settings → Advanced → Règles de triage automatique`

Les règles permettent d'assigner catégorie, compétence et équipe sans passer par l'IA.

### Critères disponibles

| Champ | Usage |
|---|---|
| Sujet ou Corps | Recherche textuelle dans l'email |
| Expéditeur | Correspondance sur l'adresse email |
| Domaine | Pour les VIP / domaines spécifiques (ex: `@direction.ci`) |
| Sentiment IA | Détecte les emails frustrés ou urgents |
| Plage Horaire | Applique un traitement différent la nuit / hors-lignes |

### Ordre d'évaluation

Les règles sont évaluées par ordre de **priorité** (le plus petit chiffre = évalué en premier).  
La première règle qui correspond déclenche ses actions.

---

## 5. Automatisations

**Menu :** `Settings → Automation`

### 5.1 Emails & Communication Client

| Réglage | Description |
|---|---|
| **Message d'accueil** | Texte personnalisé inséré dans l'accusé de réception. Placeholders : `{ticketId}`, `{subject}`, `{toName}` |
| **Signature** | HTML personnalisé. Supporte un logo uploadé |
| **Logo** | Image affichée dans la signature des emails automatiques |

### 5.2 Few-Shot Triage

Active l'utilisation des tickets résolus comme exemples pour l'IA. Quand activé, l'IA reçoit 5 tickets similaires déjà classés pour améliorer la précision de ses prédictions.

### 5.3 Relances Tickets & Clôture

| Réglage | Défaut | Description |
|---|---|---|
| **Relance & Clôture auto.** | OFF | Active le module. Crée des brouillons de relance (à valider dans le Centre de Validation) et clôture les tickets sans réponse |
| **Première relance** | 2 jours | Délai avant la 1ère relance |
| **Deuxième relance** | 5 jours | Délai avant la 2ème relance |
| **Avertissement clôture** | 10 jours | Préviens le demandeur que le ticket va être clôturé |
| **Clôture auto.** | 15 jours | Fermeture définitive sans réponse |

> Les relances ne sont plus envoyées directement : elles créent un brouillon visible dans `Centre de Validation → Relances Auto.`.  
> L'email ne part que quand un admin clique **Approuver & Envoyer**.

### 5.4 Validation des Brouillons

| Réglage | Défaut | Description |
|---|---|---|
| **Relance email** | OFF | Envoie un email aux administrateurs quand un brouillon reste en attente |
| **Délai de relance** | 30 min | Temps d'attente avant d'envoyer l'alerte |

### 5.5 Notifications

| Réglage | Description |
|---|---|
| **Récapitulatif quotidien** | Email automatique listant tous les tickets ouverts, envoyé à l'heure configurée |
| **Email au technicien assigné** | Notification quand un ticket lui est assigné par l'IA |
| **Alerte vocale** | Annonce vocale dans le navigateur pour les actions en attente |

---

## 6. Paramètres Avancés

**Menu :** `Settings → Advanced`

### 6.1 Décisions Automatiques

| Réglage | Description |
|---|---|
| **Auto-envoi des emails IA** | Expédie les réponses IA sans validation humaine |
| **Auto-approbation GLPI** | Valide automatiquement les solutions GLPI dans l'ERP |
| **Création GLPI automatique** | Crée un ticket GLPI dès l'approbation ERP |

### 6.2 Fréquences de Synchronisation

| Service | Défaut | Unité |
|---|---|---|
| Tickets GLPI | 60 s | secondes |
| Relevé des emails | 60 s | secondes |
| Structure GLPI | 60 min | minutes |
| Modèles IA | 24 h | heures |

### 6.3 Réimport de données

Permet de **réinitialiser** les données GLPI ou de **réimporter** des emails Outlook sur une plage de dates.

> Attention : le réimport GLPI supprime les tickets synchronisés dans l'ERP avant de les re-créer depuis GLPI.

---

## 7. Webhook n8n

La création de brouillons IA depuis n8n nécessite un secret partagé configuré dans `Settings → Intégrations → n8n`.

Headers requis :
```
Content-Type : application/json
x-webhook-secret : <secret configuré>
```

Payload :
```json
{
  "ticketId": 42,
  "recipientEmail": "client@exemple.com",
  "subject": "Objet de l'email",
  "proposedContent": "Corps de l'email en HTML"
}
```

---

## 8. Permissions

| Permission | Rôles | Accès |
|---|---|---|
| `emaildrafts.manage` | ADMIN, TECHNICIAN | Approuver/rejeter les brouillons |
| `locations.manage` | ADMIN | Gérer les sites GLPI |
| `tickets.manage` | HOTLINE, ADMIN, TECHNICIAN | Gestion complète des tickets |
| `users.manage` | SUPERADMIN | Gestion des utilisateurs |
| `audit-logs.view` | SUPERADMIN | Consultation des logs d'audit |

---

## 9. Circuit Breaker

La plateforme intègre un circuit breaker pour 3 services externes :

| Service | Seuil | Durée d'ouverture |
|---|---|---|
| GLPI API | 3 échecs consécutifs | 30 s |
| Outlook Graph | 3 échecs consécutifs | 60 s |
| Fournisseur IA (par type) | 3 échecs consécutifs | 30 s |

**Supervision :** `GET /api/system/circuit-breakers`

---

## 10. Correspondance Status

### Statuts Ticket ERP → GLPI

| ERP | GLPI |
|---|---|
| NEW | 1 (Nouveau) |
| OPEN | 2 (En cours) |
| PENDING | 4 (En attente) |
| WAITING_FOR_USER | 4 (En attente) |
| SOLVED | 5 (Résolu) |
| CLOSED | 6 (Fermé) |

### Statuts Brouillon

```
PENDING  ──approve──>  APPROVED  (email envoyé)
    │
    └──reject──>  REJECTED  (ignoré)
                      │
                restore ──> PENDING  (réouverture)
```
