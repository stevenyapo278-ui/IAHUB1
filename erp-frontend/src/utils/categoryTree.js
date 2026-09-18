// Construit une liste plate ordonnée (parents d'abord, puis enfants) avec la profondeur
// et un libellé hiérarchique (breadcrumb « Matériel › Impression › Imprimante ») à partir
// de la liste brute des catégories renvoyée par GET /glpi/categories (avec parentId).
// Utile pour les <select> hiérarchiques et les filtres.
export function flattenCategoryTree(categories = []) {
  const byParent = new Map();
  for (const c of categories) {
    const pid = c.parentId == null ? null : Number(c.parentId);
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(c);
  }
  const sort = (list) => list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const result = [];
  const visited = new Set();
  function walk(items, depth, prefix) {
    for (const c of sort(items)) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      const label = depth === 0 ? c.name : `${prefix} › ${c.name}`;
      result.push({ id: c.id, name: c.name, depth, label, glpiCategoryId: c.glpiCategoryId, isCustom: c.isCustom, parentId: c.parentId });
      const kids = byParent.get(c.id);
      if (kids && kids.length) walk(kids, depth + 1, label);
    }
  }
  walk(byParent.get(null) || [], 0, '');

  // Récupérer les orphelins (parentId pointe vers un parent inexistant ou circulaire)
  for (const c of categories) {
    if (!visited.has(c.id)) {
      visited.add(c.id);
      result.push({ id: c.id, name: c.name, depth: 0, label: c.name, glpiCategoryId: c.glpiCategoryId, isCustom: c.isCustom, parentId: c.parentId });
    }
  }

  return result;
}
