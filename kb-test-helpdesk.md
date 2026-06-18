# Base de connaissances — Support IT Prosuma / Nespresso

## Legend — Connexion impossible

Problème : Les utilisateurs ne peuvent plus se connecter à l'application Legend. Le message d'erreur affiché est "identifiant invalide" ou "accès refusé".

Cause : Ce problème survient généralement lors d'une expiration du certificat SSL du serveur Legend, ou lors d'une coupure réseau entre les magasins et le serveur central.

Solution :
1. Vérifier l'état du serveur Legend via le portail de supervision interne.
2. Si le serveur est en ligne, demander à l'utilisateur de vider le cache de session (Ctrl+Shift+Suppr puis "Données de session").
3. Si plusieurs magasins sont touchés simultanément, il s'agit probablement d'une panne du serveur central : escalader immédiatement à l'équipe infrastructure.
4. Redémarrer le service Legend côté serveur si le certificat a expiré.

## Imprimante HP — Erreur papier avec bac plein

Problème : L'imprimante affiche une erreur "bourrage papier" ou "erreur papier" alors que le bac est correctement rempli.

Cause : Capteur de papier encrassé ou mal calibré, ou rouleau d'entraînement usé.

Solution :
1. Éteindre l'imprimante, retirer le bac papier, vérifier l'absence de feuille coincée dans le mécanisme.
2. Nettoyer les capteurs optiques avec un chiffon sec.
3. Redémarrer l'imprimante et relancer une impression test.
4. Si le problème persiste, remplacer le rouleau d'entraînement (pièce détachée disponible auprès du fournisseur HP).

## Accès SAP — Création de compte nouveau collaborateur

Problème : Demande de création d'un accès SAP pour un nouveau collaborateur.

Procédure :
1. Vérifier que la demande est validée par le manager (DAF ou responsable RH).
2. Créer le compte utilisateur dans SAP avec le profil correspondant au poste (ex : Analyste Financier → profil "Finance Standard").
3. Configurer les droits d'accès selon la matrice des habilitations SAP.
4. Envoyer les identifiants temporaires par email sécurisé au nouveau collaborateur et à son manager.
5. Délai moyen de traitement : 24 à 48h ouvrées.

## PC lent après mise à jour Windows

Problème : Ordinateur très lent après une mise à jour Windows, démarrage anormalement long.

Cause : Indexation des fichiers en arrière-plan, mise à jour de pilotes incomplète, ou processus Windows Update bloqué.

Solution :
1. Vérifier l'avancement de Windows Update (Paramètres → Mise à jour).
2. Désactiver temporairement l'indexation de recherche si elle tourne en tâche de fond.
3. Lancer l'outil de résolution des problèmes de performance Windows.
4. Si le problème persiste après 24h, vérifier l'espace disque disponible (minimum 15% libre recommandé) et lancer une défragmentation/optimisation SSD.

## Coupure réseau magasin — Caisses bloquées

Problème : Perte totale de connexion réseau dans un magasin, caisses et terminaux de paiement hors service.

Cause : Coupure du lien opérateur, panne de la box/routeur, ou coupure électrique sur le switch réseau.

Solution :
1. Vérifier les voyants du routeur/box internet du magasin.
2. Redémarrer le routeur et le switch réseau (couper l'alimentation 30 secondes).
3. Si le problème vient de l'opérateur, contacter le support opérateur avec le numéro de ligne.
4. En cas de panne prolongée, activer le mode dégradé caisse (encaissement papier) en attendant le rétablissement.
5. Ce type d'incident est classé P1 (priorité critique) car il bloque l'activité commerciale.

## Relances automatiques et clôture de ticket

Règle métier : Si un ticket reste en attente de réponse utilisateur sans nouvelle activité :
- J+2 : première relance automatique envoyée à l'utilisateur.
- J+5 : seconde relance.
- J+10 : relance de pré-clôture (avertissement).
- J+15 : clôture automatique du ticket si aucune réponse n'a été reçue.

## Incident majeur — Critères de promotion

Un ticket est automatiquement promu en incident majeur (MAJOR_INCIDENT) lorsque :
- Le même problème est signalé par au moins 3 sites ou utilisateurs distincts dans une fenêtre de 4 heures.
- La priorité est alors automatiquement élevée à P1.
- Tous les sites impactés sont notifiés de la résolution lors de la clôture du ticket principal.
