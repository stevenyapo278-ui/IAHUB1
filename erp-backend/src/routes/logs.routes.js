const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const {
      type,
      actor,
      search,
      startDate,
      endDate,
      page = '1',
      pageSize = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const size = Math.min(Math.max(1, parseInt(pageSize) || 50), 200);
    const skip = (pageNum - 1) * size;

    const where = {};

    if (type) {
      where.type = type;
    }

    if (actor) {
      where.actor = { contains: actor, mode: 'insensitive' };
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

    if (search) {
      where.ticket = {
        OR: [
          { id: parseInt(search) ? parseInt(search) : undefined },
          { title: { contains: search, mode: 'insensitive' } },
        ].filter(Boolean),
      };
    }

    const [events, total] = await Promise.all([
      prisma.ticketEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: size,
        include: {
          ticket: { select: { id: true, title: true, glpiTicketId: true } },
        },
      }),
      prisma.ticketEvent.count({ where }),
    ]);

    res.json({
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        payload: e.payload,
        createdAt: e.createdAt,
        ticketId: e.ticket?.id || null,
        ticketTitle: e.ticket?.title || null,
        glpiTicketId: e.ticket?.glpiTicketId || null,
      })),
      pagination: {
        page: pageNum,
        pageSize: size,
        total,
        totalPages: Math.ceil(total / size),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
