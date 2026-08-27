const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { logger } = require('./logger');
const prisma = require('../prismaClient');

let io = null;

function initSocket(server) {
  const socketCorsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:5173', 'http://localhost:4000', 'http://127.0.0.1:4000', 'http://127.0.0.1:5173'];
  io = new Server(server, {
    cors: {
      origin: socketCorsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authentification via JWT et jointure de room par user.
  // Le rôle est RELU en base (comme le middleware REST) : un changement de rôle appliqué par un
  // admin prend effet immédiatement, même pour une session déjà connectée.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token manquant'));

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error('Token invalide'));
    }

    prisma.user
      .findUnique({ where: { id: decoded.sub }, select: { id: true, role: true, isActive: true } })
      .then((user) => {
        if (!user || !user.isActive) return next(new Error('Compte inactif ou supprimé'));
        socket.userId = user.id;
        socket.userRole = user.role;
        next();
      })
      .catch(() => next(new Error('Erreur d’authentification')));
  });

  io.on('connection', (socket) => {
    logger.info(`[Socket.io] Client connecté : ${socket.id} (user #${socket.userId}, ${socket.userRole})`);

    // Rejoindre une room personnelle pour recevoir ses notifications
    socket.join(`user:${socket.userId}`);

    // Les admins/techniciens rejoignent la room des assignations
    if (['ADMIN', 'TECHNICIAN', 'SUPERADMIN'].includes(socket.userRole)) {
      socket.join('assignments');
      socket.join('notifications');
    }

    socket.on('disconnect', () => {
      logger.info(`[Socket.io] Client déconnecté : ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  return io;
}

// Invalide la session d'un utilisateur en temps réel : le client rappelle /auth/me immédiatement.
// Utilisé quand un admin change le rôle d'un utilisateur ou son groupe de droits — l'effet (menus,
// permissions, restrictions) est ainsi INSTANTANÉ, sans attendre le rafraîchissement périodique.
function emitUserUpdated(userId) {
  if (!io) return;
  io.to(`user:${userId}`).emit('user_updated', { ts: Date.now() });
}

// ── Helpers d'émission ───────────────────────────────────────────────────

async function persistNotification({ userId, type, title, message, link, metadata }) {
  try {
    await prisma.notification.create({
      data: { userId, type, title, message, link, metadata: metadata || {} },
    });
  } catch (err) {
    logger.error(`[socket] Erreur persistance notification: ${err.message}`);
  }
}

// Récupère les observateurs du ticket si la relation n'a pas été incluse dans la requête
async function getObserverIds(ticket) {
  if (!ticket) return [];
  if (ticket.observers && Array.isArray(ticket.observers)) {
    return ticket.observers.map((o) => o.id || o);
  }
  try {
    const row = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { observers: { select: { id: true } } },
    });
    return row?.observers?.map((o) => o.id) || [];
  } catch {
    return [];
  }
}

// Notifie les observateurs (socket personnel + notification persistée)
function notifyRelatedUsers(ticket, eventName, { type, title, message, metadata = {}, excludeIds = [] }) {
  if (!io) return;
  getObserverIds(ticket).then((observerIds) => {
    const targets = [...new Set(observerIds.filter((uid) => uid && !excludeIds.includes(uid)))];
    for (const userId of targets) {
      io.to(`user:${userId}`).emit(eventName, {
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        changes: { status: ticket.status },
      });
      persistNotification({ userId, type, title, message, link: `/tickets/${ticket.id}`, metadata });
    }
  });
}

function emitTicketCreated(ticket) {
  if (!io) return;
  io.to('notifications').emit('ticket_created', {
    id: ticket.id,
    title: ticket.title,
    priority: ticket.priority,
    status: ticket.status,
    category: ticket.category,
    createdAt: ticket.createdAt,
    // Si déjà assigné, avertir directement le technicien
    ...(ticket.assignedToId ? { assignedToId: ticket.assignedToId } : {}),
  });

  // Persister une notification pour chaque utilisateur dans la room 'assignments' et 'notifications'
  if (ticket.assignedToId) {
    persistNotification({
      userId: ticket.assignedToId,
      type: 'ticket_created',
      title: 'Nouveau ticket assigné',
      message: `#${ticket.id} — ${ticket.title}`,
      link: `/tickets/${ticket.id}`,
      metadata: { priority: ticket.priority, status: ticket.status },
    });
  }

  // Notifier aussi les observateurs du ticket (création)
  notifyRelatedUsers(ticket, 'ticket_created', {
    type: 'ticket_created',
    title: 'Nouveau ticket en observation',
    message: `#${ticket.id} — ${ticket.title}`,
    metadata: { priority: ticket.priority, status: ticket.status },
    excludeIds: ticket.assignedToId ? [ticket.assignedToId] : [],
  });
}

function emitTicketUpdated(ticket, changes) {
  if (!io) return;
  const payload = {
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    changes: changes || {},
  };
  io.to('assignments').emit('ticket_updated', payload);

  // Notifier le technicien assigné personnellement
  if (ticket.assignedToId) {
    io.to(`user:${ticket.assignedToId}`).emit('ticket_updated', payload);

    // Persister la notification si le statut a changé
    if (changes?.status) {
      persistNotification({
        userId: ticket.assignedToId,
        type: 'ticket_updated',
        title: 'Ticket mis à jour',
        message: `#${ticket.id} — ${ticket.title} → ${changes.status}`,
        link: `/tickets/${ticket.id}`,
        metadata: { changes },
      });
    }
  }

  // Notifier le demandeur à chaque changement de statut (suivi de son ticket)
  if (ticket.requesterId && changes?.status) {
    io.to(`user:${ticket.requesterId}`).emit('ticket_updated', payload);
    persistNotification({
      userId: ticket.requesterId,
      type: 'ticket_updated',
      title: 'Statut de votre ticket',
      message: `#${ticket.id} — ${ticket.title} → ${changes.status}`,
      link: `/tickets/${ticket.id}`,
      metadata: { changes },
    });
  }

  // Notifier les observateurs
  if (changes?.status || changes?.assignedToId || changes?.priority) {
    notifyRelatedUsers(ticket, 'ticket_updated', {
      type: 'ticket_updated',
      title: 'Ticket mis à jour (observation)',
      message: `#${ticket.id} — ${ticket.title}${changes?.status ? ` → ${changes.status}` : ''}`,
      metadata: { changes },
      excludeIds: [],
    });
  }
}

function emitTicketAssigned(ticketId, title, technicianId, method) {
  if (!io) return;
  io.to('assignments').emit('ticket_assigned', {
    ticketId,
    title,
    technicianId,
    method,
  });
  io.to(`user:${technicianId}`).emit('ticket_assigned_to_you', {
    ticketId,
    title,
    method,
  });

  // Persister la notification d'assignation
  const methodLabels = {
    ai_skills: 'Assigné par compétence IA',
    by_category: 'Assigné par catégorie',
    manual: 'Assigné manuellement',
  };
  persistNotification({
    userId: technicianId,
    type: 'ticket_assigned',
    title: 'Ticket assigné',
    message: `#${ticketId} — ${title}`,
    link: `/tickets/${ticketId}`,
    metadata: { method, methodLabel: methodLabels[method] || method },
  });

  // Informer les observateurs de la nouvelle assignation
  prisma.ticket
    .findUnique({ where: { id: ticketId }, select: { observers: { select: { id: true } }, title: true } })
    .then((t) => {
      if (!io || !t) return;
      const targets = [...new Set((t.observers || []).map((o) => o.id).filter((uid) => uid && uid !== technicianId))];
      for (const userId of targets) {
        io.to(`user:${userId}`).emit('ticket_updated', { id: ticketId, title: t.title, changes: { assignedToId: technicianId } });
        persistNotification({
          userId,
          type: 'ticket_updated',
          title: 'Ticket assigné (observation)',
          message: `#${ticketId} — ${t.title}`,
          link: `/tickets/${ticketId}`,
          metadata: { method, methodLabel: methodLabels[method] || method },
        });
      }
    })
    .catch(() => {});
}

// Dépassement SLA : alerte les admins/techniciens, l'assigné, le demandeur et les observateurs
function emitSlaBreach(ticket) {
  if (!io) return;
  const payload = {
    id: ticket.id,
    title: ticket.title,
    priority: ticket.priority,
    status: ticket.status,
    slaResponseDueAt: ticket.slaResponseDueAt,
    slaBreachedAt: ticket.slaBreachedAt || new Date(),
  };
  io.to('assignments').emit('sla_breached', payload);

  // Notifier personnellement l'assigné, le demandeur et chaque observateur
  const personalTargets = [];
  if (ticket.assignedToId) personalTargets.push(ticket.assignedToId);
  if (ticket.requesterId) personalTargets.push(ticket.requesterId);
  for (const obs of ticket.observers || []) personalTargets.push(obs.id);
  const uniqueTargets = [...new Set(personalTargets)];
  for (const userId of uniqueTargets) {
    io.to(`user:${userId}`).emit('sla_breached', payload);
    persistNotification({
      userId,
      type: 'sla_breached',
      title: 'Dépassement SLA',
      message: `#${ticket.id} — ${ticket.title} (délai de réponse dépassé)`,
      link: `/tickets/${ticket.id}`,
      metadata: { priority: ticket.priority, status: ticket.status },
    });
  }
}

// Escalade d'un ticket (automatique ou manuelle) : alerte l'assigné + la room des assignations
function emitTicketEscalated(ticket, { reason, escalationLevel } = {}) {
  if (!io) return;
  const payload = {
    id: ticket.id,
    title: ticket.title,
    priority: ticket.priority,
    status: ticket.status,
    escalationLevel: escalationLevel || ticket.escalationLevel || 1,
    reason: reason || null,
  };
  io.to('assignments').emit('ticket_escalated', payload);

  if (ticket.assignedToId) {
    io.to(`user:${ticket.assignedToId}`).emit('ticket_escalated', payload);
    persistNotification({
      userId: ticket.assignedToId,
      type: 'ticket_escalated',
      title: 'Ticket escaladé',
      message: `#${ticket.id} — ${ticket.title}${reason ? ` (${reason})` : ''}`,
      link: `/tickets/${ticket.id}`,
      metadata: { priority: ticket.priority, escalationLevel: payload.escalationLevel },
    });
  }
}

module.exports = { initSocket, getIO, emitUserUpdated, persistNotification, emitTicketCreated, emitTicketUpdated, emitTicketAssigned, emitSlaBreach, emitTicketEscalated };
