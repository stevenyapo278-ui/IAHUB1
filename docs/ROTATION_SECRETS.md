# Rotation des secrets et des tokens

Ce document décrit la procédure de rotation des secrets utilisés par IA Hub :

| Secret | Stockage | Rotation | Impact |
|---|---|---|---|
| `JWT_SECRET` | `.env` / secret manager | manuelle (déploiement) | Tous les jetons d'accès sont invalidés ; les clients se renouvellent automatiquement via le cookie de refresh. |
| GLPI — App Token + User Token | table `ApiConfig` (`serviceName = 'glpi'`) | outillée + console GLPI | Les appels GLPI échouent tant que l'ancien token est révoqué sans remplacement. |
| Clés fournisseurs IA | table `AiKey` | outillée + console fournisseur | Les appels au modèle concerné échouent si la clé est révoquée avant d'être remplacée. |
| Client Secret Outlook / mot de passe IMAP | table `EmailAccount` | console Azure / boîte mail | Le pipeline email s'arrête jusqu'à ré-autorisation OAuth. |
| Refresh tokens de session | table `AuthSession` (hash SHA-256) | révocation applicative | Les sessions concernées sont déconnectées. |
| `SECRETS_ENCRYPTION_KEY` | `.env` / secret manager | manuelle (déploiement) | Les secrets chiffrés en base deviennent illisibles si la clé est perdue ou changée sans migration. |

> **Règle d'or** : ne jamais mettre un secret en clair dans un ticket, un message, un fichier
> versionné ou l'historique shell. Utiliser les variables d'environnement (comme ci-dessous)
> et les champs masqués de l'interface.

---

## 1. Inventaire et détection des secrets anciens

Depuis `erp-backend/` :

```bash
# Affiche les secrets configurés (4 derniers caractères seulement) et leur âge
node scripts/rotateSecrets.js list

# Échoue (code 2) si un secret dépasse 90 jours — à brancher sur une tâche d'exploitation
node scripts/rotateSecrets.js check --max-age-days 90
```

La commande `list` ne révèle jamais la valeur complète. Elle couvre `ApiConfig`, `AiKey`
et `EmailAccount`.

---

## 2. Rotation des tokens GLPI (App Token + User Token)

### 2.1 Générer les nouveaux tokens dans GLPI

1. **App Token** : `Configuration → Générale → API → App-token` → régénérer.
   L'ancien App Token peut rester actif le temps de basculer.
2. **User Token** : `Administration → Utilisateurs → [compte de service] → Token d'accès API`
   → régénérer. Utiliser un compte de service dédié, pas un compte nominatif.

### 2.2 Tester puis enregistrer la nouvelle paire

Le script teste d'abord `initSession` avec la nouvelle paire ; la base n'est modifiée
qu'en cas de succès.

```bash
cd erp-backend
GLPI_NEW_APP_TOKEN='...' GLPI_NEW_USER_TOKEN='...' \
  node scripts/rotateSecrets.js rotate-glpi
```

Alternative interface : `Paramètres → Autres intégrations → GLPI`, puis
**Tester la connexion** avant d'enregistrer.

### 2.3 Révoquer l'ancienne paire

Une fois les synchronisations GLPI confirmées (tickets, équipes, catégories, sites),
révoquer l'ancien User Token puis l'ancien App Token dans la console GLPI.

### 2.4 Vérifications post-rotation

- `Paramètres → Autres intégrations → GLPI` : statut **Connecté**.
- Attendre un cycle de synchronisation (< 1 min) et vérifier les logs `glpiSync`.
- Créer un ticket de test et vérifier la liaison GLPI.

---

## 3. Rotation des clés de fournisseurs IA

### 3.1 Créer la nouvelle clé chez le fournisseur

- **OpenAI / Mistral / NVIDIA** : console du fournisseur → API Keys → créer une clé nommée
  `ia-hub-<date>`.
- **Gemini** : Google AI Studio / Google Cloud → Credentials → créer une clé API.
- **Anthropic** : console Anthropic → API Keys.

Conserver l'ancienne clé active pendant la bascule (fenêtre de double clé).

### 3.2 Identifier la clé à remplacer

```bash
cd erp-backend
node scripts/rotateSecrets.js list
# Repérer la ligne « Clé fournisseur IA » et son identifiant (#id)
```

### 3.3 Remplacer la clé en base

```bash
AI_NEW_API_KEY='...' node scripts/rotateSecrets.js rotate-ai-key --key-id 3
```

Alternative interface : `Paramètres → Intelligence Artificielle → [fournisseur] → clé API`.

### 3.4 Vérifier puis révoquer l'ancienne clé

- Lancer un test de chat ou une génération de résumé.
- Vérifier `Paramètres → Supervision` / logs `aiUsageTracker`.
- Révoquer l'ancienne clé dans la console du fournisseur.

> Si plusieurs clés sont configurées pour un même fournisseur (clé société + clé perso),
> les tourner une par une et vérifier que la clé par défaut reste valide.

---

## 4. Rotation de `JWT_SECRET`

### 4.1 Quand ?

- Suspicion de compromission du fichier `.env` ou du secret manager.
- Départ d'un administrateur ayant eu accès au secret.
- Politique interne (ex. annuelle).

### 4.2 Procédure

1. Générer un secret long et aléatoire :

   ```bash
   openssl rand -base64 48
   ```

2. Mettre à jour `JWT_SECRET` dans le secret manager / `.env`, puis redéployer l'API.
3. **Révoquer les sessions existantes** si le secret est compromis (sinon un porteur d'un
   refresh token valide pourrait obtenir un nouveau jeton signé avec le nouveau secret) :

   ```bash
   cd erp-backend
   node scripts/rotateSecrets.js revoke-sessions --all
   ```

4. Redémarrer l'API pour couper immédiatement les sockets déjà ouvertes.
5. Tous les utilisateurs doivent se reconnecter.

Sans compromission avérée, la révocation de toutes les sessions est optionnelle : les
jetons d'accès émis avec l'ancien secret sont rejetés, et les clients se renouvellent
automatiquement via `/auth/refresh`.

---

## 5. Rotation de `SECRETS_ENCRYPTION_KEY`

Cette clé chiffre (AES-256-GCM, format `enc:v1:<iv>:<tag>:<ciphertext>`) les secrets stockés en
base : `ApiConfig.apiKey` / `extra.appToken`, `AiKey.apiKey`, et `EmailAccount.clientSecret`,
`refreshToken`, `password`.

### 5.1 Vérifier l'état du chiffrement

```bash
cd erp-backend
node scripts/encryptSecrets.js status
# code retour 2 = au moins un secret encore en clair
```

### 5.2 Chiffrer les secrets existants (première activation)

```bash
cd erp-backend
export SECRETS_ENCRYPTION_KEY="$(openssl rand -base64 32)"   # conserver cette valeur !
node scripts/encryptSecrets.js encrypt
node scripts/encryptSecrets.js status                        # doit renvoyer 0 secret en clair
```

Ajouter ensuite `SECRETS_ENCRYPTION_KEY` au secret manager et redéployer. **Sauvegarder la clé
hors du serveur** (coffre-fort / secret manager) : sans elle, les secrets chiffrés sont
irrécupérables et il faut ressaisir toutes les clés API et réautoriser les comptes email.

### 5.3 Rotation de la clé

Le format est versionné (`enc:v1:`), mais le script ne gère qu'une clé à la fois. Procédure :

1. Sauvegarder la base.
2. Déchiffrer temporairement avec l'ancienne clé (`SECRETS_ENCRYPTION_KEY=<ancienne>`), puis
   réécrire tous les secrets avec la nouvelle. Tant que le multi-clés n'est pas implémenté, le
   plus simple est de ressaisir les secrets via l'interface après bascule, ou d'exécuter un
   aller-retour : lecture avec l'ancienne clé → écriture avec la nouvelle.
3. Redémarrer l'API et vérifier : connexion GLPI, test de chat IA, relève email.
4. Détruire l'ancienne clé dans le secret manager.

---

## 6. Rotation du Client Secret Outlook / mot de passe IMAP

1. **Azure Portal → Entra ID → App registrations → [application] → Certificates & secrets**
   → créer un nouveau client secret, noter sa valeur et sa date d'expiration.
2. Mettre à jour le compte dans `Paramètres → Intégrations → Email`.
3. Ré-autoriser le compte (bouton **Autoriser**) : le refresh token OAuth est renouvelé.
4. Vérifier la relève email (`Paramètres → Avancé → Fréquences`), puis supprimer l'ancien
   secret dans Azure.
5. Pour IMAP/SMTP : changer le mot de passe dans la boîte, puis dans IA Hub.

> La rotation d'un client secret Azure invalide les refresh tokens existants : la
> ré-autorisation UI est obligatoire, un simple redémarrage ne suffit pas.

---

## 7. Révocation d'urgence d'une session / d'un utilisateur

```bash
cd erp-backend

# Toutes les sessions d'un utilisateur (refresh tokens + futures connexions socket)
node scripts/rotateSecrets.js revoke-sessions --email utilisateur@exemple.ci

# Toutes les sessions de la plateforme (incident majeur)
node scripts/rotateSecrets.js revoke-sessions --all
```

Redémarrer l'API après une révocation globale coupe les sockets déjà connectées.
Les routes API et les handshakes Socket.IO vérifient la session en base à chaque requête :
une session révoquée est refusée immédiatement, même si le jeton d'accès n'est pas expiré.

---

## 8. Calendrier recommandé

| Secret | Fréquence | Responsable |
|---|---|---|
| Tokens GLPI | 90 jours | Admin GLPI + Ops |
| Clés fournisseurs IA | 90 jours ou au départ d'un porteur | Ops |
| `JWT_SECRET` | 180 jours ou incident | Ops / RSSI |
| `SECRETS_ENCRYPTION_KEY` | 180 jours ou incident | Ops / RSSI |
| Client Secret Outlook | à l'expiration Azure (max 24 mois) | Ops |
| Revue des sessions actives | mensuelle | RSSI |

Automatiser la détection :

```bash
node scripts/rotateSecrets.js check --max-age-days 90
node scripts/encryptSecrets.js status          # 0 = tout est chiffré
# code retour 2 = au moins un secret à tourner ou à chiffrer
```

### Sessions et jetons de réinitialisation

- Les refresh tokens sont stockés **hashés** (SHA-256) ; un rejeu d'un token déjà tourné est
  détecté et révoque la session (`AUTH_REFRESH_REUSED` dans l'audit).
- Les jetons « mot de passe oublié » sont stockés **hashés** (`PasswordResetToken.tokenHash`),
  valables 1 h, à usage unique.
- `AUTH_MAX_SESSIONS` (10 par défaut) limite les sessions actives ; les plus anciennes sont
  révoquées à chaque nouvelle connexion.
- Une purge automatique supprime toutes les 6 h les sessions et jetons expirés depuis plus de
  7 jours.
