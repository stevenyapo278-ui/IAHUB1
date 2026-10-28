# Migration : index de performance pour la corbeille et les rejetés

Ajoute des index utilisés par :
- `GET /tickets/trash/list` (filtrage `deletedAt`)
- `GET /tickets/rejected-suggestions` (filtrage `approvalStatus`)
- les requêtes de recherche sur `title`/`content` (trigramme GIN)

Sans ces index, PostgreSQL fait un `seq scan` sur `Ticket` quand la table
dépasse le seuil de planification — exactement la situation qui provoque la
limite de récupération en corbeille/rejetés.

## Changements

1. `ADD INDEX IF NOT EXISTS "Ticket_deletedAt_idx" ON "Ticket"("deletedAt")`
2. `ADD INDEX IF NOT EXISTS "Ticket_approvalStatus_idx" ON "Ticket"("approvalStatus")`
3. `ADD INDEX IF NOT EXISTS "Ticket_deletedAt_approvalStatus_idx" ON "Ticket"("deletedAt", "approvalStatus", "status")`
4. `ADD INDEX IF NOT EXISTS "Ticket_title_trgm_idx" ON "Ticket" USING gin ("title" gin_trgm_ops)`
5. `ADD INDEX IF NOT EXISTS "Ticket_content_trgm_idx" ON "Ticket" USING gin ("content" gin_trgm_ops)`

## Rollback

Supprimer ces index dans l'ordre inverse (attention aux contraintes de
dépendances : les trigramme s'appliquent sur `title`/`content`).

```sql
DROP INDEX IF EXISTS "Ticket_content_trgm_idx";
DROP INDEX IF EXISTS "Ticket_title_trgm_idx";
DROP INDEX IF EXISTS "Ticket_deletedAt_approvalStatus_idx";
DROP INDEX IF EXISTS "Ticket_deletedAt_idx";
DROP INDEX IF EXISTS "Ticket_approvalStatus_idx";
```

## Note de compatibilité

Les index `IF NOT EXISTS` assurent une exécution idempotente : la migration
peut être relancée sans erreur si elle a été appliquée partiellement, ce qui
est utile dans un pipeline CI ou un conteneur Docker.
