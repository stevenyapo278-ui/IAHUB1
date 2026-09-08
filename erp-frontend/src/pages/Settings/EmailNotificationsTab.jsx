import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import {
  Mail, UserCheck, AlertTriangle, Clock, RefreshCw, CheckCircle2,
  TrendingUp, Shield, Send, Bell, Volume2, MousePointer2, FlaskConical,
} from 'lucide-react';
import {
  isSoundsEnabled,
  setSoundsEnabled,
  getSoundsVolume,
  setSoundsVolume,
  isSoundsInteractionEnabled,
  setSoundsInteractionEnabled,
} from '../../utils/soundPreference';
import { playSuccess, playClick } from '../../utils/sounds';
import {
  isBrowserNotifEnabled,
  setBrowserNotifEnabled,
  requestBrowserNotifPermission,
} from '../../utils/browserNotification';
import Toggle from '../../components/Toggle';
import { SettingRow, inputClass, itemVariants } from './SettingsComponents';

// ═══════════════════════════════════════════════════════════════════════════════
// TOGGLES EMAILS PAR TYPE (déjà existants)
// ═══════════════════════════════════════════════════════════════════════════════

const EMAIL_TOGGLES = [
  { key: 'emailAcknowledgementEnabled', label: 'Accusé de réception', description: "Email automatique envoyé au demandeur lors de la création d'un ticket par email.", icon: Mail, category: 'Automatiques (pipeline email)', subjects: ['[Ticket #ID] Objet du ticket'], testKey: 'acknowledgement' },
  { key: 'emailKnownIncidentEnabled', label: 'Incident déjà connu', description: 'Notification quand un email correspond à un incident existant (le demandeur est rattaché au ticket existant).', icon: AlertTriangle, category: 'Automatiques (pipeline email)', subjects: ['[Ticket #ID] Objet du ticket'], testKey: 'known_incident' },
  { key: 'emailAssignmentEnabled', label: 'Assignation technicien', description: "Email envoyé au technicien quand l'IA lui attribue automatiquement un ticket.", icon: UserCheck, category: 'Automatiques (pipeline email)', subjects: ['[Ticket #ID] Nouvelle assignation — Titre du ticket'], testKey: 'assignment' },
  { key: 'emailSlaBreachEnabled', label: 'Dépassement SLA', description: 'Alerte envoyée au technicien assigné quand le SLA de réponse est dépassé.', icon: Clock, category: 'Automatiques (schedulers)', subjects: ['[SLA] Dépassement — Ticket #ID : Titre du ticket'], testKey: 'sla_breach' },
  { key: 'emailDueDateBreachEnabled', label: "Dépassement d'échéance", description: "Alerte envoyée au technicien assigné quand la date d'échéance manuelle est dépassée.", icon: Clock, category: 'Automatiques (schedulers)', subjects: ['[Échéance] Dépassement — Ticket #ID : Titre du ticket'], testKey: 'due_date' },
  { key: 'emailStatusChangeEnabled', label: 'Changement de statut', description: 'Notification envoyée au demandeur à chaque changement de statut du ticket.', icon: RefreshCw, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Statut — Titre du ticket'], testKey: 'status_change' },
  { key: 'emailResolvedEnabled', label: 'Résolution (différé 10 min)', description: 'Email de résolution envoyé au demandeur 10 minutes après le passage en "Résolu" (laisse un délai de correction).', icon: CheckCircle2, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Résolu — Titre du ticket'], testKey: null },
  { key: 'emailEscalationEnabled', label: 'Escalade', description: "Notification envoyée aux admins/techniciens et au demandeur lors d'une escalade de ticket.", icon: TrendingUp, category: 'Manuelles (actions utilisateur)', subjects: ['[Escalade Niv.1] Ticket #ID : Titre du ticket', '[Ticket #ID] Votre demande a été escaladée'], testKey: null },
  { key: 'emailMajorIncidentResolvedEnabled', label: 'Résolution incident majeur', description: 'Notification envoyée aux emails des sites impactés quand un incident majeur est résolu.', icon: Shield, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Titre du ticket'], testKey: null },
  { key: 'emailApprovalEnabled', label: 'Approbation ticket', description: 'Notification envoyée au demandeur quand son ticket est approuvé par la Hotline.', icon: Send, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Approuvé — Titre du ticket'], testKey: null },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function EmailNotificationsTab() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Récapitulatif quotidien ──
  const [summaryRecipientInput, setSummaryRecipientInput] = useState('');
  const [testingSummary, setTestingSummary] = useState(false);
  const [summaryTestResult, setSummaryTestResult] = useState(null);

  // ── Notification création de ticket ──
  const [ticketCreationRecipientInput, setTicketCreationRecipientInput] = useState('');

  // ── Notification échec IA ──
  const [failureRecipientInput, setFailureRecipientInput] = useState('');

  // ── Sons & notifications navigateur ──
  const [soundsEnabled, setSoundsEnabledState] = useState(isSoundsEnabled());
  const [soundsVolume, setSoundsVolumeState] = useState(getSoundsVolume());
  const [soundsInteraction, setSoundsInteractionState] = useState(isSoundsInteractionEnabled());
  const [browserNotif, setBrowserNotif] = useState(isBrowserNotifEnabled());

  // ── Test email ──
  const [testEmailInput, setTestEmailInput] = useState('');
  const [testingEmailType, setTestingEmailType] = useState(null);
  const [testEmailResult, setTestEmailResult] = useState(null);

  useEffect(() => {
    api.get('/system-settings').then(({ data }) => setSettings(data)).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }, []);

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

  // ── Récapitulatif quotidien ──
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

  // ── Notification création de ticket ──
  function addTicketCreationRecipient() {
    const value = ticketCreationRecipientInput.trim();
    if (!value) return;
    const current = settings.ticketCreationEmailRecipients || [];
    if (!current.includes(value)) {
      updateSetting('ticketCreationEmailRecipients', [...current, value]);
    }
    setTicketCreationRecipientInput('');
  }

  function removeTicketCreationRecipient(email) {
    updateSetting('ticketCreationEmailRecipients', (settings.ticketCreationEmailRecipients || []).filter((e) => e !== email));
  }

  // ── Notification échec IA ──
  function addFailureRecipient() {
    const value = failureRecipientInput.trim();
    if (!value) return;
    const current = settings.emailFailureNotificationRecipients && settings.emailFailureNotificationRecipients.length > 0
      ? settings.emailFailureNotificationRecipients
      : (settings.emailFailureNotificationEmail ? [settings.emailFailureNotificationEmail] : []);
    if (!current.includes(value)) {
      updateSetting('emailFailureNotificationRecipients', [...current, value]);
    }
    setFailureRecipientInput('');
  }

  function removeFailureRecipient(email) {
    const current = settings.emailFailureNotificationRecipients && settings.emailFailureNotificationRecipients.length > 0
      ? settings.emailFailureNotificationRecipients
      : (settings.emailFailureNotificationEmail ? [settings.emailFailureNotificationEmail] : []);
    updateSetting('emailFailureNotificationRecipients', current.filter((e) => e !== email));
  }

  async function testDailySummary() {
    setTestingSummary(true);
    setSummaryTestResult(null);
    try {
      const { data } = await api.post('/system-settings/daily-summary/test');
      setSummaryTestResult(data);
    } catch (err) {
      console.error("Erreur test récap:", err);
    } finally {
      setTestingSummary(false);
    }
  }

  // ── Sons ──
  function toggleSounds(value) {
    setSoundsEnabled(value);
    setSoundsEnabledState(value);
    if (value) playSuccess();
  }

  function changeSoundsVolume(value) {
    setSoundsVolume(value);
    setSoundsVolumeState(value);
  }

  function toggleInteractionSounds(value) {
    setSoundsInteractionEnabled(value);
    setSoundsInteractionState(value);
    if (value) playClick();
  }

  // ── Test email template ──
  async function testEmailTemplate(type) {
    const email = testEmailInput.trim();
    if (!email) return;
    setTestingEmailType(type);
    setTestEmailResult(null);
    try {
      const { data } = await api.post('/system-settings/test-email', { type, recipientEmail: email });
      setTestEmailResult({ type, sent: data.sent });
    } catch (err) {
      setTestEmailResult({ type, sent: false, error: err.response?.data?.error || 'Erreur d\'envoi' });
    } finally {
      setTestingEmailType(null);
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const categories = [...new Set(EMAIL_TOGGLES.map((t) => t.category))];

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
      {/* SECTION 1 : EMAILS PAR TYPE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">toggle_on</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Activer / Désactiver par type</h4>
        </div>
        <p className="text-xs text-on-surface-variant px-1 -mt-2">Choisissez quels emails automatiques sont envoyés. Chaque type correspond à un événement déclencheur dans le cycle de vie d'un ticket.</p>

        {/* Champ email de test global */}
        <motion.div variants={itemVariants} className="bento-card flex flex-col sm:flex-row sm:items-center gap-3 p-lg">
          <div className="flex items-center gap-2 shrink-0">
            <FlaskConical className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-on-surface">Tester un template</span>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              type="email"
              value={testEmailInput}
              onChange={(e) => setTestEmailInput(e.target.value)}
              placeholder="email@exemple.com — adresse de test"
              className={`${inputClass} flex-1`}
            />
            <span className="text-xs text-on-surface-variant/60 shrink-0 hidden sm:block">Puis cliquez sur "Tester" à droite du toggle souhaité.</span>
          </div>
        </motion.div>

        {categories.map((category) => (
        <div key={category} className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 px-1">
            {category}
          </h3>
          <div className="space-y-2">
            {EMAIL_TOGGLES.filter((t) => t.category === category).map((toggle) => (
              <motion.div
                key={toggle.key}
                variants={itemVariants}
                whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
                className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg"
              >
                <div className="min-w-0 flex-1 flex items-center gap-4">
                  {toggle.icon && (
                    <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
                      <toggle.icon className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">{toggle.label}</div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">{toggle.description}</p>
                    {toggle.subjects && (
                      <div className="mt-2 space-y-1">
                        {toggle.subjects.map((subject, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-xs text-on-surface-variant/70 font-mono">
                            <span className="shrink-0 mt-0.5">✉</span>
                            <span className="break-all">{subject}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {toggle.testKey && (
                    <motion.button
                      type="button"
                      onClick={() => testEmailTemplate(toggle.testKey)}
                      disabled={testingEmailType !== null || !testEmailInput.trim()}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      className="px-3 py-1.5 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-xs transition-all disabled:opacity-50 shrink-0 shadow-sm flex items-center gap-1.5"
                      title="Envoyer un email de test avec ce template"
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                      {testingEmailType === toggle.testKey ? 'Envoi...' : 'Tester'}
                    </motion.button>
                  )}
                  <Toggle checked={settings[toggle.key] ?? true} onChange={(v) => updateSetting(toggle.key, v)} disabled={saving} />
                </div>
              </motion.div>
        ))}
        </div>
      </div>
      ))}
      </div>

      {/* Résultat du test email */}
      <AnimatePresence>
        {testEmailResult && (
          <motion.div
            key="email-test-result"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className={`p-md rounded-xl border overflow-hidden font-body-sm ${
              testEmailResult.sent
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                : 'border-red-500/20 bg-red-500/5 text-red-500'
            }`}
          >
            {testEmailResult.sent
              ? `Email de test envoyé avec succès à ${testEmailInput.trim()}`
              : `Échec de l'envoi : ${testEmailResult.error}`}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 : RÉCAPITULATIF QUOTIDIEN & NOTIFICATIONS EMAIL */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">mail</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Emails additionnels</h4>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
          <div className="space-y-md">
            {/* Notification à chaque création de ticket par un demandeur */}
            <SettingRow
              title="Notification création de ticket"
              description="Envoie un email aux boîtes configurées dès qu'un demandeur crée un ticket (formulaire, portail, chatbot)."
              icon={Mail}
              checked={settings.ticketCreationEmailEnabled ?? false}
              onChange={(v) => updateSetting('ticketCreationEmailEnabled', v)}
              disabled={saving}
            />

            <motion.div
              variants={itemVariants}
              className="bento-card flex flex-col gap-sm p-lg"
            >
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Boîtes mail à notifier</span>
              <div className="flex items-center gap-sm">
                <input
                  type="email"
                  value={ticketCreationRecipientInput}
                  onChange={(e) => setTicketCreationRecipientInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTicketCreationRecipient();
                    }
                  }}
                  placeholder="adresse@exemple.com"
                  disabled={saving}
                  className={`${inputClass} flex-1`}
                />
                <motion.button
                  type="button"
                  onClick={addTicketCreationRecipient}
                  disabled={saving}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 shrink-0"
                >
                  Ajouter
                </motion.button>
              </div>
              {(settings.ticketCreationEmailRecipients || []).length > 0 && (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
                  className="flex flex-wrap gap-2 mt-2"
                >
                  {settings.ticketCreationEmailRecipients.map((email) => (
                    <motion.span
                      key={email}
                      variants={itemVariants}
                      layout
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container-high border border-outline-variant/60 rounded-full text-on-surface text-xs font-semibold shadow-sm"
                    >
                      {email}
                      <motion.button
                        onClick={() => removeTicketCreationRecipient(email)}
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
              {(settings.ticketCreationEmailRecipients || []).length === 0 && (
                <p className="text-xs text-on-surface-variant/70 mt-1">Aucune boîte configurée — la notification restera inactive même si le toggle est activé.</p>
              )}
            </motion.div>

            <SettingRow
              title="Récapitulatif quotidien"
              description="Envoie automatiquement un email listant tous les tickets ouverts aux adresses configurées."
              icon={Mail}
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

          <div className="space-y-md">
            {/* Notification email en cas d'échec de traitement */}
            <motion.div
              variants={itemVariants}
              className="bento-card flex flex-col gap-sm p-lg"
            >
              <div className="min-w-0 flex-1">
                <div className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">Email(s) en cas d'échec IA</div>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">
                  Adresses email notifiées quand un email entrant n'a pas pu être traité par l'IA (quota dépassé, erreur provider, etc.).
                </p>
              </div>

              <div className="flex items-center gap-sm mt-2">
                <input
                  type="email"
                  value={failureRecipientInput}
                  onChange={(e) => setFailureRecipientInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addFailureRecipient();
                    }
                  }}
                  placeholder="adresse@exemple.com"
                  disabled={saving}
                  className={`${inputClass} flex-1`}
                />
                <motion.button
                  type="button"
                  onClick={addFailureRecipient}
                  disabled={saving}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 shrink-0"
                >
                  Ajouter
                </motion.button>
              </div>

              {((settings.emailFailureNotificationRecipients && settings.emailFailureNotificationRecipients.length > 0)
                ? settings.emailFailureNotificationRecipients
                : (settings.emailFailureNotificationEmail ? [settings.emailFailureNotificationEmail] : [])).length > 0 && (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
                  className="flex flex-wrap gap-2 mt-2"
                >
                  {((settings.emailFailureNotificationRecipients && settings.emailFailureNotificationRecipients.length > 0)
                    ? settings.emailFailureNotificationRecipients
                    : (settings.emailFailureNotificationEmail ? [settings.emailFailureNotificationEmail] : [])).map((email) => (
                    <motion.span
                      key={email}
                      variants={itemVariants}
                      layout
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container-high border border-outline-variant/60 rounded-full text-on-surface text-xs font-semibold shadow-sm"
                    >
                      {email}
                      <motion.button
                        onClick={() => removeFailureRecipient(email)}
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
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 : NOTIFICATIONS LOCALES (navegateur + sons) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">notifications</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Notifications locales</h4>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
          <div className="space-y-md">
            <SettingRow
              title="Notifications navigateur"
              description="Affiche une notification bureau lors des nouveaux tickets, assignations et mises à jour."
              icon={Bell}
              checked={browserNotif}
              onChange={async (v) => {
                if (v) {
                  const perm = await requestBrowserNotifPermission();
                  if (perm !== 'granted') {
                    if (typeof window !== 'undefined' && Notification.permission === 'denied') {
                      alert('Notifications bloquées par le navigateur. Réactivez-les dans les paramètres du site.');
                      return;
                    }
                  }
                }
                setBrowserNotif(v);
                setBrowserNotifEnabled(v);
              }}
            />
            {browserNotif && typeof window !== 'undefined' && Notification.permission === 'denied' && (
              <div className="bento-card p-md flex items-start gap-3" style={{ borderLeft: '3px solid #ef4444' }}>
                <span className="material-symbols-outlined text-red-500 shrink-0" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>block</span>
                <div>
                  <p className="text-[13px] font-semibold text-on-surface">Notifications bloquées</p>
                  <p className="text-[12px] text-on-surface-variant mt-0.5">
                    Le navigateur refuse les notifications. Cliquez sur l'icône 🔒 dans la barre d'adresse et autorisez les notifications.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-md">
            <SettingRow
              title="Sons de notification"
              description="Joue des sons Apple style lors des nouveaux tickets, assignations et mises à jour."
              icon={Volume2}
              checked={soundsEnabled}
              onChange={toggleSounds}
            />
            {soundsEnabled && (
              <motion.div
                variants={itemVariants}
                whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
                className="bento-card flex items-center justify-between gap-lg p-lg"
              >
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">Volume</div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 font-medium">
                    Intensité des sons de notification.
                  </p>
                </div>
                <div className="flex items-center gap-sm">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(soundsVolume * 100)}
                    onChange={(e) => changeSoundsVolume(Number(e.target.value) / 100)}
                    className="w-24 accent-primary"
                  />
                  <span className="font-body-sm text-body-sm text-on-surface-variant font-medium w-8 text-right">{Math.round(soundsVolume * 100)}%</span>
                </div>
              </motion.div>
            )}
            <SettingRow
              title="Sons d'interaction"
              description="Petits sons à chaque clic, validation ou action utilisateur."
              icon={MousePointer2}
              checked={soundsInteraction}
              onChange={toggleInteractionSounds}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
