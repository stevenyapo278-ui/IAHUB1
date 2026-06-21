jest.mock('../prismaClient', () => ({}));
jest.mock('../utils/graphClient', () => ({ graphFetch: jest.fn() }));
jest.mock('./systemSettings', () => ({ getSystemSettings: jest.fn() }));

const { buildAcknowledgementHtml, buildKnownIncidentNotificationHtml } = require('./emailSender');

describe('buildAcknowledgementHtml', () => {
  it('utilise le message par défaut quand customMessage est vide', () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', glpiTicketId: 1, originalSubject: 'Test' });
    expect(html).toContain('Nous avons bien reçu votre demande de support');
  });

  it('remplace les placeholders {ticketId}, {subject} et {toName} dans le message personnalisé', () => {
    const html = buildAcknowledgementHtml({
      toName: 'Jean',
      glpiTicketId: 42,
      originalSubject: 'Imprimante',
      customMessage: 'Merci {toName}, votre ticket {ticketId} sur "{subject}" est pris en charge.',
    });
    expect(html).toContain('Merci Jean, votre ticket 42 sur "Imprimante" est pris en charge.');
  });

  it("n'affiche plus de ligne de délai estimé (supprimée explicitement)", () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', glpiTicketId: 1, originalSubject: 'Test' });
    expect(html).not.toMatch(/délai estimé/i);
  });

  it('insère la signature fournie telle quelle', () => {
    const html = buildAcknowledgementHtml({
      toName: 'Jean',
      glpiTicketId: 1,
      originalSubject: 'Test',
      signature: '<div>Ma signature perso</div>',
    });
    expect(html).toContain('Ma signature perso');
  });

  it('retombe sur la signature par défaut si aucune signature fournie', () => {
    const html = buildAcknowledgementHtml({ toName: 'Jean', glpiTicketId: 1, originalSubject: 'Test' });
    expect(html).toContain('Cordialement');
  });
});

describe('buildKnownIncidentNotificationHtml', () => {
  it('mentionne le nombre de sites impactés', () => {
    const html = buildKnownIncidentNotificationHtml({
      toName: 'Jean',
      glpiTicketId: 1,
      originalSubject: 'Panne réseau',
      isMajor: false,
      impactedCount: 3,
    });
    expect(html).toContain('3');
  });

  it('ajoute la mention "incident majeur" uniquement si isMajor est vrai', () => {
    const minor = buildKnownIncidentNotificationHtml({
      toName: 'Jean', glpiTicketId: 1, originalSubject: 'Panne', isMajor: false, impactedCount: 1,
    });
    const major = buildKnownIncidentNotificationHtml({
      toName: 'Jean', glpiTicketId: 1, originalSubject: 'Panne', isMajor: true, impactedCount: 5,
    });
    expect(minor).not.toMatch(/incident majeur/i);
    expect(major).toMatch(/incident majeur/i);
  });
});
