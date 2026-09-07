const prisma = require('../prismaClient');

async function auditLog(action, options = {}) {
  const { actor, targetType, targetId, targetLabel, metadata, ipAddress, tx } = options;

  const data = {
    action,
    actorId: actor?.id || null,
    actorEmail: actor?.email || actor || null,
    targetType: targetType || null,
    targetId: targetId || null,
    targetLabel: targetLabel || null,
    metadata: metadata || undefined,
    ipAddress: ipAddress || null,
  };

  const client = tx || prisma;
  return client.auditLog.create({ data });
}

async function getAuditLogs(filters = {}) {
  const {
    action,
    domain,
    actor,
    targetType,
    targetId,
    search,
    startDate,
    endDate,
    order,
    page = 1,
    pageSize = 50,
  } = filters;

  const where = {};

  // Regroupements métier des actions d'audit par domaine
  const ACTION_DOMAINS = {
    UTILISATEURS: ['USER_CREATED', 'USER_UPDATED', 'USER_DELETED', 'USER_PASSWORD_RESET', 'USER_REGISTERED', 'USER_LOGIN'],
    EQUIPES: ['TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DELETED', 'TEAMS_SYNCED_FROM_GLPI'],
    LIEUX: ['LOCATION_CREATED', 'LOCATION_UPDATED', 'LOCATION_DEACTIVATED', 'LOCATION_PUSHED_TO_GLPI', 'LOCATIONS_SYNCED_FROM_GLPI'],
    DROITS: ['PERMISSION_GROUP_CREATED', 'PERMISSION_GROUP_UPDATED', 'PERMISSION_GROUP_DELETED', 'PERMISSION_GROUP_ASSIGNED'],
    SYSTEME: ['SYSTEM_SETTINGS_UPDATED', 'ADVANCED_SETTINGS_UPDATED', 'PROMPT_TEMPLATE_UPDATED'],
    EMAIL_IA: ['EMAIL_ACCOUNT_CREATED', 'EMAIL_ACCOUNT_DELETED', 'AI_PROVIDER_CREATED', 'AI_PROVIDER_DELETED', 'AI_MODEL_CREATED', 'AI_KEY_CREATED'],
    CONNAISSANCES: ['KNOWLEDGE_DOCUMENT_UPLOADED', 'KNOWLEDGE_DOCUMENT_DELETED'],
    GLPI: ['GLPI_TICKETS_SYNCED', 'GLPI_LOCATIONS_SYNCED', 'GLPI_USERS_SYNCED', 'TEAMS_SYNCED_FROM_GLPI', 'LOCATIONS_SYNCED_FROM_GLPI'],
  };

  if (action) where.action = action;
  if (domain && ACTION_DOMAINS[domain]) {
    where.action = where.action || {};
    // Combinaison domain + action explicite : l'action précise reste prioritaire
    if (typeof where.action === 'string') {
      // garder l'action précise
    } else {
      where.action = { in: ACTION_DOMAINS[domain] };
    }
  }
  if (targetType) where.targetType = targetType;
  if (targetId && !Number.isNaN(Number(targetId))) where.targetId = Number(targetId);
  if (actor) where.actorEmail = { contains: actor, mode: 'insensitive' };
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = Number(targetId);
  if (search) {
    where.OR = [
      { targetLabel: { contains: search, mode: 'insensitive' } },
      { actorEmail: { contains: search, mode: 'insensitive' } },
      { action: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const pageNum = Math.max(1, Number(page));
  const size = Math.min(Math.max(1, Number(pageSize) || 50), 200);
  const skip = (pageNum - 1) * size;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: order === 'asc' ? 'asc' : 'desc' },
      skip,
      take: size,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
  };
}

module.exports = { auditLog, getAuditLogs };
