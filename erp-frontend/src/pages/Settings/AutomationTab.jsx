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

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-12 h-6 rounded-full border transition-all duration-300 outline-none ${
        checked
          ? 'bg-primary border-primary/60 shadow-sm shadow-primary/20'
          : 'bg-surface-container-high border-outline-variant/60'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full transition-transform duration-300 shadow-sm ${
          checked ? 'translate-x-6 bg-white' : 'translate-x-0 bg-on-surface-variant/80'
        }`}
      />
    </button>
  );
}

function SettingRow({ title, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow transition-all duration-300 hover:border-outline-variant/90">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{description}</p>
      </div>
      <div className="shrink-0">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

const DEFAULT_ACK_MESSAGE = 'Nous avons bien reçu votre demande de support et un ticket a été créé automatiquement.';
const DEFAULT_SIGNATURE = '<p>Cordialement,<br>Support IT</p>';
const ACK_PREVIEW = { toName: 'Jean Dupont', ticketId: 42, subject: 'Problème imprimante 3e étage' };

function buildAckPreviewHtml(customMessage, signature, logoUrl, logoHeight) {
  const intro = (customMessage || DEFAULT_ACK_MESSAGE)
    .replaceAll('{ticketId}', ACK_PREVIEW.ticketId)
    .replaceAll('{subject}', ACK_PREVIEW.subject)
    .replaceAll('{toName}', ACK_PREVIEW.toName);
  const logoHtml = logoUrl ? `<p style="margin-top:8px"><img src="${logoUrl}" alt="Logo" style="height:${logoHeight || 60}px"></p>` : '';
  return `
<p>Bonjour ${ACK_PREVIEW.toName},</p>
<p>${intro}</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Numéro de ticket</td><td><strong>#${ACK_PREVIEW.ticketId}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Sujet</td><td>${ACK_PREVIEW.subject}</td></tr>
</table>
<p>Notre équipe va analyser votre demande et vous contactera dans les meilleurs délais.</p>
<p>Vous pouvez répondre directement à cet email pour ajouter des informations à votre ticket.</p>
<div style="margin-top:24px">${signature || DEFAULT_SIGNATURE}${logoHtml}</div>
`.trim();
}

function IntervalRow({ title, description, value, onChange, disabled, max, unit }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow transition-all duration-300 hover:border-outline-variant/90">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{description}</p>
      </div>
      <div className="flex items-center gap-sm shrink-0">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          disabled={disabled}
          className={`${inputClass} w-24 text-center disabled:opacity-50`}
        />
        <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">{unit}</span>
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
  const [ackMessageDraft, setAckMessageDraft] = useState('');
  const [signatureDraft, setSignatureDraft] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [reminderConfig, setReminderConfig] = useState(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [summaryRecipientInput, setSummaryRecipientInput] = useState('');
  const [testingSummary, setTestingSummary] = useState(false);
  const [summaryTestResult, setSummaryTestResult] = useState(null);

  function toggleVoiceAlerts(value) {
    setVoiceAlertEnabled(value);
    setVoiceAlerts(value);
  }

  function changeVoiceLang(lang) {
    setVoiceAlertLang(lang);
    setVoiceLang(lang);
  }

  function load() {
    api.get('/system-settings').then(({ data }) => {
      setSettings(data);
      setAckMessageDraft(data.acknowledgementMessage || '');
      setSignatureDraft(data.emailSignature || '');
    }).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/reminders/config').then(({ data }) => setReminderConfig(data)).catch(() => {});
  }

  useEffect(load, []);

  async function updateReminderConfig(patch) {
    setReminderSaving(true);
    setError('');
    try {
      const { data } = await api.put('/reminders/config', { ...reminderConfig, ...patch });
      setReminderConfig(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setReminderSaving(false);
    }
  }

  function addSummaryRecipient() {
    const value = summaryRecipientInput.trim();
    if (!value) return;
    const current = settings.dailySummaryRecipients || [];
    if (!current.includes(value)) {
      updateSetting('dailySummaryRecipients', [...current, value]);
    }
    setSummaryRecipientInput('');
  }

  function removeSummaryRecipient(email) {
    updateSetting('dailySummaryRecipients', (settings.dailySummaryRecipients || []).filter((e) => e !== email));
  }

  async function testDailySummary() {
    setTestingSummary(true);
    setSummaryTestResult(null);
    setError('');
    try {
      const { data } = await api.post('/system-settings/daily-summary/test');
      setSummaryTestResult(data);
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'envoi de test");
    } finally {
      setTestingSummary(false);
    }
  }

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

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const { data } = await api.post('/system-settings/signature-logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSettings(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l\'upload du logo');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  }

  async function removeLogo() {
    await updateSetting('signatureLogoUrl', null);
  }

  if (!settings) {
    return <p className="font-body-sm text-body-sm text-on-surface-variant">{error || 'Chargement...'}</p>;
  }

  const isAckChanged = ackMessageDraft !== (settings.acknowledgementMessage || '') || signatureDraft !== (settings.emailSignature || '');

  return (
    <div className="space-y-lg">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Contrôle les actions que l'intelligence artificielle peut effectuer sans validation humaine. Désactivés par défaut.
      </p>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      {/* Accusé de réception et Signature */}
      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg space-y-md">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Accusé de réception et signature</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Message et signature envoyés automatiquement au demandeur quand un nouveau ticket est créé par email (la même
            signature est aussi utilisée pour les relances et notifications d'incident). Placeholders disponibles dans le
            message : <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{ticketId}'}</code>,{' '}
            <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{subject}'}</code>,{' '}
            <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{toName}'}</code>. Laisser vide pour
            utiliser le texte par défaut.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
          <div className="space-y-md">
            <div className="flex flex-col gap-sm">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Message d'accueil</span>
              <textarea
                value={ackMessageDraft}
                onChange={(e) => setAckMessageDraft(e.target.value)}
                disabled={saving}
                rows={4}
                maxLength={2000}
                placeholder={DEFAULT_ACK_MESSAGE}
                className={`${inputClass} resize-none w-full min-h-[100px]`}
              />
            </div>

            <div className="flex flex-col gap-sm">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                Signature (HTML — Outlook compatible)
              </span>
              <textarea
                value={signatureDraft}
                onChange={(e) => setSignatureDraft(e.target.value)}
                disabled={saving}
                rows={4}
                maxLength={2000}
                placeholder={DEFAULT_SIGNATURE}
                className={`${inputClass} resize-none w-full font-mono min-h-[100px]`}
              />
            </div>

            <div className="flex flex-col gap-sm p-md border border-outline-variant/60 bg-surface-container-low/20 rounded-xl">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Logo de signature</span>
              {settings.signatureLogoUrl ? (
                <div className="flex flex-col gap-md">
                  <div className="flex items-center gap-md">
                    <img
                      src={settings.signatureLogoUrl}
                      alt="Logo actuel"
                      style={{ height: `${settings.signatureLogoHeight || 60}px` }}
                      className="border border-outline-variant/60 rounded-lg p-1 bg-white max-h-20 object-contain"
                    />
                    <button
                      type="button"
                      onClick={removeLogo}
                      disabled={saving || uploadingLogo}
                      className="px-3 py-2 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-500 rounded-xl transition-colors disabled:opacity-50 text-body-sm font-semibold"
                    >
                      Retirer le logo
                    </button>
                  </div>
                  <div className="flex items-center gap-sm">
                    <span className="font-body-sm text-body-sm text-on-surface-variant shrink-0 font-medium">Hauteur</span>
                    <input
                      type="range"
                      min={16}
                      max={200}
                      value={settings.signatureLogoHeight || 60}
                      onChange={(e) => updateSetting('signatureLogoHeight', Number(e.target.value))}
                      disabled={saving}
                      className="flex-1 accent-primary"
                    />
                    <span className="font-body-sm text-body-sm text-on-surface font-semibold shrink-0 w-12 text-right">
                      {settings.signatureLogoHeight || 60}px
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-sm">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo}
                    className="font-body-sm text-body-sm text-on-surface-variant disabled:opacity-50 cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-body-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:transition-all"
                  />
                  {uploadingLogo && <span className="font-body-sm text-body-sm text-on-surface-variant italic">Envoi en cours...</span>}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-sm p-lg border border-outline-variant/60 bg-surface-container-low/20 rounded-2xl card-shadow">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Aperçu de l'email envoyé</span>
            <div
              className="text-body-sm text-on-surface flex-1 overflow-auto bg-surface border border-outline-variant/60 rounded-xl p-md min-h-[250px]"
              dangerouslySetInnerHTML={{ __html: buildAckPreviewHtml(ackMessageDraft, signatureDraft, settings.signatureLogoUrl, settings.signatureLogoHeight) }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-sm pt-sm border-t border-outline-variant/40">
          <button
            type="button"
            onClick={() => {
              setAckMessageDraft(settings.acknowledgementMessage || '');
              setSignatureDraft(settings.emailSignature || '');
            }}
            disabled={saving || !isAckChanged}
            className="px-4 py-2 border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high rounded-xl transition-colors disabled:opacity-50 text-body-sm font-semibold"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={async () => {
              await updateSetting('acknowledgementMessage', ackMessageDraft);
              await updateSetting('emailSignature', signatureDraft);
            }}
            disabled={saving || !isAckChanged}
            className="px-4 py-2 bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* Entraînement et classification IA */}
      <div className="space-y-md">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Entraînement et classification IA</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Permet à l'IA d'apprendre des décisions passées en injectant des exemples de tickets résolus similaires dans ses prompts.
          </p>
        </div>
        <div className="flex flex-col gap-md">
          <SettingRow
            title="Apprentissage Few-Shot par historique"
            description="Quand activé, l'IA utilise les tickets résolus ou clos par les techniciens comme modèles de référence pour classer les nouveaux tickets (catégorie, priorité, équipe)."
            checked={settings.enableFewShotTriage}
            onChange={(v) => updateSetting('enableFewShotTriage', v)}
            disabled={saving}
          />
        </div>
      </div>

      {/* Relance des brouillons en attente */}

      <div className="space-y-md">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Relance des brouillons en attente</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Quand une réponse IA reste en attente de validation trop longtemps, un email de relance est envoyé aux
            responsables ayant activé « Recevoir les alertes de brouillons » (page Utilisateurs).
          </p>
        </div>
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

      {/* Relance des tickets en attente de réponse */}
      {reminderConfig && (
        <div className="space-y-md">
          <div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Relance des tickets en attente de réponse</h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Pour les tickets créés par email et en attente de réponse du demandeur (statut « En attente
              utilisateur ») : relances automatiques, puis clôture automatique si toujours sans réponse.
              Vérifié toutes les heures.
            </p>
          </div>
          <div className="flex flex-col gap-md">
            <SettingRow
              title="Relance et clôture automatique des tickets en attente"
              description="Désactiver arrête uniquement les relances/clôtures automatiques — les tickets restent ouverts indéfiniment jusqu'à action manuelle."
              checked={reminderConfig.isActive}
              onChange={(v) => updateReminderConfig({ isActive: v })}
              disabled={reminderSaving}
            />
            <IntervalRow
              title="Première relance"
              description="Délai après la dernière réponse du demandeur avant la première relance."
              value={reminderConfig.firstReminderDays}
              onChange={(v) => updateReminderConfig({ firstReminderDays: v })}
              disabled={reminderSaving || !reminderConfig.isActive}
              max={60}
              unit="jours"
            />
            <IntervalRow
              title="Deuxième relance"
              description="Délai avant la deuxième relance, si toujours sans réponse."
              value={reminderConfig.secondReminderDays}
              onChange={(v) => updateReminderConfig({ secondReminderDays: v })}
              disabled={reminderSaving || !reminderConfig.isActive}
              max={60}
              unit="jours"
            />
            <IntervalRow
              title="Avertissement avant clôture"
              description="Délai avant un dernier message prévenant que le ticket sera clôturé automatiquement."
              value={reminderConfig.preCloseDays}
              onChange={(v) => updateReminderConfig({ preCloseDays: v })}
              disabled={reminderSaving || !reminderConfig.isActive}
              max={90}
              unit="jours"
            />
            <IntervalRow
              title="Clôture automatique"
              description="Délai après lequel le ticket est définitivement clôturé sans réponse du demandeur."
              value={reminderConfig.autoCloseDays}
              onChange={(v) => updateReminderConfig({ autoCloseDays: v })}
              disabled={reminderSaving || !reminderConfig.isActive}
              max={120}
              unit="jours"
            />
          </div>
        </div>
      )}

      {/* Récapitulatif quotidien */}
      <div className="space-y-md">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Récapitulatif quotidien des tickets ouverts</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Envoie chaque jour à l'heure choisie un email listant tous les tickets ouverts (répartition par
            priorité, statut, assignation, ancienneté) aux adresses email configurées ci-dessous.
          </p>
        </div>
        <div className="flex flex-col gap-md">
          <SettingRow
            title="Récapitulatif quotidien"
            description="Envoie automatiquement le récapitulatif tous les jours à l'heure configurée."
            checked={settings.dailySummaryEnabled}
            onChange={(v) => updateSetting('dailySummaryEnabled', v)}
            disabled={saving}
          />

          <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow transition-all duration-300 hover:border-outline-variant/90">
            <div>
              <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">Heure d'envoi</div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 font-medium">Heure locale du serveur, au format 24h.</p>
            </div>
            <input
              type="time"
              value={settings.dailySummaryTime}
              onChange={(e) => updateSetting('dailySummaryTime', e.target.value)}
              disabled={saving || !settings.dailySummaryEnabled}
              className={`${inputClass} disabled:opacity-50`}
            />
          </div>

          <div className="flex flex-col gap-sm p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Destinataires</span>
            <div className="flex items-center gap-sm">
              <input
                type="email"
                value={summaryRecipientInput}
                onChange={(e) => setSummaryRecipientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSummaryRecipient();
                  }
                }}
                placeholder="adresse@exemple.com"
                disabled={saving}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={addSummaryRecipient}
                disabled={saving}
                className="px-4 py-2 bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 shrink-0"
              >
                Ajouter
              </button>
            </div>
            {(settings.dailySummaryRecipients || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {settings.dailySummaryRecipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container-high border border-outline-variant/60 rounded-full text-on-surface text-xs font-semibold shadow-sm"
                  >
                    {email}
                    <button
                      onClick={() => removeSummaryRecipient(email)}
                      disabled={saving}
                      className="text-on-surface-variant hover:text-error transition-colors flex items-center"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-sm p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow">
            <div className="flex items-center justify-between gap-md flex-wrap md:flex-nowrap">
              <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">
                Envoyer un récapitulatif de test maintenant, sans attendre l'heure configurée.
              </span>
              <button
                type="button"
                onClick={testDailySummary}
                disabled={testingSummary || (settings.dailySummaryRecipients || []).length === 0}
                className="px-4 py-2 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 shrink-0 shadow-sm"
              >
                {testingSummary ? 'Envoi...' : 'Tester maintenant'}
              </button>
            </div>
            {summaryTestResult && (
              <div className="p-md rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 font-body-sm mt-2">
                {summaryTestResult.sent
                  ? `Envoyé avec succès : ${summaryTestResult.ticketCount} ticket(s) à ${summaryTestResult.recipientCount} destinataire(s).`
                  : summaryTestResult.reason}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alerte Vocale */}
      <div className="space-y-md">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Alertes sonores</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Configurez des alertes vocales interactives pour vous avertir instantanément en cas d'activité nécessitant votre attention.
          </p>
        </div>
        <div className="flex flex-col gap-md">
          <SettingRow
            title="Alerte vocale (ce navigateur uniquement)"
            description="Quand activé, une voix annonce dans ce navigateur l'arrivée d'une nouvelle réponse IA à valider ou d'un ticket nécessitant une revue humaine. Préférence locale, non partagée avec les autres utilisateurs."
            checked={voiceAlerts}
            onChange={toggleVoiceAlerts}
          />

          <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow transition-all duration-300 hover:border-outline-variant/90">
            <div>
              <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">Langue de l'alerte vocale</div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 font-medium">
                Langue utilisée par la synthèse vocale de ce navigateur pour annoncer les alertes.
              </p>
            </div>
            <div className="flex items-center gap-sm">
              <select
                value={voiceLang}
                onChange={(e) => changeVoiceLang(e.target.value)}
                disabled={!voiceAlerts}
                className={`${inputClass} disabled:opacity-50`}
              >
                {VOICE_ALERT_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => speakTest(voiceLang)}
                disabled={!voiceAlerts}
                className="px-4 py-2 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 shadow-sm flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">volume_up</span>
                Tester
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

