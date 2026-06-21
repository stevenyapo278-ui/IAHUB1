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
  const [ackMessageDraft, setAckMessageDraft] = useState('');
  const [signatureDraft, setSignatureDraft] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [reminderConfig, setReminderConfig] = useState(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [summaryRecipientInput, setSummaryRecipientInput] = useState('');
  const [testingSummary, setTestingSummary] = useState(false);
  const [summaryTestResult, setSummaryTestResult] = useState(null);
  const [schedulerHealth, setSchedulerHealth] = useState(null);

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
    api.get('/system-settings/scheduler-health').then(({ data }) => setSchedulerHealth(data)).catch(() => {});
  }

  useEffect(load, []);
  // Rafraîchit l'état des tâches automatiques toutes les 30s pour refléter une panne/résolution
  // sans devoir recharger la page — léger, une seule petite requête.
  useEffect(() => {
    const intervalId = setInterval(() => {
      api.get('/system-settings/scheduler-health').then(({ data }) => setSchedulerHealth(data)).catch(() => {});
    }, 30000);
    return () => clearInterval(intervalId);
  }, []);

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

  return (
    <div className="flex flex-col gap-md">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Contrôle les actions que l'intelligence artificielle peut effectuer sans validation humaine. Désactivés par défaut.
      </p>

      {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}

      {schedulerHealth && schedulerHealth.some((s) => s.consecutiveFailures >= 3) && (
        <div className="border border-error text-error bg-error-container/30 rounded-none p-md flex items-start gap-sm">
          <span className="material-symbols-outlined">sync_problem</span>
          <div>
            <div className="font-headline-sm text-headline-sm">Tâches automatiques en panne</div>
            <ul className="font-body-sm text-body-sm mt-1 list-disc pl-md">
              {schedulerHealth.filter((s) => s.consecutiveFailures >= 3).map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> — {s.consecutiveFailures} échecs consécutifs depuis {new Date(s.lastFailureAt).toLocaleString('fr-FR')} : {s.lastError}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

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
        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">Texte de l'accusé de réception et signature</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
          Message et signature envoyés automatiquement au demandeur quand un nouveau ticket est créé par email (la même
          signature est aussi utilisée pour les relances et notifications d'incident). Placeholders disponibles dans le
          message : <code>{'{ticketId}'}</code>, <code>{'{subject}'}</code>, <code>{'{toName}'}</code>. Laisser vide pour
          utiliser le texte par défaut.
        </p>
        <div className="grid grid-cols-2 gap-md">
          <div className="flex flex-col gap-md">
            <div className="flex flex-col gap-sm p-lg border border-outline-variant bg-surface-container-lowest">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Message d'accueil</span>
              <textarea
                value={ackMessageDraft}
                onChange={(e) => setAckMessageDraft(e.target.value)}
                disabled={saving}
                rows={4}
                maxLength={2000}
                placeholder={DEFAULT_ACK_MESSAGE}
                className="border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface disabled:opacity-50 resize-none flex-1"
              />
            </div>
            <div className="flex flex-col gap-sm p-lg border border-outline-variant bg-surface-container-lowest">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Signature (HTML — colle ici ta signature Outlook)
              </span>
              <textarea
                value={signatureDraft}
                onChange={(e) => setSignatureDraft(e.target.value)}
                disabled={saving}
                rows={4}
                maxLength={2000}
                placeholder={DEFAULT_SIGNATURE}
                className="border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface disabled:opacity-50 resize-none flex-1 font-mono"
              />
            </div>
            <div className="flex flex-col gap-sm p-lg border border-outline-variant bg-surface-container-lowest">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Logo de signature</span>
              {settings.signatureLogoUrl ? (
                <div className="flex flex-col gap-sm">
                  <div className="flex items-center gap-md">
                    <img
                      src={settings.signatureLogoUrl}
                      alt="Logo actuel"
                      style={{ height: `${settings.signatureLogoHeight || 60}px` }}
                      className="border border-outline-variant"
                    />
                    <button
                      type="button"
                      onClick={removeLogo}
                      disabled={saving || uploadingLogo}
                      className="px-3 py-2 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
                    >
                      Retirer le logo
                    </button>
                  </div>
                  <div className="flex items-center gap-sm">
                    <span className="font-body-sm text-body-sm text-on-surface-variant shrink-0">Taille</span>
                    <input
                      type="range"
                      min={16}
                      max={200}
                      value={settings.signatureLogoHeight || 60}
                      onChange={(e) => updateSetting('signatureLogoHeight', Number(e.target.value))}
                      disabled={saving}
                      className="flex-1"
                    />
                    <span className="font-body-sm text-body-sm text-on-surface-variant shrink-0 w-12 text-right">
                      {settings.signatureLogoHeight || 60}px
                    </span>
                  </div>
                </div>
              ) : (
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                  className="font-body-sm text-body-sm text-on-surface-variant disabled:opacity-50"
                />
              )}
              {uploadingLogo && <span className="font-body-sm text-body-sm text-on-surface-variant">Envoi en cours...</span>}
            </div>
          </div>
          <div className="flex flex-col gap-sm p-lg border border-outline-variant bg-surface">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Aperçu de l'email envoyé</span>
            <div
              className="text-body-sm text-on-surface flex-1 overflow-auto"
              dangerouslySetInnerHTML={{ __html: buildAckPreviewHtml(ackMessageDraft, signatureDraft, settings.signatureLogoUrl, settings.signatureLogoHeight) }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-sm p-lg border border-outline-variant bg-surface-container-lowest mt-sm">
          <div className="flex justify-end gap-sm">
            <button
              type="button"
              onClick={() => {
                setAckMessageDraft(settings.acknowledgementMessage || '');
                setSignatureDraft(settings.emailSignature || '');
              }}
              disabled={saving || (ackMessageDraft === (settings.acknowledgementMessage || '') && signatureDraft === (settings.emailSignature || ''))}
              className="px-3 py-2 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={async () => {
                await updateSetting('acknowledgementMessage', ackMessageDraft);
                await updateSetting('emailSignature', signatureDraft);
              }}
              disabled={saving || (ackMessageDraft === (settings.acknowledgementMessage || '') && signatureDraft === (settings.emailSignature || ''))}
              className="px-3 py-2 bg-on-surface text-surface hover:opacity-80 transition-colors disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
        </div>
      </div>

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

      {reminderConfig && (
        <div className="mt-md">
          <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">Relance des tickets en attente de réponse</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
            Pour les tickets créés par email et en attente de réponse du demandeur (statut « En attente
            utilisateur ») : relances automatiques, puis clôture automatique si toujours sans réponse.
            Vérifié toutes les heures.
          </p>
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

      <div className="mt-md">
        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">Récapitulatif quotidien des tickets ouverts</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
          Envoie chaque jour à l'heure choisie un email listant tous les tickets ouverts (répartition par
          priorité, statut, assignation, ancienneté) aux adresses email configurées ci-dessous.
        </p>
        <div className="flex flex-col gap-md">
          <SettingRow
            title="Récapitulatif quotidien"
            description="Envoie automatiquement le récapitulatif tous les jours à l'heure configurée."
            checked={settings.dailySummaryEnabled}
            onChange={(v) => updateSetting('dailySummaryEnabled', v)}
            disabled={saving}
          />
          <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant bg-surface-container-lowest">
            <div>
              <div className="font-headline-sm text-headline-sm text-on-surface">Heure d'envoi</div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">Heure locale du serveur, au format 24h.</p>
            </div>
            <input
              type="time"
              value={settings.dailySummaryTime}
              onChange={(e) => updateSetting('dailySummaryTime', e.target.value)}
              disabled={saving || !settings.dailySummaryEnabled}
              className="border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-sm p-lg border border-outline-variant bg-surface-container-lowest">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Destinataires</span>
            <div className="flex items-center gap-sm">
              <input
                type="email"
                value={summaryRecipientInput}
                onChange={(e) => setSummaryRecipientInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSummaryRecipient(); } }}
                placeholder="adresse@exemple.com"
                disabled={saving}
                className="flex-1 border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface disabled:opacity-50"
              />
              <button
                type="button"
                onClick={addSummaryRecipient}
                disabled={saving}
                className="px-3 py-2 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
              >
                Ajouter
              </button>
            </div>
            {(settings.dailySummaryRecipients || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {settings.dailySummaryRecipients.map((email) => (
                  <span key={email} className="flex items-center gap-1 px-2 py-0.5 border border-outline-variant text-on-surface-variant text-xs">
                    {email}
                    <button onClick={() => removeSummaryRecipient(email)} disabled={saving} className="hover:text-error">
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-sm p-lg border border-outline-variant bg-surface-container-lowest">
            <div className="flex items-center justify-between">
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                Envoyer un récapitulatif de test maintenant, sans attendre l'heure configurée.
              </span>
              <button
                type="button"
                onClick={testDailySummary}
                disabled={testingSummary || (settings.dailySummaryRecipients || []).length === 0}
                className="px-3 py-2 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50 shrink-0"
              >
                {testingSummary ? 'Envoi...' : 'Tester maintenant'}
              </button>
            </div>
            {summaryTestResult && (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {summaryTestResult.sent
                  ? `Envoyé : ${summaryTestResult.ticketCount} ticket(s) à ${summaryTestResult.recipientCount} destinataire(s).`
                  : summaryTestResult.reason}
              </p>
            )}
          </div>
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
