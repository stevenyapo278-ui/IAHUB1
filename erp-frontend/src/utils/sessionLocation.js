const STORAGE_KEY = 'last_page_map';

export function saveSessionLocation(userId, pathname, search = '') {
  if (!userId) return;
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const fullPath = pathname + (search || '');
    const allowed = ['/tickets', '/inbox', '/teams', '/supervision', '/email-drafts', '/skills', '/documentation', '/knowledge-base', '/users', '/permission-groups', '/prompts', '/settings', '/logs'];
    const isAllowed = allowed.some((p) => pathname === p || pathname.startsWith(p + '/'));
    if (isAllowed) {
      map[String(userId)] = fullPath;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
  } catch {}
}

export function getSessionLocation(userId) {
  if (!userId) return null;
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return map[String(userId)] || null;
  } catch {
    return null;
  }
}

export function clearSessionLocation(userId) {
  if (!userId) return;
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    delete map[String(userId)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}
