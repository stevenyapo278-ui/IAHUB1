import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../../api/client';
import { sanitizeHtml } from '../../utils/sanitize';
import { useAuth } from '../../context/AuthContext';
import { SettingRow, IntervalRow, inputClass, itemVariants } from './SettingsComponents';

const DEFAULT_ACK_MESSAGE = 'Nous avons bien reçu votre demande de support et un ticket a été créé automatiquement.';
const DEFAULT_ACK_OFF_HOURS_MESSAGE = 'Nous avons bien reçu votre demande. Nos bureaux sont actuellement fermés : votre demande sera prise en charge à partir du prochain jour ouvré, dès 8h00.';
const DEFAULT_SIGNATURE = '<p>Cordialement,<br>Support IT</p>';
const ACK_PREVIEW = { ticketId: 42, subject: 'Problème imprimante 3e étage' };
const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// Miroir front de la logique backend (emailSender.isWithinBusinessHours) : indique si "maintenant"
// (fuseau Africa/Abidjan) tombe dans la plage d'ouverture configurée — sert à l'aperçu dynamique.
function isNowWithinBusinessHours(days, startTime, endTime) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Abidjan', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
    const minutes = (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10);
    const dayList = Array.isArray(days) && days.length ? days : [1, 2, 3, 4, 5];
    if (!dayList.includes(weekdayIndex)) return false;
    const parseHm = (v) => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; };
    const start = parseHm(startTime) ?? 8 * 60;
    const end = parseHm(endTime) ?? 17 * 60;
    return minutes >= start && minutes < end;
  } catch {
    return true;
  }
}

// logos : liste [{ url, height }] — même structure que SystemSettings.signatureLogos (repli sur
// l'ancien champ unique géré par l'appelant). Les images se suivent horizontalement, comme dans
// l'email réel généré par emailSender.getEmailSignature.
function buildAckPreviewHtml(customMessage, signature, logos = [], { withTicketBlock = true, toName = '' } = {}) {
  const intro = (customMessage || DEFAULT_ACK_MESSAGE)
    .replaceAll('{ticketId}', ACK_PREVIEW.ticketId)
    .replaceAll('{subject}', ACK_PREVIEW.subject)
    .replaceAll('{toName}', toName);
  const imgs = (Array.isArray(logos) ? logos : [])
    .map((logo) => `<img src="${logo.url}" alt="Logo" style="height:${logo.height || 60}px;margin-right:12px;vertical-align:middle">`)
    .join('');
  const logoHtml = imgs ? `<p style="margin-top:8px">${imgs}</p>` : '';
  return `
<p>Bonjour ${toName || ''},</p>
<p>${intro}</p>
${withTicketBlock ? `
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Numéro de ticket</td><td><strong>#${ACK_PREVIEW.ticketId}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Sujet</td><td>${ACK_PREVIEW.subject}</td></tr>
</table>
<p>Notre équipe va analyser votre demande et vous contactera dans les meilleurs délais.</p>
` : ''}
<p>Vous pouvez répondre directement à cet email pour ajouter des informations à votre demande.</p>
<div style="margin-top:24px">${signature || DEFAULT_SIGNATURE}${logoHtml}</div>
`.trim();
}

const TEST_EMAIL_STORAGE_KEY = 'automation_test_email';

export default function AutomationTab() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ackMessageDraft, setAckMessageDraft] = useState('');
  const [ackOffHoursDraft, setAckOffHoursDraft] = useState('');
  const [signatureDraft, setSignatureDraft] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [reminderConfig, setReminderConfig] = useState(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [autoClosing, setAutoClosing] = useState(false);
  // Envoi de test : email mémorisé localement pour ne pas le retaper à chaque essai
  const [testEmail, setTestEmail] = useState(() => localStorage.getItem(TEST_EMAIL_STORAGE_KEY) || '');
  const [sendingTest, setSendingTest] = useState(false);

  function load() {
    api.get('/system-settings').then(({ data }) => {
      setSettings(data);
      setAckMessageDraft(data.acknowledgementMessage || '');
      setAckOffHoursDraft(data.acknowledgementOffHoursMessage || '');
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
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Enregistre les trois brouillons de la section Signatures & Accusé (message, hors horaires,
  // signature). Retourne true si tout est passé — utilisé par « Enregistrer » et par l'envoi
  // de test, afin que l'email reflète exactement ce qui est en cours d'édition.
  async function saveAckDrafts() {
    const results = [
      await updateSetting('acknowledgementMessage', ackMessageDraft),
      await updateSetting('acknowledgementOffHoursMessage', ackOffHoursDraft),
      await updateSetting('emailSignature', signatureDraft),
    ];
    return results.every(Boolean);
  }

  async function handleRunAutoClose() {
    setAutoClosing(true);
    try {
      const { data } = await api.post('/system-settings/solved-auto-close/run-now');
      if (data.closed === 0) {
        toast.info('Aucun ticket à fermer');
      } else {
        toast.success(`${data.closed} ticket(s) fermé(s) automatiquement`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'exécution');
    } finally {
      setAutoClosing(false);
    }
  }

  // Envoie un accusé de réception de test (type ack_auto) : le backend réutilise la logique
  // réelle de sendAcknowledgement — message courant (variante horaires/hors horaires incluse),
  // signature + logo configurés ici, sujet identique à un envoi de production.
  async function handleSendTestEmail() {
    const email = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Veuillez saisir une adresse email valide');
      return;
    }
    // On enregistre d'abord les brouillons en cours : le test doit refléter ce que vous voyez
    if (isAckChanged) {
      const ok = await saveAckDrafts();
      if (!ok) return;
    }
    setSendingTest(true);
    try {
      const { data } = await api.post('/system-settings/test-email', { type: 'ack_auto', recipientEmail: email });
      localStorage.setItem(TEST_EMAIL_STORAGE_KEY, email);
      toast.success(`Email de test envoyé à ${email}${data.offHours ? ' (variante hors horaires)' : ''}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'envoi de l'email de test");
    } finally {
      setSendingTest(false);
    }
  }

  // Upload multi-images : plusieurs fichiers sélectionnables (Ctrl+clic), envoyés en une requête
  // et chaînés à la liste existante côté serveur.
  async function handleLogoUpload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadingLogo(true);
    setError('');
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('logo', file));
      const { data } = await api.post('/system-settings/signature-logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSettings(data);
      toast.success(files.length > 1 ? `${files.length} images ajoutées à la signature` : 'Image ajoutée à la signature');
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'upload de l'image");
    } finally {
      setUploadingLogo(false);
    }
  }

  // Retire une image de la liste (par URL) et met à jour les deux champs côté serveur.
  async function removeLogo(logoUrl) {
    const current = signatureLogos;
    const next = current.filter((l) => l.url !== logoUrl);
    const ok = await updateSetting('signatureLogos', next);
    if (ok) toast.success('Image retirée de la signature');
  }

  // Ajuste la hauteur d'une image précise (champ signatureLogos complet en un PATCH).
  async function updateLogoHeight(logoUrl, height) {
    const next = signatureLogos.map((l) => (l.url === logoUrl ? { ...l, height } : l));
    await updateSetting('signatureLogos', next);
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

  const isAckChanged =
    ackMessageDraft !== (settings.acknowledgementMessage || '') ||
    ackOffHoursDraft !== (settings.acknowledgementOffHoursMessage || '') ||
    signatureDraft !== (settings.emailSignature || '');

  // Liste des images de signature : nouveau champ multi (signatureLogos) avec repli sur l'ancien
  // champ unique (signatureLogoUrl) pour les réglages non encore migrés.
  const signatureLogos = (Array.isArray(settings.signatureLogos) && settings.signatureLogos.length > 0
    ? settings.signatureLogos
    : settings.signatureLogoUrl
      ? [{ url: settings.signatureLogoUrl, height: settings.signatureLogoHeight || 60 }]
      : []);

  // Aperçu dynamique : bascule sur le message hors horaires si la variante est active et que
  // l'heure actuelle (Abidjan) est hors plage d'ouverture — même choix que l'envoi réel.
  const businessHoursEnabled = settings.acknowledgementBusinessHoursEnabled !== false;
  const previewOffHours = businessHoursEnabled && !isNowWithinBusinessHours(settings.acknowledgementBusinessDays, settings.acknowledgementBusinessStartTime, settings.acknowledgementBusinessEndTime);
  const ackPreviewMessage = previewOffHours ? (ackOffHoursDraft || DEFAULT_ACK_OFF_HOURS_MESSAGE) : (ackMessageDraft || DEFAULT_ACK_MESSAGE);
  const ackPreviewWithTicket = ackPreviewMessage.includes('{ticketId}');
  const ackPreviewSubject = ackPreviewWithTicket
    ? `Réception de votre demande - #${ACK_PREVIEW.ticketId}`
    : `Accusé de réception — ${ACK_PREVIEW.subject}`;

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
              Message et signature envoyés automatiquement au demandeur lors de la réception de sa demande.
              Placeholders : <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{ticketId}'}</code>,{' '}
              <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{subject}'}</code>,{' '}
              <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{toName}'}</code>.
              Sans <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">{'{ticketId}'}</code> dans le message, aucun numéro de ticket n'est affiché dans l'email.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
            <div className="space-y-md">
              <div className="flex flex-col gap-sm">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Message — pendant les horaires</span>
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
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Message — hors horaires</span>
                <motion.textarea
                  whileFocus={{ scale: 1.01 }}
                  value={ackOffHoursDraft}
                  onChange={(e) => setAckOffHoursDraft(e.target.value)}
                  disabled={saving || settings.acknowledgementBusinessHoursEnabled === false}
                  rows={3}
                  maxLength={2000}
                  placeholder={DEFAULT_ACK_OFF_HOURS_MESSAGE}
                  className={`${inputClass} resize-none w-full min-h-[90px] disabled:opacity-50`}
                />
              </div>

              <div className="bento-card flex flex-col gap-sm p-md bg-surface-container-low/20">
                <SettingRow
                  title="Variantes horaires / hors horaires"
                  description="Envoie le message « hors horaires » en dehors de la plage d'ouverture ci-dessous (fuseau Abidjan). Désactivé = message unique pour toutes les demandes."
                  checked={settings.acknowledgementBusinessHoursEnabled !== false}
                  onChange={(v) => updateSetting('acknowledgementBusinessHoursEnabled', v)}
                  disabled={saving}
                />
                <div className="flex flex-col gap-sm">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Jours d'ouverture</span>
                  <div className="flex flex-wrap gap-xs">
                    {DAY_LABELS.map((label, idx) => {
                      const days = settings.acknowledgementBusinessDays ?? [1, 2, 3, 4, 5];
                      const active = days.includes(idx);
                      return (
                        <motion.button
                          key={label}
                          type="button"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          disabled={saving}
                          onClick={() => {
                            const next = active ? days.filter((d) => d !== idx) : [...days, idx].sort();
                            updateSetting('acknowledgementBusinessDays', next);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-body-sm font-semibold border transition-colors disabled:opacity-50 ${
                            active
                              ? 'bg-primary/10 border-primary/30 text-primary'
                              : 'bg-surface-container-high/40 border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-high'
                          }`}
                        >
                          {label}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-md">
                  <div className="flex flex-col gap-sm">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Ouverture</span>
                    <input
                      type="time"
                      value={settings.acknowledgementBusinessStartTime || '08:00'}
                      onChange={(e) => updateSetting('acknowledgementBusinessStartTime', e.target.value)}
                      disabled={saving || settings.acknowledgementBusinessHoursEnabled === false}
                      className={`${inputClass} disabled:opacity-50`}
                    />
                  </div>
                  <div className="flex flex-col gap-sm">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Fermeture</span>
                    <input
                      type="time"
                      value={settings.acknowledgementBusinessEndTime || '17:00'}
                      onChange={(e) => updateSetting('acknowledgementBusinessEndTime', e.target.value)}
                      disabled={saving || settings.acknowledgementBusinessHoursEnabled === false}
                      className={`${inputClass} disabled:opacity-50`}
                    />
                  </div>
                </div>
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
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Images de signature</span>
                <p className="font-body-xs text-body-xs text-on-surface-variant/80">
                  Ajoutez autant d'images que nécessaire (logo, badges, certifications…) : elles apparaissent côte à côte sous la signature dans chaque email.
                </p>
                {signatureLogos.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col gap-sm"
                  >
                    {signatureLogos.map((logo) => (
                      <div key={logo.url} className="flex items-center gap-md">
                        <img
                          src={logo.url}
                          alt="Image de signature"
                          style={{ height: `${logo.height || 60}px` }}
                          className="border border-outline-variant/60 rounded-lg p-1 bg-white max-h-20 object-contain shrink-0"
                        />
                        <div className="flex items-center gap-sm flex-1 min-w-0">
                          <span className="font-body-sm text-body-sm text-on-surface-variant shrink-0 font-medium">Hauteur</span>
                          <input
                            type="range"
                            min={16}
                            max={200}
                            value={logo.height || 60}
                            onChange={(e) => updateLogoHeight(logo.url, Number(e.target.value))}
                            disabled={saving}
                            className="flex-1 accent-primary min-w-0"
                          />
                          <span className="font-body-sm text-body-sm text-on-surface font-semibold shrink-0 w-12 text-right">
                            {logo.height || 60}px
                          </span>
                        </div>
                        <motion.button
                          type="button"
                          onClick={() => removeLogo(logo.url)}
                          disabled={saving || uploadingLogo}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="p-2 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-500 rounded-xl transition-colors disabled:opacity-50 shrink-0"
                          title="Retirer cette image"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </motion.button>
                      </div>
                    ))}
                  </motion.div>
                )}
                <input
                  type="file"
                  multiple
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

              {/* Mail Header Info — l'aperçu bascule automatiquement sur le message hors horaires
                  quand la variante horaire est active et que l'heure locale simule un envoi hors plage */}
              <div className="px-md py-3 bg-surface border-b border-outline-variant/20 space-y-1 text-body-xs font-body-sm text-on-surface-variant">
                <div><span className="font-semibold text-on-surface">De :</span> Support IT &lt;support@prosuma.ci&gt;</div>
                <div><span className="font-semibold text-on-surface">À :</span> {ACK_PREVIEW.toName} &lt;jean.dupont@client.com&gt;</div>
                <div><span className="font-semibold text-on-surface">Objet :</span> {ackPreviewSubject}</div>
                {previewOffHours && (
                  <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-semibold">
                    <span className="material-symbols-outlined text-[14px]">schedule</span>
                    Aperçu du message hors horaires
                  </div>
                )}
              </div>

              {/* Mail body */}
              <div className="p-md bg-white text-gray-800 flex-1 overflow-auto font-body-sm leading-relaxed max-h-[310px] min-h-[250px]">
                <div
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildAckPreviewHtml(ackPreviewMessage, signatureDraft, signatureLogos, { withTicketBlock: ackPreviewWithTicket, toName: user?.fullName || '' })) }}
                />
              </div>

              {/* Envoi de test : l'email part avec la logique réelle (message courant, variante
                  horaires, signature + logo) — voir POST /system-settings/test-email type ack_auto */}
              <div className="px-md py-sm border-t border-outline-variant/40 bg-surface-container-high/40 flex flex-col gap-xs">
                <div className="flex items-center gap-sm">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !sendingTest) handleSendTestEmail(); }}
                    placeholder="votre.adresse@prosuma.ci"
                    disabled={saving || sendingTest}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface border border-outline-variant/60 text-body-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50"
                  />
                  <motion.button
                    type="button"
                    onClick={handleSendTestEmail}
                    disabled={saving || sendingTest}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    title="Envoyer cet accusé de réception à l'adresse saisie pour vérifier le rendu réel"
                    className="flex items-center gap-1.5 px-3.5 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 shrink-0"
                  >
                    <span className={`material-symbols-outlined text-[16px] ${sendingTest ? 'animate-spin' : ''}`}>
                      {sendingTest ? 'progress_activity' : 'send'}
                    </span>
                    {sendingTest ? 'Envoi...' : 'Tester'}
                  </motion.button>
                </div>
                <p className="text-[11px] leading-snug text-on-surface-variant">
                  Envoie l'accusé de réception réel (message courant, variante {previewOffHours ? 'hors horaires' : 'horaires'} active, signature + logo) à l'adresse saisie, sans créer de ticket.
                </p>
              </div>
            </div>
          </div>

          <motion.div variants={itemVariants} className="flex justify-end gap-sm pt-sm border-t border-outline-variant/40">
            <motion.button
              type="button"
              onClick={() => {
                setAckMessageDraft(settings.acknowledgementMessage || '');
                setAckOffHoursDraft(settings.acknowledgementOffHoursMessage || '');
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
              onClick={async () => { await saveAckDrafts(); }}
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
                description="Délai après la dernière réponse du demandeur avant la 1ère relance (brouillon à valider dans le Centre de Validation)."
                value={reminderConfig.firstReminderDays}
                onChange={(v) => updateReminderConfig({ firstReminderDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={60}
                unit="jours"
              />
              <IntervalRow
                title="Deuxième relance"
                description="Délai avant la 2ème relance si aucune réponse du demandeur."
                value={reminderConfig.secondReminderDays}
                onChange={(v) => updateReminderConfig({ secondReminderDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={60}
                unit="jours"
              />
              <IntervalRow
                title="Avertissement avant clôture"
                description="Délai avant le brouillon d'avertissement « clôture automatique prochaine » (pré-clôture)."
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
            <button
              onClick={handleRunAutoClose}
              disabled={autoClosing || (settings?.solvedAutoCloseDays ?? 3) <= 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span className={`material-symbols-outlined text-[16px] ${autoClosing ? 'animate-spin' : ''}`}>
                {autoClosing ? 'progress_activity' : 'play_arrow'}
              </span>
              {autoClosing ? 'Exécution en cours...' : 'Lancer maintenant'}
            </button>
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

            {/* Exclusion email des relances */}
            <motion.div variants={itemVariants} className="space-y-2">
              <label className="text-sm font-medium text-on-surface">Exclure des relances</label>
              <p className="text-xs text-on-surface-variant">
                Adresses email qui ne recevront jamais de relance pour les brouillons en attente.
              </p>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-surface-container-low border border-outline-variant/30 min-h-[40px]">
                {(settings.draftReminderExcludeEmails || []).map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-medium"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => {
                        const updated = (settings.draftReminderExcludeEmails || []).filter((e) => e !== email);
                        updateSetting('draftReminderExcludeEmails', updated);
                      }}
                      className="hover:text-red-900 dark:hover:text-red-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="email"
                placeholder="Ajouter un email et appuyer Entrée..."
                disabled={saving || !settings.draftReminderEnabled}
                className="w-full px-3 py-2 rounded-xl bg-surface-container text-on-surface text-sm border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all placeholder:text-on-surface-variant/50 disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = e.target.value.trim().toLowerCase();
                    if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                      const current = settings.draftReminderExcludeEmails || [];
                      if (!current.includes(val)) {
                        updateSetting('draftReminderExcludeEmails', [...current, val]);
                      }
                      e.target.value = '';
                    }
                  }
                }}
              />
            </motion.div>

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
