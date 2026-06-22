const { authorizeAdmin } = require('./auth');

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('authorizeAdmin', () => {
  it('laisse passer ADMIN et SUPERADMIN', () => {
    for (const role of ['ADMIN', 'SUPERADMIN']) {
      const req = { user: { role } };
      const res = buildRes();
      const next = jest.fn();
      authorizeAdmin(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });

  it('rejette TECHNICIAN/REQUESTER avec 403', () => {
    for (const role of ['TECHNICIAN', 'REQUESTER']) {
      const req = { user: { role } };
      const res = buildRes();
      const next = jest.fn();
      authorizeAdmin(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  it('rejette une requête non authentifiée', () => {
    const req = {};
    const res = buildRes();
    const next = jest.fn();
    authorizeAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
