const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('settings.email'));

const SECRET_FIELDS = ['clientSecret', 'refreshToken', 'password'];

function maskSecret(value) {
  if (!value) return null;
  if (value.length <= 4) return '****';
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function serialize(account) {
  const result = { ...account };
  for (const field of SECRET_FIELDS) {
    result[field] = maskSecret(result[field]);
  }
  return result;
}

router.get('/', async (req, res) => {
  const accounts = await prisma.emailAccount.findMany({ orderBy: { label: 'asc' } });
  return res.json(accounts.map(serialize));
});

router.get('/:id', async (req, res) => {
  const account = await prisma.emailAccount.findUnique({ where: { id: Number(req.params.id) } });
  if (!account) return res.status(404).json({ error: 'Compte introuvable' });
  return res.json(serialize(account));
});

router.post(
  '/',
  [body('label').notEmpty(), body('emailAddress').isEmail(), body('provider').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      label, provider, emailAddress,
      clientId, clientSecret, tenantId, refreshToken,
      imapHost, imapPort, smtpHost, smtpPort, username, password, useTls,
      isActive, isDefault,
    } = req.body;

    if (isDefault) {
      await prisma.emailAccount.updateMany({ where: {}, data: { isDefault: false } });
    }

    const account = await prisma.emailAccount.create({
      data: {
        label,
        provider,
        emailAddress,
        clientId: clientId || null,
        clientSecret: clientSecret || null,
        tenantId: tenantId || null,
        refreshToken: refreshToken || null,
        imapHost: imapHost || null,
        imapPort: imapPort || null,
        smtpHost: smtpHost || null,
        smtpPort: smtpPort || null,
        username: username || null,
        password: password || null,
        useTls: useTls !== undefined ? useTls : true,
        isActive: isActive !== undefined ? isActive : true,
        isDefault: !!isDefault,
      },
    });

    return res.status(201).json(serialize(account));
  }
);

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const fields = [
    'label', 'provider', 'emailAddress',
    'clientId', 'clientSecret', 'tenantId', 'refreshToken',
    'imapHost', 'imapPort', 'smtpHost', 'smtpPort', 'username', 'password', 'useTls',
    'isActive', 'isDefault',
  ];

  const data = {};
  for (const field of fields) {
    if (req.body[field] === undefined) continue;
    // Don't overwrite secrets with masked placeholders sent back to the client
    if (SECRET_FIELDS.includes(field) && req.body[field] === '') continue;
    data[field] = req.body[field];
  }

  if (data.isDefault) {
    await prisma.emailAccount.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
  }

  try {
    const account = await prisma.emailAccount.update({ where: { id }, data });
    return res.json(serialize(account));
  } catch (err) {
    return res.status(404).json({ error: 'Compte introuvable' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.emailAccount.delete({ where: { id: Number(req.params.id) } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'Compte introuvable' });
  }
});

// ── Test de connectivité d'un compte mail ──────────────────────────────────
// Outlook/M365 : tente un rafraîchissement du token OAuth2 + appel /me/mailFolders/inbox
// IMAP générique : teste la connexion TCP sur imapHost:imapPort
router.post('/:id/test', async (req, res) => {
  const id = Number(req.params.id);
  const account = await prisma.emailAccount.findUnique({ where: { id } });
  if (!account) return res.status(404).json({ ok: false, error: 'Compte introuvable' });

  const t0 = Date.now();

  try {
    if (account.provider === 'OUTLOOK' || account.provider === 'GMAIL') {
      // Utilise graphFetch (même chemin que le poller) : rafraîchit le token et fait un appel léger
      const { graphFetch } = require('../utils/graphClient');

      let folderData;
      try {
        folderData = await graphFetch(account, '/me/mailFolders/inbox?$select=id,displayName,totalItemCount');
      } catch (graphErr) {
        return res.json({ ok: false, error: graphErr.message });
      }

      return res.json({
        ok: true,
        latencyMs: Date.now() - t0,
        details: `Boîte "${folderData?.displayName || 'Inbox'}" accessible — ${folderData?.totalItemCount ?? '?'} message(s)`,
      });
    }

    // IMAP/SMTP générique : test TCP sur imapHost:imapPort
    if (account.provider === 'IMAP' || account.provider === 'GENERIC') {
      const net = require('net');
      const host = account.imapHost;
      const port = account.imapPort || 993;

      if (!host) {
        return res.json({ ok: false, error: 'Hôte IMAP non configuré' });
      }

      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port, timeout: 8000 }, () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', (err) => reject(err));
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error(`Connexion expirée après 8s (${host}:${port})`));
        });
      });

      return res.json({ ok: true, latencyMs: Date.now() - t0, details: `Connexion TCP réussie sur ${host}:${port}` });
    }

    return res.json({ ok: false, error: `Type de fournisseur non pris en charge pour le test : ${account.provider}` });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
