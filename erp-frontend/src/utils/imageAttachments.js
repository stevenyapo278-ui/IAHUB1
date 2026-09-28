// ─── Images jointes (suivi, description, commentaire) ─────────────────────────
// Format d'un élément image partagé par tous les éditeurs :
//   { id, url, file?, filename? }
//   - file présent  → image locale (aperçu blob://) pas encore envoyée, envoyée
//                     à l'enregistrement (FormData)
//   - file absent   → image déjà enregistrée sur le serveur (/uploads/...)
// Utilisé par components/ImageAttachmentsEditor.jsx (collage, fichier,
// glisser-déposer) — voir aussi les marqueurs <!--IMAGE_<n>--> côté backend.

// Fichiers image d'un événement paste — n'empêche PAS le défaut : c'est à
// l'appelant de décider (texte + image dans le même collage, ex: suivi).
export function clipboardImageFiles(e) {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files = [];
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

// Fichiers → éléments image avec aperçu local (URL.createObjectURL)
export function imageItemsFromFiles(files, prefix = 'local') {
  return Array.from(files || [])
    .filter((f) => f?.type?.startsWith('image/'))
    .map((file, i) => ({
      id: `${prefix}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      url: URL.createObjectURL(file),
      file,
      filename: file.name,
    }));
}

// <img src="…"> (HTML) ou URL nue → URL exploitable
export function imageSrc(value) {
  if (!value || typeof value !== 'string') return '';
  const match = value.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : value;
}

// Libère l'aperçu local (blob://) d'un élément retiré ou d'un formulaire abandonné
export function revokeImageItem(item) {
  if (typeof item?.url === 'string' && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
}

export function revokeImageItems(items = []) {
  items.forEach(revokeImageItem);
}
