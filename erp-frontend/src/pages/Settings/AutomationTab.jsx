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

function IntervalRow({ title, description, value, onChange, disabled, max, unit }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant bg-surface-container-lowest">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{description}</p>
      </div>
      <div className="flex items-center gap-sm shrink-0">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          disabled={disabled}
          className="w-20 border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface disabled:opacity-50"
        />
        <span className="font-body-sm text-body-sm text-on-surface-variant">{unit}</span>
      </div>
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

      <div className="mt-md">
        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">Relance des brouillons en attente</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
          Quand une réponse IA reste en attente de validation trop longtemps, un email de relance est envoyé aux
          responsables ayant activé « Recevoir les alertes de brouillons » (page Utilisateurs).
        </p>
        <div className="flex flex-col gap-md">
          <SettingRow
            title="Relance email des brouillons en attente"
            description="Envoie un email aux responsables désignés si un brouillon reste en attente plus longtemps que le délai configuré ci-dessous."
            checked={settings.draftReminderEnabled}
            onChange={(v) => updateSetting('draftReminderEnabled', v)}
            disabled={saving}
          />
          <IntervalRow
            title="Délai avant relance"
            description="Temps d'attente après lequel un brouillon toujours non validé déclenche une relance."
            value={settings.draftReminderDelayMinutes}
            onChange={(v) => updateSetting('draftReminderDelayMinutes', v)}
            disabled={saving || !settings.draftReminderEnabled}
            max={1440}
            unit="minutes"
          />
        </div>
      </div>

      <div className="mt-md">
        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">Fréquences de synchronisation</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
          À quel rythme chaque source externe est interrogée automatiquement. Mettre à 0 désactive la synchro automatique
          pour cette tâche — le bouton manuel correspondant (s'il existe) reste alors le seul moyen de forcer une mise à jour.
        </p>
        <div className="flex flex-col gap-md">
          <IntervalRow
            title="Tickets GLPI (+ pièces jointes, approbations)"
            description="Fréquence d'import/mise à jour des tickets depuis GLPI vers l'ERP."
            value={settings.glpiTicketsSyncIntervalSeconds}
            onChange={(v) => updateSetting('glpiTicketsSyncIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />
          <IntervalRow
            title="Emails entrants"
            description="Fréquence de relevé des boîtes mail connectées (Outlook)."
            value={settings.emailSyncIntervalSeconds}
            onChange={(v) => updateSetting('emailSyncIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />
          <IntervalRow
            title="Équipes et catégories GLPI"
            description="Fréquence de synchro des groupes (équipes) et catégories de tickets depuis GLPI."
            value={settings.glpiTeamsCategoriesSyncIntervalMinutes}
            onChange={(v) => updateSetting('glpiTeamsCategoriesSyncIntervalMinutes', v)}
            disabled={saving}
            max={1440}
            unit="minutes"
          />
          <IntervalRow
            title="Modèles IA disponibles"
            description="Fréquence de vérification des modèles disponibles auprès de chaque fournisseur IA actif."
            value={settings.aiModelsSyncIntervalHours}
            onChange={(v) => updateSetting('aiModelsSyncIntervalHours', v)}
            disabled={saving}
            max={168}
            unit="heures"
          />
        </div>
      </div>

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
