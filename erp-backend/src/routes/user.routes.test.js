jest.mock('../prismaClient', () => ({}));
jest.mock('../services/emailSender', () => ({ sendTemporaryPasswordEmail: jest.fn() }));

const { canAssignRole, canActOnTarget } = require('./user.routes');

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
