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
})();
