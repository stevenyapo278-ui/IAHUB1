import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';

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

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export default function AdvancedTab() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [backendUrlDraft, setBackendUrlDraft] = useState('');
  const [frontendUrlDraft, setFrontendUrlDraft] = useState('');
  const [effectiveServerUrls, setEffectiveServerUrls] = useState(null);
  const [schedulerHealth, setSchedulerHealth] = useState(null);

  function load() {
    api.get('/advanced-settings').then(({ data }) => {
      setSettings(data);
    }).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/advanced-settings/server-urls/effective').then(({ data }) => setEffectiveServerUrls(data)).catch(() => {});
    api.get('/advanced-settings/scheduler-health').then(({ data }) => setSchedulerHealth(data)).catch(() => {});
  }

  useEffect(load, []);
  useEffect(() => {
    if (!settings || !effectiveServerUrls) return;
    setBackendUrlDraft(settings.backendUrl || effectiveServerUrls.backendHost || '');
    setFrontendUrlDraft(settings.frontendUrl || effectiveServerUrls.frontendHost || '');
  }, [settings, effectiveServerUrls]);
  useEffect(() => {
    const intervalId = setInterval(() => {
      api.get('/advanced-settings/scheduler-health').then(({ data }) => setSchedulerHealth(data)).catch(() => {});
    }, 30000);
    return () => clearInterval(intervalId);
  }, []);

  async function updateSetting(key, value) {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/advanced-settings', { [key]: value });
      setSettings(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  }

  async function saveServerUrls() {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/advanced-settings', {
        backendUrl: backendUrlDraft.trim() || null,
        frontendUrl: frontendUrlDraft.trim() || null,
      });
      setSettings(data);
      setBackendUrlDraft(data.backendUrl || '');
      setFrontendUrlDraft(data.frontendUrl || '');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
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

  const isUrlsChanged = backendUrlDraft !== (settings.backendUrl || effectiveServerUrls?.backendHost || '') ||
                        frontendUrlDraft !== (settings.frontendUrl || effectiveServerUrls?.frontendHost || '');

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
            key="advanced-error"
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

      {/* Scheduler health alert banner */}
      <AnimatePresence>
        {schedulerHealth && schedulerHealth.some((s) => s.consecutiveFailures >= 3) && (
          <motion.div
            key="scheduler-health-alert"
            initial={{ opacity: 0, height: 0, scale: 0.95 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22 }}
            className="bento-card p-lg flex items-start gap-md border border-red-500/20 bg-red-500/5 shadow-lg shadow-red-500/5"
          >
            <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10 text-red-500 shrink-0">
              <span className="absolute w-10 h-10 rounded-full bg-red-500/10 animate-ping"></span>
              <span className="material-symbols-outlined text-2xl font-bold">sync_problem</span>
            </div>
            <div className="flex-1 space-y-2">
              <div className="font-headline-sm text-headline-sm font-bold text-red-600 dark:text-red-400">
                Tâches automatiques en panne
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Certains services planifiés en arrière-plan rencontrent des échecs consécutifs critiques. Veuillez vérifier les configurations associées.
              </p>
              <ul className="font-body-sm text-body-sm list-none space-y-2 pt-1">
                {schedulerHealth.filter((s) => s.consecutiveFailures >= 3).map((s) => (
                  <li key={s.id} className="flex gap-2 items-start bg-surface/40 p-2.5 rounded-xl border border-red-500/10">
                    <span className="material-symbols-outlined text-[16px] text-red-500 mt-[3px]">error</span>
                    <span className="text-on-surface">
                      <strong className="font-semibold">{s.name}</strong> — {s.consecutiveFailures} échecs consécutifs : 
                      <code className="block bg-surface-container-high px-2 py-1.5 rounded-lg font-mono text-[11px] text-red-500 mt-1 max-w-full overflow-x-auto whitespace-pre-wrap">
                        {s.lastError}
                      </code>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 : DECISIONS AUTOMATIQUES */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">auto_mode</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Décisions & Actions Automatiques</h4>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
          <SettingRow
            title="Auto-envoi des emails IA"
            description="Envoie directement les emails générés par l'IA (accusés de réception, etc.) sans passer par la validation humaine."
            checked={settings.autoSendAiEmails}
            onChange={(v) => updateSetting('autoSendAiEmails', v)}
            disabled={saving}
          />

          <SettingRow
            title="Auto-approbation GLPI"
            description="Approuve automatiquement la solution de l'ERP dès qu'un technicien ferme/résout le ticket dans GLPI."
            checked={settings.autoApproveGlpiSolutions}
            onChange={(v) => updateSetting('autoApproveGlpiSolutions', v)}
            disabled={saving}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 : CONFIGURATION RESEAU & SERVEUR */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">dns</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Configuration Réseau & Serveur</h4>
        </div>

        <motion.div variants={itemVariants} className="bento-card p-lg space-y-md">
          <div className="bento-card-header px-0 py-0 pb-md border-b border-outline-variant/40">
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Adresses absolues du serveur</h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Adresses utilisées pour générer les liens absolus envoyés dans les e-mails (validation de brouillon, mots de passe, etc.). 
              Indiquez l'IP ou le nom de domaine sans <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">http://</code> ni port.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Adresse de l'API backend</span>
              <motion.input
                whileFocus={{ scale: 1.01 }}
                type="text"
                placeholder="192.168.1.10"
                value={backendUrlDraft}
                onChange={(e) => setBackendUrlDraft(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Adresse du site (frontend)</span>
              <motion.input
                whileFocus={{ scale: 1.01 }}
                type="text"
                placeholder="192.168.1.10"
                value={frontendUrlDraft}
                onChange={(e) => setFrontendUrlDraft(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <motion.div variants={itemVariants} className="flex justify-end pt-sm border-t border-outline-variant/40">
            <motion.button
              onClick={saveServerUrls}
              disabled={saving || !isUrlsChanged}
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
      {/* SECTION 3 : FREQUENCES DE SYNCHRONISATION */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">sync</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Fréquences de synchronisation</h4>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
          <IntervalRow
            title="Tickets GLPI"
            description="Fréquence d'import des tickets, pièces jointes et approbations depuis GLPI."
            value={settings.glpiTicketsSyncIntervalSeconds}
            onChange={(v) => updateSetting('glpiTicketsSyncIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />

          <IntervalRow
            title="Mails entrants"
            description="Fréquence de relevé des emails via les comptes Outlook/IMAP connectés."
            value={settings.emailSyncIntervalSeconds}
            onChange={(v) => updateSetting('emailSyncIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />

          <IntervalRow
            title="Groupes & Catégories GLPI"
            description="Fréquence de synchronisation de la structure organisationnelle GLPI."
            value={settings.glpiTeamsCategoriesSyncIntervalMinutes}
            onChange={(v) => updateSetting('glpiTeamsCategoriesSyncIntervalMinutes', v)}
            disabled={saving}
            max={1440}
            unit="minutes"
          />

          <IntervalRow
            title="Modèles IA disponibles"
            description="Fréquence de détection des modèles actifs chez les fournisseurs configurés."
            value={settings.aiModelsSyncIntervalHours}
            onChange={(v) => updateSetting('aiModelsSyncIntervalHours', v)}
            disabled={saving}
            max={168}
            unit="heures"
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4 : REGLES DE TRIAGE AUTOMATIQUE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <TriageRulesSection saving={saving} setSaving={setSaving} setError={setError} />
    </motion.div>
  );
}

function TriageRulesSection({ saving, setSaving, setError }) {
  const [rules, setRules] = useState([]);
  const [skills, setSkills] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [label, setLabel] = useState('');
  const [matchField, setMatchField] = useState('subject_or_body');
  const [matchType, setMatchType] = useState('contains');
  const [matchValue, setMatchValue] = useState('');
  const [category, setCategory] = useState('');
  const [skillName, setSkillName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [ticketPriority, setTicketPriority] = useState('P3');
  const [isSpam, setIsSpam] = useState(false);
  const [priority, setPriority] = useState(0);

  const categories = ['Logiciel', 'Matériel', 'Réseau', 'Téléphonie', 'Système'];

  function loadData() {
    setLoading(true);
    Promise.all([
      api.get('/triage-rules'),
      api.get('/skills'),
      api.get('/teams')
    ])
      .then(([{ data: rulesData }, { data: skillsData }, { data: teamsData }]) => {
        setRules(rulesData);
        setSkills(skillsData);
        setTeams(teamsData);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Erreur lors du chargement des règles de triage');
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadData, [setError]);

  function resetForm() {
    setLabel('');
    setMatchField('subject_or_body');
    setMatchType('contains');
    setMatchValue('');
    setCategory('');
    setSkillName('');
    setTeamName('');
    setTicketPriority('P3');
    setIsSpam(false);
    setPriority(0);
    setEditingRuleId(null);
    setShowForm(false);
  }

  function handleEdit(rule) {
    setEditingRuleId(rule.id);
    setLabel(rule.label || '');
    setMatchField(rule.matchField || 'subject_or_body');
    setMatchType(rule.matchType || 'contains');
    setMatchValue(rule.matchValue || '');
    setCategory(rule.category || '');
    setSkillName(rule.skillName || '');
    setTeamName(rule.teamName || '');
    setTicketPriority(rule.ticketPriority || 'P3');
    setIsSpam(rule.isSpam || false);
    setPriority(rule.priority || 0);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      label,
      matchField,
      matchType,
      matchValue,
      category: isSpam ? null : category || null,
      skillName: isSpam ? null : skillName || null,
      teamName: isSpam ? null : teamName || null,
      ticketPriority: isSpam ? null : ticketPriority,
      isSpam,
      priority: Number(priority) || 0
    };

    try {
      if (editingRuleId) {
        await api.put(`/triage-rules/${editingRuleId}`, payload);
      } else {
        await api.post('/triage-rules', payload);
      }
      resetForm();
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de sauvegarde de la règle');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Voulez-vous vraiment supprimer cette règle ?')) return;
    setSaving(true);
    setError('');
    try {
      await api.delete(`/triage-rules/${id}`);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id) {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/triage-rules/${id}/toggle`);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du changement de statut');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-md">
      <div className="flex items-center justify-between border-b border-outline-variant/40 pb-sm">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-2xl">rule</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Règles de triage automatique</h4>
        </div>
        <motion.button
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 font-semibold rounded-xl flex items-center gap-2 text-body-sm transition-all duration-300"
        >
          <span className="material-symbols-outlined text-md">{showForm ? 'close' : 'add'}</span>
          {showForm ? 'Fermer' : 'Ajouter une règle'}
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        {showForm && (
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, height: 0, y: -10 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -10 }}
            className="bento-card p-lg space-y-md overflow-hidden"
          >
            <div className="font-headline-sm text-headline-sm font-semibold text-on-surface pb-sm border-b border-outline-variant/30">
              {editingRuleId ? 'Modifier la règle de triage' : 'Nouvelle règle de triage'}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
              <label className="flex flex-col gap-xs lg:col-span-2">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Description / Libellé de la règle</span>
                <input
                  type="text"
                  required
                  placeholder="Ex: Triage automatique pour les demandes de ports USB"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Priorité d'évaluation (ordre)</span>
                <input
                  type="number"
                  placeholder="0"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Champ cible</span>
                <select
                  value={matchField}
                  onChange={(e) => setMatchField(e.target.value)}
                  className={inputClass}
                >
                  <option value="subject_or_body">Sujet ou Corps</option>
                  <option value="subject">Sujet uniquement</option>
                  <option value="body">Corps uniquement</option>
                  <option value="from">Adresse expéditeur (De)</option>
                </select>
              </label>

              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Type de comparaison</span>
                <select
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value)}
                  className={inputClass}
                >
                  <option value="contains">Contient</option>
                  <option value="equals">Est égal à</option>
                  <option value="starts_with">Commence par</option>
                  <option value="regex">Expression régulière (Regex)</option>
                </select>
              </label>

              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Valeur recherchée</span>
                <input
                  type="text"
                  required
                  placeholder="Ex: PORT USB"
                  value={matchValue}
                  onChange={(e) => setMatchValue(e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>

            <div className="flex items-center gap-lg py-md border-t border-b border-outline-variant/30">
              <div className="flex items-center gap-md">
                <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">Cette règle filtre du spam ?</span>
                <Toggle checked={isSpam} onChange={setIsSpam} />
              </div>
            </div>

            {!isSpam && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md pt-xs"
              >
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Catégorie ITSM</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Aucune</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Compétence cible</span>
                  <select
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Aucune</option>
                    {skills.map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Équipe affectée</span>
                  <select
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Aucune</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Priorité ticket</span>
                  <select
                    value={ticketPriority}
                    onChange={(e) => setTicketPriority(e.target.value)}
                    className={inputClass}
                  >
                    <option value="P1">P1 (Critique)</option>
                    <option value="P2">P2 (Majeur)</option>
                    <option value="P3">P3 (Moyen)</option>
                    <option value="P4">P4 (Faible)</option>
                  </select>
                </label>
              </motion.div>
            )}

            <div className="flex justify-end gap-sm pt-sm border-t border-outline-variant/30">
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                className="px-4 py-2 border border-outline-variant text-on-surface font-semibold rounded-xl text-body-sm hover:bg-surface-container-high transition-all"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 btn-gradient text-white font-semibold rounded-xl shadow-md text-body-sm hover:shadow-lg transition-all"
              >
                {saving ? 'Enregistrement...' : 'Sauvegarder'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="bento-card overflow-hidden">
        {loading ? (
          <p className="p-lg font-body-sm text-body-sm text-on-surface-variant text-center">Chargement des règles...</p>
        ) : rules.length === 0 ? (
          <p className="p-lg font-body-sm text-body-sm text-on-surface-variant text-center">Aucune règle configurée. Les emails entrants passeront tous par le modèle d'IA.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-body-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-lowest text-on-surface-variant uppercase tracking-wider font-semibold text-[10px]">
                  <th className="p-4">Priorité</th>
                  <th className="p-4">Description</th>
                  <th className="p-4">Condition</th>
                  <th className="p-4">Actions / Triage</th>
                  <th className="p-4 text-center">Active</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="p-4 font-bold text-primary">{rule.priority}</td>
                    <td className="p-4 font-semibold text-on-surface">
                      {rule.label}
                    </td>
                    <td className="p-4 text-on-surface-variant">
                      <span className="bg-surface-container-high px-2 py-1 rounded text-[11px] font-mono mr-1.5">
                        {rule.matchField === 'subject_or_body' && 'Sujet/Corps'}
                        {rule.matchField === 'subject' && 'Sujet'}
                        {rule.matchField === 'body' && 'Corps'}
                        {rule.matchField === 'from' && 'De'}
                      </span>
                      <span className="text-[11px] italic mr-1.5">
                        {rule.matchType === 'contains' && 'contient'}
                        {rule.matchType === 'equals' && 'égal à'}
                        {rule.matchType === 'starts_with' && 'commence par'}
                        {rule.matchType === 'regex' && 'match regex'}
                      </span>
                      <strong className="text-on-surface font-semibold">"{rule.matchValue}"</strong>
                    </td>
                    <td className="p-4">
                      {rule.isSpam ? (
                        <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-500 font-bold text-[10px] px-2 py-0.5 rounded-full uppercase">
                          <span className="material-symbols-outlined text-[12px]">block</span> SPAM
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {rule.category && (
                            <span className="bg-primary/10 text-primary text-[10px] px-2 py-0.5 rounded-full font-semibold">
                              Catégorie: {rule.category}
                            </span>
                          )}
                          {rule.skillName && (
                            <span className="bg-green-500/10 text-green-600 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                              Skill: {rule.skillName}
                            </span>
                          )}
                          {rule.teamName && (
                            <span className="bg-orange-500/10 text-orange-600 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                              Team: {rule.teamName}
                            </span>
                          )}
                          {rule.ticketPriority && (
                            <span className="bg-surface-container-high text-on-surface text-[10px] px-2 py-0.5 rounded-full font-bold">
                              {rule.ticketPriority}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <Toggle checked={rule.isActive} onChange={() => handleToggle(rule.id)} disabled={saving} />
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-xs">
                        <button
                          onClick={() => handleEdit(rule)}
                          className="w-8 h-8 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center"
                          title="Modifier"
                        >
                          <span className="material-symbols-outlined text-lg">edit</span>
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          className="w-8 h-8 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-red-500 transition-colors flex items-center justify-center"
                          title="Supprimer"
                        >
                          <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

