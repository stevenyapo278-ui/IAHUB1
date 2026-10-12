# Candidature — Moov Startup Challenge 2026
**Start-up :** SEVEN T — **Projet :** AI ITSM — **Gérant :** Steven Patrick Romeo Yapo

---

## 1. Brève présentation du projet (à coller dans le formulaire)

> AI ITSM est une plateforme d'assistance informatique (ITSM) intelligente qui automatise la gestion des tickets grâce à l'intelligence artificielle. Elle capte les demandes des utilisateurs par email, les analyse automatiquement (catégorie, priorité, résumé, détection de spam et de doublons), crée puis assigne le ticket dans le système de support, relance les équipes jusqu'à la résolution et apprend de chaque correction humaine.
>
> Concrètement, un message du type « l'imprimante du bureau 3 est en panne » devient, en quelques secondes, un ticket classé, priorisé, attribué au bon technicien et suivi automatiquement (accusé de réception, relances à J+2, J+5, J+10, fermeture à J+15) — sans intervention d'un opérateur.
>
> Notre differenciateur : une architecture multi-fournisseurs IA (Gemini, OpenAI, Anthropic, Mistral, NVIDIA NIM) avec bascule automatique en cas d'indisponibilité, une base de connaissances en recherche sémantique qui propose des solutions à partir des tickets déjà résolus, et un moteur d'apprentissage par correction qui améliore l'IA à chaque validation par la hotline. L'ensemble s'intègre nativement à GLPI, l'outil de ticketing open source le plus utilisé en Afrique francophone.
>
> Le produit est déjà fonctionnel et en production, utilisé au quotidien pour le traitement de tickets réels, et s'améliore continuellement. AI ITSM s'adresse aux PME, opérateurs télécoms, prestataires IT et administrations qui subissent un volume croissant de demandes sans équipe structurée : il réduit le temps de traitement, supprime les tickets perdus et fiabilise le service.
>
> Porté par SEVEN T, AI ITSM vise à devenir la référence de l'assistance informatique augmentée par IA en Côte d'Ivoire et en Afrique de l'Ouest, dans une logique d'abonnement B2B accessible aux entreprises locales.

*(Environ 1 900 caractères — si le formulaire limite la longueur, supprimer le dernier paragraphe « Porté par SEVEN T… » puis, si nécessaire, le differenciateur.)*

---

## 2. Dossier de présentation (PowerPoint → PDF)

> Rappel de candidature : joindre aussi le CV du gérant, le lien de l'application, le modèle économique, et les deux fiches signées (engagement/cession de droits + consentement données personnelles).

### Slide 1 — Couverture
- **AI ITSM — L'assistance informatique augmentée par l'IA**
- SEVEN T | Steven Patrick Romeo Yapo, gérant
- Côte d'Ivoire — Moov Startup Challenge 2026
- Visuel : logo + slogan : *« Du message au ticket résolu, sans friction. »*

### Slide 2 — Le problème
- Les PME et organisations perdent des demandes IT dans les boîtes mail partagées : pas de suivi, pas de priorisation, pas de traçabilité.
- Un technicien passe un temps considérable à trier, classer, relancer et ressaisir la même information.
- Les outils existants (GLpi, ServiceNow) gèrent le ticket mais pas l'entrée : l'analyse reste manuelle.
- Résultat : incidents non traités dans les délais, mécontentement des utilisateurs, charge inutile sur les équipes.

### Slide 3 — La solution
- **Capter** : lecture automatique des emails entrants (Microsoft Graph API / Outlook).
- **Comprendre** : analyse IA → catégorie, priorité P1–P4, résumé, détection de spam et de doublons (fenêtre 4 h).
- **Agir** : création du ticket dans GLPI, auto-assignation au technicien le moins chargé de l'équipe concernée.
- **Suivre** : accusé de réception, relances automatiques J+2 / J+5 / J+10, fermeture automatique J+15.
- **Améliorer** : chaque correction de la hotline rétroalimente l'IA (rapport hebdo validé par l'admin) + base de connaissances en recherche sémantique (pgvector).

### Slide 4 — Démo produit (captures d'écran)
- Dashboard temps réel : tickets, charge par équipe, KPI.
- Analyse d'email : aperçu du ticket généré avant validation (workflow d'approbation Hotline).
- Base de connaissances : recherche sémantique + génération d'articles depuis les tickets résolus.
- *Insérer 3–4 captures réelles de l'application.*

### Slide 5 — Technologies & différenciateurs
- IA **multi-fournisseurs** : Gemini, OpenAI, Anthropic, Mistral, NVIDIA NIM — bascule automatique si un fournisseur tombe (résilience et maîtrise du coût).
- **Prompts éditables** sans toucher au code → l'entreprise adapte le comportement de l'IA elle-même.
- Intégration native **GLPI** (sync toutes les 20 s) + **LDAP / Active Directory** pour les entreprises déjà équipées.
- Workflow humain conservé : rien ne part en production sans validation de la hotline (confiance + conformité).
- Socle : Node.js/Express, PostgreSQL + pgvector, React/Vite, Docker — déploiement en une commande.

### Slide 6 — Taille de marché
- **Marché mondial ITSM** : ~ USD 8–10 Md (2025), croissance ~10–15 %/an portée par l'IA.
- **Afrique de l'Ouest / Côte d'Ivoire** : digitalisation accélérée des PME, des opérateurs et des administrations ; offre télécom et services en forte croissance.
- **Cible prioritaire** : PME et ETI de 20–500 salariés sans service support structuré ; prestataires IT ; opérateurs et hôpitaux.
- Estimation locale : plusieurs milliers d'entreprises éligibles en Côte d'Ivoire seules.

### Slide 7 — Modèle économique (SaaS B2B par abonnement)
| Offre | Cible | Prix indicatif / mois |
|---|---|---|
| **Essentiel** | PME < 50 utilisateurs, 2 techniciens | 75 000 F CFA |
| **Pro** | PME/ETI, illimité, base de connaissances, LDAP | 250 000 F CFA |
| **Entreprise** | Multi-sites, SSO, SLA, déploiement dédié | Sur devis (à partir de 750 000 F CFA) |

- Revenus récurrents mensuels (MRR), contrat annuel, support inclus.
- Leviers complémentaires : intégration/paramétrage à l'onboarding (frais uniques), formation, extensions (WhatsApp/Chatbot, multi-GLPI).
- Marge portée par un usage IA maîtrisé (choix du fournisseur par tâche, prompts optimisés côté client).

### Slide 8 — Traction & preuves
- **Produit en production** : traitement de tickets réels au quotidien (pipeline email → IA → GLPI → relances).
- Stack complète livrée : 60+ migrations, synchronisation GLPI toutes les 20 s, notifications temps réel (Socket.IO), journal d'audit.
- Fonctionnalités avancées déjà en place : groupes de permissions granulaires, alertes vocales, apprentissage par correction, suppression en masse contrôlée.
- *Chiffres à compléter : nombre de tickets traités, nombre d'utilisateurs/clients pilotes, temps de traitement gagné.*

### Slide 9 — Concurrence & positionnement
- **ServiceNow / Zendesk** : puissants mais chers, lourds, pensés pour le marché nord-américain/européen.
- **GLPI seul** : open source et gratuit, mais sans intelligence — la saisie et le tri restent manuels.
- **Solutions locales** : peu ou pas d'automatisation IA sur l'entrée des demandes.
- **Notre place** : la couche d'intelligence qui s'ajoute aux outils déjà en place chez l'Africain (GLPI en tête), au prix adapté au marché local, en français.

### Slide 10 — Go-to-market
1. **Pilotes gratuits** (30 jours) chez 5 entreprises ivoiriennes du réseau proche → cas d'usage chiffrés.
2. **Partenariats** : intégrateurs IT, revendeurs GLPI, opérateurs télécoms (commission par compte).
3. **Contenu & événementiel** : ateliers « helpdesk sans saisie », présence dans l'écosystème Tech ivoirien.
4. **Extension régionale** : Sénégal, Côte d'Ivoire d'abord, puis UEMOA (francophone, mêmes outils).

### Slide 11 — Feuille de route (12 mois)
- **M0–M3** : génération de réponse IA assistée (brouillons validés par l'humain), chatbot WhatsApp de dépôt de tickets.
- **M3–M6** : multi-GLPI pour les prestataires IT, tableau de bord SLA, application mobile technicien.
- **M6–M9** : marketplace de connecteurs (Teams, Slack, WhatsApp Business), analyse prédictive de volume.
- **M9–M12** : ouverture régionale UEMOA, premier gros compte référence.

### Slide 12 — Équipe
- **Steven Patrick Romeo Yapo — Fondateur & gérant**
  - Conception, développement et déploiement complet d'AI ITSM (back-end, front, IA, infra).
  - Expertise : Node.js, React, PostgreSQL/pgvector, intégration d'API (GLPI, Microsoft Graph), architectures IA multi-fournisseurs, DevOps/Docker.
  - *À compléter : parcours, années d'expérience, précédents projets/emplois.*
- **Recrutements visés grâce au financement** : 1 chargé de support client/onboarding, 1 développeur back-end, 1 commercial B2B.

### Slide 13 — Pourquoi le Moov Startup Challenge
- **10 000 000 F CFA** : financer le passage de l'actuel déploiement à une offre SaaS industrialisée (onboarding self-service, SLA, support).
- **Incubation & mentoring** : structuration du modèle, juridique, pricing, premiers contrats.
- **Visibilité** : accès à un réseau d'investisseurs et de partenaires — précisément notre besoin pour le go-to-market.
- Adéquation avec l'axe **Fin-Tech / Smart City / service numérique** : outil productif pour toute la chaîne numérique ivoirienne.

### Slide 14 — Besoins & usage des 10 M F CFA (exemple)
| Poste | Montant |
|---|---|
| Industrialisation SaaS + infrastructure (hébergement, monitoring) | 3 000 000 F |
| Développement (chatbot WhatsApp, onboarding self-service, mobile) | 3 500 000 F |
| Commercial & marketing (pilotes, événements, acquisition) | 2 000 000 F |
| Juridique, conformité RGPD/pôle FRCI & frais de dossier | 1 500 000 F |
| **Total** | **10 000 000 F CFA** |

### Slide 15 — Clôture
- **« L'avenir de l'économie numérique en Côte d'Ivoire est entre nos mains — commençons par ne plus perdre un seul ticket. »**
- SEVEN T — AI ITSM
- Contact : Steven Patrick Romeo Yapo — stevenyapo278@gmail.com — 07 58 51 90 80
- Lien de l'application : *[à insérer]*

---

### Checklists avant envoi
- [ ] CV du gérant joint
- [ ] CV des membres de l'équipe technique joint
- [ ] Lien de l'application inséré (slide et/ou formulaire)
- [ ] Modèle économique intégré
- [ ] Fiche d'engagement et cession de droits signée et scannée
- [ ] Fiche de recueil de consentement signée et scannée
- [ ] Dossier converti en **PDF** avant upload
- [ ] Candidature soumise avant le **11 octobre 2026**
