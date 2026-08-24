import DOMPurify from 'dompurify';

DOMPurify.setConfig({
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'u', 'em', 'strong', 'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span',
    'img', 'sup', 'sub', 'dl', 'dt', 'dd',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style', 'width', 'height', 'cid'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
});

// ─── Adaptation des couleurs des contenus externes (emails, tickets GLPI) ────
// Les emails entrants embarquent des styles inline (« color:#000 », fonds blancs)
// qui écrasent le thème : en mode sombre on se retrouve avec du texte noir sur
// fond sombre, illisible. La classe dark:prose-invert ne peut rien contre les
// styles inline — d'où ce hook qui neutralise UNIQUEMENT les couleurs posant un
// problème de contraste, en conservant les couleurs vives (logos, boutons…).
//
// Règles (luminance relative WCAG) :
//   Mode sombre : texte quasi noir/gris foncé → inherit ; fond quasi blanc → transparent.
//   Mode clair  : texte quasi blanc → inherit (emails mal conçus sur fond blanc).
const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', navy: '#000080', teal: '#008080', maroon: '#800000',
  purple: '#800080', orange: '#ffa500', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', dimgray: '#696969', dimgrey: '#696969',
};

function clamp255(n) {
  return Math.min(255, Math.max(0, n));
}

function parseCssColor(value) {
  if (!value || typeof value !== 'string') return null;
  let v = value.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'inherit' || v === 'currentColor') return null;
  if (NAMED_COLORS[v]) v = NAMED_COLORS[v];

  // #rgb / #rrggbb
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
      };
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  // rgb(r,g,b) / rgba(r,g,b,a) — la valeur vient de el.style donc normalisée
  const rgb = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (parts.length >= 3 && parts.every((n) => !Number.isNaN(n))) {
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (alpha === 0) return null; // déjà transparent
      return { r: clamp255(parts[0]), g: clamp255(parts[1]), b: clamp255(parts[2]) };
    }
  }
  return null;
}

function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(conv(h + 1 / 3) * 255),
    g: Math.round(conv(h) * 255),
    b: Math.round(conv(h - 1 / 3) * 255),
  };
}

// Éclaircit une couleur sombre en préservant sa teinte : un lien bleu Outlook
// #0563c1 devient un bleu clair lisible au lieu d'être uniformisé avec le texte.
function lightenColor(color, targetLightness = 0.72) {
  const hsl = rgbToHsl(color);
  return hslToRgb({ h: hsl.h, s: Math.max(hsl.s, 0.35), l: Math.max(hsl.l, targetLightness) });
}

function isDark() {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark');
}

// Retourne la valeur de remplacement si la couleur est problématique, sinon null.
// kind : 'text' | 'bg'
function replacementFor(colorValue, kind) {
  const color = parseCssColor(colorValue);
  if (!color) return null;
  const lum = relativeLuminance(color);
  const dark = isDark();

  if (kind === 'text') {
    if (!dark && lum > 0.93) return 'inherit'; // texte blanc posé sans fond
    if (dark && lum < 0.22) {
      // Gris/noir neutre → hérite du thème ; couleur sombre saturée (lien,
      // accent de marque) → éclaircie en conservant la teinte.
      const { s } = rgbToHsl(color);
      if (s < 0.15) return 'inherit';
      const lit = lightenColor(color);
      return `rgb(${lit.r}, ${lit.g}, ${lit.b})`;
    }
    return null;
  }

  if (kind === 'bg' && dark && lum > 0.85) {
    // Fond blanc/quasi blanc : laisse apparaître le fond sombre du conteneur
    return 'transparent';
  }
  return null;
}

function adaptElementColors(el) {
  // 1) Attribut style — via el.style (valeurs normalisées, parse fiable)
  if (el.hasAttribute && el.hasAttribute('style')) {
    let changed = false;
    for (const prop of ['color', 'background-color']) {
      const value = el.style.getPropertyValue(prop);
      if (!value) continue;
      const fixed = replacementFor(value, prop === 'color' ? 'text' : 'bg');
      if (fixed) {
        el.style.setProperty(prop, fixed);
        changed = true;
      }
    }
    if (changed && el.getAttribute('style').trim() === '') {
      el.removeAttribute('style');
    }
  }

  // 2) Attributs legacy Outlook/Word : <table bgcolor>, <font color>
  if (el.hasAttribute && el.hasAttribute('bgcolor')) {
    const fixedBg = replacementFor(el.getAttribute('bgcolor'), 'bg');
    if (fixedBg === 'transparent') el.removeAttribute('bgcolor');
    else if (fixedBg) el.setAttribute('bgcolor', fixedBg);
  }
  if (el.hasAttribute && el.hasAttribute('color')) {
    const fixed = replacementFor(el.getAttribute('color'), 'text');
    if (fixed) el.setAttribute('color', fixed);
  }
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeType === 1) adaptElementColors(node);
});

export function sanitizeHtml(html) {
  if (!html) return '';
  // Le hook lit l'état du thème au moment du sanitize : si l'utilisateur bascule
  // de thème, le prochain rendu du contenu resanitizera avec les bonnes règles.
  return DOMPurify.sanitize(html);
}
