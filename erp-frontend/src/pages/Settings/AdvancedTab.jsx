import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog';
import Toggle from '../../components/Toggle';
import { Component } from 'react';
import { SettingRow, IntervalRow, inputClass, itemVariants } from './SettingsComponents';

// Mini ErrorBoundary pour isoler chaque section — si une section plante, les autres continuent de fonctionner
class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error(`[AdvancedTab] Section « ${this.props.label || 'inconnue'} » a crashé:`, error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bento-card p-lg border border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-2 text-red-500 font-semibold text-sm mb-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            Section « {this.props.label || 'inconnue'} » — erreur de rendu
          </div>
          <p className="text-xs text-on-surface-variant mb-3">{this.state.error?.message || 'Erreur inconnue'}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 text-xs font-semibold border border-red-500/20 hover:bg-red-500/20 transition-all"
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}



export default function AdvancedTab() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [backendUrlDraft, setBackendUrlDraft] = useState('');
  const [frontendUrlDraft, setFrontendUrlDraft] = useState('');
  const [effectiveServerUrls, setEffectiveServerUrls] = useState(null);

  const [glpiInstances, setGlpiInstances] = useState([]);

  function load() {
    api.get('/advanced-settings').then(({ data }) => {
      setSettings(data);
    }).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/advanced-settings/server-urls/effective').then(({ data }) => setEffectiveServerUrls(data)).catch(() => {});
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
          <motion.div variants={itemVariants} className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg">
            <div className="min-w-0 flex-1">
              <div className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">database</span>
                Instance GLPI active
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 break-words">
                Instance GLPI utilisée pour créer les tickets approuvés.
                Les instances disponibles se configurent dans <strong>Paramètres → Autre → Services &amp; APIs</strong>.
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
      {/* SECTION 2 : FREQUENCES DE SYNCHRONISATION — supprimée */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

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

        <SectionErrorBoundary label="Seuils SLA">
          <SlaThresholdsSection slaHours={settings?.slaHours} saving={saving} setSaving={setSaving} setError={setError} />
        </SectionErrorBoundary>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION REIMPORT — supprimé */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4bis : ZONE DE DANGER — REINITIALISATION DE LA BASE DE TICKETS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <SectionErrorBoundary label="Zone de danger">
        <TicketPurgeSection
          autonomousMode={settings.autonomousMode === true}
          ticketsSyncInterval={settings.glpiTicketsSyncIntervalSeconds}
          onPurged={(result) => {
            api.get('/advanced-settings').then(({ data }) => setSettings(data)).catch(() => {});
          }}
          setError={setError}
        />
      </SectionErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION FRESH START — DEPLOIEMENT PRODUCTION */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <SectionErrorBoundary label="Fresh Start">
        <FreshStartSection
          onDone={(result) => {
            api.get('/advanced-settings').then(({ data }) => setSettings(data)).catch(() => {});
          }}
        />
      </SectionErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION PAUSE / REPRISE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <SectionErrorBoundary label="Pause">
        <PauseSection
          isPaused={settings.autonomousMode === true}
          onToggle={(data) => {
            setSettings((prev) => ({ ...prev, autonomousMode: data.autonomousMode }));
          }}
        />
      </SectionErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4bis : GESTION DU CACHE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <SectionErrorBoundary label="Gestion du cache">
        <CacheSection />
      </SectionErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION REGLES DE TRIAGE — supprimée */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
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

        {stats && Array.isArray(stats.entries) && stats.entries.length > 0 && (
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
              {result.sequencesReset?.length > 0 && <> · séquences réinitialisées : {result.sequencesReset.length}</>}
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

// ═══════════════════════════════════════════════════════════════════════════
// FRESH START — purge complète pour déploiement prod
// ═══════════════════════════════════════════════════════════════════════════
function FreshStartSection({ onDone }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  async function handleFreshStart() {
    if (password !== 'JeMarqueLeDebut') {
      setPasswordError('Mot de passe incorrect');
      return;
    }
    setPasswordError('');
    setRunning(true);
    try {
      const { data } = await api.post('/advanced-settings/fresh-start', { password });
      setResult(data);
      setConfirmOpen(false);
      onDone?.(data);
    } catch (err) {
      setPasswordError(err.response?.data?.error || 'Erreur lors du fresh start');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
        <span className="material-symbols-outlined text-orange-500 text-2xl">factory</span>
        <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Fresh Start — Déploiement production</h4>
      </div>

      <motion.div
        variants={itemVariants}
        className="bento-card p-lg border border-orange-500/20 bg-orange-500/5 flex items-start justify-between gap-lg flex-wrap"
      >
        <div className="space-y-2 max-w-2xl">
          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-orange-500">rocket_launch</span>
            Marquer le départ en production
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
            Purge <strong>toutes les données de test</strong> : tickets, emails entrants, conversations chat,
            notifications, logs d'audit, brouillons IA, centre de validation, base de connaissances.
            Les données de référence sont <strong>conservées</strong> : utilisateurs, équipes, catégories,
            lieux, providers IA, permissions, comptes email. Le compteur de tickets est <strong>remis à 1</strong>.
          </p>
          <p className="font-body-xs text-body-xs text-orange-500 font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            Réservé au SUPERADMIN — Mot de passe requis
          </p>
        </div>

        <div className="flex flex-col items-end gap-sm shrink-0">
          <motion.button
            onClick={() => { setPassword(''); setPasswordError(''); setResult(null); setConfirmOpen(true); }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="px-5 py-2.5 bg-orange-500/10 text-orange-500 border border-orange-500/30 hover:bg-orange-500/20 rounded-xl font-semibold text-body-sm transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
            Marquer le départ
          </motion.button>
        </div>
      </motion.div>

      <AnimatePresence>
        {result && (
          <motion.div
            key="fresh-result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[13px] text-emerald-600 dark:text-emerald-400 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
            <span>
              Fresh start terminé — {result.tickets?.ticketsDeleted || 0} ticket(s) supprimé(s)
              {result.sequencesReset?.length > 0 && <> · séquences réinitialisées</>}
              {result.seedRan && <> · seed relancé</>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOpen}
        title="Marquer le départ en production ?"
        message={
          <div className="space-y-3">
            <p>
              Cette action va <strong>supprimer TOUTES les données de test</strong> (tickets, emails, conversations,
              notifications, logs, brouillons, validations, connaissances) et <strong>remettre le compteur de tickets à 1</strong>.
            </p>
            <p className="text-orange-500 font-bold">Cette action est irréversible.</p>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFreshStart(); }}
                placeholder="Entrez le mot de passe"
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                autoFocus
              />
              {passwordError && <p className="text-xs text-red-500 mt-1">{passwordError}</p>}
            </div>
          </div>
        }
        confirmLabel="Oui, marquer le départ"
        cancelLabel="Annuler"
        danger
        loading={running}
        onConfirm={handleFreshStart}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAUSE — mettre en pause / reprendre le système
// ═══════════════════════════════════════════════════════════════════════════
function PauseSection({ isPaused, onToggle }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [running, setRunning] = useState(false);

  async function handleToggle() {
    if (password !== 'JeMarqueLeDebut') {
      setPasswordError('Mot de passe incorrect');
      return;
    }
    setPasswordError('');
    setRunning(true);
    try {
      const action = isPaused ? 'resume' : 'pause';
      const { data } = await api.post('/advanced-settings/pause', { password, action });
      setConfirmOpen(false);
      onToggle?.(data);
    } catch (err) {
      setPasswordError(err.response?.data?.error || 'Erreur');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
        <span className="material-symbols-outlined text-blue-500 text-2xl">pause_circle</span>
        <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Pause / Reprise</h4>
      </div>

      <motion.div
        variants={itemVariants}
        className={`bento-card p-lg border flex items-start justify-between gap-lg flex-wrap ${
          isPaused
            ? 'border-blue-500/20 bg-blue-500/5'
            : 'border-outline-variant/40 bg-surface-container-lowest'
        }`}
      >
        <div className="space-y-2 max-w-2xl">
          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
            <span className={`material-symbols-outlined text-[20px] ${isPaused ? 'text-blue-500' : 'text-on-surface-variant'}`}>
              {isPaused ? 'play_circle' : 'pause_circle'}
            </span>
            {isPaused ? 'Système en pause' : 'Mettre en pause'}
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
            {isPaused
              ? 'Le système est actuellement en pause. Le traitement des emails et les synchronisations sont suspendus. Cliquez sur "Reprendre" pour relancer.'
              : 'Suspend le traitement des emails et les synchronisations. Utile avant un déploiement ou une maintenance.'}
          </p>
        </div>

        <div className="flex flex-col items-end gap-sm shrink-0">
          <motion.button
            onClick={() => { setPassword(''); setPasswordError(''); setConfirmOpen(true); }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className={`px-5 py-2.5 rounded-xl font-semibold text-body-sm transition-all flex items-center gap-2 ${
              isPaused
                ? 'bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20'
                : 'bg-surface-container text-on-surface-variant border border-outline-variant/50 hover:bg-surface-container-high'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{isPaused ? 'play_arrow' : 'pause'}</span>
            {isPaused ? 'Reprendre' : 'Mettre en pause'}
          </motion.button>
        </div>
      </motion.div>

      <ConfirmDialog
        open={confirmOpen}
        title={isPaused ? 'Reprendre le système ?' : 'Mettre en pause ?'}
        message={
          <div className="space-y-3">
            <p>
              {isPaused
                ? 'Le système va reprendre le traitement des emails et les synchronisations.'
                : 'Le traitement des emails et les synchronisations seront suspendus.'}
            </p>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleToggle(); }}
                placeholder="Entrez le mot de passe"
                className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                autoFocus
              />
              {passwordError && <p className="text-xs text-red-500 mt-1">{passwordError}</p>}
            </div>
          </div>
        }
        confirmLabel={isPaused ? 'Oui, reprendre' : 'Oui, mettre en pause'}
        cancelLabel="Annuler"
        loading={running}
        onConfirm={handleToggle}
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

function SlaThresholdsSection({ slaHours: slaHoursProp, saving, setSaving, setError }) {
  const [slaHours, setSlaHours] = useState(() => {
    const stored = slaHoursProp && typeof slaHoursProp === 'object' ? slaHoursProp : {};
    const merged = JSON.parse(JSON.stringify(DEFAULT_SLA_HOURS));
    for (const p of Object.keys(DEFAULT_SLA_HOURS)) {
      const e = stored[p];
      if (e && typeof e === 'object') {
        if (typeof e.response === 'number' && e.response >= 0) merged[p].response = e.response;
        if (typeof e.resolution === 'number' && e.resolution >= 0) merged[p].resolution = e.resolution;
      }
    }
    return merged;
  });
  const [loaded] = useState(true);

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






