(function () {
  var stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) { /* stockage indisponible */ }
  var dark = stored === 'dark'
    || (!stored && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    || (!stored && !window.matchMedia);

  /* Classe de thème avant le premier paint… */
  document.documentElement.classList.toggle('dark', dark);

  /* …et fond critique en inline : le <html> n'a plus jamais la couleur par défaut
     du navigateur pendant le chargement du bundle CSS → zéro flash blanc/noir.
     (Retiré au montage du ThemeProvider, une fois la vraie feuille de style active.) */
  document.documentElement.style.backgroundColor = dark ? '#060a14' : '#F8FAFC';

  /* ── Skin (couleur d'accent) appliqué AVANT le premier paint ────────────── */
  /* Miroir JS de SKINS (ThemeContext.jsx) : appliquer data-skin tout de suite
     évite que l'interface s'affiche en bleu par défaut puis bascule vers la
     couleur choisie une fois React monté. */
  var SKIN_PRIMARY = {
    'default': '#0067ff', bento: '#ff5a1f', aqua: '#1597a5', lime: '#9ccc1f',
    lilac: '#6d5ba6', prism: '#6d28d9', midnight: '#4f5bd5', ocean: '#0a84ff',
    graphite: '#2b2b30', emerald: '#059669', amber: '#f59e0b', coral: '#ff6b5e',
    'console': '#15803d',
  };
  var skin = null;
  try { skin = localStorage.getItem('skin'); } catch (e) { /* stockage indisponible */ }
  if (!skin || !SKIN_PRIMARY[skin]) skin = 'default';
  document.documentElement.setAttribute('data-skin', skin);

  /* Couleurs du boot loader (index.html) dérivées du skin + du thème :
     le loader s'affiche DIRECTEMENT dans la couleur choisie — plus de logo
     bleu qui vire à la couleur du thème après coup. */
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }
  function shade(hex, factor) {
    var c = hexToRgb(hex);
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v * factor))); };
    return '#' + [c.r, c.g, c.b].map(function (v) { return f(v).toString(16).padStart(2, '0'); }).join('');
  }
  var primary = SKIN_PRIMARY[skin];
  var s = document.documentElement.style;
  s.setProperty('--boot-primary', primary);
  s.setProperty('--boot-primary-dark', shade(primary, 0.75));
  s.setProperty('--boot-primary-40', 'rgba(' + hexToRgb(primary).r + ',' + hexToRgb(primary).g + ',' + hexToRgb(primary).b + ',0.4)');
  s.setProperty('--boot-primary-25', 'rgba(' + hexToRgb(primary).r + ',' + hexToRgb(primary).g + ',' + hexToRgb(primary).b + ',0.25)');
  s.setProperty('--boot-bg', dark ? '#060a14' : '#F8FAFC');
  s.setProperty('--boot-text', dark ? '#e2e8f0' : '#0f172a');
  s.setProperty('--boot-track', dark ? '#1f2937' : '#e2e8f0');
})();

/* ── Police utilisateur (anti-flash) ─────────────────────────────────────────
   Miroir minimal de src/config/fonts.js : appliquée AVANT le premier paint
   pour éviter un clignotement entre la police par défaut et celle choisie.
   ⚠️ Garder synchronisé avec src/config/fonts.js. */
(function () {
  var FONT_VAR = '--user-font';
  var DEFAULT_STACK = "'Ubuntu', system-ui, sans-serif";
  var FONT_STACKS = {
    ubuntu: "'Ubuntu', system-ui, sans-serif",
    'plus-jakarta': "'Plus Jakarta Sans', 'Ubuntu', system-ui, sans-serif",
    inter: "'Inter', 'Ubuntu', system-ui, sans-serif",
    roboto: "'Roboto', 'Ubuntu', system-ui, sans-serif",
    'open-sans': "'Open Sans', 'Ubuntu', system-ui, sans-serif",
    poppins: "'Poppins', 'Ubuntu', system-ui, sans-serif",
    montserrat: "'Montserrat', 'Ubuntu', system-ui, sans-serif",
    lato: "'Lato', 'Ubuntu', system-ui, sans-serif",
  };
  var stack = DEFAULT_STACK;
  try {
    var uid = null;
    try { uid = JSON.parse(localStorage.getItem('user') || 'null'); uid = uid && uid.id; } catch (e) { /* ignore */ }
    var key = uid ? 'userPreferences:' + uid : 'userPreferences';
    var prefs = null;
    try { prefs = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { /* ignore */ }
    if (!prefs && !uid) {
      try { prefs = JSON.parse(localStorage.getItem('userPreferences') || 'null'); } catch (e) { /* ignore */ }
    }
    if (prefs && FONT_STACKS[prefs.fontFamily]) stack = FONT_STACKS[prefs.fontFamily];
  } catch (e) { /* storage unavailable */ }
  document.documentElement.style.setProperty(FONT_VAR, stack);
})();
