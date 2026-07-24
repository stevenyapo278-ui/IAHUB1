jest.mock('../prismaClient', () => ({}));
jest.mock('../services/emailSender', () => ({ sendTemporaryPasswordEmail: jest.fn() }));

const { canAssignRole, canActOnTarget, parseUsersCsv } = require('./user.routes');

describe('parseUsersCsv', () => {
  it('extrait correctement les colonnes et identifiants GLPI du format Prosuma', () => {
    const csvContent =
      'Identifiant;Nom de famille;Courriels;Téléphone;Lieu;Actif\n' +
      'aabledou (1778);BLEDOU;Ange.BLEDOU@prosuma.ci;;;Oui\n' +
      'aadepo (986);Adepo;&nbsp;;;;Oui\n' +
      "aanoma (978);Anoma;Arnaud.Anoma@prosuma.ci;345;CENTRALE D'ACHATS > DAFCI;Non\n";

    const parsed = parseUsersCsv(csvContent);
    expect(parsed).toHaveLength(3);

    expect(parsed[0]).toEqual({
      username: 'aabledou',
      glpiId: 1778,
      fullName: 'BLEDOU',
      email: 'ange.bledou@prosuma.ci',
      location: null,
      isActive: true,
    });

    // Remplace &nbsp; par l'adresse fallback
    expect(parsed[1]).toEqual({
      username: 'aadepo',
      glpiId: 986,
      fullName: 'Adepo',
      email: 'aadepo@prosuma.ci',
      location: null,
      isActive: true,
    });

    expect(parsed[2]).toEqual({
      username: 'aanoma',
      glpiId: 978,
      fullName: 'Anoma',
      email: 'arnaud.anoma@prosuma.ci',
      location: "CENTRALE D'ACHATS > DAFCI",
      isActive: false,
    });
  });

  it('gère les fichiers CSV vides ou invalides', () => {
    expect(parseUsersCsv('')).toEqual([]);
    expect(parseUsersCsv(null)).toEqual([]);
  });
});

describe('canAssignRole', () => {
  it('SUPERADMIN peut assigner SUPERADMIN, ADMIN, TECHNICIAN, REQUESTER', () => {
    expect(canAssignRole('SUPERADMIN', 'SUPERADMIN')).toBe(true);
    expect(canAssignRole('SUPERADMIN', 'ADMIN')).toBe(true);
    expect(canAssignRole('SUPERADMIN', 'TECHNICIAN')).toBe(true);
    expect(canAssignRole('SUPERADMIN', 'REQUESTER')).toBe(true);
  });

  it('ADMIN ne peut assigner que TECHNICIAN/REQUESTER, jamais ADMIN ni SUPERADMIN', () => {
    expect(canAssignRole('ADMIN', 'TECHNICIAN')).toBe(true);
    expect(canAssignRole('ADMIN', 'REQUESTER')).toBe(true);
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'SUPERADMIN')).toBe(false);
  });

  it('un rôle inconnu ou TECHNICIAN/REQUESTER ne peut rien assigner', () => {
    expect(canAssignRole('TECHNICIAN', 'REQUESTER')).toBe(false);
    expect(canAssignRole('REQUESTER', 'REQUESTER')).toBe(false);
    expect(canAssignRole(undefined, 'REQUESTER')).toBe(false);
  });
});

describe('canActOnTarget', () => {
  it('SUPERADMIN peut agir sur une cible de n\'importe quel rôle', () => {
    expect(canActOnTarget('SUPERADMIN', 'SUPERADMIN')).toBe(true);
    expect(canActOnTarget('SUPERADMIN', 'ADMIN')).toBe(true);
    expect(canActOnTarget('SUPERADMIN', 'TECHNICIAN')).toBe(true);
  });

  it('ADMIN ne peut pas agir sur une cible ADMIN ou SUPERADMIN', () => {
    expect(canActOnTarget('ADMIN', 'ADMIN')).toBe(false);
    expect(canActOnTarget('ADMIN', 'SUPERADMIN')).toBe(false);
  });

  it('ADMIN peut agir sur une cible TECHNICIAN ou REQUESTER', () => {
    expect(canActOnTarget('ADMIN', 'TECHNICIAN')).toBe(true);
    expect(canActOnTarget('ADMIN', 'REQUESTER')).toBe(true);
  });
});
