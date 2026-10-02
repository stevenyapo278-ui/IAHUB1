import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Zap } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { visiblePulseSections, pulseAlerts } from '../config/pulse';
import { visibleActions } from '../config/quickActions';
import SystemPulse from './SystemPulse';
import QuickActionsMenu from './QuickActionsFab';

// ─── Rail flottant unique (style onglet d'extension, bord gauche) ─────────────
// Regroupe les deux anciens boutons ronds (Actions rapides + Pouls système) dans une
// languette étroite, glissable partout à l'écran (souris/tactile) avec position
// mémorisée. Un déplacement < 5 px reste un CLIC : les boutons restent cliquables.
const STORE_KEY = 'floatingDock:position';
const RAIL_W = 40;
const RAIL_H = 92;
const PANEL_W = 336;
const MENU_W = 224;
const MENU_ITEM_H = 41;
const GAP = 10;
const DRAG_THRESHOLD = 5;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const clampPos = (p) => ({
  x: clamp(Number(p.x) || 0, 0, Math.max(0, window.innerWidth - RAIL_W)),
  y: clamp(Number(p.y) || 0, 0, Math.max(0, window.innerHeight - RAIL_H)),
});

function loadPosition() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return clampPos(p);
    }
  } catch { /* stockage indisponible */ }
  // Défaut : collé au bord gauche, centré verticalement (comme un onglet d'extension)
  return { x: 0, y: Math.round((window.innerHeight - RAIL_H) / 2) };
}

function savePosition(p) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* stockage indisponible */ }
}

export default function FloatingDock() {
  const { user } = useAuth();
  const [pos, setPos] = useState(loadPosition);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [dragging, setDragging] = useState(false);
  const [pulseOpen, setPulseOpen] = useState(() => localStorage.getItem('systemPulse:open') === '1');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false); // 403/401 sur /dashboard/pulse

  const railRef = useRef(null);
  const dragRef = useRef(null);
  const posRef = useRef(pos);
  // Le rail suit le pointeur pendant le glisser : le mouseup retombe donc SUR le bouton,
  // ce qui déclencherait un clic parasite → on avale le 1er clic après un drag.
  const suppressClickRef = useRef(false);

  // ── Données du pouls : un seul appel GET /dashboard/pulse, rafraîchi toutes
  //    les 60 s + au focus de la fenêtre + au clic sur rafraîchir ─────────────
  // Style .then() (comme AuthContext.refreshMe) : aucun setState synchrone dans l'effet.
  const load = useCallback(() => api
    .get('/dashboard/pulse')
    .then(({ data: payload }) => {
      setData(payload);
      setFailed(false);
      setForbidden(false);
    })
    .catch((err) => {
      if (err?.response?.status === 403 || err?.response?.status === 401) setForbidden(true);
      else setFailed(true);
    }), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const manualRefresh = () => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  };

  // ── Position : suivi du redimensionnement (recalage dans le listener) ──────
  useEffect(() => {
    const onResize = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      setPos((p) => clampPos(p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { posRef.current = pos; }, [pos]);

  // ── Glisser-déposer : écouteurs permanents, activation après seuil ─────────
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        setDragging(true);
        document.body.style.userSelect = 'none';
      }
      if (e.cancelable) e.preventDefault();
      setPos(clampPos({ x: d.posX + dx, y: d.posY + dy }));
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      document.body.style.userSelect = '';
      if (d?.moved) {
        suppressClickRef.current = true;
        savePosition(posRef.current);
      }
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
    };
  }, []);

  const onRailPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      posX: posRef.current.x, posY: posRef.current.y,
      moved: false,
    };
  };

  // ── Fermeture : clic extérieur (menu) + Échap (menu et panneau) ────────────
  useEffect(() => {
    if (!actionsOpen && !pulseOpen) return undefined;
    const onDown = (e) => {
      if (railRef.current?.contains(e.target)) return;
      if (e.target.closest?.('#system-pulse-panel')) return;
      setActionsOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setActionsOpen(false);
      setPulseOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [actionsOpen, pulseOpen]);

  if (forbidden && visibleActions(user).length === 0) return null;

  const sections = forbidden ? [] : visiblePulseSections(user, hasPermission);
  const { critical, warning } = pulseAlerts(data, sections);
  const actions = visibleActions(user);
  const canPulse = !forbidden && hasPermission(user, 'tickets.view');
  if (!canPulse && actions.length === 0) return null;

  const togglePulse = () => {
    setPulseOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem('systemPulse:open', next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  };

  // ── Ancrage : les panneaux suivent le rail (à sa droite, re-plafonnés au viewport)
  const panelLeft = clamp(pos.x + RAIL_W + GAP, 8, Math.max(8, vp.w - PANEL_W - 8));
  const panelTop = clamp(pos.y - 16, 8, Math.max(8, vp.h - 320));
  const panelStyle = { left: panelLeft, top: panelTop, maxHeight: `calc(100vh - ${panelTop + 8}px)` };

  const menuH = 8 + actions.length * MENU_ITEM_H;
  let menuTop = pos.y + 12;
  if (menuTop + menuH > vp.h - 8) menuTop = pos.y - menuH - 12;
  menuTop = clamp(menuTop, 8, Math.max(8, vp.h - menuH - 8));
  const menuStyle = {
    left: clamp(pos.x + RAIL_W + GAP, 8, Math.max(8, vp.w - MENU_W - 8)),
    top: menuTop,
  };

  return (
    <>
      {/* La languette : gribouillis de prise en haut, puis les 2 boutons */}
      <div
        ref={railRef}
        onPointerDown={onRailPointerDown}
        onClickCapture={(e) => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
        style={{ left: pos.x, top: pos.y }}
        role="toolbar"
        aria-label="Raccourcis flottants"
        className={`hidden md:flex fixed z-50 w-10 flex-col items-center gap-1 py-2 rounded-2xl
          border border-outline-variant bg-surface-container-lowest select-none touch-none
          ${dragging ? 'shadow-2xl cursor-grabbing' : 'shadow-lg cursor-grab'}`}
      >
        <span className="w-4 h-1 rounded-full bg-outline-variant mb-0.5" aria-hidden />

        {canPulse && (
          <button
            type="button"
            onClick={togglePulse}
            aria-expanded={pulseOpen}
            aria-controls="system-pulse-panel"
            title={pulseOpen ? 'Replier le pouls système' : 'Ouvrir le pouls système'}
            className={`relative h-7 w-7 rounded-xl flex items-center justify-center transition-colors
              ${pulseOpen ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`}
          >
            <Activity className="w-3.5 h-3.5" aria-hidden />
            {critical > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full
                bg-danger text-on-error text-[9px] font-bold flex items-center justify-center ring-2 ring-surface-container-lowest">
                {critical > 99 ? '99+' : critical}
              </span>
            )}
            {critical === 0 && warning > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-warning ring-2 ring-surface-container-lowest" />
            )}
            {critical === 0 && warning === 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-success ring-2 ring-surface-container-lowest" />
            )}
          </button>
        )}

        {actions.length > 0 && (
          <button
            type="button"
            onClick={() => setActionsOpen((v) => !v)}
            aria-expanded={actionsOpen}
            aria-label={actionsOpen ? 'Fermer les actions rapides' : 'Ouvrir les actions rapides'}
            title="Actions rapides"
            className={`h-7 w-7 rounded-xl flex items-center justify-center transition-colors
              ${actionsOpen ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`}
          >
            <Zap className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
      </div>

      {pulseOpen && canPulse && (
        <SystemPulse
          data={data}
          failed={failed}
          sections={sections}
          style={panelStyle}
          refreshing={refreshing}
          onRefresh={manualRefresh}
          onClose={() => setPulseOpen(false)}
        />
      )}

      {actionsOpen && actions.length > 0 && (
        <QuickActionsMenu
          actions={actions}
          style={menuStyle}
          onClose={() => setActionsOpen(false)}
        />
      )}
    </>
  );
}
