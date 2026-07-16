const prisma = require('../prismaClient');
const { graphFetch } = require('../utils/graphClient');

const MESSAGE_SELECT = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,conversationId,hasAttachments,internetMessageId,internetMessageHeaders';

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

// Télécharge les pièces jointes de type fichier d'un message Graph (images, PDF, Word, etc.).
// isInline/size/contentId sont conservés pour permettre de distinguer plus tard un logo de signature
// d'une vraie capture d'écran collée par l'utilisateur.
async function fetchMessageAttachments(account, messageId) {
  const res = await graphFetch(account, `/me/messages/${messageId}/attachments`);
  return (res.value || []).filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment');
}

// Récupère les emails d'un compte dans une plage de dates via l'API Graph (pas le delta).
// Utilise $filter=receivedDateTime ge/le pour ne récupérer que les emails de la période.
async function fetchEmailsByDateRange(account, dateFrom, dateTo) {
  const filterParts = [];
  if (dateFrom) filterParts.push(`receivedDateTime ge ${dateFrom}T00:00:00Z`);
  if (dateTo) filterParts.push(`receivedDateTime le ${dateTo}T23:59:59Z`);
  const filter = filterParts.length > 0 ? `&$filter=${encodeURIComponent(filterParts.join(' and '))}` : '';

  let url = `/me/mailFolders/inbox/messages?$select=${MESSAGE_SELECT}&$top=50${filter}`;
  const messages = [];

  do {
    const page = await graphFetch(account, url);
    for (const item of page.value || []) {
      messages.push(item);
    }
    url = page['@odata.nextLink'] || null;
  } while (url);

  return messages;
}

module.exports = { fetchNewMessages, pollAllAccounts, fetchMessageAttachments, fetchEmailsByDateRange, MESSAGE_SELECT };
