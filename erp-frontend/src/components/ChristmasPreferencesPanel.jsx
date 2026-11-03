import { useState } from 'react';
import { Slider, Label } from '@/components/ui';
import {
  Star, Snowflake, Gift, Palette,
  Starburst, Balloon, Lightbulb, Settings, RotateCcw,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useUserPreferences } from '../context/UserPreferencesContext';

/**
 * ─── Panneau de préférences "Noël" (dans le CustomizerDrawer) ─────────────────
 *
 * Ce panneau est ouvert depuis le volet de personnalisation du layout.
 * Il permet d'activer/désactiver les animations de Noël, de choisir une
 * couleur de thème, de régler la vitesse et d'activer le mode "nuit de Noël".
 *
 * L'État est seulement dans le localStorage (pas de env var, ni de backend).
 */
export function ChristmasPreferencesPanel() {
  const { setLayoutSettings } = useTheme();
  const { prefs, setFontFamily, setFontSize } = useUserPreferences();

  // Préférences Noël stockées dans localStorage (clé partagée avec AnimatedBackground et LayoutSettings)
  const STORAGE_KEY = 'xmas_prefs_v2';

  const load = () => {
    if (typeof window === 'undefined') return DEFAULT_XMAS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_XMAS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...DEFAULT_XMAS, active: !!prefs.xmasEnabled };
  };

  const save = (next) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const [xmas, setXmas] = useState(load);
  const [visible, setVisible] = useState(false);

  const update = (patch) => {
    const next = { ...xmas, ...patch };
    setXmas(next);
    save(next);
  };

  const toggleEnabled = () => {
    const next = { ...xmas, active: !xmas.active };
    setXmas(next);
    save(next);
  };

  // On ré-active la cible de personnalisation dynamique sur changement
  const animationIsActive =
    xmas.active &&
    (
      xmas.effects !== null ||
      xmas.color !== null ||
      xmas.speed !== null ||
      xmas.nightMode !== null
    );

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex items-center gap-3 border-b border-outline-variant/40 pb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-red-500 flex items-center justify-center text-white">
          <Star className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-on-surface">Noël</h3>
          <p className="text-[11px] text-on-surface-variant">Animations et décoration</p>
        </div>
        <button
          onClick={() => setVisible((v) => !v)}
          className={`ml-auto text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
            visible ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container'
          }`}
        >
          {visible ? 'Masquer' : 'Configurer'}
        </button>
      </div>

      {/* Contenu du panneau (affiché/shown dynamiquement) */}
      {visible && (
        <div className="space-y-5 animate-fade-in">
          {/* État global */}
          <div className="flex items-center justify-between rounded-xl border border-outline-variant/40 bg-surface p-4">
            <div>
              <p className="text-sm font-semibold text-on-surface">Activer les animations de Noël</p>
              <p className="text-[11px] text-on-surface-variant">
                Guirlandes, étoiles, ambiance nocturne, flou et chute de neige.
                Désactive une partie du style dès le démarrage (privilégie la
                surcharge manuelle si tu veux quitter le style "noël").
              </p>
            </div>
            <button
              onClick={toggleEnabled}
              className={`relative w-12 h-7 rounded-full transition-colors duration-300 cursor-pointer ${
                xmas.active ? 'bg-amber-400' : 'bg-surface-container-high'
              }`}
              style={{ boxShadow: xmas.active ? '0 0 12px rgba(251, 191, 36, 0.35)' : 'none' }}
            >
              <span
                className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
                  xmas.active ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {xmas.active && (
            <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface p-4">
              {/* Couleur */}
              <div>
                <Label>Couleur de thème</Label>
                <div className="flex gap-3 mt-2">
                  {[
                    { label: 'Foncé', color: '#0067ff' },
                    { label: 'Amber', color: '#f59e0b' },
                    { label: 'Rouge', color: '#dc2626' },
                    { label: 'Rose', color: '#ec4899' },
                    { label: 'Vert', color: '#16a34a' },
                    { label: 'Violet', color: '#8b5cf6' },
                  ].map((c) => (
                    <button
                      key={c.label}
                      onClick={() => update({ color: c.color })}
                      className={`w-8 h-8 rounded-full transition-transform hover:scale-110 cursor-pointer ${
                        xmas.color === c.color ? 'ring-2 ring-offset-2 ring-on-surface' : ''
                      }`}
                      style={{ backgroundColor: c.color }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* Vitesse */}
              <div>
                <Label>Vitesse de l'animation</Label>
                <Slider
                  value={[xmas.speed ?? 1]}
                  onValueChange={(v) => update({ speed: Math.min(3, Math.max(0.3, Number(v[0])))) }}
                  min={0.3}
                  max={3}
                  step={0.1}
                  className="mt-2"
                />
                <div className="flex justify-between text-[11px] text-on-surface-variant mt-1">
                  <span>Lent</span>
                  <span>Normal</span>
                  <span>Rapide</span>
                </div>
              </div>

              {/* Mode nuit */}
              <div className="flex items-center justify-between">
                <Label>Mode nuit de Noël</Label>
                <button
                  onClick={() => update({ nightMode: !xmas.nightMode })}
                  className={`relative w-12 h-7 rounded-full transition-colors duration-300 cursor-pointer ${
                    xmas.nightMode ? 'bg-amber-400' : 'bg-surface-container-high'
                  }`}
                  style={{ boxShadow: xmas.nightMode ? '0 0 12px rgba(251, 191, 36, 0.35)' : 'none' }}
                >
                  <span
                    className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
                      xmas.nightMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Icône d'affichage */}
              <div>
                <Label>Icône d'invite</Label>
                <div className="flex gap-2 mt-2">
                  {[
                    { icon: '🎄', emoji: 'treeFull' },
                    { icon: '✨', emoji: 'sparkles' },
                    { icon: '🦌', emoji: 'deer' },
                    { icon: '🎁', emoji: 'gift' },
                    { icon: '❄️', emoji: 'snowflake' },
                  ].map(({ icon, emoji }) => (
                    <button
                      key={emoji}
                      onClick={() => update({ emoji: icon, emojiLabel: emoji })}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors cursor-pointer ${
                        xmas.emojiLabel === emoji
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-outline-variant hover:bg-surface-container'
                      }`}
                    >
                      <span className="leading-none">{emoji}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Réinitialisation */}
          {!xmas.active && (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setXmas(DEFAULT_XMAS);
                  save(DEFAULT_XMAS);
                  toggleEnabled();
                }}
                className="text-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer underline underline-offset-2"
              >
                Réactiver les animations
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const DEFAULT_XMAS = {
  active: true,
  color: '#0067ff',
  speed: 1,
  nightMode: false,
  emoji: '🎄',
  emojiLabel: '🎄',
};
