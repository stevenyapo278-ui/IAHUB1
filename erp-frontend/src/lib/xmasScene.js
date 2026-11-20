/**
 * Scène de Noël en canvas 2D : ciel étoilé, sapin procédural, guirlandes,
 * cadeaux, neige, étoile filante, étincelles et berceuse générée en Web Audio.
 *
 * Extraite de `sapin-de-noel.html` pour être réutilisable dans l'application
 * (page de connexion, fonds décoratifs). Aucune dépendance externe.
 *
 * Le rendu s'adapte à la taille du conteneur (ResizeObserver), respecte
 * `prefers-reduced-motion` (image fixe) et met l'animation en pause quand
 * l'onglet est masqué.
 */

const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

const LIGHT_COLORS = [
  { c: '#ffe6ab', g: 'rgba(255,214,130,ALPHA)', w: 5 }, // chaud
  { c: '#ffd07a', g: 'rgba(255,183,88,ALPHA)', w: 3 },
  { c: '#ff6079', g: 'rgba(255,86,120,ALPHA)', w: 2 }, // rouge
  { c: '#8ff0ff', g: 'rgba(120,235,255,ALPHA)', w: 2 }, // cyan
  { c: '#ffa8e2', g: 'rgba(255,150,222,ALPHA)', w: 1 }, // rose
  { c: '#c6ffd9', g: 'rgba(160,255,200,ALPHA)', w: 1 }, // vert menthe
];
const COLOR_POOL = LIGHT_COLORS.flatMap((o) => Array(o.w).fill(o));

const RNG_SEED = 20241224;

export function createXmasScene(canvas, options = {}) {
  const opts = {
    snow: true,
    presents: true,
    sparks: true,
    // Mode « vignette » (sidebar) : moins de particules, DPR et fps réduits.
    compact: false,
    ...options,
  };

  if (!canvas || typeof canvas.getContext !== 'function') {
    return { destroy() {}, startMusic: () => false, stopMusic() {}, isMusicPlaying: () => false };
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0;
  let H = 0;
  let DPR = 1;
  let cx = 0;
  let baseY = 0;
  let treeH = 0;
  let RMAX = 0;

  let sky = null;
  let treeLayer = null;
  let stars = [];
  let snow = [];
  let bokeh = [];
  let lights = [];
  let tinsel = [];
  let sparks = [];
  let presents = [];
  let shoot = null;
  let shootTimer = 4;

  let rafId = 0;
  let T = 0;
  let last = 0;
  let lastDraw = 0;
  let destroyed = false;

  // ---------------------------------------------------------------- geometry
  const radiusAt = (f) => RMAX * Math.pow(clamp(f, 0, 1), 1.12);
  const localY = (f) => -treeH * (1 - f);

  // ---------------------------------------------------------------- sizing
  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
    const cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));

    DPR = Math.min(window.devicePixelRatio || 1, opts.compact ? 1.5 : 2);
    W = cssW;
    H = cssH;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    cx = W * 0.5;
    baseY = H * 0.815;
    treeH = Math.min(H * 0.7, W * 1.22);
    RMAX = Math.min(treeH * 0.386, W * 0.43);

    buildSky();
    buildStars();
    buildSnow();
    buildBokeh();
    buildTreeLayer();
    buildLights();
    buildPresents();

    if (reduceMotion) renderStatic();
  }

  function buildSky() {
    sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.0, '#050a18');
    sky.addColorStop(0.36, '#081228');
    sky.addColorStop(0.68, '#0a1b33');
    sky.addColorStop(1.0, '#0d2438');
  }

  function buildStars() {
    stars = [];
    const n = Math.min(600, Math.max(opts.compact ? 14 : 6, Math.round((W * H) / 9000)));
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.pow(Math.random(), 1.25) * H * 0.82,
        r: rand(0.35, 1.35),
        a: rand(0.15, 0.95),
        ph: rand(0, TAU),
        sp: rand(0.6, 2.4),
      });
    }
  }

  function buildSnow() {
    snow = [];
    if (!opts.snow) return;
    const n = Math.round(
      clamp((W * H) / (opts.compact ? 2600 : 5200), opts.compact ? 45 : 120, 460)
    );
    for (let i = 0; i < n; i++) {
      const depth = Math.random();
      snow.push({
        x: Math.random() * W,
        y: Math.random() * H,
        depth,
        r: lerp(0.55, 2.5, depth * depth),
        vy: lerp(10, 46, depth),
        sway: rand(6, 26) * lerp(0.4, 1, depth),
        ph: rand(0, TAU),
        sp: rand(0.25, 0.85),
        a: lerp(0.25, 0.85, depth),
      });
    }
  }

  function buildBokeh() {
    bokeh = [];
    const count = opts.compact ? 8 : 16;
    for (let i = 0; i < count; i++) {
      bokeh.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(28, 110) * (opts.compact ? 0.55 : 1),
        a: rand(0.02, 0.075),
        vy: rand(-14, -3),
        ph: rand(0, TAU),
        hue: pick(['255,215,140', '150,220,255', '190,255,210']),
      });
    }
  }

  // ---------------------------------------------------------------- presents
  function buildPresents() {
    presents = [];
    if (!opts.presents) return;
    const s = clamp(treeH * 0.055, opts.compact ? 9 : 22, 62);
    const spots = [
      { dx: -RMAX * 0.94, w: s * 1.25, h: s * 0.95, c1: '#8e1f36', c2: '#c8394f', rib: '#ffd98a' },
      { dx: -RMAX * 0.55, w: s * 0.9, h: s * 0.72, c1: '#1c5c63', c2: '#2f8f92', rib: '#ffe9b8' },
      { dx: RMAX * 0.62, w: s * 1.1, h: s * 1.02, c1: '#8a5a17', c2: '#c8973a', rib: '#f7e6c4' },
      { dx: RMAX * 1.02, w: s * 0.78, h: s * 0.62, c1: '#4a2a63', c2: '#7a4f9c', rib: '#ffd98a' },
    ];
    // Vignette : deux cadeaux suffisent, quatre encombreraient un sapin de 100 px.
    presents = opts.compact ? [spots[0], spots[2]] : spots;
  }

  // ---------------------------------------------------------------- the fir
  // RNG déterministe : le sapin est identique à chaque redimensionnement.
  function mulberry32(a) {
    return function random() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildTreeLayer() {
    const rnd = mulberry32(RNG_SEED);
    const R = (a, b) => a + rnd() * (b - a);

    const cn = document.createElement('canvas');
    cn.width = Math.round(W * DPR);
    cn.height = Math.round(H * DPR);
    const c = cn.getContext('2d');
    c.scale(DPR, DPR);
    c.translate(cx, baseY);
    c.lineCap = 'round';
    c.lineJoin = 'round';

    const frost = [];

    drawTrunk(c);
    drawMass(c, rnd);

    // Étages de branches (whorls) : du bas vers le haut, pour que les étages
    // supérieurs recouvrent naturellement les inférieurs.
    const WHORLS = 22;
    for (let i = 0; i < WHORLS; i++) {
      const f = 0.035 + 0.958 * (i / (WHORLS - 1));
      const y = localY(f);
      const rad = radiusAt(f) * 1.02;

      const nB = f > 0.62 ? 10 : f > 0.3 ? 9 : 8;
      const baseAng = R(0, TAU);
      const list = [];
      for (let k = 0; k < nB; k++) {
        const th = baseAng + (k / nB) * TAU + R(-0.18, 0.18);
        const side = Math.sin(th);
        if (Math.abs(side) < 0.16) continue; // branches quasi face caméra
        list.push({ side, L: rad * R(0.78, 1.08), depth: Math.cos(th), th });
      }
      list.sort((a, b) => a.depth - b.depth); // arrière d'abord

      for (const b of list) {
        const projY = y - b.depth * b.L * 0.11 + b.L * 0.045;
        const x = b.side * b.L;
        const len = Math.hypot(x, projY - y);
        const ang = Math.atan2(projY - y, x);
        const front = clamp((b.depth + 1) / 2, 0, 1);
        const thick = clamp(len * 0.16, 3.0, 25) * (0.72 + 0.42 * front);
        drawBranch(c, 0, y, len, ang, thick, front, f, R, rnd, frost);
      }

      // ombre portée sous l'étage : sépare nettement les couches de branches
      if (i > 0 && f < 0.93) {
        const bandH = treeH * 0.03;
        c.save();
        conePath(c, 0.99);
        c.clip();
        const bg = c.createLinearGradient(0, y, 0, y + bandH);
        bg.addColorStop(0, 'rgba(1,10,7,0.30)');
        bg.addColorStop(0.45, 'rgba(1,10,7,0.12)');
        bg.addColorStop(1, 'rgba(1,10,7,0)');
        c.fillStyle = bg;
        c.fillRect(-RMAX * 1.1, y, RMAX * 2.2, bandH);
        c.restore();
      }
    }

    // ombrage de profondeur, découpé sur la silhouette du sapin
    c.save();
    conePath(c, 1.0);
    c.clip();
    const dg = c.createLinearGradient(-RMAX, 0, RMAX, 0);
    dg.addColorStop(0.0, 'rgba(1,9,6,0.34)');
    dg.addColorStop(0.3, 'rgba(1,9,6,0.10)');
    dg.addColorStop(0.55, 'rgba(1,9,6,0.02)');
    dg.addColorStop(0.8, 'rgba(120,210,180,0.05)');
    dg.addColorStop(1.0, 'rgba(150,230,200,0.10)');
    c.fillStyle = dg;
    c.fillRect(-RMAX * 1.2, localY(0) - treeH * 0.04, RMAX * 2.4, treeH * 1.12);
    c.restore();

    // pointe du sapin : bouquets courts et denses (le "leader")
    for (let i = 0; i < 7; i++) {
      const f = 0.012 + i * 0.016;
      const y = localY(f);
      const len = Math.max(3, radiusAt(f) * 1.0);
      const n = 5;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * TAU + R(-0.3, 0.3);
        const flip = Math.sin(ang) >= 0 ? 1 : -1;
        drawBranch(
          c,
          0,
          y,
          len * R(0.8, 1.5),
          flip > 0 ? R(-0.35, 0.35) : Math.PI + R(-0.35, 0.35),
          Math.max(2.4, treeH * 0.0052),
          1,
          f,
          R,
          rnd,
          frost
        );
      }
    }

    drawFrost(c, frost);
    drawFrostSnow(c, frost, R);
    drawOrnaments(c);

    treeLayer = cn;
  }

  function conePath(c, k) {
    const steps = 64;
    c.beginPath();
    for (let i = 0; i <= steps; i++) {
      const f = 0.02 + 0.98 * (i / steps);
      c.lineTo(radiusAt(f) * k, localY(f) + treeH * 0.012);
    }
    for (let i = steps; i >= 0; i--) {
      const f = 0.02 + 0.98 * (i / steps);
      c.lineTo(-radiusAt(f) * k, localY(f) + treeH * 0.012);
    }
    c.closePath();
  }

  // Masse sombre intérieure : évite les "trous" et donne du volume.
  function drawMass(c, rnd) {
    const steps = 64;
    c.beginPath();
    for (let i = 0; i <= steps; i++) {
      const f = 0.02 + 0.98 * (i / steps);
      const x = radiusAt(f) * (0.985 + (rnd() - 0.5) * 0.05);
      c.lineTo(x, localY(f) + treeH * 0.012);
    }
    for (let i = steps; i >= 0; i--) {
      const f = 0.02 + 0.98 * (i / steps);
      const x = radiusAt(f) * (0.985 + (rnd() - 0.5) * 0.05);
      c.lineTo(-x, localY(f) + treeH * 0.012);
    }
    c.closePath();
    const g = c.createLinearGradient(0, localY(0), 0, localY(1));
    g.addColorStop(0, '#0f4430');
    g.addColorStop(0.5, '#07281b');
    g.addColorStop(1, '#03130c');
    c.fillStyle = g;
    c.fill();
  }

  // Une branche = une tige fine + des bouquets d'aiguilles répartis dessus.
  // C'est ce qui donne le bord "en dentelle" irrégulier d'un vrai sapin.
  function drawBranch(c, ox, oy, len, ang, thick, front, f, R, rnd, frost) {
    c.save();
    c.translate(ox, oy);
    c.rotate(ang);

    const lit = clamp(front * 0.62 + f * 0.38, 0, 1);
    const colTop = `rgb(${Math.round(26 + 78 * lit)},${Math.round(104 + 92 * lit)},${Math.round(64 + 76 * lit)})`;
    const colBot = `rgb(${Math.round(5 + 16 * lit)},${Math.round(32 + 34 * lit)},${Math.round(21 + 26 * lit)})`;

    // --- tige
    c.beginPath();
    c.moveTo(-thick * 0.4, thick * 0.16);
    c.quadraticCurveTo(len * 0.5, -thick * 0.5, len * 1.01, -thick * 0.22);
    c.quadraticCurveTo(len * 0.5, thick * 0.18, -thick * 0.4, thick * 0.16);
    c.closePath();
    c.fillStyle = `rgba(${Math.round(9 + 16 * lit)},${Math.round(46 + 30 * lit)},${Math.round(30 + 24 * lit)},0.95)`;
    c.fill();

    // --- bouquets d'aiguilles le long de la tige
    const nC = clamp(Math.round(len / 5.5), 5, 20);
    for (let i = 0; i <= nC; i++) {
      const t = i / nC;
      const x = len * t;
      const y = -thick * 0.5 * Math.pow(t, 1.4) * 0.9 + thick * 0.1;

      // les bouquets du bas sont plus gros (comme sur un sapin)
      const scale = (1.15 - 0.55 * t) * (0.7 + 0.55 * front);
      const nN = 3 + Math.round(rnd() * 3);

      for (let k = 0; k < nN; k++) {
        const upSide = k % 2 === 0;
        const spread = R(0.16, 0.94);
        const na = (upSide ? -spread : spread) + R(-0.22, 0.22);
        const nl = clamp(thick * R(1.15, 2.7) * scale, 4, 25);
        const bx = x + R(-thick * 0.3, thick * 0.3);
        const by = y + R(-thick * 0.25, thick * 0.25);
        const wBase = clamp(thick * 0.34 * scale, 0.9, 5.2);

        const tipX = bx + Math.cos(na) * nl;
        const tipY = by + Math.sin(na) * nl;
        // courbure : les aiguilles retombent
        const midX = bx + Math.cos(na) * nl * 0.55;
        const midY = by + Math.sin(na) * nl * 0.55 + (upSide ? -nl * 0.1 : nl * 0.22);

        const bright = upSide ? R(0.45, 1) : R(0, 0.6);
        c.beginPath();
        c.moveTo(bx - Math.sin(na) * wBase * 0.5, by + Math.cos(na) * wBase * 0.5);
        c.quadraticCurveTo(midX - Math.sin(na) * wBase * 0.42, midY + Math.cos(na) * wBase * 0.42, tipX, tipY);
        c.quadraticCurveTo(
          midX + Math.sin(na) * wBase * 0.42,
          midY - Math.cos(na) * wBase * 0.42,
          bx + Math.sin(na) * wBase * 0.5,
          by - Math.cos(na) * wBase * 0.5
        );
        c.closePath();
        c.fillStyle =
          bright > 0.62
            ? colTop
            : bright > 0.3
              ? `rgba(${Math.round(14 + 34 * lit)},${Math.round(62 + 54 * lit)},${Math.round(40 + 44 * lit)},1)`
              : colBot;
        c.globalAlpha = 0.55 + 0.45 * bright;
        c.fill();
        c.globalAlpha = 1;

        // givre sur les aiguilles du dessus
        if (upSide && front > 0.45 && rnd() < 0.16) {
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          frost.push([
            ox + ca * tipX - sa * tipY,
            oy + sa * tipX + ca * tipY,
            R(0.5, 1.6),
            R(0.12, 0.45) * front,
          ]);
        }
      }
    }

    // --- reflet de lune sur le dessus de la branche
    if (front > 0.4) {
      c.strokeStyle = `rgba(200,242,255,${(0.13 * front * (0.35 + 0.65 * f)).toFixed(3)})`;
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(0, -thick * 0.45);
      c.quadraticCurveTo(len * 0.5, -thick * 1.0, len, -thick * 0.3);
      c.stroke();
    }

    c.restore();
  }

  function drawFrost(c, frost) {
    for (const [x, y, r, a] of frost) {
      c.fillStyle = `rgba(224,255,247,${a.toFixed(3)})`;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
  }

  // petits amas de neige posés sur les branches du dessus
  function drawFrostSnow(c, frost, R) {
    for (let i = 0; i < frost.length; i++) {
      const p = frost[i];
      if (p[3] < 0.28) continue;
      if (R(0, 1) > 0.2) continue;
      c.fillStyle = `rgba(236,250,255,${(p[3] * 1.4).toFixed(3)})`;
      c.beginPath();
      c.ellipse(p[0], p[1] - 1.2, p[2] * 2.1, p[2] * 0.85, 0, 0, TAU);
      c.fill();
    }
  }

  function drawTrunk(c) {
    const w = Math.max(5, treeH * 0.022);
    const top = localY(0.17);
    const g = c.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#2a1a12');
    g.addColorStop(0.35, '#5c3a26');
    g.addColorStop(0.6, '#3a2418');
    g.addColorStop(1, '#150c08');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-w * 0.24, top);
    c.lineTo(w * 0.24, top);
    c.lineTo(w * 0.75, 2);
    c.lineTo(-w * 0.75, 2);
    c.closePath();
    c.fill();
  }

  function drawOrnaments(c) {
    const palette = [
      ['#ff5f77', '#8c1128'],
      ['#ffd68a', '#a86c15'],
      ['#f4f7ff', '#9fb0c6'],
      ['#59d8d0', '#0f5f66'],
      ['#c48bff', '#492a72'],
      ['#ff2f4f', '#6d0a1d'],
    ];
    // Les boules suivent la taille du sapin : à 133 px de haut (sidebar), des boules
    // de 9 px de rayon écraseraient les branches.
    const k = clamp(treeH / 630, 0.18, 1);
    const n = opts.compact ? 9 : 14;
    for (let i = 0; i < n; i++) {
      const f = 0.22 + 0.7 * Math.random();
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = side * radiusAt(f) * rand(0.34, 0.86);
      const y = localY(f) + rand(-treeH * 0.012, treeH * 0.012);
      const r = rand(5.0, 9.6) * clamp(f + 0.5, 0.72, 1.25) * k;
      const [hi, lo] = pick(palette);

      // fil
      c.strokeStyle = 'rgba(255,240,200,0.20)';
      c.lineWidth = Math.max(0.4, 0.8 * k);
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + rand(-3, 3) * k, y - r - rand(5, 11) * k);
      c.stroke();

      const gr = c.createRadialGradient(x - r * 0.36, y - r * 0.42, r * 0.08, x, y, r * 1.12);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.22, hi);
      gr.addColorStop(1, lo);

      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fillStyle = gr;
      c.fill();

      // reflet et ombre
      c.beginPath();
      c.ellipse(x - r * 0.34, y - r * 0.4, r * 0.26, r * 0.17, -0.6, 0, TAU);
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.fill();

      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.strokeStyle = 'rgba(0,0,0,0.28)';
      c.lineWidth = 0.9;
      c.stroke();
    }
  }

  // ---------------------------------------------------------------- lights
  function buildLights() {
    lights = [];
    const n = Math.round(clamp(RMAX * 0.55, opts.compact ? 30 : 90, 190));
    const turns = 8.2;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = u * turns * TAU + 0.6;
      const f = 0.075 + 0.9 * Math.pow(u, 0.52);
      const col = pick(COLOR_POOL);
      lights.push({
        f,
        a,
        col,
        sprite: glowSprite(col.g.slice(5, col.g.indexOf(',ALPHA'))),
        size: rand(1.5, 2.9) * (0.7 + 0.5 * f),
        ph: rand(0, TAU),
        sp: rand(1.0, 3.0),
        kind: Math.random(),
        off: rand(-0.05, 0.05),
      });
    }

    tinsel = [];
    const m = Math.round(clamp(RMAX * 0.7, opts.compact ? 40 : 110, 240));
    for (let i = 0; i < m; i++) {
      const u = i / m;
      const a = u * 11.5 * TAU + 2.2;
      tinsel.push({ f: 0.08 + 0.88 * Math.pow(u, 0.55), a, r: rand(0.5, 1.15), ph: rand(0, TAU) });
    }
  }

  // ---------------------------------------------------------------- draw
  function drawSkyLayer(time) {
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // halo de lune en haut à droite
    const mx = W * 0.82;
    const my = H * 0.14;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, Math.max(W, H) * 0.42);
    mg.addColorStop(0, 'rgba(146,182,255,0.16)');
    mg.addColorStop(0.35, 'rgba(96,130,200,0.055)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, W, H);

    // étoiles
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(time * s.sp + s.ph);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = '#eaf3ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // bokeh diffus
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bokeh) {
      const pul = 0.7 + 0.3 * Math.sin(time * 0.5 + b.ph);
      stamp(glowSprite(b.hue), b.x, b.y, b.r * 1.55, b.a * 5.2 * pul);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawShootingStar(dt) {
    shutTimerTick(dt);
    if (!shoot) return;
    shoot.x += shoot.vx * dt;
    shoot.y += shoot.vy * dt;
    shoot.life -= dt * 0.55;
    if (shoot.life <= 0 || shoot.x > W + 200) {
      shoot = null;
      return;
    }

    const len = 120 * shoot.life;
    const ang = Math.atan2(shoot.vy, shoot.vx);
    const tx = shoot.x - Math.cos(ang) * len;
    const ty = shoot.y - Math.sin(ang) * len;
    const g = ctx.createLinearGradient(shoot.x, shoot.y, tx, ty);
    g.addColorStop(0, `rgba(255,255,255,${(0.85 * shoot.life).toFixed(2)})`);
    g.addColorStop(0.4, `rgba(190,225,255,${(0.25 * shoot.life).toFixed(2)})`);
    g.addColorStop(1, 'rgba(190,225,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoot.x, shoot.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  function shutTimerTick(dt) {
    if (shoot) return;
    shootTimer -= dt;
    if (shootTimer <= 0) {
      shootTimer = rand(9, 20);
      const sx = rand(W * 0.05, W * 0.75);
      shoot = { x: sx, y: rand(0, H * 0.3), vx: rand(340, 620), vy: rand(90, 210), life: 1 };
    }
  }

  function drawSnowLayer(dt, time, front) {
    for (const s of snow) {
      if ((s.depth > 0.55) !== front) continue;
      const sway = Math.sin(time * s.sp + s.ph) * s.sway;
      ctx.globalAlpha = s.a * (front ? 1 : 0.75);
      ctx.fillStyle = front ? '#ffffff' : '#dbe9ff';
      if (s.r > 1.9) {
        ctx.save();
        ctx.shadowBlur = s.r * 3.2;
        ctx.shadowColor = 'rgba(200,230,255,0.55)';
        ctx.beginPath();
        ctx.arc(s.x + sway, s.y, s.r, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(s.x + sway, s.y, s.r, 0, TAU);
        ctx.fill();
      }
      s.y += s.vy * dt;
      s.x += (s.vx || 0) * dt + Math.cos(time * s.sp * 0.7 + s.ph) * 4 * dt;
      if (s.y - 6 > H) {
        s.y = -8;
        s.x = Math.random() * W;
      }
      if (s.x < -20) s.x = W + 20;
      if (s.x > W + 20) s.x = -20;
    }
    ctx.globalAlpha = 1;
  }

  function drawMound() {
    // ombre de contact
    const sg = ctx.createRadialGradient(cx, baseY + H * 0.004, 0, cx, baseY + H * 0.004, RMAX * 1.05);
    sg.addColorStop(0, 'rgba(1,8,6,0.50)');
    sg.addColorStop(0.6, 'rgba(1,8,6,0.18)');
    sg.addColorStop(1, 'rgba(1,8,6,0)');
    ctx.save();
    ctx.translate(cx, baseY + H * 0.004);
    ctx.scale(1, 0.16);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, RMAX * 1.05, 0, TAU);
    ctx.fill();
    ctx.restore();

    // congère au pied du sapin
    const g = ctx.createRadialGradient(cx, baseY + H * 0.012, 0, cx, baseY + H * 0.012, RMAX * 1.15);
    g.addColorStop(0, 'rgba(226,242,255,0.22)');
    g.addColorStop(0.55, 'rgba(206,230,255,0.11)');
    g.addColorStop(1, 'rgba(180,210,245,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, baseY + H * 0.012, RMAX * 1.15, H * 0.03, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(238,248,255,0.26)';
    ctx.beginPath();
    ctx.ellipse(cx + RMAX * 0.22, baseY + H * 0.001, RMAX * 0.6, H * 0.014, 0, 0, TAU);
    ctx.fill();
  }

  function drawGround() {
    // halo doux au sol (fondu progressif, sans bord net)
    const gy = baseY + H * 0.02;
    const rx = RMAX * 2.6;
    const ry = H * 0.085;
    const g = ctx.createRadialGradient(cx, gy, 0, cx, gy, rx);
    g.addColorStop(0.0, 'rgba(150,190,235,0.16)');
    g.addColorStop(0.35, 'rgba(130,172,222,0.09)');
    g.addColorStop(0.62, 'rgba(105,145,200,0.04)');
    g.addColorStop(0.85, 'rgba(90,130,190,0.012)');
    g.addColorStop(1.0, 'rgba(80,120,180,0)');
    ctx.save();
    ctx.translate(cx, gy);
    ctx.scale(1, ry / rx);
    ctx.translate(-cx, -gy);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, gy, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawAura(time) {
    const pulse = 0.82 + 0.18 * Math.sin(time * 0.9);
    const g = ctx.createRadialGradient(cx, baseY - treeH * 0.45, 0, cx, baseY - treeH * 0.45, treeH * 0.85);
    g.addColorStop(0, `rgba(120,255,190,${(0.085 * pulse).toFixed(3)})`);
    g.addColorStop(0.5, `rgba(90,190,255,${(0.035 * pulse).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  function bulbIntensity(l, time) {
    const base = 0.62 + 0.38 * Math.sin(time * l.sp + l.ph);
    let v = base;
    if (l.kind > 0.86) {
      // guirlande "chenillard" : éclairs ponctuels
      const blink = Math.sin(time * 1.15 - l.f * 9.0);
      v = 0.25 + 0.9 * Math.pow(Math.max(0, blink), 4);
    }
    return clamp(v, 0.06, 1.25);
  }

  function drawLights(time, front) {
    ctx.globalCompositeOperation = 'lighter';

    // tinsel (fines paillettes le long d'une spirale)
    const white = glowSprite('255,248,220');
    for (const p of tinsel) {
      const x = cx + radiusAt(p.f) * Math.sin(p.a) * 0.99;
      const depth = Math.cos(p.a);
      if ((depth > 0.05) !== front) continue;
      const y = baseY + localY(p.f) + depth * RMAX * 0.035;
      const tw = 0.4 + 0.6 * Math.max(0, Math.sin(time * 2.2 + p.ph));
      stamp(white, x, y, p.r * 4, 0.42 * tw * (front ? 1 : 0.45));
      ctx.fillStyle = `rgba(255,252,235,${(0.6 * tw * (front ? 1 : 0.5)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, TAU);
      ctx.fill();
    }

    // ampoules
    for (const l of lights) {
      const depth = Math.cos(l.a);
      const isFront = depth > 0;
      if (isFront !== front) continue;

      const rr = radiusAt(l.f);
      const x = cx + rr * Math.sin(l.a);
      const y = baseY + localY(l.f) + depth * RMAX * 0.045;

      const v = bulbIntensity(l, time) * (isFront ? 1 : 0.34);
      const s = l.size * (isFront ? 1 : 0.72);

      stamp(l.sprite, x, y, s * 9 * (0.6 + 0.9 * v), 0.9 * v);

      ctx.globalAlpha = clamp(0.45 + v, 0, 1);
      ctx.fillStyle = l.col.c;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isFront && v > 0.85) {
        stamp(white, x, y, s * 2.4, (v - 0.85) * 1.6);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawStar(time) {
    const sx = cx;
    const sy = baseY + localY(0.015) - treeH * 0.012;
    const r = clamp(treeH * 0.045, 9, 30);
    const pulse = 0.86 + 0.14 * Math.sin(time * 2.1);
    const rot = time * 0.32;

    ctx.globalCompositeOperation = 'lighter';

    // grand halo
    const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 8.5 * pulse);
    hg.addColorStop(0, 'rgba(255,244,203,0.55)');
    hg.addColorStop(0.22, 'rgba(255,206,110,0.20)');
    hg.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 8.5 * pulse, 0, TAU);
    ctx.fill();

    // rayons tournants
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(TAU / 4);
      const rg = ctx.createLinearGradient(0, 0, r * 4.6, 0);
      rg.addColorStop(0, 'rgba(255,235,180,0.38)');
      rg.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.22);
      ctx.lineTo(r * 4.6, 0);
      ctx.lineTo(0, r * 0.22);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // étoile à 5 branches
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.sin(time * 0.55) * 0.14);
    const pts = 5;
    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const rad = i % 2 === 0 ? r : r * 0.42;
      const a = (i / (pts * 2)) * TAU - Math.PI / 2;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.15);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(0.45, '#ffe9a8');
    sg.addColorStop(1, '#e0a233');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,225,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // scintillements
    for (let i = 0; i < 5; i++) {
      const a = rot * 2 + i * 1.7;
      const d = r * (2.2 + (i % 3) * 1.3);
      const tw = 0.35 + 0.65 * Math.max(0, Math.sin(time * 3 + i * 2.1));
      ctx.fillStyle = `rgba(255,250,235,${(0.8 * tw).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 1.2 * tw + 0.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPresentsLayer() {
    for (const p of presents) {
      const x = cx + p.dx;
      const y = baseY + H * 0.012;
      const w = p.w;
      const h = p.h;

      const g = ctx.createLinearGradient(x - w / 2, y - h, x + w / 2, y);
      g.addColorStop(0, p.c1);
      g.addColorStop(0.55, p.c2);
      g.addColorStop(1, p.c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h, w, h, 3);
      else ctx.rect(x - w / 2, y - h, w, h);
      ctx.fill();

      // couvercle
      const lg = ctx.createLinearGradient(x - w / 2, y - h, x + w / 2, y - h);
      lg.addColorStop(0, p.rib);
      lg.addColorStop(0.5, '#ffffff');
      lg.addColorStop(1, p.rib);
      ctx.fillStyle = lg;
      ctx.fillRect(x - w / 2, y - h - h * 0.13, w, h * 0.16);

      // ruban vertical
      ctx.fillStyle = p.rib;
      ctx.globalAlpha = 0.95;
      ctx.fillRect(x - w * 0.08, y - h, w * 0.16, h);
      ctx.globalAlpha = 1;

      // nœud
      ctx.fillStyle = p.rib;
      ctx.beginPath();
      ctx.ellipse(x - w * 0.14, y - h - h * 0.16, w * 0.13, h * 0.09, -0.5, 0, TAU);
      ctx.ellipse(x + w * 0.14, y - h - h * 0.16, w * 0.13, h * 0.09, 0.5, 0, TAU);
      ctx.fill();

      // ombre au sol
      ctx.fillStyle = 'rgba(2,10,20,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y + 1, w * 0.62, h * 0.1, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(
      W * 0.5,
      H * 0.48,
      Math.min(W, H) * 0.28,
      W * 0.5,
      H * 0.48,
      Math.max(W, H) * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(2,6,16,0.28)');
    g.addColorStop(1, 'rgba(1,3,10,0.70)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- sparks
  function emitSparks(x, y, count) {
    if (!opts.sparks || reduceMotion) return;
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(30, 300) * (Math.random() < 0.3 ? 0.4 : 1);
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(20, 90),
        life: 1,
        decay: rand(0.5, 1.3),
        r: rand(0.8, 2.6),
        hue: pick(['255,236,178', '255,196,110', '186,232,255', '255,255,255', '255,160,190']),
      });
    }
    if (sparks.length > 900) sparks.splice(0, sparks.length - 900);
  }

  function updateSparks(dt) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= dt * p.decay;
      if (p.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      p.vy += 120 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const a = p.life * p.life;
      const r = p.r * (0.4 + p.life);
      stamp(glowSprite(p.hue), p.x, p.y, r * 5, 0.95 * a);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- sprites
  // sprites de halo pré-calculés (beaucoup plus rapide que des dégradés par image)
  const glowCache = new Map();

  function glowSprite(rgb) {
    let s = glowCache.get(rgb);
    if (s) return s;
    const S = 128;
    s = document.createElement('canvas');
    s.width = s.height = S;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.0, `rgba(${rgb},1)`);
    g.addColorStop(0.16, `rgba(${rgb},0.62)`);
    g.addColorStop(0.42, `rgba(${rgb},0.16)`);
    g.addColorStop(1.0, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    glowCache.set(rgb, s);
    return s;
  }

  function stamp(sprite, x, y, radius, alpha) {
    if (alpha <= 0.004) return;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- loop
  function drawFrame(time, dt) {
    drawSkyLayer(time);
    drawBokehMove(dt);
    drawShootingStar(dt);
    drawGround();
    drawSnowLayer(dt, time, false);

    // halo derrière l'arbre
    drawAura(time);

    // ampoules de l'arrière (avant le sapin => vraie profondeur)
    ctx.save();
    const sway = Math.sin(time * 0.42) * 0.0055;
    ctx.translate(cx, baseY);
    ctx.rotate(sway);
    ctx.translate(-cx, -baseY);

    drawLights(time, false);

    // le sapin (image pré-rendue, donc très fluide)
    if (treeLayer) ctx.drawImage(treeLayer, 0, 0, W, H);

    drawLights(time, true);
    drawMound();
    drawStar(time);
    ctx.restore();

    // au sol
    drawPresentsLayer();
    drawSnowLayer(dt, time, true);
    updateSparks(dt);
    drawVignette();
  }

  function drawBokehMove(dt) {
    for (const b of bokeh) {
      b.y += b.vy * dt;
      if (b.y < -b.r) {
        b.y = H + b.r;
        b.x = Math.random() * W;
      }
    }
  }

  function renderStatic() {
    drawFrame(0, 0);
  }

  function frame(now) {
    if (destroyed) return;
    if (!last) last = now;

    // Vignette de sidebar : 30 fps suffisent et divisent la charge CPU par deux.
    if (opts.compact && now - lastDraw < 1000 / 30) {
      rafId = window.requestAnimationFrame(frame);
      return;
    }
    lastDraw = now;

    let dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0, 0.05);
    T += dt;

    drawFrame(T, dt);
    rafId = window.requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || reduceMotion) {
      if (reduceMotion) renderStatic();
      return;
    }
    if (!rafId) {
      last = 0;
      rafId = window.requestAnimationFrame(frame);
    }
  }

  function stop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // ---------------------------------------------------------------- events
  function onPointerMove(e) {
    if (!pointInCanvas(e.clientX, e.clientY)) return;
    emitSparks(e.clientX, e.clientY, 2);
  }

  function onPointerDown(e) {
    if (!pointInCanvas(e.clientX, e.clientY)) return;
    emitSparks(e.clientX, e.clientY, 45);
  }

  function pointInCanvas(x, y) {
    const r = canvas.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  const pointerTarget = opts.pointerTarget || canvas.parentElement || canvas;
  if (opts.sparks) {
    pointerTarget.addEventListener('pointermove', onPointerMove, { passive: true });
    pointerTarget.addEventListener('pointerdown', onPointerDown, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibility);

  let resizeTimer = null;
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    });
    observer.observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  // ---------------------------------------------------------------- musique
  // Petite berceuse de Noël générée en direct (Web Audio), aucune dépendance.
  const Music = (() => {
    let actx = null;
    let master = null;
    let wet = null;
    let timer = null;
    let step = 0;
    let playing = false;

    const PROG = [
      { bass: 48, notes: [64, 67, 72] }, // Do
      { bass: 45, notes: [60, 64, 67] }, // La m
      { bass: 41, notes: [65, 69, 72] }, // Fa
      { bass: 43, notes: [67, 71, 74] }, // Sol
    ];
    const MEL = [
      [76, null, 79, 76, 72, null, 74, null],
      [72, null, 76, 72, 69, null, 71, null],
      [77, null, 74, 72, 69, null, 72, null],
      [74, null, 71, 74, 79, null, 76, null],
    ];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    function init() {
      if (actx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();

      master = actx.createGain();
      master.gain.value = 0.0001;
      master.connect(actx.destination);

      wet = actx.createGain();
      wet.gain.value = 0.55;
      const delay = actx.createDelay(1.2);
      delay.delayTime.value = 0.34;
      const fb = actx.createGain();
      fb.gain.value = 0.38;
      const damp = actx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2200;
      wet.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(master);
    }

    function voice(freq, t, dur, gain, type) {
      const o = actx.createOscillator();
      const o2 = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o2.type = 'sine';
      o.frequency.value = freq;
      o2.frequency.value = freq * 2.005;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      const g2 = actx.createGain();
      g2.gain.value = 0.16;
      o.connect(g);
      o2.connect(g2);
      g2.connect(g);
      g.connect(master);
      g.connect(wet);
      o.start(t);
      o2.start(t);
      o.stop(t + dur + 0.05);
      o2.stop(t + dur + 0.05);
    }

    function tick() {
      if (!playing) return;
      const bar = Math.floor(step / 8) % 4;
      const beat = step % 8;
      const t = actx.currentTime + 0.08;
      const chord = PROG[bar];

      if (step % 8 === 0) voice(mtof(chord.bass), t, 3.4, 0.16, 'sine'); // basse
      if (step % 8 === 4) voice(mtof(chord.bass + 7), t, 2.0, 0.09, 'sine');

      // arpège de fond
      const arp = chord.notes[step % 3] + (step % 8 >= 4 ? 12 : 0);
      voice(mtof(arp), t, 1.5, 0.045, 'triangle');

      // mélodie
      const m = MEL[bar][beat];
      if (m) voice(mtof(m), t, 1.9, 0.085, 'triangle');

      step++;
    }

    function startMusic() {
      init();
      if (!actx) return false;
      if (actx.state === 'suspended') actx.resume();
      playing = true;
      master.gain.cancelScheduledValues(actx.currentTime);
      master.gain.setValueAtTime(master.gain.value, actx.currentTime);
      master.gain.linearRampToValueAtTime(0.5, actx.currentTime + 1.6);
      if (timer) clearInterval(timer);
      step = 0;
      tick();
      timer = setInterval(tick, 390);
      return true;
    }

    function stopMusic() {
      if (!actx) return;
      playing = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      master.gain.cancelScheduledValues(actx.currentTime);
      master.gain.setValueAtTime(master.gain.value, actx.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, actx.currentTime + 0.7);
    }

    function dispose() {
      try {
        stopMusic();
        if (actx) actx.close();
      } catch {
        /* déjà fermé */
      }
      actx = null;
      master = null;
      wet = null;
    }

    return { startMusic, stopMusic, dispose, isPlaying: () => playing };
  })();

  // ---------------------------------------------------------------- démarrage
  resize();
  start();
  // petite pluie d'étincelles d'ouverture sur l'étoile
  if (!reduceMotion) {
    window.setTimeout(() => {
      if (!destroyed) emitSparks(cx, baseY - treeH * 1.02, 55);
    }, 700);
  }

  return {
    destroy() {
      destroyed = true;
      stop();
      Music.dispose();
      document.removeEventListener('visibilitychange', onVisibility);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', resize);
      if (opts.sparks) {
        pointerTarget.removeEventListener('pointermove', onPointerMove);
        pointerTarget.removeEventListener('pointerdown', onPointerDown);
      }
      clearTimeout(resizeTimer);
      glowCache.clear();
      treeLayer = null;
    },
    startMusic: () => Music.startMusic(),
    stopMusic: () => Music.stopMusic(),
    isMusicPlaying: () => Music.isPlaying(),
    resize,
  };
}
