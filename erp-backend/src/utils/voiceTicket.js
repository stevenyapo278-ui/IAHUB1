const crypto = require('crypto');
const prisma = require('../prismaClient');

// Ticket éphémère pour ouvrir la WebSocket vocale. Le navigateur ne peut pas envoyer
// d'en-tête Authorization lors du handshake : le front échange son jeton d'accès (Bearer)
// contre ce ticket, puis le serveur vocal le consomme une seule fois. Un ticket volé
// dans un log est inutilisable après 60 s et après la première connexion.
const TICKET_TTL_MS = 60 * 1000;

function hashTicket(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function issueVoiceTicket({ userId, sessionId }) {
  if (!userId || !sessionId) throw new Error('Utilisateur ou session manquant pour le ticket vocal');

  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();

  // Purge opportuniste des tickets expirés (évite la croissance de la table).
  prisma.voiceTicket.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } } }).catch(() => {});

  await prisma.voiceTicket.create({
    data: {
      tokenHash: hashTicket(token),
      userId: Number(userId),
      sessionId: String(sessionId),
      expiresAt: new Date(now.getTime() + TICKET_TTL_MS),
    },
  });

  return { token, expiresIn: Math.floor(TICKET_TTL_MS / 1000) };
}

async function consumeVoiceTicket(rawToken) {
  if (!rawToken) return null;

  const tokenHash = hashTicket(rawToken);
  const now = new Date();
  const ticket = await prisma.voiceTicket.findUnique({ where: { tokenHash } });

  if (!ticket || ticket.usedAt || ticket.expiresAt <= now) return null;

  // Consommation atomique : deux handshakes concurrents ne peuvent pas réutiliser le ticket.
  const consumed = await prisma.voiceTicket.updateMany({
    where: { id: ticket.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });

  return consumed.count === 1 ? ticket : null;
}

module.exports = { issueVoiceTicket, consumeVoiceTicket };
