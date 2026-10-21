# Gestion des comptes utilisateurs — Processus internes

> Documentation interne IA Hub (Prosuma). Ce document décrit les processus réels de
> création, d'activation et de réinitialisation des comptes utilisateurs de la plateforme.

## 1. Vue d'ensemble — les voies de création d'un compte

Un compte utilisateur de la plateforme IA Hub peut être créé de quatre manières :

1. **Création manuelle par un administrateur** (menu Utilisateurs) — la voie la plus courante pour les techniciens et la Hotline.
2. **Import CSV en masse** (menu Utilisateurs > Import CSV) — uniquement pour créer des demandeurs en gros.
3. **Synchronisation Active Directory / LDAP** — les comptes du dossier d'entreprise sont synchronisés automatiquement.
4. **Première connexion via LDAP** (auto-provisioning) — un collaborateur qui se connecte pour la première fois avec ses identifiants AD voit son compte créé automatiquement.

**Important** : la réception d'un mail par la plateforme ne crée JAMAIS de compte utilisateur. Un expéditeur inconnu reste un simple champ « email expéditeur » sur le ticket, sans compte.

## 2. Création manuelle par un administrateur

**Qui peut créer un compte ?** Uniquement les rôles **SUPERADMIN** et **ADMIN** (menu Utilisateurs).

**Quel rôle peut-on attribuer ?** La matrice est stricte :
- Un **SUPERADMIN** peut créer des comptes de tous les rôles : SUPERADMIN, ADMIN, HOTLINE, TECHNICIAN, REQUESTER.
- Un **ADMIN** peut créer des comptes HOTLINE, TECHNICIAN et REQUESTER uniquement — il ne peut ni créer, ni modifier, ni supprimer, ni réinitialiser un compte ADMIN ou SUPERADMIN.

**Champs obligatoires à la création** : email (unique sur la plateforme), nom complet, mot de passe (8 caractères minimum). Optionnel : rôle et équipe.

**Groupe de permissions** : le groupe de permissions correspondant au rôle est attribué **automatiquement** à la création (« le groupe suit le rôle »). Un seul groupe par utilisateur. Par exemple, un compte créé avec le rôle TECHNICIAN rejoint automatiquement le groupe « Techniciens » avec ses 11 permissions.

**Aucun email n'est envoyé à la création** : la plateforme ne notifie pas le nouvel utilisateur. L'administrateur communique lui-même le mot de passe par un autre canal (téléphone, email personnel, etc.).

**Journalisation** : chaque création est enregistrée dans le journal d'audit (action USER_CREATED) avec l'auteur et le compte créé.

## 3. Import CSV de masse

Depuis le menu Utilisateurs, l'administrateur peut importer une liste de demandeurs depuis un fichier CSV (colonnes email, nom complet, équipe, actif).

- Seuls des comptes **REQUESTER** sont créés par cet import — jamais de techniciens ni d'admins.
- Le mot de passe est généré aléatoirement (inutilisable) : le premier authentification doit le changer (« mustChangePassword »).
- Si l'email existe déjà, la ligne est mise à jour (nom, équipe, statut) au lieu de créer un doublon.

## 4. Création automatique via Active Directory (LDAP)

Quand l'annuaire LDAP/AD est configuré, deux mécanismes créent automatiquement des comptes :

**a) Synchronisation périodique** — toutes les 10 minutes, un service synchronise l'annuaire AD :
- Chaque collaborateur de l'AD sans compte IA Hub correspondant reçoit un compte **REQUESTER** (le rôle n'est jamais déduit de l'AD ; les rôles sont gérés dans IA Hub).
- L'état du compte AD (activé/désactivé) pilote le champ « actif » du compte IA Hub.
- Le collaborateur se connecte avec son mot de passe AD (liaison LDAP) : aucun mot de passe local n'est défini.
- Un collaborataire qui disparaît de l'AD voit son compte IA Hub **désactivé** (l'historique et les tickets sont conservés).

**b) Auto-provisioning à la première connexion** — si un collaborateur AD se connecte pour la première fois sans compte existant, le compte est créé à la volée :
- Rôle **REQUESTER** par défaut.
- Rôle **ADMIN** uniquement si le login figure dans la liste blanche des admins LDAP (configuration LDAP_ADMIN_USERNAMES).

À nouveau : la réception d'un mail d'un expéditeur inconnu ne crée aucun compte ; l'expéditeur reste un simple champ sourceEmail sur le ticket créé.

## 5. Rôles et groupes de permissions

La plateforme compte 5 rôles. Chaque rôle (sauf SUPERADMIN) est lié à un groupe de permissions système :

| Rôle | Groupe de permissions | Ce que le compte peut faire |
|---|---|---|
| SUPERADMIN | aucun (droits totaux) | Tout, y compris la gestion des admins et des paramètres avancés |
| ADMIN | Administrateurs | Toutes les permissions (22) ; gestion des utilisateurs, équipes, paramètres |
| HOTLINE | Équipe Hotline | Qualification et triage des tickets, validation d'approbation, escalade, gestion des lieux, rapports hebdomadaires |
| TECHNICIAN | Techniciens | Traitement des tickets, gestion des problèmes, knowledge base, inventaire (assets), suivi de temps, synchronisation inbox |
| REQUESTER | Demandeurs | Consulter ses propres tickets, consulter l'inventaire |

Les permissions sont des clés techniques (par ex. tickets.view, tickets.assign, users.manage, settings.email). Les groupes sont créés automatiquement au démarrage du serveur (seeder idempotent : les permissions manquantes sont ajoutées, jamais retirées). L'administrateur peut créer des groupes personnalisés et y placer des utilisateurs — le rôle reste la source d'autorisation d'accès aux menus utilisateurs.

## 6. Mot de passe oublié et réinitialisation

**Auto-service (page publique « Mot de passe oublié »)** :
1. L'utilisateur saisit son adresse email sur la page de connexion.
2. Si l'email existe, un lien de réinitialisation lui est envoyé par email. Le lien est **valable 1 heure** et à **usage unique**.
3. Le nouveau mot de passe doit respecter la politique forte : 8 caractères minimum, avec au moins une majuscule, une minuscule, un chiffre et un caractère spécial.
4. La plateforme répond toujours « Si cet email existe, un lien a été envoyé » — pour ne pas révéler si un compte existe ou non.

**Réinitialisation par un administrateur** (menu Utilisateurs) :
1. L'ADMIN/SUPERADMIN clique sur « Réinitialiser le mot de passe » du compte cible.
2. Un mot de passe temporaire de 12 caractères (sans caractères ambigus) est généré et **envoyé par email** au titulaire du compte.
3. Le champ « changement de mot de passe obligatoire » est activé : l'utilisateur devra le changer à sa prochaine connexion.
4. Un ADMIN ne peut pas réinitialiser le mot de passe d'un compte ADMIN ou SUPERADMIN (réservé au SUPERADMIN).

**Changement volontaire** : tout utilisateur connecté peut changer son mot de passe depuis son compte (ancien mot de passe + politique forte).

## 7. Comptes de test / défaut

- Le compte SUPERADMIN initial de la plateforme est `superadmin@prosuma.ci` (mot de passe par défaut : 12345678, à changer dès la première connexion en production).
- Les comptes créés par le seed ont tous `mustChangePassword` quand applicable.
