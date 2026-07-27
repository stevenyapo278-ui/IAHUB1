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
    actor,
    targetType,
    targetId,
    search,
    startDate,
    endDate,
    page = 1,
    pageSize = 50,
  } = filters;

  const where = {};

  if (action) where.action = action;
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
      orderBy: { createdAt: 'desc' },
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
