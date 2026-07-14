const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

const GRAPH_SCOPES = ['offline_access', 'User.Read', 'Mail.Read', 'Mail.ReadWrite', 'Mail.Send'].join(' ');

function authorizeUrl(account, state, redirectUri) {
  const base = `https://login.microsoftonline.com/${account.tenantId}/oauth2/v2.0/authorize`;
  const params = new URLSearchParams({
    client_id: account.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: GRAPH_SCOPES,
    state,
  });
  return `${base}?${params.toString()}`;
}

// Démarre le flux OAuth2 : redirige l'admin vers la page de connexion Microsoft
router.get('/email-accounts/:id/oauth/connect', authenticate, requirePermission('settings.email'), async (req, res) => {
  const account = await prisma.emailAccount.findUnique({ where: { id: Number(req.params.id) } });
  if (!account) return res.status(404).json({ error: 'Compte introuvable' });
  if (!account.clientId || !account.tenantId || !account.clientSecret) {
    return res.status(400).json({ error: 'Client ID, Tenant ID et Client Secret sont requis avant de connecter le compte' });
  }

  const { getSystemSettings, resolveBackendUrl } = require('../services/systemSettings');
  const settings = await getSystemSettings();
  const backendUrl = resolveBackendUrl(settings);
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${backendUrl}/api/oauth/outlook/callback`;

  const state = jwt.sign({ accountId: account.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  return res.json({ url: authorizeUrl(account, state, redirectUri) });
});

// Callback Microsoft : échange le code contre un refresh token et le sauvegarde
router.get('/oauth/outlook/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Erreur Microsoft : ${error} - ${error_description || ''}`);
  }
  if (!code || !state) {
    return res.status(400).send('Paramètres manquants (code/state)');
  }

  let payload;
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET);
  } catch {
    return res.status(400).send('State invalide ou expiré, veuillez recommencer la connexion');
  }

  const account = await prisma.emailAccount.findUnique({ where: { id: payload.accountId } });
  if (!account) return res.status(404).send('Compte introuvable');

  const { getSystemSettings, resolveBackendUrl } = require('../services/systemSettings');
  const settings = await getSystemSettings();
  const backendUrl = resolveBackendUrl(settings);
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${backendUrl}/api/oauth/outlook/callback`;

  try {
    const tokenRes = await fetch(`https://login.microsoftonline.com/${account.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: account.clientId,
        client_secret: account.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        scope: GRAPH_SCOPES,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(502).send(`Échec de l'échange du code : ${tokenData.error_description || tokenData.error}`);
    }

    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { refreshToken: tokenData.refresh_token, isActive: true },
    });

    // Auto-définit comme compte par défaut si aucun autre compte Outlook par défaut n'existe
    await prisma.emailAccount.updateMany({
      where: { id: account.id, isDefault: false },
      data: { isDefault: true },
    });
    // Si un autre compte par défaut existait déjà, updateMany n'aura rien fait (isDefault était déjà false)
    // — ce qui préserve le choix explicite de l'utilisateur.

    return res.send('<html><body><h2>Compte Outlook connecté avec succès.</h2><p>Vous pouvez fermer cette fenêtre et retourner au dashboard.</p></body></html>');
  } catch (err) {
    return res.status(502).send(`Erreur lors de la connexion : ${err.message}`);
  }
});

module.exports = router;
