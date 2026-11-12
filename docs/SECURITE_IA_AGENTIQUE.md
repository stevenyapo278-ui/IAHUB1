# Sécurisation du système IA agentique — contrôles techniques

Ce document décrit les contrôles **implémentés dans le code** pour trois mesures du
guide ANSSI « Les Essentiels — Sécuriser un système IA agentique » (V1.0, 10/26) :

| Mesure | Question | Contrôle | Code |
|---|---|---|---|
| 4.5 | Q-4.5-02 | Filtrage DLP avant envoi au modèle hébergé | `erp-backend/src/services/dlpFilter.js` |
| 5.3 | Q-5.3-01 | Contrôle des enchaînements d'actions | `erp-backend/src/services/toolPolicy.js` |
| 5.3 | Q-5.3-02 | Marquage de provenance / sensibilité (taint) | `erp-backend/src/services/toolPolicy.js` |
| 5.4 | Q-5.4-02 | Authentification des appels agents ↔ outils | `mcp-glpi/src/httpAuth.ts` |

Ces contrôles sont **déterministes et hors du modèle** : le LLM ne peut ni les voir,
ni les modifier, ni les désactiver par une instruction.

---

## 1. Filtrage DLP avant appel au modèle (mesure 4.5)

### Principe

Tout ce qui est envoyé à un modèle hébergé est réputé accessible au fournisseur.
Le filtre s'applique donc au **point d'envoi unique** de la plateforme :
`callProviderWithFallback()` dans `erp-backend/src/services/mailAnalyzer.js`
(fonction `applyDlp()`, appelée une seule fois, avant la boucle de fournisseurs).

Conséquence : chat, analyse d'e-mails, résumés, génération de connaissances,
rapports et **résultats d'outils** réinjectés dans le contexte sont filtrés de la
même manière, quel que soit le fournisseur (OpenAI, Gemini, Anthropic).

### Données masquées

| Catégorie | Détection | Jeton inséré |
|---|---|---|
| `SECRET` | `api_key`, `secret`, `token`, `password`… suivis d'une valeur | `[SECRET_MASQUÉ]` |
| `IBAN` | IBAN français (avec ou sans espaces) | `[IBAN_MASQUÉ]` |
| `CARD` | 13 à 19 chiffres **validés par Luhn** | `[CARTE_MASQUÉE]` |
| `NIR` | N° de sécurité sociale français | `[NIR_MASQUÉ]` |
| `PHONE` | Numéros FR (`0X…`, `+33…`) | `[TÉLÉPHONE_MASQUÉ]` |
| `EMAIL` | Adresse e-mail | partie locale masquée (`j***@exemple.fr`) |

Le contrôle de Luhn évite de masquer un identifiant numérique arbitraire
(numéro de ticket, de série, référence) : un faux positif dégrade la réponse
sans apporter de sécurité.

### Comportement en cas d'échec

* Le filtre est **activé par défaut** (`AI_DLP_ENABLED=true`).
* Si le filtre lève une erreur, l'envoi est **refusé** (fail-closed).
  Dérogation explicite et tracée : `AI_DLP_FAIL_OPEN=true`.
* Catégories désactivables une par une : `AI_DLP_DISABLED_TYPES=PHONE,EMAIL`.
* Les journaux ne contiennent **jamais la valeur** masquée : uniquement la catégorie
  et le nombre d'occurrences.

### Preuve

```bash
cd erp-backend && npx jest src/services/dlpFilter.test.js
```

13 tests, dont un test d'intégration qui mocke `global.fetch` et vérifie que le
corps HTTP réellement transmis au fournisseur ne contient plus l'IBAN, le numéro
de carte, le NIR, le téléphone, l'adresse e-mail ni le secret.

### Limites connues

* Aucune classification formelle des données ne définit le « niveau autorisé »
  (hors périmètre code : PSSI / DPO).
* Les **images** envoyées au modèle Vision ne sont pas masquées : un OCR local
  préalable (ou un refus des images) reste à faire.
* Détection par motifs : pas d'analyse sémantique (un IBAN écrit en toutes lettres
  n'est pas détecté).

---

## 2. Contrôle des enchaînements et taint tracking (mesures 5.3)

### Point d'application unique

`authorizeToolCall()` dans `erp-backend/src/services/toolPolicy.js` est traversé par
**tous** les outils, côté chat texte (`chatbotService.executeTool`) comme côté
assistant vocal (`voiceLive.routes.js`). Le registre `TOOL_REGISTRY` classe chaque
outil en `read` / `write` / `external` et refuse par défaut tout outil inconnu.

### Règle de séquence

Après une lecture qui fait entrer dans la session des données internes
(`confidential`) ou du contenu rédigé par un tiers (`untrusted`), toute action à
effet externe est refusée :

```
lecture (search_emails) → send_ticket_report  ⇒  refus SEQUENCE_DENIED
```

* Le refus est **audité** : `AI_TOOL_DENIED` avec `code: SEQUENCE_DENIED`.
* Une **confirmation humaine explicite** débloque l'action et laisse une trace
  dédiée : `AI_SEQUENCE_CONFIRMED` avec les étiquettes ayant déclenché le contrôle.
* Seul outil `external` aujourd'hui : `send_ticket_report` (permission
  `automation.manage`).

### Taint : étiquettes et portée

| Outil de lecture | Étiquettes posées |
|---|---|
| `search_emails` | `confidential`, `untrusted` |
| `analyze_root_cause` | `confidential`, `untrusted` |
| `search_users`, `search_inventory`, `get_ticket_time_entries` | `confidential` |
| `get_ticket_summary`, `check_ticket`, `search_tickets`, `get_ticket_links`, `find_similar_tickets`, `search_knowledge` | `untrusted` |

* Portée : **par session** — clé `_stateKey` (conversation) côté chat,
  `voiceSessionKey()` (WeakMap sur la connexion WebSocket) côté vocal.
* Durée de vie : **30 minutes** (`TAINT_TTL_MS`), purge à chaque écriture.
* État **en mémoire uniquement** : un marquage ne peut pas être rejoué d'une
  conversation à l'autre ni après redémarrage (choix assumé, cf. limites).

### Preuve

```bash
cd erp-backend && npx jest src/services/toolPolicy.test.js
```

17 tests, dont les scénarios de chaînage demandés par la feuille :

* lecture d'e-mails → `send_ticket_report` refusé (`SEQUENCE_DENIED`) et audité ;
* contenu de ticket non fiable → envoi refusé (injection indirecte) ;
* session vierge → envoi autorisé ;
* confirmation explicite → autorisation + `AI_SEQUENCE_CONFIRMED` ;
* isolation entre deux sessions ;
* purge du marquage (`resetSessionTaint`).

### Limites connues

* Deux étiquettes seulement, non dérivées d'une classification formelle.
* Le marquage n'est pas injecté dans le prompt : le modèle ne raisonne pas sur la
  provenance, il est seulement bridé en aval.
* Règle exprimée comme une liste de combinaisons interdites, pas comme une analyse
  de flux d'information complète (IFC).

---

## 3. Authentification agents ↔ outils (mesure 5.4)

### Serveur MCP (transport HTTP)

`mcp-glpi/src/httpAuth.ts` :

* jeton porteur obligatoire sur `/mcp` (`Authorization: Bearer …` ou `X-MCP-Token`) ;
* comparaison **à temps constant** (`crypto.timingSafeEqual`), sans court-circuit ;
* liste de jetons acceptés (`MCP_AUTH_TOKENS="ancien,nouveau"`) pour une rotation
  sans coupure ;
* **fail-closed** : sans jeton configuré, le serveur refuse de démarrer
  (dérogation locale explicite : `MCP_ALLOW_INSECURE=true`) ;
* écoute par défaut sur `127.0.0.1` (`MCP_HOST`) et publication du port hôte
  limitée à la boucle locale dans `docker-compose.yml` ;
* `/health` reste public et ne révèle aucune capacité.

```bash
cd mcp-glpi && npm test        # build + 7 tests node:test
```

### Agents internes

Aucun appel d'outil n'est autorisé au seul motif qu'il est interne : il passe par
`authorizeToolCall()`, qui vérifie l'identité (`authenticate`), la permission
déclarée par l'outil, l'état des interrupteurs d'arrêt et le marquage de session.

### Limites connues

* Secret statique partagé : pas d'identité par client, pas de mTLS ni d'OAuth 2.0
  client credentials ; un jeton donne accès à tout le catalogue d'outils.
* Le service MCP GLPI est hors périmètre de production (profil compose `glpi`, non
  démarré sur Dokploy) ; le contrôle est néanmoins implémenté et testé.

---

## Exploitation

| Variable | Défaut | Rôle |
|---|---|---|
| `AI_DLP_ENABLED` | `true` | Active le filtrage DLP |
| `AI_DLP_DISABLED_TYPES` | *(vide)* | Catégories à ne pas filtrer (`PHONE,EMAIL`…) |
| `AI_DLP_FAIL_OPEN` | `false` | Autorise un envoi non filtré si le filtre échoue |
| `MCP_AUTH_TOKEN` / `MCP_AUTH_TOKENS` | *(vide)* | Jeton(s) accepté(s) par le serveur MCP |
| `MCP_HOST` | `127.0.0.1` | Interface d'écoute du serveur MCP |
| `MCP_ALLOW_INSECURE` | `false` | Démarre le MCP sans jeton (usage local strict) |

Génération d'un jeton MCP : `openssl rand -hex 32`.
Rotation : ajouter le nouveau jeton à `MCP_AUTH_TOKENS`, redémarrer, basculer les
clients, retirer l'ancien (voir `docs/ROTATION_SECRETS.md`).
