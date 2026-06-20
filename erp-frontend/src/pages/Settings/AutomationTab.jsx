import { useEffect, useState } from 'react';
import api from '../../api/client';
import {
  isVoiceAlertEnabled,
  setVoiceAlertEnabled,
  getVoiceAlertLang,
  setVoiceAlertLang,
  speakTest,
  VOICE_ALERT_LANGUAGES,
} from '../../utils/voiceAlertPreference';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-12 h-6 rounded-none border border-outline-variant transition-colors ${
        checked ? 'bg-on-surface' : 'bg-surface-container-low'
      } disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-none transition-transform ${
          checked ? 'translate-x-6 bg-surface' : 'translate-x-0 bg-on-surface-variant'
        }`}
        style={{ width: '18px', height: '18px' }}
      />
    </button>
  );
}

function SettingRow({ title, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant bg-surface-container-lowest">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function AutomationTab() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [voiceAlerts, setVoiceAlerts] = useState(isVoiceAlertEnabled());
  const [voiceLang, setVoiceLang] = useState(getVoiceAlertLang());

  function toggleVoiceAlerts(value) {
    setVoiceAlertEnabled(value);
    setVoiceAlerts(value);
  }

  function changeVoiceLang(lang) {
    setVoiceAlertLang(lang);
    setVoiceLang(lang);
  }

  function load() {
    api.get('/system-settings').then(({ data }) => setSettings(data)).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  async function updateSetting(key, value) {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/system-settings', { [key]: value });
      setSettings(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <p className="font-body-sm text-body-sm text-on-surface-variant">{error || 'Chargement...'}</p>;
  }

  return (
    <div className="flex flex-col gap-md">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Contrôle les actions que l'intelligence artificielle peut effectuer sans validation humaine. Désactivés par défaut.
      </p>

      {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}

      <SettingRow
        title="Auto-envoi des emails IA"
        description="Quand activé, les emails générés automatiquement (accusé de réception, notification d'incident connu) sont envoyés directement sans passer par la validation humaine dans « Réponses à valider »."
        checked={settings.autoSendAiEmails}
        onChange={(v) => updateSetting('autoSendAiEmails', v)}
        disabled={saving}
      />

      <SettingRow
        title="Auto-approbation des solutions GLPI"
        description="Quand activé, dès qu'un technicien marque un ticket comme résolu dans GLPI, toute demande de validation de la solution en attente est approuvée automatiquement, sans attendre de confirmation du demandeur."
        checked={settings.autoApproveGlpiSolutions}
        onChange={(v) => updateSetting('autoApproveGlpiSolutions', v)}
        disabled={saving}
      />

      <SettingRow
        title="Alerte vocale (ce navigateur uniquement)"
        description="Quand activé, une voix annonce dans ce navigateur l'arrivée d'une nouvelle réponse IA à valider ou d'un ticket nécessitant une revue humaine. Préférence locale, non partagée avec les autres utilisateurs."
        checked={voiceAlerts}
        onChange={toggleVoiceAlerts}
      />

      <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant bg-surface-container-lowest">
        <div>
          <div className="font-headline-sm text-headline-sm text-on-surface">Langue de l'alerte vocale</div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Langue utilisée par la synthèse vocale de ce navigateur pour annoncer les alertes.
          </p>
        </div>
        <div className="flex items-center gap-sm">
          <select
            value={voiceLang}
            onChange={(e) => changeVoiceLang(e.target.value)}
            disabled={!voiceAlerts}
            className="border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface disabled:opacity-50"
          >
            {VOICE_ALERT_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => speakTest(voiceLang)}
            disabled={!voiceAlerts}
            className="px-3 py-2 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
          >
            Tester
          </button>
        </div>
      </div>
    </div>
  );
}
