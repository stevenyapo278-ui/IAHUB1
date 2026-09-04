import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { sanitizeHtml } from '../../utils/sanitize';
import Toggle from '../../components/Toggle';

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

function SettingRow({ title, description, checked, onChange, disabled }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
      className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg"
    >
      <div className="min-w-0 flex-1">
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">{description}</p>
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
      className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg"
    >
      <div className="min-w-0 flex-1">
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">{description}</p>
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
  const [ackMessageDraft, setAckMessageDraft] = useState('');
  const [signatureDraft, setSignatureDraft] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [reminderConfig, setReminderConfig] = useState(null);
  const [reminderSaving, setReminderSaving] = useState(false);

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
      {/* SECTION 1 : SIGNATURES & ACCUSÉ DE RÉCEPTION */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">mail</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Signatures & Accusé de réception</h4>
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

              {/* Mail body */}
              <div className="p-md bg-white text-gray-800 flex-1 overflow-auto font-body-sm leading-relaxed max-h-[310px] min-h-[250px]">
                <div
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildAckPreviewHtml(ackMessageDraft, signatureDraft, settings.signatureLogoUrl, settings.signatureLogoHeight)) }}
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
      {/* SECTION 2 : INTELLIGENCE & TRIAGE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">neurology</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Intelligence & Triage</h4>
        </div>

        <SettingRow
            title="Apprentissage Few-Shot historique"
            description="Utilise les tickets résolus ou clos par les techniciens comme modèles de référence pour classer les nouveaux tickets (catégorie, priorité, équipe)."
            checked={settings.enableFewShotTriage}
            onChange={(v) => updateSetting('enableFewShotTriage', v)}
            disabled={saving}
          />

        <SettingRow
            title="Auto-création des compétences"
            description="Lors de l'analyse IA d'un email, si la compétence suggérée n'existe pas encore, elle est automatiquement créée dans la base."
            checked={settings.enableAutoCreateSkills}
            onChange={(v) => updateSetting('enableAutoCreateSkills', v)}
            disabled={saving}
          />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 : RELANCES & CLÔTURE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            <span className="material-symbols-outlined text-primary text-2xl">schedule</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Relances Tickets</h4>
          </div>

          {reminderConfig && (
            <div className="space-y-md">
              <SettingRow
                title="Relance & Clôture automatique"
                description="Crée des brouillons de relance (à valider dans le Centre de Validation) pour les tickets en attente de réponse utilisateur. Clôture automatiquement les tickets restés sans réponse."
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
                description="Préviens le demandeur que le ticket sera clôturé automatiquement."
                value={reminderConfig.preCloseDays}
                onChange={(v) => updateReminderConfig({ preCloseDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={90}
                unit="jours"
              />
              <IntervalRow
                title="Clôture automatique"
                description="Délai avant clôture définitive d'un ticket sans réponse."
                value={reminderConfig.autoCloseDays}
                onChange={(v) => updateReminderConfig({ autoCloseDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={120}
                unit="jours"
              />
            </div>
          )}

          <div className="space-y-md mt-lg">
            <IntervalRow
              title="Fermeture auto tickets résolus"
              description="Délai avant de passer automatiquement un ticket de Résolu à Fermé. 0 = désactivé."
              value={settings?.solvedAutoCloseDays ?? 3}
              onChange={(v) => updateSetting('solvedAutoCloseDays', v)}
              disabled={saving}
              max={90}
              unit="jours"
            />
          </div>
        </div>

        {/* Bloc validation des brouillons */}
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            <span className="material-symbols-outlined text-primary text-2xl">rate_review</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Validation des Brouillons</h4>
          </div>

          <div className="space-y-md">
            <SettingRow
              title="Relance email des brouillons en attente"
              description="Avertit les techniciens par email si un brouillon (réponse IA ou relance) reste en attente de validation plus longtemps que le délai ci-dessous."
              checked={settings.draftReminderEnabled}
              onChange={(v) => updateSetting('draftReminderEnabled', v)}
              disabled={saving}
            />

            <IntervalRow
              title="Délai de relance"
              description="Temps d'attente avant de déclencher l'alerte."
              value={settings.draftReminderDelayMinutes}
              onChange={(v) => updateSetting('draftReminderDelayMinutes', v)}
              disabled={saving || !settings.draftReminderEnabled}
              max={1440}
              unit="minutes"
            />

            <motion.div
              variants={itemVariants}
              className="bento-card p-md bg-surface-container-low/30 border border-dashed border-outline-variant/30 text-center"
            >
              <p className="text-xs text-on-surface-variant">
                Les brouillons à valider sont accessibles depuis{' '}
                <strong className="text-primary">Centre de Validation &gt; Réponses Email IA</strong> et{' '}
                <strong className="text-amber-600 dark:text-amber-400">Relances Auto.</strong>
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
