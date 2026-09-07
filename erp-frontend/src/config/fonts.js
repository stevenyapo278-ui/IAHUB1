/**
 * Polices disponibles pour la personnalisation par utilisateur.
 *
 * Chaque entrée = clé → libellé + pile CSS complète (avec fallback Ubuntu).
 * Toutes ces familles sont chargées via Google Fonts dans index.html.
 * La pile est injectée dans la variable CSS `--user-font`, consommée en tête
 * des piles `fontFamily` de tailwind.config.js.
 *
 * NB : `public/theme-init.js` contient une copie minimale de ce mapping pour
 * appliquer la police avant le premier paint (anti-flash). Le garder synchronisé.
 */

export const DEFAULT_FONT_KEY = 'ubuntu';

export const FONT_STACKS = {
  ubuntu: {
    label: 'Ubuntu',
    family: "'Ubuntu', system-ui, sans-serif",
  },
  'plus-jakarta': {
    label: 'Plus Jakarta Sans',
    family: "'Plus Jakarta Sans', 'Ubuntu', system-ui, sans-serif",
  },
  inter: {
    label: 'Inter',
    family: "'Inter', 'Ubuntu', system-ui, sans-serif",
  },
  roboto: {
    label: 'Roboto',
    family: "'Roboto', 'Ubuntu', system-ui, sans-serif",
  },
  'open-sans': {
    label: 'Open Sans',
    family: "'Open Sans', 'Ubuntu', system-ui, sans-serif",
  },
  poppins: {
    label: 'Poppins',
    family: "'Poppins', 'Ubuntu', system-ui, sans-serif",
  },
  montserrat: {
    label: 'Montserrat',
    family: "'Montserrat', 'Ubuntu', system-ui, sans-serif",
  },
  lato: {
    label: 'Lato',
    family: "'Lato', 'Ubuntu', system-ui, sans-serif",
  },
};

/** Variable CSS racine qui porte la pile de la police choisie */
export const FONT_CSS_VAR = '--user-font';

/** Retourne la pile CSS pour une clé (avec fallback sur le défaut) */
export function getFontFamily(key) {
  const entry = FONT_STACKS[key] || FONT_STACKS[DEFAULT_FONT_KEY];
  return entry.family;
}