import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Loader2, RotateCcw } from 'lucide-react';
import { CENTER_TYPE_LABEL, STATUS_LABELS } from './labels';
import { itemColor } from './fanLayout';

// ─── Mode « réseau de neurones » (WebGL / three.js) ──────────────────────────
// Arbre horizontal projeté en 3D : racine → catégories → éléments, nœuds
// lumineux (halo additif), connecteurs fins, dérive lente de caméra + pulsation.
// Chunk lazy (import three isolé de la page /explorer). Clic = mêmes actions que
// les autres modes (déplier une branche / ouvrir le détail / choisir le centre).

const CAM_Z = 9;
const POS = { rootX: -4.6, catX: 0, itemX: 4.6 };
const SIZE = { root: 0.4, cat: 0.26, item: 0.17 };
const MAX_Z = 0.7;

function makeHaloTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function NeuralMode({
  centerType, centerData, loading, error, empty,
  loadCategory, onItem, onPickCenter,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const labelRefs = useRef(new Map());
  const [expanded, setExpanded] = useState(() => new Set());
  const [catData, setCatData] = useState({});
  const [hover, setHover] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0); // relance la scène après un échec WebGL

  async function ensure(key) {
    if (catData[key]?.status) return;
    setCatData((d) => ({ ...d, [key]: { status: 'loading' } }));
    try {
      const res = await loadCategory(key);
      setCatData((d) => ({ ...d, [key]: { status: 'ready', items: res.items || [], total: res.total ?? 0 } }));
    } catch {
      setCatData((d) => ({ ...d, [key]: { status: 'error' } }));
    }
  }

  function toggle(cat) {
    const open = expanded.has(cat.key);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.delete(cat.key); else next.add(cat.key);
      return next;
    });
    if (!open) ensure(cat.key);
  }

  // ── Mise en page pure (nœuds + liens) ────────────────────────────────────
  const layout = useMemo(() => {
    const cats = centerData?.categories || [];
    const nodes = [];
    const links = [];
    nodes.push({ key: 'center', kind: 'center', label: centerData?.center?.label || 'Centre', sub: centerData?.center?.sub, color: '#38bdf8', size: SIZE.root, x: POS.rootX, y: 0 });
    const n = cats.length || 1;
    // Espacement comprimé si besoin pour tenir dans le champ de la caméra
    const step = n > 1 ? Math.min(1.05, 6.3 / (n - 1)) : 0;
    cats.forEach((c, i) => {
      const y = (i - (n - 1) / 2) * step;
      const open = expanded.has(c.key);
      nodes.push({ key: `cat:${c.key}`, kind: 'cat', cat: c, label: c.label, count: c.count, color: open ? '#60a5fa' : '#7dd3fc', size: SIZE.cat, x: POS.catX, y });
      links.push({ a: 'center', b: `cat:${c.key}`, color: open ? '#60a5fa' : '#334155' });
      if (!open) return;
      const entry = catData[c.key];
      const items = entry?.status === 'ready' ? entry.items : [];
      const m = items.length || 1;
      items.forEach((item, j) => {
        const iy = y + (j - (m - 1) / 2) * 0.62;
        nodes.push({ key: `item:${c.key}:${item.kind}:${item.id}`, kind: 'item', item, label: item.ref ? `${item.ref} · ${item.label}` : item.label, sub: item.meta, color: itemColor(item), size: SIZE.item, x: POS.itemX, y: iy });
        links.push({ a: `cat:${c.key}`, b: `item:${c.key}:${item.kind}:${item.id}`, color: itemColor(item) });
      });
    });
    return { nodes, links };
  }, [centerData, expanded, catData]);

  // Callbacks à jour pour la boucle three.js (sans re-monter la scène)
  const latest = useRef({});
  useEffect(() => {
    latest.current = { toggle, onItem, onPickCenter, layout, expanded };
  });

  // ── Scène three.js (montage unique) ──────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    void attempt; // dépendance volontaire : reconstruire au « Réessayer »
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      queueMicrotask(() => setFailed(true));
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, CAM_Z);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.PointLight(0x93c5fd, 60, 40);
    key.position.set(4, 3, 8);
    scene.add(key);

    const root = new THREE.Group();
    scene.add(root);
    const haloTex = makeHaloTexture();
    const content = new THREE.Group(); // remplacé à chaque rebuild
    root.add(content);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const meshes = [];
    const halos = [];
    let raf = 0;
    let hoverId = null;
    let downAt = null;
    let dragging = false;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
      const w = wrap.clientWidth || 960;
      const h = wrap.clientHeight || 620;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function disposeContent() {
      for (const obj of [...content.children]) {
        content.remove(obj);
        obj.traverse?.((o) => {
          o.geometry?.dispose?.();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material?.dispose?.();
        });
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      }
      meshes.length = 0;
      halos.length = 0;
    }

    function rebuild() {
      const { nodes, links } = latest.current.layout;
      disposeContent();
      const byKey = new Map();
      for (const n of nodes) {
        const geo = new THREE.SphereGeometry(n.size, 20, 16);
        const mat = new THREE.MeshStandardMaterial({
          color: n.color, emissive: n.color, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.1,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(n.x, n.y, (Math.sin(n.x * 1.7 + n.y) || 0) * MAX_Z * 0.5);
        mesh.userData = n;
        content.add(mesh);
        byKey.set(n.key, mesh);
        meshes.push(mesh);

        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: haloTex, color: n.color, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        const s = n.size * (n.kind === 'center' ? 5.5 : 4.2);
        halo.scale.set(s, s, 1);
        halo.position.copy(mesh.position);
        content.add(halo);
        halos.push(halo);
      }
      for (const l of links) {
        const a = byKey.get(l.a);
        const b = byKey.get(l.b);
        if (!a || !b) continue;
        const geo = new THREE.BufferGeometry().setFromPoints([a.position, b.position]);
        const mat = new THREE.LineBasicMaterial({ color: l.color, transparent: true, opacity: 0.45 });
        content.add(new THREE.Line(geo, mat));
      }
    }
    rebuild();

    // L'état des nœuds change → reconstruire (les callbacks passent par latest)
    let lastLayout = latest.current.layout;
    function syncLayout() {
      if (latest.current.layout !== lastLayout) {
        lastLayout = latest.current.layout;
        rebuild();
      }
    }

    function projectLabels() {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const rect = wrap.getBoundingClientRect();
      for (const n of latest.current.layout.nodes) {
        const mesh = meshes.find((m) => m.userData.key === n.key);
        if (!mesh) continue;
        const el = labelRefs.current.get(n.key);
        if (!el) continue;
        const v = mesh.position.clone().applyMatrix4(content.matrixWorld).project(camera);
        const x = (v.x * 0.5 + 0.5) * rect.width;
        const y = (-v.y * 0.5 + 0.5) * rect.height;
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        el.style.opacity = v.z > 1 ? '0' : '1';
      }
    }

    function animate(t) {
      raf = requestAnimationFrame(animate);
      syncLayout();
      const time = t * 0.001;
      if (!reduce) {
        root.rotation.y = Math.sin(time * 0.14) * 0.09;
        root.rotation.x = Math.cos(time * 0.11) * 0.045;
        camera.position.x = Math.sin(time * 0.07) * 0.35;
        camera.lookAt(0, 0, 0);
        meshes.forEach((m, i) => {
          const pulse = 1 + Math.sin(time * 1.6 + i * 0.7) * 0.05;
          const boost = m.userData.key === hoverId ? 1.35 : 1;
          m.scale.setScalar(pulse * boost);
        });
        halos.forEach((h, i) => {
          h.material.opacity = 0.35 + Math.sin(time * 1.6 + i * 0.7) * 0.12 + (meshes[i]?.userData.key === hoverId ? 0.25 : 0);
        });
      } else {
        meshes.forEach((m) => m.scale.setScalar(m.userData.key === hoverId ? 1.3 : 1));
      }
      renderer.render(scene, camera);
      projectLabels();
    }
    raf = requestAnimationFrame(animate);

    function pick(ev) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(meshes, false);
      return hits[0]?.object || null;
    }

    function onMove(ev) {
      const mesh = pick(ev);
      const id = mesh?.userData.key || null;
      if (id !== hoverId) {
        hoverId = id;
        setHover(mesh ? { node: mesh.userData, x: ev.clientX, y: ev.clientY } : null);
        canvas.style.cursor = mesh ? 'pointer' : 'default';
      } else if (mesh) {
        setHover((h) => (h ? { ...h, x: ev.clientX, y: ev.clientY } : h));
      }
      if (dragging && downAt) {
        root.rotation.y += (ev.clientX - downAt.x) * 0.004;
        downAt = { x: ev.clientX, y: ev.clientY };
      }
    }
    function onDown(ev) { downAt = { x: ev.clientX, y: ev.clientY }; dragging = false; }
    function onUp(ev) {
      const moved = downAt ? Math.abs(ev.clientX - downAt.x) + Math.abs(ev.clientY - downAt.y) : 99;
      downAt = null;
      dragging = false;
      if (moved > 5) return; // glissé = rotation, pas un clic
      const mesh = pick(ev);
      if (!mesh) return;
      const n = mesh.userData;
      const cur = latest.current;
      if (n.kind === 'center') cur.onPickCenter();
      else if (n.kind === 'cat') cur.toggle(n.cat);
      else if (n.kind === 'item') cur.onItem(n.item);
    }
    function onLeave() { hoverId = null; setHover(null); }

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      disposeContent();
      haloTex.dispose();
      renderer.dispose();
    };
  }, [attempt]);

  if (failed) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-sm text-slate-400">
        <p>WebGL indisponible sur ce navigateur.</p>
        <button type="button" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}
          className="flex items-center gap-2 rounded-xl border border-white/15 px-3 py-1.5 text-slate-200 hover:bg-white/5 transition">
          <RotateCcw size={14} /> Réessayer
        </button>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-[620px] overflow-hidden rounded-xl"
      style={{ background: 'radial-gradient(1100px 520px at 50% 42%, #16213a 0%, #0b1120 55%, #070b14 100%)' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Réseau de neurones d'exploration" />

      {/* Étiquettes HTML projetées (cliquables = mêmes actions) */}
      <div ref={overlayRef} className="pointer-events-none absolute inset-0">
        {centerData && layout.nodes.map((n) => (
          <div
            key={n.key}
            ref={(el) => { if (el) labelRefs.current.set(n.key, el); else labelRefs.current.delete(n.key); }}
            className="pointer-events-auto absolute left-0 top-0 whitespace-nowrap"
          >
            {n.kind === 'center' ? (
              <button type="button" onClick={onPickCenter} title="Choisir un centre"
                className="rounded-xl border border-white/15 bg-white/[0.08] px-3 py-2 text-left text-slate-100 backdrop-blur transition hover:border-primary/50">
                <span className="block text-sm font-semibold">{n.label}</span>
                <span className="block text-[11px] text-slate-400">
                  {CENTER_TYPE_LABEL[centerType]}{n.sub && n.sub !== 'Lieu' ? ` · ${STATUS_LABELS[n.sub] || n.sub}` : ''}
                </span>
              </button>
            ) : n.kind === 'cat' ? (
              <button type="button" onClick={() => toggle(n.cat)} aria-expanded={expanded.has(n.cat.key)}
                className="rounded-lg border border-white/12 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-slate-200 backdrop-blur transition hover:border-primary/50">
                {n.label}
                <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-300">{n.count}</span>
              </button>
            ) : (
              <span className="flex max-w-[13rem] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-slate-300 backdrop-blur">
                <span className="h-2.5 w-1 shrink-0 rounded-full" style={{ background: n.color }} />
                <span className="truncate">{n.label}</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* États */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Chargement du centre…
        </div>
      )}
      {!loading && error}
      {!loading && !error && empty}
      {centerData && !expanded.size && !hover && (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-slate-400">
          Cliquez une branche pour l'ouvrir · glisser pour pivoter · clic = détail
        </p>
      )}

      {/* Infobulle au survol */}
      {hover && (
        <div className="pointer-events-none fixed z-30 rounded-lg border border-white/15 bg-surface-container-lowest/95 px-2.5 py-1.5 text-xs text-slate-100 shadow-xl"
          style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <span className="block font-medium">{hover.node.label}</span>
          {hover.node.sub && <span className="block text-[11px] text-slate-400">{hover.node.sub}</span>}
          {hover.node.kind === 'cat' && <span className="block text-[11px] text-slate-400">{hover.node.count} élément(s)</span>}
        </div>
      )}
    </div>
  );
}
