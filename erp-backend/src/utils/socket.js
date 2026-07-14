const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { logger } = require('./logger');
const prisma = require('../prismaClient');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  // Authentification via JWT et jointure de room par user
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Token manquant'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.sub;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('Token invalide'));
    }
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
}

module.exports = { initSocket, getIO, emitTicketCreated, emitTicketUpdated, emitTicketAssigned };
