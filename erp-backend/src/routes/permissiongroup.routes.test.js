// Vérifie que la création/modification/suppression de groupes de droits est bien réservée au
// SUPERADMIN (requireSuperAdmin), tandis que la consultation et l'assignation restent accessibles
// à tout ADMIN (authorizeAdmin) — on inspecte directement la pile de middlewares du router Express
// plutôt que de monter un serveur HTTP complet, cohérent avec le reste de la suite (pas de mocks
// Prisma nécessaires ici puisqu'on ne va jamais jusqu'aux handlers).
const router = require('./permissiongroup.routes');

function middlewareNames(layer) {
  const names = [];
  let stack = layer.route ? layer.route.stack : [layer];
  for (const l of stack) {
    names.push(l.handle.name || l.name);
  }
  return names;
}

function findRoute(method, path) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]);
}

describe('permissiongroup.routes — restriction SUPERADMIN sur la gestion des groupes', () => {
  it('POST / (création) passe par requireSuperAdmin', () => {
    const layer = findRoute('post', '/');
    const names = middlewareNames(layer);
    expect(names).toContain('requireSuperAdmin');
  });

  it('PATCH /:id (édition) passe par requireSuperAdmin', () => {
    const layer = findRoute('patch', '/:id');
    const names = middlewareNames(layer);
    expect(names).toContain('requireSuperAdmin');
  });

  it('DELETE /:id (suppression) passe par requireSuperAdmin', () => {
    const layer = findRoute('delete', '/:id');
    const names = middlewareNames(layer);
    expect(names).toContain('requireSuperAdmin');
  });

  it('POST /:id/assign et /:id/unassign ne passent PAS par requireSuperAdmin (accessibles à tout ADMIN)', () => {
    const assignLayer = findRoute('post', '/:id/assign');
    const unassignLayer = findRoute('post', '/:id/unassign');
    expect(middlewareNames(assignLayer)).not.toContain('requireSuperAdmin');
    expect(middlewareNames(unassignLayer)).not.toContain('requireSuperAdmin');
  });

  it('GET / (consultation) ne passe PAS par requireSuperAdmin', () => {
    const layer = findRoute('get', '/');
    expect(middlewareNames(layer)).not.toContain('requireSuperAdmin');
  });
});
