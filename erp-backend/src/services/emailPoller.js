const prisma = require('../prismaClient');
const { graphFetch } = require('../utils/graphClient');

const MESSAGE_SELECT = 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,conversationId';

// Récupère les nouveaux messages reçus depuis le dernier passage, via l'API delta de Microsoft Graph
async function fetchNewMessages(account) {
  const startUrl = account.deltaLink
    || `/me/mailFolders/inbox/messages/delta?$select=${MESSAGE_SELECT}`;

  let url = startUrl;
  const messages = [];
  let nextDeltaLink = account.deltaLink;

  do {
    const page = await graphFetch(account, url);
    for (const item of page.value || []) {
      if (!item['@removed']) messages.push(item);
    }

    if (page['@odata.nextLink']) {
      url = page['@odata.nextLink'];
    } else {
      nextDeltaLink = page['@odata.deltaLink'] || nextDeltaLink;
      url = null;
    }
  } while (url);

  return { messages, deltaLink: nextDeltaLink };
}

// Interroge tous les comptes Outlook actifs et connectés, et retourne les nouveaux emails reçus pour chacun
async function pollAllAccounts() {
  const accounts = await prisma.emailAccount.findMany({
    where: { provider: 'OUTLOOK', isActive: true, refreshToken: { not: null } },
  });

  const results = [];
  for (const account of accounts) {
    try {
      const { messages, deltaLink } = await fetchNewMessages(account);

      await prisma.emailAccount.update({
        where: { id: account.id },
        data: { deltaLink, lastSyncAt: new Date() },
      });

      results.push({ account, messages });
    } catch (err) {
      console.error(`[emailPoller] Erreur lors du sondage du compte "${account.label}" :`, err.message);
      results.push({ account, messages: [], error: err.message });
    }
  }

  return results;
}

module.exports = { fetchNewMessages, pollAllAccounts };
