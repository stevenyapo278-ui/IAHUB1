import api from '../api/client';

/**
 * Télécharge une extraction (XLSX / CSV / JSON) servie par l'API en réponse blob.
 *
 * Utilisé par le tiroir « tickets associés » (catégories / lieux) et par les
 * boutons d'export des tableaux Catégories et Lieux : les trois passent par le
 * même code pour nommer le fichier d'après Content-Disposition.
 *
 * @param {object} options
 * @param {string} options.url          chemin API (ex. '/categories/export')
 * @param {object} [options.params]     paramètres de requête (format, search…)
 * @param {string} options.fallbackName nom si l'en-tête est absent
 * @returns {Promise<string>} nom de fichier enregistré
 */
export default async function exportFile({ url, params = {}, fallbackName }) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const disposition = res.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : fallbackName;

  const objectUrl = window.URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);

  return filename;
}
