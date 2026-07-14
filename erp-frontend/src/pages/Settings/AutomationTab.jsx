import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
    <motion.button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      whileTap={{ scale: 0.92 }}
      className={`relative w-12 h-6 rounded-full border transition-all duration-300 outline-none ${
        checked
          ? 'bg-primary border-primary/60 shadow-sm shadow-primary/20'
          : 'bg-surface-container-high border-outline-variant/60'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <motion.span
        animate={{ x: checked ? 24 : 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full shadow-sm ${
          checked ? 'bg-white' : 'bg-on-surface-variant/80'
        }`}
      />
    </motion.button>
  );
}

function SettingRow({ title, description, checked, onChange, disabled }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
      className="bento-card flex items-center justify-between gap-lg p-lg"
    >
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{description}</p>
      </div>
      <div className="shrink-0">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </motion.div>
  );
}

function IntervalRow({ title, description, value, onChange, disabled, max, unit }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
      className="bento-card flex items-center justify-between gap-lg p-lg"
    >
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
    </motion.div>
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

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

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
      setError(err.response?.data?.error || "Erreur lors de l'upload du logo");
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  }

  async function removeLogo() {
    await updateSetting('signatureLogoUrl', null);
  }

  if (!settings) {
    return (
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="font-body-sm text-body-sm text-on-surface-variant"
      >
        {error || 'Chargement...'}
      </motion.p>
    );
  }

  const isAckChanged = ackMessageDraft !== (settings.acknowledgementMessage || '') || signatureDraft !== (settings.emailSignature || '');

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
            key="settings-error"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md overflow-hidden"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 : EMAILS & SIGNATURES */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">mail</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Emails & Communication Client</h4>
        </div>

        <motion.div variants={itemVariants} className="bento-card p-lg space-y-md">
          <div className="bento-card-header px-0 py-0 pb-md border-b border-outline-variant/40">
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Accusé de réception et signature</h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Message et signature envoyés automatiquement au demandeur à la création d'un ticket par email. 
              Placeholders : <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{ticketId}'}</code>,{' '}
              <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{subject}'}</code>,{' '}
              <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{toName}'}</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
            <div className="space-y-md">
              <div className="flex flex-col gap-sm">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Message d'accueil</span>
                <motion.textarea
                  whileFocus={{ scale: 1.01 }}
                  value={ackMessageDraft}
                  onChange={(e) => setAckMessageDraft(e.target.value)}
                  disabled={saving}
                  rows={3}
                  maxLength={2000}
                  placeholder={DEFAULT_ACK_MESSAGE}
                  className={`${inputClass} resize-none w-full min-h-[90px]`}
                />
              </div>

              <div className="flex flex-col gap-sm">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                  Signature (HTML)
                </span>
                <motion.textarea
                  whileFocus={{ scale: 1.01 }}
                  value={signatureDraft}
                  onChange={(e) => setSignatureDraft(e.target.value)}
                  disabled={saving}
                  rows={3}
                  maxLength={2000}
                  placeholder={DEFAULT_SIGNATURE}
                  className={`${inputClass} resize-none w-full font-mono min-h-[90px]`}
                />
              </div>

              <div className="bento-card flex flex-col gap-sm p-md bg-surface-container-low/20">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Logo de signature</span>
                {settings.signatureLogoUrl ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col gap-md"
                  >
                    <div className="flex items-center gap-md">
                      <img
                        src={settings.signatureLogoUrl}
                        alt="Logo actuel"
                        style={{ height: `${settings.signatureLogoHeight || 60}px` }}
                        className="border border-outline-variant/60 rounded-lg p-1 bg-white max-h-20 object-contain"
                      />
                      <motion.button
                        type="button"
                        onClick={removeLogo}
                        disabled={saving || uploadingLogo}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.96 }}
                        className="px-3 py-2 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-500 rounded-xl transition-colors disabled:opacity-50 text-body-sm font-semibold"
                      >
                        Retirer le logo
                      </motion.button>
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
                  </motion.div>
                ) : (
                  <div className="flex flex-col gap-sm">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      className="font-body-sm text-body-sm text-on-surface-variant disabled:opacity-50 cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-body-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:transition-all"
                    />
                    {uploadingLogo && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="font-body-sm text-body-sm text-on-surface-variant italic"
                      >
                        Envoi en cours...
                      </motion.span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Dynamic Mail Client Mockup Panel */}
            <div className="flex flex-col gap-0 overflow-hidden bg-surface-container-lowest border border-outline-variant/60 shadow-sm rounded-2xl h-full select-none">
              {/* Browser / Client controls */}
              <div className="bg-surface-container-high/60 px-md py-sm border-b border-outline-variant/40 flex items-center justify-between">
                <div className="flex items-center gap-xs">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500/80"></span>
                </div>
                <span className="font-label-md text-label-md text-on-surface-variant font-semibold">Aperçu du message</span>
                <div className="w-12"></div>
              </div>

              {/* Mail Header Info */}
              <div className="px-md py-3 bg-surface border-b border-outline-variant/20 space-y-1 text-body-xs font-body-sm text-on-surface-variant">
                <div><span className="font-semibold text-on-surface">De :</span> Support IT &lt;support@prosuma.ci&gt;</div>
                <div><span className="font-semibold text-on-surface">À :</span> {ACK_PREVIEW.toName} &lt;jean.dupont@client.com&gt;</div>
                <div><span className="font-semibold text-on-surface">Objet :</span> Réception de votre demande - #{ACK_PREVIEW.ticketId}</div>
              </div>

              {/* Mail body styled strictly inside white container for realistic markup */}
              <div className="p-md bg-white text-gray-800 flex-1 overflow-auto font-body-sm leading-relaxed max-h-[310px] min-h-[250px]">
                <div
                  dangerouslySetInnerHTML={{ __html: buildAckPreviewHtml(ackMessageDraft, signatureDraft, settings.signatureLogoUrl, settings.signatureLogoHeight) }}
                />
              </div>
            </div>
          </div>

          <motion.div variants={itemVariants} className="flex justify-end gap-sm pt-sm border-t border-outline-variant/40">
            <motion.button
              type="button"
              onClick={() => {
                setAckMessageDraft(settings.acknowledgementMessage || '');
                setSignatureDraft(settings.emailSignature || '');
              }}
              disabled={saving || !isAckChanged}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              className="px-4 py-2 border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high rounded-xl transition-colors disabled:opacity-50 text-body-sm font-semibold"
            >
              Annuler
            </motion.button>
            <motion.button
              type="button"
              onClick={async () => {
                await updateSetting('acknowledgementMessage', ackMessageDraft);
                await updateSetting('emailSignature', signatureDraft);
              }}
              disabled={saving || !isAckChanged}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              className="px-4 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </motion.button>
          </motion.div>
        </motion.div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 : AUTRES AUTOMATISATIONS & RELANCES */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        {/* Colonne gauche : Triage & Relance Brouillons */}
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            <span className="material-symbols-outlined text-primary text-2xl">neurology</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Apprentissage & Brouillons</h4>
          </div>

          <div className="space-y-md">
            <SettingRow
              title="Apprentissage Few-Shot historique"
              description="Utilise les tickets résolus ou clos par les techniciens comme modèles de référence pour classer les nouveaux tickets (catégorie, priorité, équipe)."
              checked={settings.enableFewShotTriage}
              onChange={(v) => updateSetting('enableFewShotTriage', v)}
              disabled={saving}
            />

            <SettingRow
              title="Relance email des brouillons en attente"
              description="Avertit par email si un brouillon reste en attente de validation plus longtemps que le délai ci-dessous."
              checked={settings.draftReminderEnabled}
              onChange={(v) => updateSetting('draftReminderEnabled', v)}
              disabled={saving}
            />

            <IntervalRow
              title="Délai de relance brouillon"
              description="Temps d'attente avant de déclencher l'alerte."
              value={settings.draftReminderDelayMinutes}
              onChange={(v) => updateSetting('draftReminderDelayMinutes', v)}
              disabled={saving || !settings.draftReminderEnabled}
              max={1440}
              unit="minutes"
            />
          </div>
        </div>

        {/* Colonne droite : Relance Tickets en attente */}
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            <span className="material-symbols-outlined text-primary text-2xl">schedule</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Relances Tickets Automatiques</h4>
          </div>

          {reminderConfig && (
            <div className="space-y-md">
              <SettingRow
                title="Relance & Clôture automatique"
                description="Relance les tickets en attente de réponse utilisateur, puis les clôture automatiquement s'ils restent sans réponse."
                checked={reminderConfig.isActive}
                onChange={(v) => updateReminderConfig({ isActive: v })}
                disabled={reminderSaving}
              />
              <IntervalRow
                title="Première relance"
                description="Délai après le dernier message avant la 1ère relance."
                value={reminderConfig.firstReminderDays}
                onChange={(v) => updateReminderConfig({ firstReminderDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={60}
                unit="jours"
              />
              <IntervalRow
                title="Deuxième relance"
                description="Délai avant la 2ème relance si aucune réponse."
                value={reminderConfig.secondReminderDays}
                onChange={(v) => updateReminderConfig({ secondReminderDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={60}
                unit="jours"
              />
              <IntervalRow
                title="Avertissement avant clôture"
                description="Préviens que le ticket sera clôturé automatiquement."
                value={reminderConfig.preCloseDays}
                onChange={(v) => updateReminderConfig({ preCloseDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={90}
                unit="jours"
              />
              <IntervalRow
                title="Clôture automatique"
                description="Délai avant clôture définitive du ticket."
                value={reminderConfig.autoCloseDays}
                onChange={(v) => updateReminderConfig({ autoCloseDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={120}
                unit="jours"
              />
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 : RAPPORTS & NOTIFICATIONS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">monitoring</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Rapports & Notifications locales</h4>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
          {/* Récapitulatif Quotidien */}
          <div className="space-y-md">
            <SettingRow
              title="Récapitulatif quotidien"
              description="Envoie automatiquement un email listant tous les tickets ouverts aux adresses configurées."
              checked={settings.dailySummaryEnabled}
              onChange={(v) => updateSetting('dailySummaryEnabled', v)}
              disabled={saving}
            />

            <motion.div
              variants={itemVariants}
              whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
              className="bento-card flex items-center justify-between gap-lg p-lg"
            >
              <div>
                <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">Heure d'envoi</div>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 font-medium">Heure locale du serveur.</p>
              </div>
              <input
                type="time"
                value={settings.dailySummaryTime}
                onChange={(e) => updateSetting('dailySummaryTime', e.target.value)}
                disabled={saving || !settings.dailySummaryEnabled}
                className={`${inputClass} disabled:opacity-50`}
              />
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="bento-card flex flex-col gap-sm p-lg"
            >
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
                <motion.button
                  type="button"
                  onClick={addSummaryRecipient}
                  disabled={saving}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 shrink-0"
                >
                  Ajouter
                </motion.button>
              </div>
              {(settings.dailySummaryRecipients || []).length > 0 && (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
                  className="flex flex-wrap gap-2 mt-2"
                >
                  {settings.dailySummaryRecipients.map((email) => (
                    <motion.span
                      key={email}
                      variants={itemVariants}
                      layout
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container-high border border-outline-variant/60 rounded-full text-on-surface text-xs font-semibold shadow-sm"
                    >
                      {email}
                      <motion.button
                        onClick={() => removeSummaryRecipient(email)}
                        disabled={saving}
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        className="text-on-surface-variant hover:text-error transition-colors flex items-center"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </motion.button>
                    </motion.span>
                  ))}
                </motion.div>
              )}
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="bento-card flex flex-col gap-sm p-lg"
            >
              <div className="flex items-center justify-between gap-md flex-wrap md:flex-nowrap">
                <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">
                  Envoyer un récapitulatif de test maintenant.
                </span>
                <motion.button
                  type="button"
                  onClick={testDailySummary}
                  disabled={testingSummary || (settings.dailySummaryRecipients || []).length === 0}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 shrink-0 shadow-sm"
                >
                  {testingSummary ? 'Envoi...' : 'Tester maintenant'}
                </motion.button>
              </div>
              <AnimatePresence>
                {summaryTestResult && (
                  <motion.div
                    key="summary-test-result"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-md rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 font-body-sm mt-2 overflow-hidden"
                  >
                    {summaryTestResult.sent
                      ? `Envoyé avec succès : ${summaryTestResult.ticketCount} ticket(s) à ${summaryTestResult.recipientCount} destinataire(s).`
                      : summaryTestResult.reason}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Notification Email au Technicien Assigné */}
          <SettingRow
            title="Email au technicien assigné"
            description="Envoie un email de notification au technicien lorsqu'un ticket créé par email lui est automatiquement assigné par l'IA."
            checked={settings.notifyTechnicianOnAssignment}
            onChange={(v) => updateSetting('notifyTechnicianOnAssignment', v)}
            disabled={saving}
          />

          {/* Alertes Vocales & Sonores */}
          <div className="space-y-md">
            <SettingRow
              title="Alerte vocale interactive"
              description="Une voix annonce dans ce navigateur l'arrivée de nouvelles actions requérant votre validation locale."
              checked={voiceAlerts}
              onChange={toggleVoiceAlerts}
            />

            <motion.div
              variants={itemVariants}
              whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
              className="bento-card flex items-center justify-between gap-lg p-lg"
            >
              <div>
                <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">Langue vocale</div>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 font-medium">
                  Langue de synthèse pour les annonces.
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
                <motion.button
                  type="button"
                  onClick={() => speakTest(voiceLang)}
                  disabled={!voiceAlerts}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 shadow-sm flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">volume_up</span>
                  Tester
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
