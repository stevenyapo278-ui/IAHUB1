jest.mock('../prismaClient', () => ({
  ticket: { findMany: jest.fn() },
  systemSettings: { update: jest.fn() },
}));
jest.mock('./emailSender', () => ({
  sendEmail: jest.fn(),
  getEmailSignature: jest.fn().mockResolvedValue('<p>Signature</p>'),
  // Miroir minimal de buildEmailLayout : si l'appelant passe une chaîne au lieu de l'objet
  // { headerTitle, children, signature }, le rendu contient « undefined » — ce que le test
  // de non-régression ci-dessous détecte.
  buildEmailLayout: ({ headerTitle, headerSubtitle, children, signature }) => `${headerTitle}\n${headerSubtitle || ''}\n${children}\n${signature || '<p>Cordialement,<br>Support IT</p>'}`,
}));
jest.mock('./systemSettings', () => ({
  getSystemSettings: jest.fn(),
  resolveFrontendUrl: jest.fn().mockReturnValue('http://localhost:3000'),
}));

const prisma = require('../prismaClient');
const { sendEmail } = require('./emailSender');
const { getSystemSettings } = require('./systemSettings');
const { sendObserverSummary } = require('./observerSummary');

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

describe('sendObserverSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 7,
        title: 'Panne réseau agence',
        priority: 'P2',
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        assignedTo: { id: 1, fullName: 'Jean Technicien' },
        team: { id: 1, name: 'Réseau' },
        requester: { id: 2, fullName: 'Alice Demandeuse' },
        observers: [{ id: 3, email: 'observateur@test.com', fullName: 'Observateur Test' }],
      },
    ]);
    getSystemSettings.mockResolvedValue({
      observerSummaryEnabled: true,
      observerSummaryDay: new Date().getDay(),
      observerSummaryTime: currentTime(),
      observerSummaryLastSentDate: null,
    });
  });

  it("construit le mail avec le gabarit commun, sans « undefined » dans le contenu", async () => {
    const result = await sendObserverSummary();

    expect(result).toEqual({ sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const { bodyHtml } = sendEmail.mock.calls[0][0];
    expect(bodyHtml).not.toContain('undefined');
    expect(bodyHtml).toContain('Récapitulatif des tickets ouverts');
    expect(bodyHtml).toContain('Panne réseau agence');
    expect(bodyHtml).toContain('<p>Signature</p>');
  });
});
