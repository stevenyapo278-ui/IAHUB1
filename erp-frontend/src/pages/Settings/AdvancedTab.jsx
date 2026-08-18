import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog';

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

  const [glpiInstances, setGlpiInstances] = useState([]);

  function load() {
    api.get('/advanced-settings').then(({ data }) => {
      setSettings(data);
    }).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/advanced-settings/server-urls/effective').then(({ data }) => setEffectiveServerUrls(data)).catch(() => {});
    api.get('/advanced-settings/scheduler-health').then(({ data }) => setSchedulerHealth(data)).catch(() => {});
    api.get('/api-configs').then(({ data }) => {
      setGlpiInstances(data.filter((c) => c.serviceName?.startsWith('glpi')));
    }).catch(() => {});
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

        <p className="text-xs text-on-surface-variant leading-relaxed max-w-2xl">
          Ces options définissent ce que la plateforme peut faire sans intervention humaine. 
          Activées, elles accélèrent le traitement mais réduisent le contrôle. 
          Désactivées, les actions correspondantes passent par le <strong>Centre de Validation</strong>.
        </p>

        {/* Mode autonome : la plateforme fonctionne comme e-ticketing sans GLPI */}
        <SettingRow
          title="Mode autonome (sans GLPI)"
          description="Utilise la plateforme comme outil d'e-ticketing complet, sans dépendre de GLPI. Toutes les synchronisations et écritures GLPI sont désactivées ; les catégories se gèrent localement (page Catégories). Réactivable à tout moment."
          checked={settings.autonomousMode === true}
          onChange={(v) => updateSetting('autonomousMode', v)}
          disabled={saving}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-md">
          <SettingRow
            title="Auto-envoi des emails IA"
            description="Expédie automatiquement les accusés de réception et réponses IA sans validation humaine."
            checked={settings.autoSendAiEmails}
            onChange={(v) => updateSetting('autoSendAiEmails', v)}
            disabled={saving}
          />

          <SettingRow
            title="Auto-approbation des tickets manuels"
            description="Approuve automatiquement les tickets créés manuellement (formulaire interne, portail) sans passage par le Centre de Validation. Les tickets créés par email/IA restent soumis à validation Hotline."
            checked={settings.autoApproveManualTickets === true}
            onChange={(v) => updateSetting('autoApproveManualTickets', v)}
            disabled={saving}
          />

          {settings.autonomousMode !== true && (
            <>
              <SettingRow
                title="Auto-approbation GLPI"
                description="Valide automatiquement la solution ERP quand le technicien résout le ticket dans GLPI — supprime la relecture manuelle."
                checked={settings.autoApproveGlpiSolutions}
                onChange={(v) => updateSetting('autoApproveGlpiSolutions', v)}
                disabled={saving}
              />

              <SettingRow
                title="Création GLPI automatique"
                description="Crée un ticket correspondant dans GLPI dès qu'un ticket est approuvé dans l'ERP."
                checked={settings.enableGlpiTicketCreation !== false}
                onChange={(v) => updateSetting('enableGlpiTicketCreation', v)}
                disabled={saving}
              />

              <SettingRow
                title="Dry Run Mode (simulation)"
                description="Mode simulation : aucune action n'est réellement écrite dans GLPI (création, mise à jour, suivi). Les tickets reçoivent un ID fictif négatif. À désactiver en production."
                checked={settings.dryRunMode === true}
                onChange={(v) => updateSetting('dryRunMode', v)}
                disabled={saving}
              />
            </>
          )}
        </div>

        {/* Instance GLPI active */}
        {settings.autonomousMode !== true && (
          <motion.div variants={itemVariants} className="bento-card flex items-center justify-between gap-lg p-lg">
            <div>
              <div className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">database</span>
                Instance GLPI active
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">
                Instance GLPI utilisée pour créer les tickets approuvés. 
                Les instances disponibles se configurent dans <strong>Paramètres → Autre → Services & APIs</strong>.
              </p>
            </div>
            <div className="shrink-0">
              {glpiInstances.length === 0 ? (
                <span className="text-xs text-on-surface-variant italic">Aucune instance configurée</span>
              ) : (
                <select
                  value={settings.activeGlpiInstance || 'glpi'}
                  onChange={(e) => updateSetting('activeGlpiInstance', e.target.value)}
                  disabled={saving}
                  className={`${inputClass} min-w-[200px] disabled:opacity-50`}
                >
                  {glpiInstances.map((inst) => (
                    <option key={inst.id} value={inst.serviceName}>
                      {inst.serviceName === 'glpi' ? 'GLPI Production' : inst.serviceName}
                      {inst.baseUrl ? ` (${inst.baseUrl.replace(/^https?:\/\//, '').slice(0, 40)})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </motion.div>
        )}
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

        <p className="text-xs text-on-surface-variant leading-relaxed max-w-2xl">
          Définit à quel intervalle chaque service vérifie les nouvelles données. 
          Une valeur basse réduit la latence mais augmente la charge serveur.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
          {settings.autonomousMode !== true && (
            <IntervalRow
              title="Tickets GLPI"
              description="Import des nouveaux tickets, suivis et approbations depuis GLPI vers l'ERP."
              value={settings.glpiTicketsSyncIntervalSeconds}
              onChange={(v) => updateSetting('glpiTicketsSyncIntervalSeconds', v)}
              disabled={saving}
              max={3600}
              unit="secondes"
            />
          )}

          <IntervalRow
            title="Relevé des emails"
            description="Vérification des nouveaux emails entrants sur les comptes Outlook/IMAP connectés."
            value={settings.emailSyncIntervalSeconds}
            onChange={(v) => updateSetting('emailSyncIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />

          {settings.autonomousMode !== true && (
            <IntervalRow
              title="Structure GLPI"
              description="Synchronisation des groupes, catégories et utilisateurs depuis GLPI."
              value={settings.glpiTeamsCategoriesSyncIntervalMinutes}
              onChange={(v) => updateSetting('glpiTeamsCategoriesSyncIntervalMinutes', v)}
              disabled={saving}
              max={1440}
              unit="minutes"
            />
          )}

          <IntervalRow
            title="Modèles IA disponibles"
            description="Actualisation de la liste des modèles actifs chez les fournisseurs d'IA configurés."
            value={settings.aiModelsSyncIntervalHours}
            onChange={(v) => updateSetting('aiModelsSyncIntervalHours', v)}
            disabled={saving}
            max={168}
            unit="heures"
          />

          <IntervalRow
            title="Surveillance SLA"
            description="Fréquence de détection des dépassements de délai de réponse (0 = désactivé)."
            value={settings.slaMonitorIntervalSeconds}
            onChange={(v) => updateSetting('slaMonitorIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION SLA : SEUILS PAR PRIORITE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">timer</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Moteur SLA</h4>
        </div>

        <p className="text-xs text-on-surface-variant leading-relaxed max-w-2xl">
          Délais de première réponse et de résolution par priorité, en heures. Les échéances sont
          calculées à la création du ticket et recalculées à chaque changement de priorité. Une
          valeur de 0 désactive le SLA pour cette priorité. Un dépassement déclenche une alerte
          (notification + email au technicien assigné).
        </p>

        <SlaThresholdsSection saving={saving} setSaving={setSaving} setError={setError} />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4 : REIMPORT GLPI & EMAILS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <GlpiReimportSection autonomousMode={settings.autonomousMode === true} />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4bis : ZONE DE DANGER — REINITIALISATION DE LA BASE DE TICKETS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <TicketPurgeSection
        autonomousMode={settings.autonomousMode === true}
        ticketsSyncInterval={settings.glpiTicketsSyncIntervalSeconds}
        onPurged={(result) => {
          api.get('/advanced-settings').then(({ data }) => setSettings(data)).catch(() => {});
        }}
        setError={setError}
      />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4bis : GESTION DU CACHE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <CacheSection />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 5 : REGLES DE TRIAGE AUTOMATIQUE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <TriageRulesSection saving={saving} setSaving={setSaving} setError={setError} />
    </motion.div>
  );
}

function CacheSection() {
  const [stats, setStats] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState('');

  function load() {
    api.get('/cache/stats').then(({ data }) => setStats(data)).catch(() => {});
  }

  useEffect(load, []);
  useEffect(() => {
    const intervalId = setInterval(load, 30000);
    return () => clearInterval(intervalId);
  }, []);

  async function handleClear() {
    setClearing(true);
    setMessage('');
    try {
      const { data } = await api.post('/cache/clear');
      setMessage(`Cache vidé (${data.cleared} entrée(s) supprimée(s)).`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Erreur lors de la purge du cache');
    } finally {
      setClearing(false);
    }
  }

  const totalHits = stats?.entries?.reduce((s, e) => s + e.hits, 0) || 0;

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
        <span className="material-symbols-outlined text-primary text-2xl">bolt</span>
        <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Gestion du cache</h4>
      </div>

      <motion.div variants={itemVariants} className="bento-card p-lg space-y-md">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed max-w-2xl">
            Le cache mémoire accélère le chargement des listes à forte lecture (utilisateurs,
            équipes, référentiels GLPI, modèles, réglages). Chaque réponse est conservée quelques
            secondes seulement (TTL court) puis rafraîchie — aucune donnée n'est obsolète. Les
            écritures ne sont jamais mises en cache.
          </p>
          <motion.button
            onClick={handleClear}
            disabled={clearing}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 rounded-xl font-semibold text-body-sm transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">cleaning_services</span>
            {clearing ? 'Purge en cours...' : 'Vider le cache'}
          </motion.button>
        </div>

        {message && (
          <p className="text-[12px] font-medium text-on-surface-variant">{message}</p>
        )}

        {stats ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Entrées en cache</div>
              <div className="font-headline-md text-headline-md font-bold text-on-surface">{stats.count}</div>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Réponses servies du cache</div>
              <div className="font-headline-md text-headline-md font-bold text-on-surface">{totalHits}</div>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Taille approximative</div>
              <div className="font-headline-md text-headline-md font-bold text-on-surface">
                {stats.approxBytes > 1024 * 1024 ? `${(stats.approxBytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(stats.approxBytes / 1024)} Ko`}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-on-surface-variant italic">Chargement des statistiques...</p>
        )}

        {stats && stats.entries.length > 0 && (
          <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest overflow-hidden">
            <div className="px-4 py-2.5 border-b border-outline-variant/40 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Entrées les plus consultées
            </div>
            <div className="divide-y divide-outline-variant/30">
              {stats.entries.slice(0, 5).map((e) => (
                <div key={e.key} className="px-4 py-2 flex items-center justify-between gap-4">
                  <code className="font-mono text-[11px] text-on-surface truncate">{e.key}</code>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-on-surface-variant font-medium">{e.hits} hit{s.e.hits > 1 ? 's' : ''}</span>
                    <span className="text-[11px] text-on-surface-variant font-medium">{e.remainingSeconds}s restantes</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function TicketPurgeSection({ autonomousMode = false, ticketsSyncInterval = 0, onPurged, setError }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState(null);

  async function handlePurge() {
    setPurging(true);
    setResult(null);
    setError('');
    try {
      const { data } = await api.post('/advanced-settings/purge-tickets');
      setResult(data);
      setConfirmOpen(false);
      onPurged(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la purge des tickets');
    } finally {
      setPurging(false);
    }
  }

  const reimportActive = !autonomousMode && ticketsSyncInterval > 0;

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
        <span className="material-symbols-outlined text-red-500 text-2xl">dangerous</span>
        <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Zone de danger — Réinitialisation de la base de tickets</h4>
      </div>

      <motion.div
        variants={itemVariants}
        className="bento-card p-lg border border-red-500/20 bg-red-500/5 flex items-start justify-between gap-lg flex-wrap"
      >
        <div className="space-y-2 max-w-2xl">
          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-red-500">delete_sweep</span>
            Purger tous les tickets
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
            Supprime <strong>tous les tickets</strong> et leur contenu (followups, messages, pièces jointes,
            temps passé, suggestions IA, liens assets…) pour repartir d'une base vierge. Les
            référentiels importés depuis GLPI sont <strong>conservés</strong> : équipes, catégories,
            lieux, utilisateurs, assets, base de connaissances, boîte mail.
          </p>
          {reimportActive && (
            <p className="font-body-sm text-body-sm text-red-500 leading-relaxed flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-[1px]">warning</span>
              La synchronisation des tickets GLPI est active : elle sera désactivée automatiquement,
              sinon les tickets présents dans GLPI seraient ré-importés dès le prochain cycle.
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-sm shrink-0">
          <motion.button
            onClick={() => setConfirmOpen(true)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="px-5 py-2.5 bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 rounded-xl font-semibold text-body-sm transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">delete_forever</span>
            Purger tous les tickets
          </motion.button>
        </div>
      </motion.div>

      <AnimatePresence>
        {result && (
          <motion.div
            key="purge-result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[13px] text-emerald-600 dark:text-emerald-400 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
            <span>
              <strong>{result.ticketsDeleted}</strong> ticket(s) supprimé(s)
              {result.orphans && Object.keys(result.orphans).length > 0 && (
                <> · orphelins nettoyés : {Object.entries(result.orphans).map(([m, c]) => `${m} (${c})`).join(', ')}</>
              )}
              {result.attachmentsFilesRemoved > 0 && <> · fichiers de pièces jointes supprimés : {result.attachmentsFilesRemoved}</>}
              {result.glpiTicketSyncDisabled && <> · synchro tickets GLPI désactivée (évite la ré-importation)</>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOpen}
        title="Purger tous les tickets ?"
        message={
          reimportActive
            ? "Tous les tickets et leur contenu seront définitivement supprimés (irréversible). La synchronisation des tickets GLPI sera désactivée pour éviter leur ré-importation. Les équipes, catégories, lieux, utilisateurs, assets, connaissances et la boîte mail sont conservés. Confirmer la purge ?"
            : "Tous les tickets et leur contenu seront définitivement supprimés (irréversible). Les équipes, catégories, lieux, utilisateurs, assets, connaissances et la boîte mail sont conservés. Confirmer la purge ?"
        }
        confirmLabel="Oui, tout supprimer"
        cancelLabel="Annuler"
        danger
        loading={purging}
        onConfirm={handlePurge}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

const DEFAULT_SLA_HOURS = {
  P1: { response: 1, resolution: 4 },
  P2: { response: 2, resolution: 8 },
  P3: { response: 4, resolution: 24 },
  P4: { response: 8, resolution: 72 },
};

const PRIORITY_LABELS = {
  P1: 'P1 — Critique',
  P2: 'P2 — Haute',
  P3: 'P3 — Moyenne',
  P4: 'P4 — Basse',
};

function SlaThresholdsSection({ saving, setSaving, setError }) {
  const [slaHours, setSlaHours] = useState(() => JSON.parse(JSON.stringify(DEFAULT_SLA_HOURS)));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get('/advanced-settings').then(({ data }) => {
      const stored = data.slaHours && typeof data.slaHours === 'object' ? data.slaHours : {};
      const merged = JSON.parse(JSON.stringify(DEFAULT_SLA_HOURS));
      for (const p of Object.keys(DEFAULT_SLA_HOURS)) {
        const e = stored[p];
        if (e && typeof e === 'object') {
          if (typeof e.response === 'number' && e.response >= 0) merged[p].response = e.response;
          if (typeof e.resolution === 'number' && e.resolution >= 0) merged[p].resolution = e.resolution;
        }
      }
      setSlaHours(merged);
      setLoaded(true);
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.patch('/advanced-settings', { slaHours });
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'enregistrement des seuils SLA");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <motion.div variants={itemVariants} className="bento-card p-lg">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-md">
        {Object.keys(DEFAULT_SLA_HOURS).map((priority) => (
          <div key={priority} className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4">
            <div className="font-headline-sm text-headline-sm text-on-surface font-bold mb-3">{PRIORITY_LABELS[priority]}</div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Réponse (heures)</label>
                <input
                  type="number"
                  min={0}
                  max={720}
                  value={slaHours[priority].response}
                  onChange={(e) => setSlaHours((s) => ({ ...s, [priority]: { ...s[priority], response: Math.max(0, Number(e.target.value) || 0) } }))}
                  disabled={saving}
                  className={`${inputClass} w-full disabled:opacity-50`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Résolution (heures)</label>
                <input
                  type="number"
                  min={0}
                  max={2160}
                  value={slaHours[priority].resolution}
                  onChange={(e) => setSlaHours((s) => ({ ...s, [priority]: { ...s[priority], resolution: Math.max(0, Number(e.target.value) || 0) } }))}
                  disabled={saving}
                  className={`${inputClass} w-full disabled:opacity-50`}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={save}
        disabled={saving}
        className="mt-4 px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-body-sm hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
      >
        {saving ? 'Enregistrement...' : 'Enregistrer les seuils SLA'}
      </motion.button>
    </motion.div>
  );
}

function GlpiReimportSection({ autonomousMode = false }) {
  const [activeTab, setActiveTab] = useState(autonomousMode ? 'email' : 'glpi');
  const [reimporting, setReimporting] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const GLPI_STEPS = [
    { icon: 'delete_sweep',   label: 'Suppression des tickets existants',    color: '#ef4444', pct: 15 },
    { icon: 'cloud_download', label: 'Récupération depuis GLPI',              color: '#f59e0b', pct: 40 },
    { icon: 'sync_alt',       label: 'Import & synchronisation des tickets',  color: '#3b82f6', pct: 75 },
    { icon: 'people',         label: 'Résolution des assignations',           color: '#8b5cf6', pct: 90 },
    { icon: 'check_circle',   label: 'Finalisation',                          color: '#10b981', pct: 100 },
  ];

  const EMAIL_STEPS = [
    { icon: 'mail_lock',       label: 'Connexion Outlook',           color: '#3b82f6', pct: 20 },
    { icon: 'mark_email_read', label: 'Récupération des emails',     color: '#f59e0b', pct: 55 },
    { icon: 'psychology',      label: 'Traitement IA',               color: '#8b5cf6', pct: 85 },
    { icon: 'check_circle',    label: 'Finalisation',                color: '#10b981', pct: 100 },
  ];

  const STEPS = activeTab === 'glpi' ? GLPI_STEPS : EMAIL_STEPS;

  useEffect(() => {
    if (!reimporting) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [reimporting]);

  useEffect(() => {
    if (!reimporting) return;
    setProgress(0); setCurrentStep(0);
    let pct = 0;
    const interval = setInterval(() => {
      pct += Math.random() * 1.2 + 0.4;
      if (pct >= 92) { pct = 92; clearInterval(interval); }
      setProgress(pct);
      const idx = STEPS.findIndex((s) => pct < s.pct);
      setCurrentStep(idx === -1 ? STEPS.length - 1 : Math.max(0, idx - 1));
    }, 180);
    return () => clearInterval(interval);
  }, [reimporting]); // eslint-disable-line

  function finishAnimation(finalResult, finalError) {
    setProgress(100);
    setCurrentStep(STEPS.length - 1);
    setTimeout(() => {
      setReimporting(false);
      if (finalResult) setResult(finalResult);
      if (finalError) setError(finalError);
    }, 800);
  }

  async function handleGlpiReimport() {
    if (!confirm("Supprimer les tickets GLPI existants dans l'ERP et tout réimporter depuis GLPI ? Cette action est réversible.")) return;
    setReimporting(true); setResult(null); setError(null);
    try {
      const payload = {};
      if (dateFrom) payload.dateFrom = dateFrom;
      if (dateTo) payload.dateTo = dateTo;
      const { data } = await api.post('/glpi/reimport', payload);
      finishAnimation(data, null);
    } catch (err) {
      finishAnimation(null, err.response?.data?.error || err.message);
    }
  }

  async function handleEmailReimport() {
    if (!confirm("Réimporter les emails de la plage de dates sélectionnée ? Les emails déjà traités seront ignorés (pas de doublons).")) return;
    setReimporting(true); setResult(null); setError(null);
    try {
      const payload = {};
      if (dateFrom) payload.dateFrom = dateFrom;
      if (dateTo) payload.dateTo = dateTo;
      const { data } = await api.post('/inbox/reimport', payload);
      finishAnimation(data, null);
    } catch (err) {
      finishAnimation(null, err.response?.data?.error || err.message);
    }
  }

  const isGlpi = !autonomousMode && activeTab === 'glpi';
  const fmtElapsed = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
        <span className="material-symbols-outlined text-primary text-2xl">download</span>
        <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Réimport de données</h4>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-surface-container-high/50 w-fit">
        {!autonomousMode && (
          <button
            onClick={() => { setActiveTab('glpi'); setResult(null); setError(null); }}
            disabled={reimporting}
            className={`px-4 py-2 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-40 ${isGlpi ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            <span className="material-symbols-outlined text-[16px] mr-1.5 align-middle">link</span>
            GLPI
          </button>
        )}
        <button
          onClick={() => { setActiveTab('email'); setResult(null); setError(null); }}
          disabled={reimporting}
          className={`px-4 py-2 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-40 ${!isGlpi ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
        >
          <span className="material-symbols-outlined text-[16px] mr-1.5 align-middle">mail</span>
          Emails
        </button>
      </div>

      <motion.div variants={itemVariants} className="bento-card p-lg space-y-md overflow-hidden">
        <p className="font-body-sm text-body-sm text-on-surface-variant"
          dangerouslySetInnerHTML={{
            __html: isGlpi
              ? "Supprime les tickets synchronisés depuis GLPI dans l'ERP et les réimporte depuis la source. Le GLPI source n'est <strong>jamais modifié</strong>."
              : "Récupère les emails Outlook de la plage de dates et les traite via le pipeline IA. Les emails déjà traités sont ignorés (pas de doublons). Outlook n'est <strong>jamais modifié</strong>."
          }}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Date de début (optionnel)</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={reimporting} className={inputClass} />
            <span className="text-[11px] text-on-surface-variant">Laisser vide = tout récupérer</span>
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Date de fin (optionnel)</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={reimporting} className={inputClass} />
            <span className="text-[11px] text-on-surface-variant">Laisser vide = jusqu'à aujourd'hui</span>
          </label>
        </div>

        <AnimatePresence mode="wait">
          {!reimporting && (
            <motion.div key="launch" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <motion.button
                onClick={isGlpi ? handleGlpiReimport : handleEmailReimport}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="px-5 py-2.5 bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 rounded-xl font-semibold text-body-sm transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                {isGlpi ? 'Réinitialiser et réimporter GLPI' : 'Réimporter les emails'}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {reimporting && (
            <motion.div
              key="progress-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{
                background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(139,92,246,0.06) 100%)',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '16px',
                padding: '20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <motion.span
                      className="material-symbols-outlined"
                      style={{ fontSize: '20px', color: '#6366f1' }}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    >autorenew</motion.span>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--on-surface)' }}>Import en cours…</span>
                  </div>
                  <span style={{
                    fontFamily: 'monospace', fontSize: '13px', color: 'var(--on-surface-variant)',
                    background: 'rgba(99,102,241,0.1)', padding: '2px 10px', borderRadius: '20px', letterSpacing: '0.05em',
                  }}>⏱ {fmtElapsed}</span>
                </div>

                <div style={{ height: '8px', background: 'rgba(99,102,241,0.12)', borderRadius: '99px', overflow: 'hidden', marginBottom: '20px' }}>
                  <motion.div
                    style={{
                      height: '100%', borderRadius: '99px',
                      background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #3b82f6)',
                      backgroundSize: '200% 100%',
                    }}
                    animate={{ width: `${progress}%`, backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
                    transition={{ width: { duration: 0.4, ease: 'easeOut' }, backgroundPosition: { duration: 2, repeat: Infinity, ease: 'linear' } }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {STEPS.map((step, idx) => {
                    const isCompleted = idx < currentStep;
                    const isActive    = idx === currentStep;
                    const isPending   = idx > currentStep;
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.07 }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '8px 12px', borderRadius: '10px',
                          background: isActive ? `${step.color}15` : isCompleted ? 'rgba(16,185,129,0.06)' : 'transparent',
                          border: isActive ? `1px solid ${step.color}40` : '1px solid transparent',
                          transition: 'all 0.3s ease',
                        }}
                      >
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                          background: isCompleted ? 'rgba(16,185,129,0.15)' : isActive ? `${step.color}20` : 'rgba(148,163,184,0.1)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isCompleted ? (
                            <motion.span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#10b981' }}
                              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }}>
                              check_circle
                            </motion.span>
                          ) : isActive ? (
                            <motion.span className="material-symbols-outlined" style={{ fontSize: '18px', color: step.color }}
                              animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                              {step.icon}
                            </motion.span>
                          ) : (
                            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--on-surface-variant)', opacity: 0.4 }}>
                              {step.icon}
                            </span>
                          )}
                        </div>
                        <span style={{
                          fontSize: '13px',
                          fontWeight: isActive ? 600 : isCompleted ? 500 : 400,
                          color: isCompleted ? '#10b981' : isActive ? step.color : 'var(--on-surface-variant)',
                          opacity: isPending ? 0.5 : 1,
                          transition: 'all 0.3s ease',
                        }}>{step.label}</span>
                        {isActive && (
                          <motion.div style={{ display: 'flex', gap: '3px', marginLeft: 'auto' }}>
                            {[0, 1, 2].map((i) => (
                              <motion.div key={i}
                                style={{ width: '5px', height: '5px', borderRadius: '50%', background: step.color }}
                                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                              />
                            ))}
                          </motion.div>
                        )}
                        {isCompleted && (
                          <motion.span initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
                            style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '1px 8px', borderRadius: '99px' }}>
                            OK
                          </motion.span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                <div style={{ textAlign: 'right', marginTop: '12px' }}>
                  <span style={{ fontSize: '24px', fontWeight: 800, color: '#6366f1', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.floor(progress)}%
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {result && !reimporting && (
            <motion.div key="success"
              initial={{ opacity: 0, scale: 0.95, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300 }}
              style={{
                padding: '14px 16px', borderRadius: '14px',
                background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.04))',
                border: '1px solid rgba(16,185,129,0.25)',
                display: 'flex', flexDirection: 'column', gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <motion.span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#10b981' }}
                  initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, delay: 0.1 }}>
                  task_alt
                </motion.span>
                <span style={{ fontWeight: 700, fontSize: '14px', color: '#10b981' }}>Import terminé avec succès</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '12px', color: 'rgba(16,185,129,0.7)' }}>
                  ⏱ {fmtElapsed}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--on-surface-variant)', paddingLeft: '28px' }}>
                {isGlpi
                  ? (<><span style={{ color: '#ef4444', fontWeight: 600 }}>{result.deleted}</span> tickets supprimés{' · '}<span style={{ color: '#10b981', fontWeight: 600 }}>{result.imported}</span> tickets importés</>)
                  : (<><span style={{ color: '#3b82f6', fontWeight: 600 }}>{result.totalFetched}</span> emails récupérés{' · '}<span style={{ color: '#10b981', fontWeight: 600 }}>{result.totalProcessed}</span> traités{' · '}<span style={{ color: '#f59e0b', fontWeight: 600 }}>{result.totalSkipped}</span> déjà existants</>)
                }
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && !reimporting && (
            <motion.div key="error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[13px] text-red-500 flex items-center gap-2"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}>error</span>
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
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
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Champ / Critère de Triage</span>
                <select
                  value={matchField}
                  onChange={(e) => setMatchField(e.target.value)}
                  className={inputClass}
                >
                  <option value="subject_or_body">Sujet ou Corps</option>
                  <option value="subject">Sujet uniquement</option>
                  <option value="body">Corps uniquement</option>
                  <option value="from">Adresse expéditeur (De)</option>
                  <option value="domain">Domaine client / VIP (ex: @direction.ci)</option>
                  <option value="sentiment">🔥 Analyse de Sentiment IA (Frustré / Urgent)</option>
                  <option value="time_window">🌙 Plage Horaire (Nuit / Off-Hours)</option>
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

