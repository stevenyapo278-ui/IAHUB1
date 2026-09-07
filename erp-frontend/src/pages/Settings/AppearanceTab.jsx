import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { itemVariants } from './SettingsComponents';
import {
  Palette,
  Eye,
  Shuffle,
  CalendarDays,
  Pin,
  Check,
  ExternalLink,
  AlertTriangle,
  Sparkles,
  Columns2,
  Layers,
  Minus,
} from 'lucide-react';

const VALID_VARIANTS = ['classic', 'split', 'hero', 'minimal'];

const VARIANT_META = {
  classic: {
    label: 'Classique',
    shortLabel: 'Classic',
    desc: 'Design historique — deux colonnes, branding sombre + carte formulaire premium',
    icon: Palette,
    badge: 'Historique',
  },
  split: {
    label: 'Split Showcase',
    shortLabel: 'Split',
    desc: 'Katalyst split — colonne showcase sombre à gauche, formulaire à droite',
    icon: Columns2,
    badge: 'Katalyst 1',
  },
  hero: {
    label: 'Hero Gradient',
    shortLabel: 'Hero',
    desc: 'Carte flottante à deux volets — dégradé bleu/indigo à gauche',
    icon: Sparkles,
    badge: 'Katalyst 2',
  },
  minimal: {
    label: 'Minimal Card',
    shortLabel: 'Minimal',
    desc: 'Centré minimaliste — anneaux concentriques + carte unique',
    icon: Layers,
    badge: 'Katalyst 3',
  },
};

const MODE_META = {
  daily_rotation: {
    label: 'Rotation quotidienne',
    desc: 'Change automatiquement chaque jour parmi les variantes activées. Identique pour tous les utilisateurs.',
    icon: CalendarDays,
  },
  fixed: {
    label: 'Thème fixe',
    desc: 'Toujours la même variante, tous les jours. Idéal pour une identité stable ou une démo.',
    icon: Pin,
  },
  random: {
    label: 'Aléatoire',
    desc: 'Tirage au sort parmi les variantes activées à chaque chargement de la page.',
    icon: Shuffle,
  },
};

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function buildDailyPreview(enabled, days = 7) {
  const pool = enabled.length ? enabled : VALID_VARIANTS;
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const seed = getDayOfYear(d) + d.getFullYear() * 366;
    const variant = pool[seed % pool.length];
    out.push({
      date: d.toISOString().slice(0, 10),
      variant,
      dayLabel: d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'short' }),
      isToday: i === 0,
    });
  }
  return out;
}

export default function AppearanceTab() {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [liveResolved, setLiveResolved] = useState(null);

  function load() {
    api
      .get('/advanced-settings')
      .then(({ data }) => {
        const normalized = {
          loginThemeMode: ['daily_rotation', 'fixed', 'random'].includes(data.loginThemeMode)
            ? data.loginThemeMode
            : 'daily_rotation',
          loginThemeFixedVariant: VALID_VARIANTS.includes(data.loginThemeFixedVariant)
            ? data.loginThemeFixedVariant
            : 'classic',
          loginThemeEnabledVariants: Array.isArray(data.loginThemeEnabledVariants) &&
            data.loginThemeEnabledVariants.length > 0
            ? [...new Set(data.loginThemeEnabledVariants.filter((v) => VALID_VARIANTS.includes(v)))]
            : [...VALID_VARIANTS],
        };
        if (normalized.loginThemeEnabledVariants.length === 0) normalized.loginThemeEnabledVariants = [...VALID_VARIANTS];
        setSettings(data);
        setDraft(normalized);
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))

    // Récupère la variante réellement servie aujourd'hui (pour le bandeau "actuellement visible")
    const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/+$/, '');
    const url = apiBase.endsWith('/api') ? `${apiBase}/auth/login-theme` : `${apiBase}/api/auth/login-theme`;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setLiveResolved(d?.resolvedVariant || null))
      .catch(() => {});
  }

  useEffect(load, []);

  const isDirty = useMemo(() => {
    if (!settings || !draft) return false;
    return (
      draft.loginThemeMode !== (settings.loginThemeMode || 'daily_rotation') ||
      draft.loginThemeFixedVariant !== (settings.loginThemeFixedVariant || 'classic') ||
      JSON.stringify([...draft.loginThemeEnabledVariants].sort()) !==
        JSON.stringify([...(settings.loginThemeEnabledVariants || VALID_VARIANTS)].sort())
    );
  }, [settings, draft]);

  const preview7 = useMemo(() => {
    if (!draft) return [];
    return buildDailyPreview(draft.loginThemeEnabledVariants, 7);
  }, [draft]);

  async function handleSave() {
    if (!draft) return;
    if (draft.loginThemeEnabledVariants.length === 0) {
      setError('Au moins une variante doit rester activée.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.patch('/advanced-settings', {
        loginThemeMode: draft.loginThemeMode,
        loginThemeFixedVariant: draft.loginThemeFixedVariant,
        loginThemeEnabledVariants: draft.loginThemeEnabledVariants,
      });
      setSettings(data);
      setSuccess('Configuration de la page de connexion enregistrée.');
      // refresh live resolved
      const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/+$/, '');
      const url = apiBase.endsWith('/api') ? `${apiBase}/auth/login-theme` : `${apiBase}/api/auth/login-theme`;
      fetch(url, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setLiveResolved(d?.resolvedVariant || null))
        .catch(() => {});
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.errors?.[0]?.msg ||
        'Erreur lors de la mise à jour';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!settings) return;
    setDraft({
      loginThemeMode: settings.loginThemeMode || 'daily_rotation',
      loginThemeFixedVariant: settings.loginThemeFixedVariant || 'classic',
      loginThemeEnabledVariants: settings.loginThemeEnabledVariants?.length
        ? [...settings.loginThemeEnabledVariants]
        : [...VALID_VARIANTS],
    });
    setError('');
    setSuccess('');
  }

  function toggleVariant(id) {
    setDraft((prev) => {
      if (!prev) return prev;
      const enabled = prev.loginThemeEnabledVariants;
      const isEnabled = enabled.includes(id);
      if (isEnabled) {
        if (enabled.length === 1) {
          setError('Au moins une variante doit rester activée.');
          return prev;
        }
        setError('');
        return { ...prev, loginThemeEnabledVariants: enabled.filter((v) => v !== id) };
      }
      setError('');
      return { ...prev, loginThemeEnabledVariants: [...enabled, id] };
    });
  }

  function openPreview(id) {
    window.open(`/login?design=${id}`, '_blank', 'noopener');
  }

  if (!settings || !draft) {
    return (
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-on-surface-variant">
        {error || 'Chargement...'}
      </motion.p>
    );
  }

  const currentResolvedLabel = liveResolved ? VARIANT_META[liveResolved]?.label || liveResolved : null;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
      className="space-y-xl"
    >
      <AnimatePresence>
        {error && (
          <motion.div
            key="appearance-error"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm flex items-start gap-2 overflow-hidden"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        )}
        {success && (
          <motion.div
            key="appearance-success"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 p-3 rounded-xl text-sm flex items-center gap-2 overflow-hidden"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bandeau info live */}
      {currentResolvedLabel && (
        <motion.div
          variants={itemVariants}
          className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-primary/10 text-primary">
              <Eye className="w-4 h-4" />
            </span>
            <div>
              <div className="text-sm font-bold text-on-surface">
                Variante actuellement servie : <span className="text-primary">{currentResolvedLabel}</span>
                <span className="font-normal text-on-surface-variant"> ({liveResolved})</span>
              </div>
              <p className="text-xs text-on-surface-variant">
                Mode serveur : <strong>{MODE_META[draft.loginThemeMode]?.label}</strong> · Cache 5 s ·{' '}
                <code className="bg-surface-container-high px-1 rounded text-[11px]">?design=classic|split|hero|minimal</code> force l'aperçu sans toucher à la config
              </p>
            </div>
          </div>
          <button
            onClick={() => window.open('/login', '_blank', 'noopener')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity"
          >
            Ouvrir la page <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODE — 3 cartes radio */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">palette</span>
          <h4 className="font-bold text-on-surface">Mode d'affichage</h4>
          <span className="ml-2 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
            SUPERADMIN
          </span>
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed max-w-3xl">
          La page <code className="bg-surface-container-high px-1 rounded text-[11px]">/login</code> était en rotation quotidienne aléatoire (déterministe sur 4 thèmes). Vous pouvez désormais figer un thème, garder la rotation mais en filtrant les variantes, ou passer en tirage aléatoire à chaque chargement.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
          {Object.entries(MODE_META).map(([modeKey, meta]) => {
            const Icon = meta.icon;
            const isActive = draft.loginThemeMode === modeKey;
            return (
              <motion.button
                key={modeKey}
                variants={itemVariants}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setDraft((p) => ({ ...p, loginThemeMode: modeKey }))}
                className={`text-left rounded-2xl border p-4 flex flex-col gap-3 transition-all ${
                  isActive
                    ? 'bg-primary/5 border-primary/30 shadow-sm ring-1 ring-primary/10'
                    : 'bg-surface-container-lowest border-outline-variant/40 hover:border-outline-variant hover:bg-surface-container-low'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`p-2 rounded-xl ${isActive ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isActive ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant'}`}
                  >
                    {isActive && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                </div>
                <div>
                  <div className={`text-sm font-bold ${isActive ? 'text-primary' : 'text-on-surface'}`}>{meta.label}</div>
                  <p className="text-xs text-on-surface-variant leading-relaxed mt-1">{meta.desc}</p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION FIXE : grille de sélection */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {draft.loginThemeMode === 'fixed' && (
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            <Pin className="w-5 h-5 text-primary" />
            <h4 className="font-bold text-on-surface">Thème fixe — choisissez la variante</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {VALID_VARIANTS.map((id) => {
              const meta = VARIANT_META[id];
              const Icon = meta.icon;
              const isActive = draft.loginThemeFixedVariant === id;
              return (
                <motion.div
                  key={id}
                  variants={itemVariants}
                  whileHover={{ y: -1 }}
                  className={`relative rounded-2xl border p-4 flex flex-col gap-3 transition-all ${isActive ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/10' : 'bg-surface-container-lowest border-outline-variant/40 hover:border-outline-variant'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`p-2 rounded-xl ${isActive ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div>
                        <div className="text-sm font-bold text-on-surface flex items-center gap-2">
                          {meta.label}
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-on-surface-variant">
                            {meta.badge}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-on-surface-variant">{id}</div>
                      </div>
                    </div>
                    {isActive && <span className="p-1 rounded-full bg-primary text-on-primary"><Check className="w-3.5 h-3.5" strokeWidth={3} /></span>}
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{meta.desc}</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, loginThemeFixedVariant: id }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${isActive ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-outline-variant/40 hover:bg-surface-container-high text-on-surface'}`}
                    >
                      {isActive ? 'Sélectionné' : 'Choisir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openPreview(id)}
                      className="px-3 py-2 rounded-xl bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-xs font-semibold flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Aperçu
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION ROTATION / ALEATOIRE : checklist */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {(draft.loginThemeMode === 'daily_rotation' || draft.loginThemeMode === 'random') && (
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            {draft.loginThemeMode === 'random' ? <Shuffle className="w-5 h-5 text-primary" /> : <CalendarDays className="w-5 h-5 text-primary" />}
            <h4 className="font-bold text-on-surface">
              {draft.loginThemeMode === 'random' ? 'Tirage aléatoire — variantes autorisées' : 'Rotation quotidienne — variantes incluses'}
            </h4>
            <span className="text-xs text-on-surface-variant">({draft.loginThemeEnabledVariants.length}/4)</span>
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {draft.loginThemeMode === 'random'
              ? 'À chaque chargement, le serveur tire au sort une variante parmi celles cochées.'
              : 'Chaque jour, la variante est choisie de façon déterministe (jour de l’année) parmi celles cochées — identique pour tous les utilisateurs du jour.'}{' '}
            Décochez celles que vous ne voulez plus voir. Au moins une doit rester active.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {VALID_VARIANTS.map((id) => {
              const meta = VARIANT_META[id];
              const Icon = meta.icon;
              const checked = draft.loginThemeEnabledVariants.includes(id);
              const isLastOne = checked && draft.loginThemeEnabledVariants.length === 1;
              return (
                <motion.label
                  key={id}
                  variants={itemVariants}
                  className={`relative flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition-all ${checked ? 'bg-surface-container-lowest border-primary/20' : 'bg-surface-container-lowest/60 border-outline-variant/40 opacity-75'} ${isLastOne ? 'cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLastOne}
                    onChange={() => toggleVariant(id)}
                    className="mt-1 w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary/20 disabled:opacity-40"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`p-1.5 rounded-lg ${checked ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="text-sm font-bold text-on-surface">{meta.label}</span>
                      <span className="text-[10px] font-mono text-on-surface-variant">{id}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant leading-relaxed mt-1.5">{meta.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      openPreview(id);
                    }}
                    className="shrink-0 p-2 rounded-xl bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
                    title={`Prévisualiser ${id}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </motion.label>
              );
            })}
          </div>

          {draft.loginThemeMode === 'daily_rotation' && (
            <motion.div variants={itemVariants} className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest overflow-hidden">
              <div className="px-4 py-3 border-b border-outline-variant/30 flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-on-surface flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary" /> Aperçu des 7 prochains jours
                </div>
                <span className="text-[11px] text-on-surface-variant">Basé sur la sélection actuelle (non sauvegardée = aperçu local)</span>
              </div>
              <div className="divide-y divide-outline-variant/20">
                {preview7.map((entry) => {
                  const meta = VARIANT_META[entry.variant];
                  const Icon = meta?.icon || Minus;
                  return (
                    <div key={entry.date} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${entry.isToday ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full border ${entry.isToday ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant'}`}>
                          {entry.isToday ? "Aujourd'hui" : entry.dayLabel}
                        </span>
                        <span className="text-xs font-mono text-on-surface-variant hidden sm:inline">{entry.date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-primary/10 text-primary hidden sm:flex">
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-sm font-semibold text-on-surface">{meta?.label || entry.variant}</span>
                        <span className="text-xs font-mono text-on-surface-variant">({entry.variant})</span>
                        <button
                          type="button"
                          onClick={() => openPreview(entry.variant)}
                          className="ml-2 p-1.5 rounded-lg bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
                          title="Prévisualiser"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-2 bg-surface-container-low/40 border-t border-outline-variant/20 text-[11px] text-on-surface-variant">
                La rotation est déterministe : <code className="bg-surface-container-high px-1 rounded">seed = jourDeLAnnée + année×366</code> modulo le nombre de variantes activées. Stable au refresh et partagée par tous le même jour.
              </div>
            </motion.div>
          )}

          {draft.loginThemeMode === 'random' && (
            <motion.div variants={itemVariants} className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-4 text-center">
              <p className="text-xs text-on-surface-variant leading-relaxed">
                En mode aléatoire, la variante est tirée côté serveur à chaque <code className="bg-surface-container-high px-1 rounded">GET /api/auth/login-theme</code> parmi{' '}
                <strong>{draft.loginThemeEnabledVariants.length}</strong> variante(s) cochée(s). Pas de planning prévisible — parfait pour A/B léger.
              </p>
            </motion.div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ACTIONS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-outline-variant/30">
        <div className="text-xs text-on-surface-variant">
          {isDirty ? (
            <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> Modifications non enregistrées
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" /> Configuration à jour
            </span>
          )}
          <span className="hidden sm:inline"> · Audit tracé · Cache 5 s</span>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleReset}
            disabled={!isDirty || saving}
            className="px-4 py-2 rounded-xl border border-outline-variant/40 bg-surface text-on-surface-variant font-semibold text-sm hover:bg-surface-container-high disabled:opacity-40 transition-all"
          >
            Annuler
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="px-5 py-2 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-md shadow-primary/10 hover:shadow-lg disabled:opacity-40 transition-all flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-on-primary/30 border-t-on-primary animate-spin" />
                Enregistrement...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> Enregistrer
              </>
            )}
          </motion.button>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4">
        <h5 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">Notes</h5>
        <ul className="text-xs text-on-surface-variant leading-relaxed list-disc pl-4 space-y-1">
          <li>
            Le paramètre <code className="bg-surface-container-high px-1 rounded">?design=</code> reste disponible pour forcer un aperçu sans toucher à la config — utile pour valider un thème avant de le figer.
          </li>
          <li>
            Le endpoint public <code className="bg-surface-container-high px-1 rounded">GET /api/auth/login-theme</code> est sans authentification et cache 5 s.
          </li>
          <li>
            En cas d'indisponibilité du serveur, le frontend retombe automatiquement sur la rotation locale déterministe (ancien comportement), donc la page de login ne casse jamais.
          </li>
        </ul>
      </motion.div>
    </motion.div>
  );
}
