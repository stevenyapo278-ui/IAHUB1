import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog';

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

function CustomToggle({ checked, onChange }) {
  return (
    <motion.label className="relative inline-flex items-center cursor-pointer" whileTap={{ scale: 0.92 }}>
      <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
      <div className="w-11 h-6 bg-surface-container-high rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-outline-variant/60 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
    </motion.label>
  );
}

function DeleteButton({ onClick }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.15, color: 'var(--color-error)' }}
      whileTap={{ scale: 0.9 }}
      className="text-on-surface-variant hover:text-error transition-colors p-1"
    >
      <span className="material-symbols-outlined text-[18px]">delete</span>
    </motion.button>
  );
}

export default function AiProvidersTab() {
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState('');
  const [expandedSections, setExpandedSections] = useState({});

  function toggleSection(providerId, section) {
    const key = `${providerId}-${section}`;
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const [providerForm, setProviderForm] = useState({ name: '', label: '', baseUrl: '' });
  const [modelForms, setModelForms] = useState({});
  const [keyForms, setKeyForms] = useState({});
  const [syncing, setSyncing] = useState(null);
  const [info, setInfo] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'provider'|'model'|'key', id }
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testResults, setTestResults] = useState({}); // { [keyId]: { loading, ok, latencyMs, modelCount, error } }
  const [testModelResults, setTestModelResults] = useState({}); // { [modelId]: { loading, ok, latencyMs, error } }

  function load(openKeysForNew = false) {
    api
      .get('/ai-providers')
      .then(({ data }) => {
        setProviders(data);
        // Ouvrir la section "Clés API" par défaut pour chaque fournisseur (au 1er chargement et après création)
        if (openKeysForNew) {
          setExpandedSections((prev) => {
            const defaults = {};
            data.forEach((p) => { if (prev[`${p.id}-keys`] === undefined) defaults[`${p.id}-keys`] = true; });
            return { ...defaults, ...prev };
          });
        }
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(() => load(true), []);

  async function handleCreateProvider(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/ai-providers', providerForm);
      setProviderForm({ name: '', label: '', baseUrl: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateProvider(id, field, value) {
    try {
      await api.patch(`/ai-providers/${id}`, { [field]: value });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  function askDeleteProvider(id) {
    setPendingDelete({ type: 'provider', id });
  }

  async function handleDeleteProvider() {
    if (!pendingDelete || pendingDelete.type !== 'provider') return;
    setDeleting(true);
    try {
      await api.delete(`/ai-providers/${pendingDelete.id}`);
      load();
      setPendingDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSyncModels(providerId) {
    setError('');
    setInfo('');
    setSyncing(providerId);
    try {
      const { data } = await api.post(`/ai-providers/${providerId}/sync-models`);
      setInfo(data.added > 0 ? `${data.added} nouveau(x) modèle(s) ajouté(s).` : 'Aucun nouveau modèle disponible.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la synchronisation');
    } finally {
      setSyncing(null);
    }
  }

  async function handleAddModel(providerId, e) {
    e.preventDefault();
    const form = modelForms[providerId] || { name: '', label: '', type: 'CHAT' };
    if (!form.name) return;
    setSubmitting(true);
    try {
      await api.post(`/ai-providers/${providerId}/models`, { ...form, type: form.type || 'CHAT' });
      setModelForms({ ...modelForms, [providerId]: { name: '', label: '', type: 'CHAT' } });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout du modèle");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetDefaultModel(modelId, isDefault) {
    try {
      await api.patch(`/ai-providers/models/${modelId}`, { isDefault });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  function askDeleteModel(modelId) {
    setPendingDelete({ type: 'model', id: modelId });
  }

  async function handleDeleteModel() {
    if (!pendingDelete || pendingDelete.type !== 'model') return;
    setDeleting(true);
    try {
      await api.delete(`/ai-providers/models/${pendingDelete.id}`);
      load();
      setPendingDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddKey(providerId, e) {
    e.preventDefault();
    const form = keyForms[providerId] || { label: '', apiKey: '', modelId: '', isDefault: false };
    if (!form.label || !form.apiKey) return;
    setSubmitting(true);
    try {
      await api.post(`/ai-providers/${providerId}/keys`, {
        label: form.label,
        apiKey: form.apiKey,
        modelId: form.modelId ? Number(form.modelId) : null,
        isDefault: !!form.isDefault,
      });
      setKeyForms({ ...keyForms, [providerId]: { label: '', apiKey: '', modelId: '', isDefault: false } });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout de la clé");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetDefaultKey(keyId, isDefault) {
    try {
      await api.patch(`/ai-providers/keys/${keyId}`, { isDefault });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  async function handleToggleKeyActive(keyId, isActive) {
    try {
      await api.patch(`/ai-providers/keys/${keyId}`, { isActive });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  function askDeleteKey(keyId) {
    setPendingDelete({ type: 'key', id: keyId });
  }

  async function handleDeleteKey() {
    if (!pendingDelete || pendingDelete.type !== 'key') return;
    setDeleting(true);
    try {
      await api.delete(`/ai-providers/keys/${pendingDelete.id}`);
      load();
      setPendingDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  async function handleTestKey(keyId) {
    setTestResults((prev) => ({ ...prev, [keyId]: { loading: true } }));
    try {
      const { data } = await api.post(`/ai-providers/keys/${keyId}/test`);
      setTestResults((prev) => ({ ...prev, [keyId]: { loading: false, ...data } }));
      // Efface le résultat après 8 secondes
      setTimeout(() => setTestResults((prev) => { const n = { ...prev }; delete n[keyId]; return n; }), 8000);
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [keyId]: { loading: false, ok: false, error: err.response?.data?.error || err.message } }));
    }
  }

  async function handleTestModel(modelId) {
    setTestModelResults((prev) => ({ ...prev, [modelId]: { loading: true } }));
    try {
      const { data } = await api.post(`/ai-providers/models/${modelId}/test`);
      setTestModelResults((prev) => ({ ...prev, [modelId]: { loading: false, ...data } }));
      // Efface le résultat après 8 secondes
      setTimeout(() => setTestModelResults((prev) => { const n = { ...prev }; delete n[modelId]; return n; }), 8000);
    } catch (err) {
      setTestModelResults((prev) => ({ ...prev, [modelId]: { loading: false, ok: false, error: err.response?.data?.error || err.message } }));
    }
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
      className="space-y-lg"
    >
      <AnimatePresence>
        {error && (
          <motion.div
            key="ai-error"
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
            key="ai-info"
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

      {/* Ajouter un fournisseur */}
      <motion.div variants={itemVariants} className="bento-card p-lg">
        <div className="bento-card-header px-0 py-0 pb-md border-b border-outline-variant/40">
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Ajouter un fournisseur</h3>
        </div>
        <form onSubmit={handleCreateProvider} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end pt-md">
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Identifiant technique</span>
            <input
              className={inputClass}
              value={providerForm.name}
              onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
              placeholder="ex: openai, anthropic"
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom affiché</span>
            <input
              className={inputClass}
              value={providerForm.label}
              onChange={(e) => setProviderForm({ ...providerForm, label: e.target.value })}
              placeholder="ex: OpenAI"
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">URL de base (optionnel)</span>
            <input
              className={inputClass}
              value={providerForm.baseUrl}
              onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <div className="md:col-span-3 flex justify-end">
            <motion.button
              type="submit"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              disabled={submitting}
              className="btn-gradient font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>}
              {submitting ? 'Ajout...' : 'Ajouter le fournisseur'}
            </motion.button>
          </div>
        </form>
      </motion.div>

      <motion.h3 variants={itemVariants} className="font-headline-md text-headline-md text-on-surface font-bold">
        Fournisseurs configurés
      </motion.h3>

      {providers.map((provider, pIdx) => {
        const isModelsExpanded = !!expandedSections[`${provider.id}-models`];
        const isKeysExpanded = !!expandedSections[`${provider.id}-keys`];

        return (
          <motion.div
            key={provider.id}
            variants={itemVariants}
            layout
            className="bento-card p-lg flex flex-col gap-lg"
          >
            {/* Provider header */}
            <div className="flex justify-between items-start border-b border-outline-variant/40 pb-md">
              <div className="flex items-center gap-md">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: pIdx * 0.05 + 0.1, type: 'spring', stiffness: 200, damping: 15 }}
                  className="w-12 h-12 bg-surface-container-low rounded-xl border border-outline-variant/60 flex items-center justify-center shadow-sm"
                >
                  <span className="material-symbols-outlined text-primary text-2xl">memory</span>
                </motion.div>
                <div className="space-y-1">
                  <h4 className="font-headline-md text-headline-md text-on-surface flex items-center gap-sm font-semibold">
                    {provider.label}
                    <span className="border border-outline-variant/60 text-on-surface-variant px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-semibold">{provider.name}</span>
                    {provider.isActive && (
                      <motion.span
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-bold dark:bg-emerald-500/15 dark:text-emerald-400"
                      >
                        Actif
                      </motion.span>
                    )}
                  </h4>
                  <motion.input
                    defaultValue={provider.baseUrl || ''}
                    onBlur={(e) => handleUpdateProvider(provider.id, 'baseUrl', e.target.value)}
                    placeholder="URL de base"
                    whileFocus={{ scale: 1.01 }}
                    className="font-mono-sm text-mono-sm text-on-surface bg-surface border border-outline-variant/60 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 w-full max-w-md"
                  />
                </div>
              </div>
              <div className="flex items-center gap-md">
                <CustomToggle checked={provider.isActive} onChange={(v) => handleUpdateProvider(provider.id, 'isActive', v)} />
                <DeleteButton onClick={() => askDeleteProvider(provider.id)} />
              </div>
            </div>

            {/* Modèles (Accordion) */}
            <div className="border border-outline-variant/60 rounded-2xl p-md bg-surface/20">
              <div
                onClick={() => toggleSection(provider.id, 'models')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(provider.id, 'models'); } }}
                tabIndex={0}
                role="button"
                aria-expanded={isModelsExpanded}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface-variant text-[20px] group-hover:text-primary transition-colors">deployed_code</span>
                  <h5 className="font-headline-sm text-headline-sm text-on-surface font-semibold group-hover:text-primary transition-colors">Modèles</h5>
                  <span className="bg-surface-container-high text-on-surface-variant px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                    {provider.models.length}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <motion.button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSyncModels(provider.id);
                    }}
                    disabled={syncing === provider.id}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    className="flex items-center gap-1 text-primary font-semibold text-body-sm hover:underline disabled:opacity-50 transition-colors mr-2"
                  >
                    <motion.span
                      animate={syncing === provider.id ? { rotate: 360 } : { rotate: 0 }}
                      transition={syncing === provider.id ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
                      className="material-symbols-outlined text-sm"
                    >
                      sync
                    </motion.span>
                    {syncing === provider.id ? 'Synchro...' : 'Synchroniser'}
                  </motion.button>
                  <motion.span
                    animate={{ rotate: isModelsExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="material-symbols-outlined text-on-surface-variant text-[20px]"
                  >
                    expand_more
                  </motion.span>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isModelsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="pt-md space-y-md">
                      <div className="border border-outline-variant/60 rounded-xl overflow-hidden bg-surface-container-lowest overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                          <thead>
                            <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Nom</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Libellé</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-28">Type</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Par défaut</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Actif</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-48 text-right"></th>
                            </tr>
                          </thead>
                          <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant/40">
                            {provider.models.map((m) => (
                              <motion.tr
                                key={m.id}
                                layout
                                className="hover:bg-surface-container-low/40 transition-colors"
                              >
                                <td className="p-3 font-semibold">{m.name}</td>
                                <td className="p-3 text-on-surface-variant">{m.label || '-'}</td>
                                <td className="p-3 text-on-surface-variant">
                                  <span className="border border-outline-variant/60 px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold">
                                    {m.type === 'EMBEDDING' ? 'Embedding' : m.type === 'RERANK' ? 'Reranker' : 'Chat'}
                                  </span>
                                </td>
                                <td className="p-3 text-center">
                                  <motion.input
                                    type="radio"
                                    className="accent-primary w-4 h-4 cursor-pointer"
                                    name={`default-model-${provider.id}-${m.type}`}
                                    checked={m.isDefault}
                                    onChange={() => handleSetDefaultModel(m.id, true)}
                                    whileTap={{ scale: 1.2 }}
                                  />
                                </td>
                                <td className="p-3 text-center">
                                  <motion.input
                                    type="checkbox"
                                    className="w-4 h-4 accent-primary cursor-pointer"
                                    checked={m.isActive}
                                    onChange={(e) => api.patch(`/ai-providers/models/${m.id}`, { isActive: e.target.checked }).then(load)}
                                    whileTap={{ scale: 1.2 }}
                                  />
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {/* Bouton test connectivité */}
                                    {m.type === 'CHAT' && (
                                      <div className="relative group">
                                        <motion.button
                                          onClick={() => handleTestModel(m.id)}
                                          disabled={testModelResults[m.id]?.loading}
                                          whileHover={{ scale: 1.1 }}
                                          whileTap={{ scale: 0.9 }}
                                          title="Tester la connectivité"
                                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all duration-150
                                                     text-on-surface-variant border-outline-variant/40 hover:border-primary/40 hover:text-primary hover:bg-primary/5
                                                     disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {testModelResults[m.id]?.loading ? (
                                            <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                          ) : (
                                            <span className="material-symbols-outlined text-[14px]">network_check</span>
                                          )}
                                          <span className="hidden sm:inline">Tester</span>
                                        </motion.button>
                                      </div>
                                    )}
                                    {/* Résultat du test */}
                                    {testModelResults[m.id] && !testModelResults[m.id].loading && (
                                      <motion.span
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                          testModelResults[m.id].ok
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                            : 'bg-red-500/10 text-red-500 border-red-500/20'
                                        }`}
                                        title={testModelResults[m.id].error || `${testModelResults[m.id].latencyMs}ms`}
                                      >
                                        <span className="material-symbols-outlined text-[11px]">{testModelResults[m.id].ok ? 'check_circle' : 'cancel'}</span>
                                        {testModelResults[m.id].ok ? `${testModelResults[m.id].latencyMs}ms` : 'Échec'}
                                      </motion.span>
                                    )}
                                    <DeleteButton onClick={() => askDeleteModel(m.id)} />
                                  </div>
                                </td>
                              </motion.tr>
                            ))}
                            {provider.models.length === 0 && (
                              <tr>
                                <td colSpan={6} className="p-6 text-center text-on-surface-variant italic">Aucun modèle configuré</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <form onSubmit={(e) => handleAddModel(provider.id, e)} className="flex flex-wrap gap-3 mt-md">
                        <motion.input
                          whileFocus={{ scale: 1.01 }}
                          className={`${inputClass} flex-1 min-w-[180px]`}
                          placeholder="Nom du modèle (ex: gpt-4o)"
                          value={modelForms[provider.id]?.name || ''}
                          onChange={(e) => setModelForms({ ...modelForms, [provider.id]: { ...modelForms[provider.id], name: e.target.value } })}
                        />
                        <motion.input
                          whileFocus={{ scale: 1.01 }}
                          className={`${inputClass} flex-1 min-w-[180px]`}
                          placeholder="Libellé (optionnel)"
                          value={modelForms[provider.id]?.label || ''}
                          onChange={(e) => setModelForms({ ...modelForms, [provider.id]: { ...modelForms[provider.id], label: e.target.value } })}
                        />
                        <select
                          className={inputClass}
                          value={modelForms[provider.id]?.type || 'CHAT'}
                          onChange={(e) => setModelForms({ ...modelForms, [provider.id]: { ...modelForms[provider.id], type: e.target.value } })}
                        >
                          <option value="CHAT">Chat</option>
                          <option value="EMBEDDING">Embedding</option>
                          <option value="RERANK">Reranker</option>
                        </select>
                        <motion.button
                          type="submit"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                          disabled={submitting}
                          className="px-4 py-2 border border-outline-variant/60 rounded-xl bg-surface hover:bg-surface-container-high transition-all text-body-sm font-semibold shadow-sm flex items-center gap-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {submitting ? <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">add</span>}
                          Ajouter le modèle
                        </motion.button>
                      </form>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Clés API (Accordion) */}
            <div className="border border-outline-variant/60 rounded-2xl p-md bg-surface/20">
              <div
                onClick={() => toggleSection(provider.id, 'keys')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(provider.id, 'keys'); } }}
                tabIndex={0}
                role="button"
                aria-expanded={isKeysExpanded}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface-variant text-[20px] group-hover:text-primary transition-colors">key</span>
                  <h5 className="font-headline-sm text-headline-sm text-on-surface font-semibold group-hover:text-primary transition-colors">Clés API</h5>
                  <span className="bg-surface-container-high text-on-surface-variant px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                    {provider.keys.length}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <motion.span
                    animate={{ rotate: isKeysExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="material-symbols-outlined text-on-surface-variant text-[20px]"
                  >
                    expand_more
                  </motion.span>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isKeysExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="pt-md space-y-md">
                      <div className="border border-outline-variant/60 rounded-xl overflow-hidden bg-surface-container-lowest overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                          <thead>
                            <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Libellé</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Clé</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Modèle</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Par défaut</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Actif</th>
                              <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-16 text-right"></th>
                            </tr>
                          </thead>
                          <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant/40">
                            {provider.keys.map((k) => (
                              <motion.tr
                                key={k.id}
                                layout
                                className="hover:bg-surface-container-low/40 transition-colors"
                              >
                                <td className="p-3 font-semibold">{k.label}</td>
                                <td className="p-3 font-mono-sm text-mono-sm text-on-surface-variant truncate max-w-xs">{k.apiKey}</td>
                                <td className="p-3 text-on-surface-variant font-medium">{k.model?.name || 'Tous les modèles'}</td>
                                <td className="p-3 text-center">
                                  <motion.input
                                    type="radio"
                                    className="accent-primary w-4 h-4 cursor-pointer"
                                    name={`default-key-${provider.id}-${k.modelId || 'none'}`}
                                    checked={k.isDefault}
                                    onChange={() => handleSetDefaultKey(k.id, true)}
                                    whileTap={{ scale: 1.2 }}
                                  />
                                </td>
                                <td className="p-3 text-center">
                                  <motion.input
                                    type="checkbox"
                                    className="w-4 h-4 accent-primary cursor-pointer"
                                    checked={k.isActive}
                                    onChange={(e) => handleToggleKeyActive(k.id, e.target.checked)}
                                    whileTap={{ scale: 1.2 }}
                                  />
                                </td>
                                 <td className="p-3">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {/* Bouton test connectivité */}
                                    <div className="relative group">
                                      <motion.button
                                        onClick={() => handleTestKey(k.id)}
                                        disabled={testResults[k.id]?.loading}
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.9 }}
                                        title="Tester la connectivité"
                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all duration-150
                                                   text-on-surface-variant border-outline-variant/40 hover:border-primary/40 hover:text-primary hover:bg-primary/5
                                                   disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {testResults[k.id]?.loading ? (
                                          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                        ) : (
                                          <span className="material-symbols-outlined text-[14px]">network_check</span>
                                        )}
                                        <span className="hidden sm:inline">Tester</span>
                                      </motion.button>
                                    </div>
                                    {/* Résultat du test */}
                                    {testResults[k.id] && !testResults[k.id].loading && (
                                      <motion.span
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                          testResults[k.id].ok
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                            : 'bg-red-500/10 text-red-500 border-red-500/20'
                                        }`}
                                        title={testResults[k.id].error || `${testResults[k.id].latencyMs}ms — ${testResults[k.id].modelCount ?? '?'} modèles`}
                                      >
                                        <span className="material-symbols-outlined text-[11px]">{testResults[k.id].ok ? 'check_circle' : 'cancel'}</span>
                                        {testResults[k.id].ok ? `${testResults[k.id].latencyMs}ms` : 'Échec'}
                                      </motion.span>
                                    )}
                                    <DeleteButton onClick={() => askDeleteKey(k.id)} />
                                  </div>
                                 </td>
                              </motion.tr>
                            ))}
                            {provider.keys.length === 0 && (
                              <tr>
                                <td colSpan={6} className="p-6 text-center text-on-surface-variant italic">Aucune clé configurée</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <form onSubmit={(e) => handleAddKey(provider.id, e)} className="flex flex-wrap items-center gap-3 mt-md">
                        <motion.input
                          whileFocus={{ scale: 1.01 }}
                          className={`${inputClass} flex-1 min-w-[160px]`}
                          placeholder="Libellé (ex: Clé société)"
                          value={keyForms[provider.id]?.label || ''}
                          onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], label: e.target.value } })}
                        />
                        <motion.input
                          whileFocus={{ scale: 1.01 }}
                          type="password"
                          className={`${inputClass} flex-1 min-w-[160px]`}
                          placeholder="Clé API"
                          value={keyForms[provider.id]?.apiKey || ''}
                          onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], apiKey: e.target.value } })}
                        />
                        <select
                          className={inputClass}
                          value={keyForms[provider.id]?.modelId || ''}
                          onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], modelId: e.target.value } })}
                        >
                          <option value="">Tous les modèles</option>
                          {provider.models.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant cursor-pointer">
                          <motion.input
                            type="checkbox"
                            className="w-4 h-4 accent-primary cursor-pointer"
                            checked={keyForms[provider.id]?.isDefault || false}
                            onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], isDefault: e.target.checked } })}
                            whileTap={{ scale: 1.2 }}
                          />
                          Par défaut
                        </label>
                        <motion.button
                          type="submit"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                          disabled={submitting}
                          className="px-4 py-2 border border-outline-variant/60 rounded-xl bg-surface hover:bg-surface-container-high transition-all text-body-sm font-semibold shadow-sm flex items-center gap-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {submitting ? <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">add</span>}
                          Ajouter la clé
                        </motion.button>
                      </form>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        );
      })}

      <ConfirmDialog
        open={!!pendingDelete}
        title={
          pendingDelete?.type === 'provider'
            ? 'Supprimer le fournisseur'
            : pendingDelete?.type === 'model'
            ? 'Supprimer le modèle'
            : 'Supprimer la clé API'
        }
        message={
          pendingDelete?.type === 'provider'
            ? 'Supprimer définitivement ce fournisseur et toutes ses clés/modèles ? Cette action est irréversible.'
            : pendingDelete?.type === 'model'
            ? 'Supprimer définitivement ce modèle ? Cette action est irréversible.'
            : 'Supprimer définitivement cette clé API ? Cette action est irréversible.'
        }
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={
          pendingDelete?.type === 'provider'
            ? handleDeleteProvider
            : pendingDelete?.type === 'model'
            ? handleDeleteModel
            : handleDeleteKey
        }
        onCancel={() => setPendingDelete(null)}
      />
    </motion.div>
  );
}
