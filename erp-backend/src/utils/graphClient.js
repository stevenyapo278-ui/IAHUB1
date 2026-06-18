const prisma = require('../prismaClient');

const GRAPH_SCOPES = ['offline_access', 'User.Read', 'Mail.Read', 'Mail.ReadWrite', 'Mail.Send'].join(' ');

// Échange le refresh token contre un access token valide, et met à jour le refresh token en base si Microsoft en renvoie un nouveau
async function getAccessToken(account) {
  if (!account.refreshToken) {
    throw new Error(`Le compte mail "${account.label}" n'est pas connecté à Outlook (pas de refresh token)`);
  }

  const res = await fetch(`https://login.microsoftonline.com/${account.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: account.clientId,
      client_secret: account.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      scope: GRAPH_SCOPES,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Échec du rafraîchissement du token Outlook pour "${account.label}" : ${data.error_description || data.error}`);
  }

  if (data.refresh_token && data.refresh_token !== account.refreshToken) {
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { refreshToken: data.refresh_token },
    });
  }

  return data.access_token;
}

async function graphFetch(account, path, options = {}) {
  const accessToken = await getAccessToken(account);
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Erreur Graph API (${res.status}) sur ${path} : ${errBody}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

module.exports = { getAccessToken, graphFetch, GRAPH_SCOPES };
