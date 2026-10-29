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
import { inputClass, itemVariants } from './SettingsComponents';
import AckSignatureCard from './AckSignatureCard';
import EmailTemplatesSection from './EmailTemplatesSection';

// ═══════════════════════════════════════════════════════════════════════════════
// TOGGLES EMAILS PAR TYPE
// templateKeys : clés du registre /api/email-templates — le sujet affiché est alors
// celui réellement rendu (surcharge incluse). testKey : type envoyé par
// POST /system-settings/test-email.
// ═══════════════════════════════════════════════════════════════════════════════

const EMAIL_TOGGLES = [
  { key: 'emailAcknowledgementEnabled', label: 'Accusé de réception', description: "Email automatique envoyé au demandeur lors de la création d'un ticket par email.", icon: Mail, category: 'Automatiques (pipeline email)', subjects: ['[Ticket #ID] Objet du ticket'], testKey: 'acknowledgement' },
  { key: 'emailKnownIncidentEnabled', label: 'Incident déjà connu', description: 'Notification quand un email correspond à un incident existant (le demandeur est rattaché au ticket existant).', icon: AlertTriangle, category: 'Automatiques (pipeline email)', subjects: ['[Ticket #ID] Objet du ticket'], templateKeys: ['known_incident'], testKey: 'known_incident' },
  { key: 'emailAssignmentEnabled', label: 'Assignation technicien', description: "Email envoyé au technicien quand l'IA lui attribue automatiquement un ticket.", icon: UserCheck, category: 'Automatiques (pipeline email)', subjects: ['[Ticket #ID] Nouvelle assignation — Titre du ticket'], templateKeys: ['assignment'], testKey: 'assignment' },
  { key: 'emailSlaBreachEnabled', label: 'Dépassement SLA', description: 'Alerte envoyée au technicien assigné quand le SLA de réponse est dépassé.', icon: Clock, category: 'Automatiques (schedulers)', subjects: ['[SLA] Dépassement — Ticket #ID : Titre du ticket'], templateKeys: ['sla_breach'], testKey: 'sla_breach' },
  { key: 'emailDueDateBreachEnabled', label: "Dépassement d'échéance", description: "Alerte envoyée au technicien assigné quand la date d'échéance manuelle est dépassée.", icon: Clock, category: 'Automatiques (schedulers)', subjects: ['[Échéance] Dépassement — Ticket #ID : Titre du ticket'], templateKeys: ['due_date'], testKey: 'due_date' },
  { key: 'emailStatusChangeEnabled', label: 'Changement de statut', description: 'Notification envoyée au demandeur à chaque changement de statut du ticket.', icon: RefreshCw, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Statut — Titre du ticket'], templateKeys: ['status_change'], testKey: 'status_change' },
  { key: 'emailResolvedEnabled', label: 'Résolution (différé 10 min)', description: 'Email de résolution envoyé au demandeur 10 minutes après le passage en "Résolu" (laisse un délai de correction).', icon: CheckCircle2, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Résolu — Titre du ticket'], templateKeys: ['resolved'], testKey: 'resolved' },
  { key: 'emailEscalationEnabled', label: 'Escalade', description: "Notification envoyée aux admins/techniciens et au demandeur lors d'une escalade de ticket.", icon: TrendingUp, category: 'Manuelles (actions utilisateur)', subjects: ['[Escalade Niv.1] Ticket #ID : Titre du ticket', '[Ticket #ID] Votre demande a été escaladée'], templateKeys: ['escalation', 'escalation_requester'], testKey: 'escalation' },
  { key: 'emailMajorIncidentResolvedEnabled', label: 'Résolution incident majeur', description: 'Notification envoyée aux emails des sites impactés quand un incident majeur est résolu.', icon: Shield, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Titre du ticket'], templateKeys: ['major_incident_resolved'], testKey: 'major_incident_resolved' },
  { key: 'emailApprovalEnabled', label: 'Approbation ticket', description: 'Notification envoyée au demandeur quand son ticket est approuvé par la Hotline.', icon: Send, category: 'Manuelles (actions utilisateur)', subjects: ['[Ticket #ID] Approuvé — Titre du ticket'], templateKeys: ['approval'], testKey: 'approval' },
  { key: 'needsHumanReviewNotificationEnabled', label: 'Révision humaine', description: "Email envoyé quand un email entrant nécessite une révision humaine (confiance IA faible, spam ambigu, etc.).", icon: AlertTriangle, category: 'Automatiques (pipeline email)', subjects: ['[Révision requise] Objet du mail'], templateKeys: ['needs_human_review'], testKey: 'needs_human_review' },
];

const SECTIONS = [
  { id: 'content', symbol: 'mail', title: 'Contenu des emails', desc: "Accusé de réception, signature commune et gabarits éditables envoyés aux demandeurs et aux équipes." },
  { id: 'types', symbol: 'toggle_on', title: 'Emails par type', desc: "Choisissez les emails automatiques effectivement envoyés selon leur événement déclencheur." },
  { id: 'digests', symbol: 'forward_to_inbox', title: 'Récapitulatifs & alertes', desc: 'Envois planifiés aux équipes et aux observateurs, plus les alertes internes.' },
  { id: 'local', symbol: 'notifications', title: 'Notifications locales', desc: 'Notifications de bureau et sons joués dans ce navigateur.' },
];

// ── Cartes / composants partagés de la page ─────────────────────────────────

const ACCENTS = {
  primary: 'bg-primary/10 border-primary/20 text-primary',
  violet: 'bg-violet-500/10 border-violet-500/20 text-violet-500 dark:text-violet-400',
  amber: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
};

// Panneau de réglage : en-tête (icône, titre, description, toggle facultatif) + corps.
function Panel({ symbol, icon: Icon, title, description, toggle, accent = 'primary', children }) {
  return (
    <motion.section variants={itemVariants} className="bento-card overflow-hidden flex flex-col">
      <div className="flex items-start justify-between gap-3 p-lg pb-md">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`p-2.5 rounded-xl border shrink-0 ${ACCENTS[accent]}`}>
            {symbol
              ? <span className="material-symbols-outlined text-xl">{symbol}</span>
              : Icon && <Icon className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">{title}</h3>
            {description && (
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 break-words">{description}</p>
            )}
          </div>
        </div>
        {toggle && <div className="shrink-0 pt-0.5">{toggle}</div>}
      </div>
      {children && (
        <div className="px-lg pb-lg pt-md border-t border-outline-variant/30 flex flex-col gap-sm">
          {children}
        </div>
      )}
    </motion.section>
  );
}

// Ligne « libellé + contrôle » utilisée pour les heures, jours et volumes.
function FieldRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="font-body-sm text-body-sm text-on-surface font-semibold">{label}</div>
        {hint && <p className="text-xs text-on-surface-variant mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Gestion d'une liste d'adresses : saisie + ajout (Entrée), puis pastilles supprimables.
function RecipientField({ label, values, inputValue, setInputValue, onAdd, onRemove, placeholder = 'adresse@exemple.com', disabled, emptyHint }) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">{label}</span>
      )}
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={`${inputClass} flex-1 min-w-0`}
        />
        <motion.button
          type="button"
          onClick={onAdd}
          disabled={disabled || !inputValue.trim()}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          className="px-4 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 shrink-0"
        >
          Ajouter
        </motion.button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-1">
          {values.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container-high border border-outline-variant/60 rounded-full text-on-surface text-xs font-semibold shadow-sm"
            >
              {email}
              <button
                type="button"
                onClick={() => onRemove(email)}
                disabled={disabled}
                aria-label={`Retirer ${email}`}
                className="text-on-surface-variant hover:text-error transition-colors flex items-center disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </span>
          ))}
        </div>
      ) : (
        emptyHint && <p className="text-xs text-on-surface-variant/70">{emptyHint}</p>
      )}
    </div>
  );
}

// Bandeau de résultat d'envoi (récapitulatif manuel, test de gabarit).
function ResultBanner({ tone = 'success', children }) {
  const tones = {
    success: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
    warning: 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400',
    error: 'border-red-500/20 bg-red-500/5 text-red-500',
  };
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className={`p-md rounded-xl border font-body-sm overflow-hidden ${tones[tone]}`}
    >
      {children}
    </motion.div>
  );
}

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

  // ── Notification révision humaine ──
  const [needsReviewRecipientInput, setNeedsReviewRecipientInput] = useState('');

  // ── Sons & notifications navigateur ──
  const [soundsEnabled, setSoundsEnabledState] = useState(isSoundsEnabled());
  const [soundsVolume, setSoundsVolumeState] = useState(getSoundsVolume());
  const [soundsInteraction, setSoundsInteractionState] = useState(isSoundsInteractionEnabled());
  const [browserNotif, setBrowserNotif] = useState(isBrowserNotifEnabled());

  // ── Test email ──
  const [testEmailInput, setTestEmailInput] = useState('');
  const [testingEmailType, setTestingEmailType] = useState(null);
  const [testEmailResult, setTestEmailResult] = useState(null);

  // ── Gabarits éditables (Contenu des emails) ──
  const [templates, setTemplates] = useState(null);

  // ── Section affichée dans la sous-navigation ──
  const [activeSection, setActiveSection] = useState('content');

  function loadTemplates() {
    return api.get('/email-templates')
      .then(({ data }) => setTemplates(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement des gabarits'));
  }

  useEffect(() => {
    api.get('/system-settings').then(({ data }) => setSettings(data)).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    loadTemplates();
  }, []);

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
    const current = failureRecipients;
    if (!current.includes(value)) {
      updateSetting('emailFailureNotificationRecipients', [...current, value]);
    }
    setFailureRecipientInput('');
  }

  function removeFailureRecipient(email) {
    updateSetting('emailFailureNotificationRecipients', failureRecipients.filter((e) => e !== email));
  }

  // ── Notification révision humaine ──
  function addNeedsReviewRecipient() {
    const value = needsReviewRecipientInput.trim();
    if (!value) return;
    const current = settings.needsHumanReviewRecipients || [];
    if (!current.includes(value)) {
      updateSetting('needsHumanReviewRecipients', [...current, value]);
    }
    setNeedsReviewRecipientInput('');
  }

  function removeNeedsReviewRecipient(email) {
    updateSetting('needsHumanReviewRecipients', (settings.needsHumanReviewRecipients || []).filter((e) => e !== email));
  }

  async function testDailySummary() {
    setTestingSummary(true);
    setSummaryTestResult(null);
    try {
      const { data } = await api.post('/system-settings/daily-summary/test');
      setSummaryTestResult(data);
    } catch (err) {
      console.error('Erreur test récap:', err);
      setSummaryTestResult({ sent: false, reason: err.response?.data?.error || "Erreur lors de l'envoi" });
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

  // Sujets affichés sur chaque toggle : ceux réellement rendus par le backend (surcharge
  // incluse) quand des gabarits existent, sinon l'exemple statique par défaut.
  function subjectsForToggle(toggle) {
    if (!templates || !toggle.templateKeys?.length) return toggle.subjects;
    const items = toggle.templateKeys.map((k) => templates.find((t) => t.key === k)).filter(Boolean);
    if (items.length === 0) return toggle.subjects;
    return items
      .map((t) => t.previewSubject || t.defaultSubject || (t.subjectExamples || [])[0])
      .filter(Boolean);
  }

  const failureRecipients = settings.emailFailureNotificationRecipients && settings.emailFailureNotificationRecipients.length > 0
    ? settings.emailFailureNotificationRecipients
    : (settings.emailFailureNotificationEmail ? [settings.emailFailureNotificationEmail] : []);

  // Compteurs affichés dans la sous-navigation (état réel des réglages).
  const enabledCount = EMAIL_TOGGLES.filter((t) => settings[t.key] ?? true).length;
  const activeAdditional = [
    settings.ticketCreationEmailEnabled,
    settings.needsHumanReviewNotificationEnabled,
    settings.dailySummaryEnabled,
    settings.observerSummaryEnabled,
  ].filter(Boolean).length + (failureRecipients.length > 0 ? 1 : 0);
  const activeLocal = [browserNotif, soundsEnabled].filter(Boolean).length;

  const sectionStats = {
    content: templates ? `${templates.length} gabarits` : '…',
    types: `${enabledCount}/${EMAIL_TOGGLES.length} actifs`,
    digests: `${activeAdditional}/5 rubriques`,
    local: `${activeLocal}/2 actives`,
  };

  const active = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];

  // Bandeau d'erreur commun.
  const errorBanner = (
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
  );

  return (
    <div className="flex flex-col lg:flex-row gap-lg items-start">
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SOUS-NAVIGATION (colonne collante sur desktop, pastilles sur mobile) */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <nav className="w-full lg:w-72 shrink-0 lg:sticky lg:top-6">
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-1.5 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => {
            const isActive = s.id === activeSection;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all border shrink-0 lg:shrink lg:w-full ${
                  isActive
                    ? 'bg-primary/10 border-primary/25 text-primary'
                    : 'border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                }`}
              >
                <span className={`material-symbols-outlined text-lg shrink-0 ${isActive ? '' : 'opacity-70'}`}>{s.symbol}</span>
                <span className="min-w-0 flex-1 flex flex-col">
                  <span className="text-[13px] font-semibold leading-tight whitespace-nowrap lg:whitespace-normal">{s.title}</span>
                  <span
                    className={`hidden lg:block text-[10px] font-semibold mt-0.5 ${
                      isActive ? 'text-primary/80' : 'text-on-surface-variant/70'
                    }`}
                  >
                    {sectionStats[s.id]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="hidden lg:flex items-center gap-2 px-3 pt-3 text-[11px] text-on-surface-variant/70">
          <AnimatePresence mode="wait">
            {saving ? (
              <motion.span
                key="saving"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-primary font-semibold"
              >
                <RefreshCw className="w-3 h-3 animate-spin" />
                Enregistrement…
              </motion.span>
            ) : (
              <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Chaque modification est enregistrée automatiquement.
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CONTENU DE LA SECTION ACTIVE                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-w-0 w-full space-y-md">
        {errorBanner}

        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
            <span className="material-symbols-outlined text-xl">{active.symbol}</span>
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-on-surface">{active.title}</h2>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{active.desc}</p>
          </div>
        </div>

        {/* Racine d'animation locale : les cartes (AckSignatureCard, EmailTemplatesSection,
            Panel...) portent des `variants` sans initial/animate et héritent donc du parent le
            plus proche. Sans cette racine, l'AnimatePresence de la page Paramètres leur transmet
            un état « hidden » qu'elles ne quittent jamais et tout reste invisible (opacity 0).
            Même rôle que la racine de SectionModal. Pas d'AnimatePresence ici : imbriqué dans
            celui de la page Paramètres (mode « wait »), il bloquait la commutation de section. */}
        <motion.div
          key={activeSection}
          initial={false}
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
          className="space-y-md"
        >
            {/* ── 1. CONTENU DES EMAILS : accusé, signature, gabarits ── */}
            {activeSection === 'content' && (
              <>
                <AckSignatureCard
                  settings={settings}
                  updateSetting={updateSetting}
                  saving={saving}
                  setError={setError}
                  onSettingsUpdated={setSettings}
                />

                <div className="bento-card p-lg flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 shrink-0">
                    <FlaskConical className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-on-surface">Adresse de test</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 min-w-0">
                    <input
                      type="email"
                      value={testEmailInput}
                      onChange={(e) => setTestEmailInput(e.target.value)}
                      placeholder="email@exemple.com"
                      className={`${inputClass} flex-1 min-w-0`}
                    />
                    <span className="text-xs text-on-surface-variant/70 shrink-0">
                      Puis « Tester » à droite du gabarit voulu.
                    </span>
                  </div>
                </div>

                <EmailTemplatesSection
                  templates={templates}
                  settings={settings}
                  testEmailInput={testEmailInput}
                  reloadTemplates={loadTemplates}
                  setError={setError}
                />
              </>
            )}

            {/* ── 2. EMAILS PAR TYPE ── */}
            {activeSection === 'types' && (
              <div className="space-y-lg">
                {categories.map((category) => (
                  <div key={category} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 px-1">
                        {category}
                      </h3>
                      <div className="flex-1 h-px bg-outline-variant/30" />
                      <span className="text-[11px] font-semibold text-on-surface-variant/60">
                        {EMAIL_TOGGLES.filter((t) => t.category === category && (settings[t.key] ?? true)).length}
                        {' / '}
                        {EMAIL_TOGGLES.filter((t) => t.category === category).length} actifs
                      </span>
                    </div>
                    <div className="space-y-2">
                      {EMAIL_TOGGLES.filter((t) => t.category === category).map((toggle) => (
                        <div
                          key={toggle.key}
                          className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-lg p-lg"
                        >
                          <div className="min-w-0 flex-1 flex items-start gap-4">
                            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
                              <toggle.icon className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-headline-sm text-headline-sm text-on-surface font-semibold break-words">{toggle.label}</div>
                              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">{toggle.description}</p>
                              {toggle.subjects && (
                                <div className="mt-2 space-y-1">
                                  {subjectsForToggle(toggle).map((subject, i) => (
                                    <div key={i} className="flex items-start gap-1.5 text-xs text-on-surface-variant/70 font-mono">
                                      <Mail className="w-3 h-3 shrink-0 mt-0.5 opacity-60" />
                                      <span className="break-all">{subject}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {toggle.testKey && (
                              <button
                                type="button"
                                onClick={() => testEmailTemplate(toggle.testKey)}
                                disabled={testingEmailType !== null || !testEmailInput.trim()}
                                className="px-3 py-1.5 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-xs transition-all disabled:opacity-50 shrink-0 shadow-sm flex items-center gap-1.5"
                                title="Envoyer un email de test avec ce template"
                              >
                                <FlaskConical className="w-3.5 h-3.5" />
                                {testingEmailType === toggle.testKey ? 'Envoi...' : 'Tester'}
                              </button>
                            )}
                            <Toggle checked={settings[toggle.key] ?? true} onChange={(v) => updateSetting(toggle.key, v)} disabled={saving} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <AnimatePresence>
                  {testEmailResult && (
                    <ResultBanner key="email-test-result" tone={testEmailResult.sent ? 'success' : 'error'}>
                      {testEmailResult.sent
                        ? `Email de test envoyé avec succès à ${testEmailInput.trim()}`
                        : `Échec de l'envoi : ${testEmailResult.error}`}
                    </ResultBanner>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* ── 3. RÉCAPITULATIFS & ALERTES ── */}
            {activeSection === 'digests' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg items-start">
                {/* Récapitulatif quotidien */}
                <Panel
                  symbol="mail"
                  title="Récapitulatif quotidien"
                  description="Liste de tous les tickets ouverts, envoyée aux adresses ci-dessous et aux emails de groupe des équipes."
                  toggle={
                    <Toggle
                      checked={settings.dailySummaryEnabled}
                      onChange={(v) => updateSetting('dailySummaryEnabled', v)}
                      disabled={saving}
                      label="Activer le récapitulatif quotidien"
                    />
                  }
                >
                  <FieldRow label="Heure d'envoi" hint="Heure locale du serveur.">
                    <input
                      type="time"
                      value={settings.dailySummaryTime}
                      onChange={(e) => updateSetting('dailySummaryTime', e.target.value)}
                      disabled={saving || !settings.dailySummaryEnabled}
                      className={`${inputClass} disabled:opacity-50`}
                    />
                  </FieldRow>
                  <RecipientField
                    label="Destinataires"
                    values={settings.dailySummaryRecipients || []}
                    inputValue={summaryRecipientInput}
                    setInputValue={setSummaryRecipientInput}
                    onAdd={addSummaryRecipient}
                    onRemove={removeSummaryRecipient}
                    disabled={saving}
                    emptyHint="Aucune adresse — seuls les emails de groupe des équipes seront utilisés."
                  />
                  <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
                    <p className="text-xs text-on-surface-variant flex-1 min-w-[12rem]">
                      Déclenche l'envoi immédiatement, sans attendre l'heure configurée.
                    </p>
                    <button
                      type="button"
                      onClick={testDailySummary}
                      disabled={testingSummary}
                      className="px-4 py-2 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 shrink-0 shadow-sm flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      {testingSummary ? 'Envoi...' : 'Envoyer maintenant'}
                    </button>
                  </div>
                  <AnimatePresence>
                    {summaryTestResult && (
                      <ResultBanner key="summary-test-result" tone={summaryTestResult.sent ? 'success' : 'warning'}>
                        {summaryTestResult.sent
                          ? `Envoyé avec succès : ${summaryTestResult.ticketCount} ticket(s) à ${summaryTestResult.recipientCount} destinataire(s).`
                          : `Rien n'a été envoyé : ${summaryTestResult.reason}`}
                      </ResultBanner>
                    )}
                  </AnimatePresence>
                </Panel>

                {/* Récapitulatif observateurs */}
                <Panel
                  symbol="visibility"
                  accent="violet"
                  title="Récapitulatif observateurs"
                  description="Un email personnalisé par observateur, listant uniquement les tickets ouverts qu'il suit."
                  toggle={
                    <Toggle
                      checked={settings.observerSummaryEnabled}
                      onChange={(v) => updateSetting('observerSummaryEnabled', v)}
                      disabled={saving}
                      label="Activer le récapitulatif observateurs"
                    />
                  }
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
                    <FieldRow label="Jour d'envoi">
                      <select
                        value={settings.observerSummaryDay ?? 1}
                        onChange={(e) => updateSetting('observerSummaryDay', Number(e.target.value))}
                        disabled={saving || !settings.observerSummaryEnabled}
                        className={`${inputClass} disabled:opacity-50`}
                      >
                        <option value={0}>Dimanche</option>
                        <option value={1}>Lundi</option>
                        <option value={2}>Mardi</option>
                        <option value={3}>Mercredi</option>
                        <option value={4}>Jeudi</option>
                        <option value={5}>Vendredi</option>
                        <option value={6}>Samedi</option>
                      </select>
                    </FieldRow>
                    <FieldRow label="Heure d'envoi">
                      <input
                        type="time"
                        value={settings.observerSummaryTime || '09:00'}
                        onChange={(e) => updateSetting('observerSummaryTime', e.target.value)}
                        disabled={saving || !settings.observerSummaryEnabled}
                        className={`${inputClass} disabled:opacity-50`}
                      />
                    </FieldRow>
                  </div>
                  <p className="text-xs text-on-surface-variant/70">
                    Heure locale du serveur. Les observateurs sans adresse email sur leur compte sont ignorés.
                  </p>
                </Panel>

                {/* Notification création de ticket */}
                <Panel
                  icon={Mail}
                  title="Notification création de ticket"
                  description="Prévient les boîtes configurées dès qu'un demandeur crée un ticket (formulaire, portail, chatbot)."
                  toggle={
                    <Toggle
                      checked={settings.ticketCreationEmailEnabled ?? false}
                      onChange={(v) => updateSetting('ticketCreationEmailEnabled', v)}
                      disabled={saving}
                      label="Activer la notification de création de ticket"
                    />
                  }
                >
                  <RecipientField
                    values={settings.ticketCreationEmailRecipients || []}
                    inputValue={ticketCreationRecipientInput}
                    setInputValue={setTicketCreationRecipientInput}
                    onAdd={addTicketCreationRecipient}
                    onRemove={removeTicketCreationRecipient}
                    disabled={saving}
                    emptyHint="Aucune boîte configurée — la notification reste inactive même si le toggle est activé."
                  />
                </Panel>

                {/* Notification révision humaine */}
                <Panel
                  icon={AlertTriangle}
                  title="Notification révision humaine"
                  description="Prévient les boîtes configurées quand un email entrant nécessite une révision humaine (confiance IA faible, spam ambigu…)."
                  toggle={
                    <Toggle
                      checked={settings.needsHumanReviewNotificationEnabled ?? true}
                      onChange={(v) => updateSetting('needsHumanReviewNotificationEnabled', v)}
                      disabled={saving}
                      label="Activer la notification de révision humaine"
                    />
                  }
                >
                  <RecipientField
                    values={settings.needsHumanReviewRecipients || []}
                    inputValue={needsReviewRecipientInput}
                    setInputValue={setNeedsReviewRecipientInput}
                    onAdd={addNeedsReviewRecipient}
                    onRemove={removeNeedsReviewRecipient}
                    disabled={saving}
                    emptyHint="Aucune boîte configurée — la notification reste inactive même si le toggle est activé."
                  />
                </Panel>

                {/* Échec de traitement IA */}
                <Panel
                  icon={AlertTriangle}
                  accent="amber"
                  title="Alerte échec IA"
                  description="Adresses notifiées quand un email entrant n'a pas pu être traité par l'IA (quota dépassé, erreur provider…)."
                >
                  <RecipientField
                    values={failureRecipients}
                    inputValue={failureRecipientInput}
                    setInputValue={setFailureRecipientInput}
                    onAdd={addFailureRecipient}
                    onRemove={removeFailureRecipient}
                    disabled={saving}
                    emptyHint="Aucune adresse — aucun mail ne partira en cas d'échec."
                  />
                </Panel>
              </div>
            )}

            {/* ── 4. NOTIFICATIONS LOCALES ── */}
            {activeSection === 'local' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-lg items-start">
                <div className="space-y-md">
                  <Panel
                    icon={Bell}
                    title="Notifications navigateur"
                    description="Affiche une notification de bureau lors des nouveaux tickets, assignations et mises à jour."
                    toggle={
                      <Toggle
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
                        label="Activer les notifications navigateur"
                      />
                    }
                  >
                    {browserNotif && typeof window !== 'undefined' && Notification.permission === 'denied' && (
                      <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-md">
                        <span className="material-symbols-outlined text-red-500 shrink-0 text-xl">block</span>
                        <div>
                          <p className="text-[13px] font-semibold text-on-surface">Notifications bloquées</p>
                          <p className="text-[12px] text-on-surface-variant mt-0.5">
                            Le navigateur refuse les notifications. Cliquez sur l'icône 🔒 dans la barre d'adresse et autorisez-les.
                          </p>
                        </div>
                      </div>
                    )}
                  </Panel>

                  <Panel
                    icon={Volume2}
                    title="Sons de notification"
                    description="Joue des sons lors des nouveaux tickets, assignations et mises à jour."
                    toggle={
                      <Toggle checked={soundsEnabled} onChange={toggleSounds} label="Activer les sons de notification" />
                    }
                  >
                    <FieldRow label="Volume" hint="Intensité des sons de notification.">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(soundsVolume * 100)}
                          onChange={(e) => changeSoundsVolume(Number(e.target.value) / 100)}
                          disabled={!soundsEnabled}
                          className="w-24 accent-primary disabled:opacity-40"
                        />
                        <span className="font-body-sm text-body-sm text-on-surface-variant font-medium w-8 text-right">
                          {Math.round(soundsVolume * 100)}%
                        </span>
                      </div>
                    </FieldRow>
                  </Panel>
                </div>

                <Panel
                  icon={MousePointer2}
                  title="Sons d'interaction"
                  description="Petits sons à chaque clic, validation ou action utilisateur."
                  toggle={
                    <Toggle checked={soundsInteraction} onChange={toggleInteractionSounds} label="Activer les sons d'interaction" />
                  }
                >
                  <p className="text-xs text-on-surface-variant/70">
                    Réglage propre à ce navigateur : il n'affecte pas les autres utilisateurs.
                  </p>
                </Panel>
              </div>
            )}
        </motion.div>
      </div>
    </div>
  );
}
