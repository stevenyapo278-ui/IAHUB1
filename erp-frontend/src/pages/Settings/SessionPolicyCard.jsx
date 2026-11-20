import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../../api/client';
import { inputClass, itemVariants } from './SettingsComponents';

// Politique de session (Paramètres > Avancé > Sessions).
//
// Deux limites indépendantes :
//   • inactivité : déconnexion après N minutes sans interaction réelle ;
//   • plafond absolu : durée maximale d'une session depuis le login.
// 0 = contrôle désactivé. Vide = valeur héritée du serveur (env puis défaut).
//
// L'activité de N'IMPORTE QUEL onglet prolonge la session (cookie partagé), et
// une déconnexion volontaire est propagée aux autres onglets : le multi-onglets
// ne provoque donc jamais de déconnexion intempestive.

const IDLE_PRESETS = [
  { label: '2 h', minutes: 120 },
  { label: '8 h', minutes: 480 },
  { label: '12 h', minutes: 720 },
  { label: 'Jamais', minutes: 0 },
];

const MAX_PRESETS = [
  { label: '12 h', hours: 12 },
  { label: '24 h', hours: 24 },
  { label: '48 h', hours: 48 },
  { label: 'Illimitée', hours: 0 },
];

const DEFAULT_POLICY = { idleTimeoutMinutes: 480, maxHours: 12, idleSource: 'env', maxSource: 'env' };

function formatIdle(minutes) {
  if (minutes === 0) return 'jamais';
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

function formatMax(hours) {
  if (hours === 0) return 'illimitée';
  return `${hours} h`;
}

function SourceBadge({ source }) {
  const isUi = source === 'ui';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
        isUi
          ? 'bg-primary/10 text-primary border-primary/20'
          : 'bg-surface-container-high text-on-surface-variant border-outline-variant/40'
      }`}
    >
      <span className="material-symbols-outlined text-[12px]">{isUi ? 'tune' : 'settings_suggest'}</span>
      {isUi ? 'Personnalisé' : 'Valeur par défaut'}
    </span>
  );
}

function PresetButtons({ presets, onSelect, disabled, active }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => {
        const value = preset.minutes ?? preset.hours;
        const isActive = active === value;
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => onSelect(value)}
            disabled={disabled}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all disabled:opacity-50 ${
              isActive
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface-container-low text-on-surface-variant border-outline-variant/40 hover:bg-primary/10 hover:text-primary hover:border-primary/30'
            }`}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SessionPolicyCard({ settings, onSaved, setSaving, setError, saving }) {
  const policy = settings?.sessionPolicy || DEFAULT_POLICY;
  const [idleDraft, setIdleDraft] = useState(String(policy.idleTimeoutMinutes));
  const [maxDraft, setMaxDraft] = useState(String(policy.maxHours));

  // Resynchronise quand le parent recharge les réglages (ou après un PATCH).
  useEffect(() => {
    setIdleDraft(String(policy.idleTimeoutMinutes));
    setMaxDraft(String(policy.maxHours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.idleTimeoutMinutes, policy.maxHours]);

  const idleValue = idleDraft === '' ? null : Number(idleDraft);
  const maxValue = maxDraft === '' ? null : Number(maxDraft);
  const dirty =
    idleDraft !== String(policy.idleTimeoutMinutes) || maxDraft !== String(policy.maxHours);

  function validate(value, { min, max, label }) {
    if (value === null || value === undefined) return null;
    if (!Number.isInteger(value) || value < min || value > max) {
      return `${label} : valeur entière entre ${min} et ${max} attendue`;
    }
    return null;
  }

  async function save(overrides = {}) {
    // N'envoie que les champs modifiés : le champ non touché continue d'hériter
    // de l'environnement (ou de sa valeur UI existante) au lieu d'être figé.
    const payload = { ...overrides };
    if (!('sessionIdleTimeoutMinutes' in payload) && idleDraft !== String(policy.idleTimeoutMinutes)) {
      payload.sessionIdleTimeoutMinutes = idleValue;
    }
    if (!('sessionMaxHours' in payload) && maxDraft !== String(policy.maxHours)) {
      payload.sessionMaxHours = maxValue;
    }
    if (Object.keys(payload).length === 0) return;

    const error =
      validate(payload.sessionIdleTimeoutMinutes, { min: 0, max: 100000, label: "Délai d'inactivité" }) ||
      validate(payload.sessionMaxHours, { min: 0, max: 8760, label: 'Durée maximale de session' });
    if (error) {
      setError(error);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/advanced-settings', payload);
      onSaved?.(data);
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'enregistrement de la politique de session");
    } finally {
      setSaving(false);
    }
  }

  const idleEffective = policy.idleTimeoutMinutes;
  const maxEffective = policy.maxHours;

  return (
    <motion.div variants={itemVariants} className="bento-card p-lg space-y-md">
      <div className="bento-card-header px-0 py-0 pb-md border-b border-outline-variant/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">
              Durée de vie des sessions
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant max-w-2xl">
              Un utilisateur qui travaille ne doit pas être déconnecté. Seules les interactions
              réelles (clic, clavier, scroll, retour sur l'onglet) comptent : le simple polling
              d'un onglet ouvert ne prolonge pas la session.
            </p>
          </div>
          <span className="material-symbols-outlined text-primary text-3xl shrink-0">lock_clock</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        {/* Inactivité */}
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-label-md text-label-md text-on-surface font-semibold">
                Déconnexion après inactivité
              </div>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                Valeur appliquée : <strong>{formatIdle(idleEffective)}</strong>
              </p>
            </div>
            <SourceBadge source={policy.idleSource} />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100000}
              step={1}
              value={idleDraft}
              onChange={(e) => setIdleDraft(e.target.value)}
              disabled={saving}
              placeholder={String(idleEffective)}
              className={`${inputClass} w-28 text-center disabled:opacity-50`}
            />
            <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">minutes</span>
          </div>

          <PresetButtons
            presets={IDLE_PRESETS}
            active={idleValue}
            onSelect={(v) => setIdleDraft(String(v))}
            disabled={saving}
          />

          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            <strong>0</strong> = jamais déconnecté pour inactivité. Vide = valeur du serveur.
            L'activité de n'importe quel onglet prolonge la session.
          </p>
        </div>

        {/* Plafond absolu */}
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-label-md text-label-md text-on-surface font-semibold">
                Durée maximale d'une session
              </div>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                Valeur appliquée : <strong>{formatMax(maxEffective)}</strong>
              </p>
            </div>
            <SourceBadge source={policy.maxSource} />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={8760}
              step={1}
              value={maxDraft}
              onChange={(e) => setMaxDraft(e.target.value)}
              disabled={saving}
              placeholder={String(maxEffective)}
              className={`${inputClass} w-28 text-center disabled:opacity-50`}
            />
            <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">heures</span>
          </div>

          <PresetButtons
            presets={MAX_PRESETS}
            active={maxValue}
            onSelect={(v) => setMaxDraft(String(v))}
            disabled={saving}
          />

          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            Plafond depuis le login, même en cas d'activité continue. <strong>0</strong> = pas de
            plafond (déconseillé hors poste de confiance). Vide = valeur du serveur.
          </p>
        </div>
      </div>

      {(idleValue === 0 || maxValue === 0) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-700 dark:text-amber-300">
          <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
          <p>
            {maxValue === 0
              ? "Sans plafond absolu, une session peut vivre indéfiniment sur un poste laissé ouvert. Gardez au minimum le contrôle d'inactivité."
              : "Le contrôle d'inactivité est désactivé : seule la durée maximale de session coupera la connexion."}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-3 py-2.5 text-[12px] text-on-surface-variant leading-relaxed">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary shrink-0">tab</span>
          <p>
            <strong>Plusieurs onglets :</strong> un seul cookie de session est partagé. Travailler
            dans un onglet maintient les autres connectés, et une déconnexion volontaire est
            propagée immédiatement à tous les onglets. Ouvrir un nouvel onglet ne déconnecte
            jamais la session existante.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-sm border-t border-outline-variant/40">
        <button
          type="button"
          onClick={() => save({ sessionIdleTimeoutMinutes: null, sessionMaxHours: null })}
          disabled={saving}
          className="px-3 py-2 rounded-xl text-body-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all disabled:opacity-50"
        >
          Réinitialiser aux valeurs du serveur
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => save()}
          disabled={saving || !dirty}
          className="px-4 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </motion.button>
      </div>
    </motion.div>
  );
}
