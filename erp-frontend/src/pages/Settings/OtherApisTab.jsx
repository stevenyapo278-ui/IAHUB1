import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../utils/permissions';
import ConfirmDialog from '../../components/ConfirmDialog';

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export default function OtherApisTab() {
  const { user } = useAuth();
  const canManageGlpi = hasPermission(user, 'glpi.manage');
  const [configs, setConfigs] = useState([]);
  const [form, setForm] = useState({ serviceName: '', baseUrl: '', apiKey: '', appToken: '' });
  const [workflows, setWorkflows] = useState([]);
  const [workflowForm, setWorkflowForm] = useState({ name: '', webhookUrl: '', description: '' });
  const [triggering, setTriggering] = useState(null);
  const [syncingGlpi, setSyncingGlpi] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState({}); // { [configId]: { connected, error } }
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'workflow'|'config', id }
  const [deleting, setDeleting] = useState(false);
  
  const [showAddIntegration, setShowAddIntegration] = useState(false);
  const [showAddWorkflow, setShowAddWorkflow] = useState(false);
  const [showSecrets, setShowSecrets] = useState({});

  function toggleSecretVisibility(id, field) {
    const key = `${id}-${field}`;
    setShowSecrets((p) => ({ ...p, [key]: !p[key] }));
  }

  const REQUIRED_FIELDS = {
    glpi: [
      { key: 'baseUrl', label: 'URL de base' },
      { key: 'apiKey', label: 'Clé API (User Token)' },
      { key: 'appToken', label: 'App Token' },
    ],
  };

  function getMissingFields(config) {
    const required = REQUIRED_FIELDS[config.serviceName];
    if (!required) return [];
    const values = { baseUrl: config.baseUrl, apiKey: config.apiKey, appToken: config.extra?.appToken };
    return required.filter((f) => !values[f.key]).map((f) => f.label);
  }

  async function handleTestConnection(config) {
    const missing = getMissingFields(config);
    if (missing.length > 0) {
      setConnectionStatus((s) => ({ ...s, [config.id]: { connected: false, error: `Champ(s) manquant(s) : ${missing.join(', ')}` } }));
      return;
    }
    setTestingId(config.id);
    try {
      const { data } = await api.post(`/api-configs/${config.id}/test-connection`);
      setConnectionStatus((s) => ({ ...s, [config.id]: data }));
    } catch (err) {
      setConnectionStatus((s) => ({
        ...s,
        [config.id]: { connected: false, error: err.response?.data?.error || 'Erreur lors du test de connexion' },
      }));
    } finally {
      setTestingId(null);
    }
  }

  function load() {
    api
      .get('/api-configs')
      .then(({ data }) => {
        setConfigs(data);
        data.filter((c) => c.isActive && REQUIRED_FIELDS[c.serviceName]).forEach((c) => handleTestConnection(c));
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  function loadWorkflows() {
    api
      .get('/n8n-workflows')
      .then(({ data }) => setWorkflows(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);
  useEffect(loadWorkflows, []);

  async function handleCreateWorkflow(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/n8n-workflows', workflowForm);
      setWorkflowForm({ name: '', webhookUrl: '', description: '' });
      loadWorkflows();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  async function handleUpdateWorkflow(id, field, value) {
    try {
      await api.patch(`/n8n-workflows/${id}`, { [field]: value });
      loadWorkflows();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  function askDeleteWorkflow(id) {
    setPendingDelete({ type: 'workflow', id });
  }

  async function handleDeleteWorkflow() {
    if (!pendingDelete || pendingDelete.type !== 'workflow') return;
    setDeleting(true);
    try {
      await api.delete(`/n8n-workflows/${pendingDelete.id}`);
      loadWorkflows();
      setPendingDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleTrigger(id) {
    setError('');
    setInfo('');
    setTriggering(id);
    try {
      await api.post(`/n8n-workflows/${id}/trigger`, {});
      setInfo('Workflow déclenché avec succès.');
      loadWorkflows();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du déclenchement');
    } finally {
      setTriggering(null);
    }
  }

  async function handleSyncGlpi() {
    setError('');
    setInfo('');
    setSyncingGlpi(true);
    try {
      const { data } = await api.post('/glpi/sync');
      setInfo(`Synchronisation GLPI : ${data.imported} ticket(s) importé(s), ${data.updated} mis à jour.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la synchronisation GLPI');
    } finally {
      setSyncingGlpi(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');

    const required = REQUIRED_FIELDS[form.serviceName];
    if (required) {
      const missing = required.filter((f) => !form[f.key]).map((f) => f.label);
      if (missing.length > 0) {
        setError(`Champ(s) manquant(s) : ${missing.join(', ')}`);
        return;
      }
    }

    try {
      const { appToken, ...rest } = form;
      const payload = { ...rest, ...(appToken ? { extra: { appToken } } : {}) };
      await api.post('/api-configs', payload);
      setForm({ serviceName: '', baseUrl: '', apiKey: '', appToken: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  async function handleUpdate(id, field, value) {
    setError('');
    setInfo('');
    try {
      const { data } = await api.patch(`/api-configs/${id}`, { [field]: value });
      if (data.glpiLinksReset) {
        const { tickets, teams, categories } = data.glpiLinksReset;
        setInfo(
          `Changement d'instance GLPI détecté : ${tickets} ticket(s) et ${teams} équipe(s) détachés de l'ancien GLPI, ${categories} catégorie(s) supprimée(s). ` +
          `Cliquez « Synchroniser GLPI » pour récupérer les données de la nouvelle instance.`
        );
      }
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  async function handleUpdateAppToken(id, currentExtra, appToken) {
    if (!appToken) return;
    try {
      await api.patch(`/api-configs/${id}`, { extra: { ...currentExtra, appToken } });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de la mise à jour de l'App Token");
    }
  }

  function askDelete(id) {
    setPendingDelete({ type: 'config', id });
  }

  async function handleDelete() {
    if (!pendingDelete || pendingDelete.type !== 'config') return;
    setDeleting(true);
    try {
      await api.delete(`/api-configs/${pendingDelete.id}`);
      load();
      setPendingDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

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
            key="other-error"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md overflow-hidden"
          >
            {error}
          </motion.div>
        )}
        {info && (
          <motion.div
            key="other-info"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-md rounded-xl font-body-md overflow-hidden"
          >
            {info}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 : SERVICES & APIS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex justify-between items-center border-b border-outline-variant/40 pb-sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl">api</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Services & APIs configurés</h4>
          </div>
          <motion.button
            onClick={() => setShowAddIntegration(v => !v)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            className="border border-outline-variant/60 py-2 px-4 rounded-xl font-semibold text-body-sm text-on-surface hover:bg-surface-container-high transition-all duration-300 shadow-sm flex items-center gap-1"
          >
            <motion.span
              animate={{ rotate: showAddIntegration ? 180 : 0 }}
              transition={{ duration: 0.3 }}
              className="material-symbols-outlined text-[18px]"
            >
              {showAddIntegration ? 'close' : 'add'}
            </motion.span>
            {showAddIntegration ? 'Annuler' : 'Ajouter une intégration'}
          </motion.button>
        </div>

        {/* Ajouter une intégration (Collapsible) */}
        <AnimatePresence>
          {showAddIntegration && (
            <motion.div
              key="add-integration-form"
              initial={{ opacity: 0, height: 0, scale: 0.97 }}
              animate={{ opacity: 1, height: 'auto', scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.97 }}
              transition={{ duration: 0.3, type: 'spring', stiffness: 200, damping: 22 }}
              className="bento-card p-lg overflow-hidden"
            >
              <div className="bento-card-header px-0 py-0 pb-md border-b border-outline-variant/40 mb-md">
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Ajouter un service externe</h3>
              </div>
              <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end">
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom du service</span>
                  <input
                    className={inputClass}
                    value={form.serviceName}
                    onChange={(e) => setForm({ ...form, serviceName: e.target.value })}
                    placeholder="glpi, glpi_dev, supabase…"
                    required
                  />
                  {form.serviceName === 'glpi' && (
                    <div className="flex items-start gap-1.5 mt-1.5 p-2 rounded-lg" style={{ backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                      <span className="material-symbols-outlined text-[14px] shrink-0 mt-px" style={{ color: '#3b82f6' }}>info</span>
                      <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-on-surface-variant)' }}>
                        <strong style={{ color: '#3b82f6' }}>GLPI Production</strong> — utilisez <code className="bg-surface-container-high px-1 rounded font-mono">glpi</code> pour l'instance de production réelle des techniciens.
                        <br />
                        Pour une instance de <strong style={{ color: '#f59e0b' }}>Développement / Test</strong>, créez une seconde entrée avec le nom <code className="bg-surface-container-high px-1 rounded font-mono">glpi_dev</code>.
                      </div>
                    </div>
                  )}
                  {form.serviceName === 'glpi_dev' && (
                    <div className="flex items-start gap-1.5 mt-1.5 p-2 rounded-lg" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                      <span className="material-symbols-outlined text-[14px] shrink-0 mt-px" style={{ color: '#f59e0b' }}>info</span>
                      <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-on-surface-variant)' }}>
                        <strong style={{ color: '#f59e0b' }}>GLPI Développement</strong> — instance de test isolée. Aucun impact sur la production.
                        <br />
                        Pour l'instance de <strong style={{ color: '#16a34a' }}>Production</strong>, créez une autre entrée avec le nom <code className="bg-surface-container-high px-1 rounded font-mono">glpi</code>.
                      </div>
                    </div>
                  )}
                </label>
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">URL de base</span>
                  <input className={inputClass} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://..." />
                </label>
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                    Clé API{form.serviceName === 'glpi' ? ' (User Token)' : ''}
                  </span>
                  <div className="relative flex items-center w-full">
                    <input
                      className={`${inputClass} w-full pr-10`}
                      type={showSecrets['new-apiKey'] ? 'text' : 'password'}
                      value={form.apiKey}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => toggleSecretVisibility('new', 'apiKey')}
                      className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {showSecrets['new-apiKey'] ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </label>
                {form.serviceName === 'glpi' && (
                  <label className="flex flex-col gap-xs">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">App Token (GLPI)</span>
                    <div className="relative flex items-center w-full">
                      <input
                        className={`${inputClass} w-full pr-10`}
                        type={showSecrets['new-appToken'] ? 'text' : 'password'}
                        value={form.appToken}
                        onChange={(e) => setForm({ ...form, appToken: e.target.value })}
                        placeholder="Jeton du client API GLPI"
                      />
                      <button
                        type="button"
                        onClick={() => toggleSecretVisibility('new', 'appToken')}
                        className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {showSecrets['new-appToken'] ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                    </div>
                  </label>
                )}
                <div className="md:col-span-3 flex justify-end mt-2">
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    className="btn-gradient font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
                  >
                    Ajouter l'intégration
                  </motion.button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tableau des intégrations */}
        <motion.div variants={itemVariants} className="bento-card overflow-hidden flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-32">Service</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">URL de base</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-44">Clé API</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-44">App Token</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-36">Statut</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Active</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-40 text-center">Actions</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant/40">
                {configs.map((c) => (
                  <motion.tr
                    key={c.id}
                    layout
                    className="hover:bg-surface-container-low/40 transition-colors"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold uppercase text-primary">{c.serviceName}</span>
                        {c.serviceName === 'glpi' && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>PROD</span>
                        )}
                        {c.serviceName === 'glpi_dev' && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>DEV</span>
                        )}
                      </div>
                      {c.serviceName === 'glpi' && (
                        <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>Instance de production</div>
                      )}
                      {c.serviceName === 'glpi_dev' && (
                        <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>Instance de développement / test</div>
                      )}
                    </td>
                    <td className="p-3">
                      <input
                        className={`${inputClass} w-full`}
                        defaultValue={c.baseUrl || ''}
                        onBlur={(e) => handleUpdate(c.id, 'baseUrl', e.target.value)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="relative flex items-center">
                        <input
                          className={`${inputClass} w-full pr-10`}
                          type={showSecrets[`${c.id}-apiKey`] ? 'text' : 'password'}
                          placeholder={c.apiKey ? '••••••••••••••••' : 'Non définie'}
                          onBlur={(e) => {
                            if (e.target.value) handleUpdate(c.id, 'apiKey', e.target.value);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility(c.id, 'apiKey')}
                          className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {showSecrets[`${c.id}-apiKey`] ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      {c.serviceName === 'glpi' ? (
                        <div className="relative flex items-center">
                          <input
                            className={`${inputClass} w-full pr-10`}
                            type={showSecrets[`${c.id}-appToken`] ? 'text' : 'password'}
                            placeholder={c.extra?.appToken ? '••••••••••••••••' : 'Non défini'}
                            onBlur={(e) => handleUpdateAppToken(c.id, c.extra, e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => toggleSecretVisibility(c.id, 'appToken')}
                            className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {showSecrets[`${c.id}-appToken`] ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-on-surface-variant/60 italic p-2 block">-</span>
                      )}
                    </td>
                    <td className="p-3">
                      {REQUIRED_FIELDS[c.serviceName] && (
                        <motion.button
                          onClick={() => handleTestConnection(c)}
                          disabled={testingId === c.id}
                          title="Tester la connexion"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-outline-variant/60 rounded-xl text-[11px] font-semibold bg-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 shadow-sm"
                        >
                          {testingId === c.id ? (
                            <span className="text-on-surface-variant">Test...</span>
                          ) : connectionStatus[c.id]?.connected ? (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="flex items-center gap-1.5"
                            >
                              <motion.span
                                animate={{ scale: [1, 1.3, 1] }}
                                transition={{ duration: 0.5, ease: 'easeInOut' }}
                                className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20"
                              />
                              <span className="text-on-surface">Connecté</span>
                            </motion.span>
                          ) : connectionStatus[c.id] ? (
                            <>
                              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/20"></span>
                              <span className="text-error" title={connectionStatus[c.id].error}>Échec</span>
                            </>
                          ) : (
                            <span className="text-on-surface-variant">Tester</span>
                          )}
                        </motion.button>
                      )}
                      {connectionStatus[c.id]?.error && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-[10px] text-error mt-1 max-w-[180px] bg-error/5 border border-error/15 px-2 py-0.5 rounded-lg font-medium"
                        >
                          {connectionStatus[c.id].error}
                        </motion.div>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <motion.input
                        type="checkbox"
                        className="w-4 h-4 accent-primary cursor-pointer"
                        checked={c.isActive}
                        onChange={(e) => handleUpdate(c.id, 'isActive', e.target.checked)}
                        whileTap={{ scale: 1.2 }}
                      />
                    </td>
                    <td className="p-3 text-center">
                      {c.serviceName === 'glpi' && canManageGlpi && (
                        <motion.button
                          onClick={handleSyncGlpi}
                          disabled={syncingGlpi}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                          className="px-3.5 py-1.5 rounded-xl border border-outline-variant/60 text-on-surface font-semibold text-body-sm hover:bg-surface-container-high transition-colors disabled:opacity-50 shadow-sm flex items-center gap-1 mx-auto"
                        >
                          <motion.span
                            animate={syncingGlpi ? { rotate: 360 } : { rotate: 0 }}
                            transition={syncingGlpi ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
                            className="material-symbols-outlined text-[16px]"
                          >
                            sync
                          </motion.span>
                          {syncingGlpi ? 'Synchro...' : 'Synchroniser GLPI'}
                        </motion.button>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <motion.button
                        onClick={() => askDelete(c.id)}
                        whileHover={{ scale: 1.15, color: 'var(--color-error)' }}
                        whileTap={{ scale: 0.9 }}
                        className="text-on-surface-variant hover:text-error transition-colors p-1"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </motion.button>
                    </td>
                  </motion.tr>
                ))}
                {configs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-on-surface-variant italic font-body-md">Aucune intégration configurée.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 : WORKFLOWS N8N */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex justify-between items-center border-b border-outline-variant/40 pb-sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl">account_tree</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Workflows n8n (Webhooks)</h4>
          </div>
          <motion.button
            onClick={() => setShowAddWorkflow(v => !v)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            className="border border-outline-variant/60 py-2 px-4 rounded-xl font-semibold text-body-sm text-on-surface hover:bg-surface-container-high transition-all duration-300 shadow-sm flex items-center gap-1"
          >
            <motion.span
              animate={{ rotate: showAddWorkflow ? 180 : 0 }}
              transition={{ duration: 0.3 }}
              className="material-symbols-outlined text-[18px]"
            >
              {showAddWorkflow ? 'close' : 'add'}
            </motion.span>
            {showAddWorkflow ? 'Annuler' : 'Ajouter un workflow'}
          </motion.button>
        </div>

        {/* Ajouter un workflow (Collapsible) */}
        <AnimatePresence>
          {showAddWorkflow && (
            <motion.div
              key="add-workflow-form"
              initial={{ opacity: 0, height: 0, scale: 0.97 }}
              animate={{ opacity: 1, height: 'auto', scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.97 }}
              transition={{ duration: 0.3, type: 'spring', stiffness: 200, damping: 22 }}
              className="bento-card p-lg overflow-hidden"
            >
              <div className="bento-card-header px-0 py-0 pb-md border-b border-outline-variant/40 mb-md">
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Ajouter un workflow n8n</h3>
              </div>
              <form onSubmit={handleCreateWorkflow} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end">
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom</span>
                  <input
                    className={inputClass}
                    value={workflowForm.name}
                    onChange={(e) => setWorkflowForm({ ...workflowForm, name: e.target.value })}
                    placeholder="ex: Synchro GLPI"
                    required
                  />
                </label>
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">URL du webhook</span>
                  <input
                    className={inputClass}
                    value={workflowForm.webhookUrl}
                    onChange={(e) => setWorkflowForm({ ...workflowForm, webhookUrl: e.target.value })}
                    placeholder="https://n8n.example.com/webhook/..."
                    required
                  />
                </label>
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Description</span>
                  <input
                    className={inputClass}
                    value={workflowForm.description}
                    onChange={(e) => setWorkflowForm({ ...workflowForm, description: e.target.value })}
                    placeholder="Optionnel"
                  />
                </label>
                <div className="md:col-span-3 flex justify-end mt-2">
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    className="btn-gradient font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
                  >
                    Ajouter le workflow
                  </motion.button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tableau des workflows */}
        <motion.div variants={itemVariants} className="bento-card overflow-hidden flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Nom</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Webhook</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Dernière exécution</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Active</th>
                  <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant/40">
                {workflows.map((w) => (
                  <motion.tr
                    key={w.id}
                    layout
                    className="hover:bg-surface-container-low/40 transition-colors"
                  >
                    <td className="p-3 font-semibold">
                      {w.name}
                      {w.description && <div className="font-body-xs text-xs text-on-surface-variant mt-0.5 font-normal">{w.description}</div>}
                    </td>
                    <td className="p-3 font-mono-sm text-mono-sm text-on-surface-variant truncate max-w-xs">{w.webhookUrl}</td>
                    <td className="p-3 font-medium">
                      {w.lastRunAt ? (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={w.lastStatus === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-error'}
                        >
                          {new Date(w.lastRunAt).toLocaleString('fr-FR')} ({w.lastStatus})
                        </motion.span>
                      ) : (
                        <span className="text-on-surface-variant/60 italic">Jamais exécuté</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <motion.input
                        type="checkbox"
                        className="w-4 h-4 accent-primary cursor-pointer"
                        checked={w.isActive}
                        onChange={(e) => handleUpdateWorkflow(w.id, 'isActive', e.target.checked)}
                        whileTap={{ scale: 1.2 }}
                      />
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <motion.button
                          onClick={() => handleTrigger(w.id)}
                          disabled={!w.isActive || triggering === w.id}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                          className="flex items-center gap-1 border border-outline-variant/60 text-on-surface px-3 py-1.5 rounded-xl font-semibold text-body-sm hover:bg-surface-container-high transition-colors disabled:opacity-50 shadow-sm"
                        >
                          <motion.span
                            animate={triggering === w.id ? { rotate: 360 } : { rotate: 0 }}
                            transition={triggering === w.id ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
                            className="material-symbols-outlined text-[16px]"
                          >
                            play_arrow
                          </motion.span>
                          {triggering === w.id ? '...' : 'Lancer'}
                        </motion.button>
                        <motion.button
                          onClick={() => askDeleteWorkflow(w.id)}
                          whileHover={{ scale: 1.15, color: 'var(--color-error)' }}
                          whileTap={{ scale: 0.9 }}
                          className="text-on-surface-variant hover:text-error transition-colors p-1"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </motion.button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
                {workflows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-on-surface-variant italic font-body-md">Aucun workflow configuré.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.type === 'workflow' ? 'Supprimer le workflow' : 'Supprimer la configuration'}
        message={
          pendingDelete?.type === 'workflow'
            ? 'Supprimer définitivement ce workflow ? Cette action est irréversible.'
            : 'Supprimer définitivement cette configuration ? Cette action est irréversible.'
        }
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={pendingDelete?.type === 'workflow' ? handleDeleteWorkflow : handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </motion.div>
  );
}
