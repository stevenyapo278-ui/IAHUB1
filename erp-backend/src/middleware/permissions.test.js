const mockFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  permissionGroup: { findMany: (...args) => mockFindMany(...args) },
}));

const { requirePermission, requireSuperAdmin } = require('./permissions');

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requirePermission — bypass strictement réservé à SUPERADMIN', () => {
  beforeEach(() => jest.clearAllMocks());

  it('laisse passer un SUPERADMIN sans consulter les groupes de permissions', async () => {
    const req = { user: { sub: 1, role: 'SUPERADMIN' } };
    const res = buildRes();
    const next = jest.fn();
    await requirePermission('automation.manage', ['ADMIN'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('un ADMIN sans aucun groupe est refusé (plus de fallback par rôle)', async () => {
    mockFindMany.mockResolvedValue([]);
    const req = { user: { sub: 1, role: 'ADMIN' } };
    const res = buildRes();
    const next = jest.fn();
    await requirePermission('automation.manage')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('un ADMIN appartenant à un groupe avec la permission est autorisé', async () => {
    mockFindMany.mockResolvedValue([{ permissions: ['settings.ai'] }]);
    const req = { user: { sub: 1, role: 'ADMIN' } };
    const res = buildRes();
    const next = jest.fn();
    await requirePermission('settings.ai')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('un ADMIN appartenant à un groupe sans la permission est refusé', async () => {
    mockFindMany.mockResolvedValue([{ permissions: ['tickets.create'] }]);
    const req = { user: { sub: 1, role: 'ADMIN' } };
    const res = buildRes();
    const next = jest.fn();
    await requirePermission('settings.ai')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('un TECHNICIAN sans aucun groupe est refusé (plus de fallback par rôle)', async () => {
    mockFindMany.mockResolvedValue([]);
    const req = { user: { sub: 1, role: 'TECHNICIAN' } };
    const res = buildRes();
    const next = jest.fn();
    await requirePermission('automation.manage')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('un TECHNICIAN avec un groupe sans la permission est refusé', async () => {
    mockFindMany.mockResolvedValue([{ permissions: ['tickets.create'] }]);
    const req = { user: { sub: 1, role: 'TECHNICIAN' } };
    const res = buildRes();
    const next = jest.fn();
    await requirePermission('automation.manage')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireSuperAdmin', () => {
  it('rejette un ADMIN avec 403', () => {
    const req = { user: { role: 'ADMIN' } };
    const res = buildRes();
    const next = jest.fn();
    requireSuperAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('laisse passer un SUPERADMIN', () => {
    const req = { user: { role: 'SUPERADMIN' } };
    const res = buildRes();
    const next = jest.fn();
    requireSuperAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("rejette une requête non authentifiée avec 401", () => {
    const req = {};
    const res = buildRes();
    const next = jest.fn();
    requireSuperAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
