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

function Toggle({ checked, onChange, disabled = false }) {
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

const PROVIDER_ICONS = {
  openai: 'smart_toy',
  anthropic: 'person',
  gemini: 'spa',
  mistral: 'air',
  nvidia: 'stadia_controller',
};

function ProviderModal({ provider, onClose, onUpdate }) {
  const [tab, setTab] = useState('models');
  const [syncing, setSyncing] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [testResults, setTestResults] = useState({});
  const [testModelResults, setTestModelResults] = useState({});
  const [modelForm, setModelForm] = useState({ name: '', label: '', type: 'CHAT' });
  const [keyForm, setKeyForm] = useState({ label: '', apiKey: '', modelId: '', isDefault: false });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleUpdateProvider(id, field, value) {
    try {
      await api.patch(`/ai-providers/${id}`, { [field]: value });
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleSyncModels(providerId) {
    setError('');
    setInfo('');
    setSyncing(providerId);
    try {
      const { data } = await api.post(`/ai-providers/${providerId}/sync-models`);
      setInfo(data.added > 0 ? `${data.added} nouveau(x) modèle(s) ajouté(s).` : 'Aucun nouveau modèle disponible.');
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la synchronisation');
    } finally {
      setSyncing(null);
    }
  }

  async function handleAddModel(providerId, e) {
    e.preventDefault();
    if (!modelForm.name) return;
    setSubmitting(true);
    try {
      await api.post(`/ai-providers/${providerId}/models`, { ...modelForm, type: modelForm.type || 'CHAT' });
      setModelForm({ name: '', label: '', type: 'CHAT' });
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout du modèle");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetDefaultModel(modelId) {
    try {
      await api.patch(`/ai-providers/models/${modelId}`, { isDefault: true });
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleToggleModelActive(modelId, isActive) {
    try {
      await api.patch(`/ai-providers/models/${modelId}`, { isActive });
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleAddKey(providerId, e) {
    e.preventDefault();
    if (!keyForm.label || !keyForm.apiKey) return;
    setSubmitting(true);
    try {
      await api.post(`/ai-providers/${providerId}/keys`, {
        label: keyForm.label,
        apiKey: keyForm.apiKey,
        modelId: keyForm.modelId ? Number(keyForm.modelId) : null,
        isDefault: !!keyForm.isDefault,
      });
      setKeyForm({ label: '', apiKey: '', modelId: '', isDefault: false });
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout de la clé");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleKeyActive(keyId, isActive) {
    try {
      await api.patch(`/ai-providers/keys/${keyId}`, { isActive });
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleSetDefaultKey(keyId) {
    try {
      await api.patch(`/ai-providers/keys/${keyId}`, { isDefault: true });
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
    }
  }

  async function handleTestKey(keyId) {
    setTestResults((prev) => ({ ...prev, [keyId]: { loading: true } }));
    try {
      const { data } = await api.post(`/ai-providers/keys/${keyId}/test`);
      setTestResults((prev) => ({ ...prev, [keyId]: { loading: false, ...data } }));
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
      setTimeout(() => setTestModelResults((prev) => { const n = { ...prev }; delete n[modelId]; return n; }), 8000);
    } catch (err) {
      setTestModelResults((prev) => ({ ...prev, [modelId]: { loading: false, ok: false, error: err.response?.data?.error || err.message } }));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 sm:p-8 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => onClose()}
        className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="relative bg-surface border border-outline-variant/40 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
      >
        {/* En-tête */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-outline-variant/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-surface-container-low rounded-xl border border-outline-variant/50 flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-primary text-2xl">{PROVIDER_ICONS[provider.name] || 'memory'}</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                {provider.label}
                <span className="border border-outline-variant/50 text-on-surface-variant px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold">{provider.name}</span>
                {provider.isActive && (
                  <span className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px] uppercase font-bold">Actif</span>
                )}
              </h3>
            </div>
          </div>
          <motion.button
            onClick={onClose}
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="border border-red-500/20 bg-red-500/5 text-red-500 p-3 rounded-xl text-xs"
            >{error}</motion.div>
          )}
          {info && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-3 rounded-xl text-xs"
            >{info}</motion.div>
          )}

          {/* Infos provider */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Identifiant technique</span>
              <input className={inputClass} value={provider.name} disabled />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">URL de base</span>
              <input className={inputClass} defaultValue={provider.baseUrl || ''}
                onBlur={(e) => handleUpdateProvider(provider.id, 'baseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Actif</span>
              <div className="flex items-center h-full pt-1">
                <Toggle checked={provider.isActive} onChange={(v) => handleUpdateProvider(provider.id, 'isActive', v)} />
              </div>
            </label>
          </div>

          {/* Onglets */}
          <div className="flex gap-1 p-1 rounded-xl bg-surface-container-high/50 w-fit">
            <button onClick={() => setTab('models')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${tab === 'models' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[14px] mr-1.5 align-middle">deployed_code</span>
              Modèles ({provider.models.length})
            </button>
            <button onClick={() => setTab('keys')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${tab === 'keys' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[14px] mr-1.5 align-middle">key</span>
              Clés API ({provider.keys.length})
            </button>
          </div>

          {/* Contenu des onglets */}
          {tab === 'models' && (
            <div className="space-y-4">
              <div className="border border-outline-variant/50 rounded-xl overflow-hidden bg-surface-container-lowest">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-bright/50 border-b border-outline-variant/50">
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3">Nom</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3">Libellé</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3 w-24">Type</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3 w-20 text-center">Par défaut</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3 w-20 text-center">Actif</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3 w-36 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs text-on-surface divide-y divide-outline-variant/30">
                    {provider.models.map((m) => (
                      <tr key={m.id} className="hover:bg-surface-container-low/40 transition-colors">
                        <td className="p-3 font-semibold">{m.name}</td>
                        <td className="p-3 text-on-surface-variant">{m.label || '-'}</td>
                        <td className="p-3">
                          <span className="border border-outline-variant/50 px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold">
                            {m.type === 'EMBEDDING' ? 'Embedding' : m.type === 'RERANK' ? 'Reranker' : 'Chat'}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <input type="radio" className="accent-primary w-4 h-4 cursor-pointer"
                            name={`modal-default-model-${provider.id}`}
                            checked={m.isDefault}
                            onChange={() => handleSetDefaultModel(m.id)}
                          />
                        </td>
                        <td className="p-3 text-center">
                          <input type="checkbox" className="w-4 h-4 accent-primary cursor-pointer"
                            checked={m.isActive}
                            onChange={(e) => handleToggleModelActive(m.id, e.target.checked)}
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            {m.type === 'CHAT' && (
                              <>
                                <motion.button onClick={() => handleTestModel(m.id)}
                                  disabled={testModelResults[m.id]?.loading}
                                  whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border border-outline-variant/30 text-on-surface-variant hover:border-primary/40 hover:text-primary disabled:opacity-50"
                                >
                                  {testModelResults[m.id]?.loading
                                    ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                                    : <span className="material-symbols-outlined text-[12px]">network_check</span>}
                                </motion.button>
                                {testModelResults[m.id] && !testModelResults[m.id].loading && (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                    testModelResults[m.id].ok
                                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                      : 'bg-red-500/10 text-red-500 border-red-500/20'
                                  }`}>
                                    <span className="material-symbols-outlined text-[9px]">{testModelResults[m.id].ok ? 'check_circle' : 'cancel'}</span>
                                    {testModelResults[m.id].ok ? `${testModelResults[m.id].latencyMs}ms` : 'Échec'}
                                  </span>
                                )}
                              </>
                            )}
                            <DeleteButton onClick={() => setPendingDelete({ type: 'model', id: m.id })} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {provider.models.length === 0 && (
                      <tr><td colSpan={6} className="p-6 text-center text-on-surface-variant italic">Aucun modèle configuré</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Ajouter un modèle */}
              <form onSubmit={(e) => handleAddModel(provider.id, e)} className="flex flex-wrap gap-2">
                <input className={`${inputClass} flex-1 min-w-[140px]`} placeholder="Nom du modèle (ex: gpt-4o)"
                  value={modelForm.name}
                  onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                />
                <input className={`${inputClass} flex-1 min-w-[140px]`} placeholder="Libellé (optionnel)"
                  value={modelForm.label}
                  onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })}
                />
                <select className={inputClass} value={modelForm.type}
                  onChange={(e) => setModelForm({ ...modelForm, type: e.target.value })}
                >
                  <option value="CHAT">Chat</option>
                  <option value="EMBEDDING">Embedding</option>
                  <option value="RERANK">Reranker</option>
                </select>
                <motion.button type="submit" disabled={submitting}
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 border border-outline-variant/50 rounded-xl bg-surface hover:bg-surface-container-high transition-all text-xs font-semibold shadow-sm disabled:opacity-50 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  Ajouter
                </motion.button>
              </form>

              <div className="flex justify-end">
                <motion.button onClick={() => handleSyncModels(provider.id)}
                  disabled={syncing === provider.id}
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-primary border border-primary/30 hover:bg-primary/5 disabled:opacity-50 transition-colors"
                >
                  <motion.span animate={syncing === provider.id ? { rotate: 360 } : { rotate: 0 }}
                    transition={syncing === provider.id ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
                    className="material-symbols-outlined text-[14px]"
                  >sync</motion.span>
                  {syncing === provider.id ? 'Synchro...' : 'Synchroniser les modèles depuis le provider'}
                </motion.button>
              </div>
            </div>
          )}

          {tab === 'keys' && (
            <div className="space-y-4">
              <div className="border border-outline-variant/50 rounded-xl overflow-hidden bg-surface-container-lowest">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-bright/50 border-b border-outline-variant/50">
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3">Libellé</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3">Clé</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3">Modèle</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3 w-20 text-center">Par défaut</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3 w-20 text-center">Actif</th>
                      <th className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider p-3 w-36 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs text-on-surface divide-y divide-outline-variant/30">
                    {provider.keys.map((k) => (
                      <tr key={k.id} className="hover:bg-surface-container-low/40 transition-colors">
                        <td className="p-3 font-semibold">{k.label}</td>
                        <td className="p-3 font-mono text-on-surface-variant truncate max-w-[160px]">{k.apiKey}</td>
                        <td className="p-3 text-on-surface-variant font-medium">{k.model?.name || 'Tous les modèles'}</td>
                        <td className="p-3 text-center">
                          <input type="radio" className="accent-primary w-4 h-4 cursor-pointer"
                            name={`modal-default-key-${provider.id}`}
                            checked={k.isDefault}
                            onChange={() => handleSetDefaultKey(k.id)}
                          />
                        </td>
                        <td className="p-3 text-center">
                          <input type="checkbox" className="w-4 h-4 accent-primary cursor-pointer"
                            checked={k.isActive}
                            onChange={(e) => handleToggleKeyActive(k.id, e.target.checked)}
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            <motion.button onClick={() => handleTestKey(k.id)}
                              disabled={testResults[k.id]?.loading}
                              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border border-outline-variant/30 text-on-surface-variant hover:border-primary/40 hover:text-primary disabled:opacity-50"
                            >
                              {testResults[k.id]?.loading
                                ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                                : <span className="material-symbols-outlined text-[12px]">network_check</span>}
                            </motion.button>
                            {testResults[k.id] && !testResults[k.id].loading && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                testResults[k.id].ok
                                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                  : 'bg-red-500/10 text-red-500 border-red-500/20'
                              }`}>
                                <span className="material-symbols-outlined text-[9px]">{testResults[k.id].ok ? 'check_circle' : 'cancel'}</span>
                                {testResults[k.id].ok ? `${testResults[k.id].latencyMs}ms` : 'Échec'}
                              </span>
                            )}
                            <DeleteButton onClick={() => setPendingDelete({ type: 'key', id: k.id })} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {provider.keys.length === 0 && (
                      <tr><td colSpan={6} className="p-6 text-center text-on-surface-variant italic">Aucune clé configurée</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Ajouter une clé */}
              <form onSubmit={(e) => handleAddKey(provider.id, e)} className="flex flex-wrap gap-2 items-center">
                <input className={`${inputClass} flex-1 min-w-[140px]`} placeholder="Libellé (ex: Clé prod)"
                  value={keyForm.label}
                  onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })}
                />
                <input type="password" className={`${inputClass} flex-1 min-w-[140px]`} placeholder="Clé API"
                  value={keyForm.apiKey}
                  onChange={(e) => setKeyForm({ ...keyForm, apiKey: e.target.value })}
                />
                <select className={inputClass} value={keyForm.modelId}
                  onChange={(e) => setKeyForm({ ...keyForm, modelId: e.target.value })}
                >
                  <option value="">Tous les modèles</option>
                  {provider.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-primary cursor-pointer"
                    checked={keyForm.isDefault}
                    onChange={(e) => setKeyForm({ ...keyForm, isDefault: e.target.checked })}
                  />
                  Par défaut
                </label>
                <motion.button type="submit" disabled={submitting}
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                  className="px-4 py-2 border border-outline-variant/50 rounded-xl bg-surface hover:bg-surface-container-high transition-all text-xs font-semibold shadow-sm disabled:opacity-50 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  Ajouter
                </motion.button>
              </form>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={!!pendingDelete}
          title={pendingDelete?.type === 'model' ? 'Supprimer le modèle' : 'Supprimer la clé API'}
          message="Cette action est irréversible."
          confirmLabel="Supprimer"
          danger
          loading={deleting}
          onConfirm={async () => {
            setDeleting(true);
            try {
              if (pendingDelete.type === 'model') await api.delete(`/ai-providers/models/${pendingDelete.id}`);
              else await api.delete(`/ai-providers/keys/${pendingDelete.id}`);
              setPendingDelete(null);
              onUpdate();
            } catch (err) {
              setError(err.response?.data?.error || 'Erreur de suppression');
            } finally {
              setDeleting(false);
            }
          }}
          onCancel={() => setPendingDelete(null)}
        />
      </motion.div>
    </div>
  );
}

function DeleteButton({ onClick }) {
  return (
    <motion.button onClick={onClick}
      whileHover={{ scale: 1.15, color: 'var(--color-error)' }}
      whileTap={{ scale: 0.9 }}
      className="text-on-surface-variant hover:text-error transition-colors p-1"
    >
      <span className="material-symbols-outlined text-[14px]">delete</span>
    </motion.button>
  );
}

export default function AiProvidersTab() {
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState('');
  const [providerForm, setProviderForm] = useState({ name: '', label: '', baseUrl: '' });
  const [submitting, setSubmitting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Rafraîchit la liste ET le fournisseur ouvert dans la modale (sans la fermer) : après une
  // action (modèle par défaut, suppression, sync...), le contenu affiché doit refléter la base
  // immédiatement, pas au prochain clic.
  function refresh() {
    api.get('/ai-providers')
      .then(({ data }) => {
        setProviders(data);
        setSelectedProvider((current) => (current ? data.find((p) => p.id === current.id) || null : current));
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(() => refresh(), []);

  async function handleCreateProvider(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/ai-providers', providerForm);
      setProviderForm({ name: '', label: '', baseUrl: '' });
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleProvider(id, isActive) {
    try {
      await api.patch(`/ai-providers/${id}`, { isActive });
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
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
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl text-xs overflow-hidden"
          >
            {error}
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
            <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Identifiant technique</span>
            <input className={inputClass} value={providerForm.name}
              onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
              placeholder="ex: openai, anthropic" required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Nom affiché</span>
            <input className={inputClass} value={providerForm.label}
              onChange={(e) => setProviderForm({ ...providerForm, label: e.target.value })}
              placeholder="ex: OpenAI" required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">URL de base (optionnel)</span>
            <input className={inputClass} value={providerForm.baseUrl}
              onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <div className="md:col-span-3 flex justify-end">
            <motion.button type="submit" disabled={submitting}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
              className="btn-gradient font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all text-xs disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>}
              {submitting ? 'Ajout...' : 'Ajouter le fournisseur'}
            </motion.button>
          </div>
        </form>
      </motion.div>

      <motion.h3 variants={itemVariants} className="font-headline-md text-headline-md text-on-surface font-bold">
        Fournisseurs configurés
      </motion.h3>

      {/* Grille de cartes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {providers.map((provider, pIdx) => (
            <motion.div
              key={provider.id}
              layout
              variants={itemVariants}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              whileHover={{ y: -4, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
              onClick={() => setSelectedProvider(provider)}
              className="bento-card p-5 flex flex-col gap-3 cursor-pointer group relative"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-container-low border border-outline-variant/50 flex items-center justify-center shadow-sm group-hover:border-primary/30 transition-colors">
                    <span className="material-symbols-outlined text-primary text-xl">{PROVIDER_ICONS[provider.name] || 'memory'}</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">{provider.label}</h4>
                    <span className="text-[10px] text-on-surface-variant font-mono uppercase">{provider.name}</span>
                  </div>
                </div>
                <motion.button
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(provider.id); }}
                  whileHover={{ scale: 1.15, color: 'var(--color-error)' }}
                  whileTap={{ scale: 0.9 }}
                  className="text-on-surface-variant/40 hover:text-error transition-colors p-1 opacity-0 group-hover:opacity-100"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </motion.button>
              </div>

              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">deployed_code</span>
                  {provider.models.length} modèle{provider.models.length !== 1 ? 's' : ''}
                </span>
                <span className="text-outline-variant">·</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">key</span>
                  {provider.keys.length} clé{provider.keys.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-outline-variant/20">
                <div className="flex items-center gap-1.5">
                  {provider.isActive ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Actif
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-on-surface-variant">
                      <span className="w-1.5 h-1.5 rounded-full bg-outline-variant" />
                      Inactif
                    </span>
                  )}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Toggle checked={provider.isActive} onChange={(v) => handleToggleProvider(provider.id, v)} />
                </div>
              </div>

              {provider.baseUrl && (
                <p className="text-[9px] font-mono text-on-surface-variant truncate mt-1">{provider.baseUrl}</p>
              )}
            </motion.div>
          ))}

          {providers.length === 0 && (
            <motion.div variants={itemVariants}
              className="col-span-full p-12 text-center rounded-3xl border border-dashed border-outline-variant/30 bg-surface-container-lowest/30"
            >
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3">memory</span>
              <p className="text-sm text-on-surface-variant">Aucun fournisseur configuré</p>
              <p className="text-xs text-on-surface-variant/60 mt-1">Ajoutez un fournisseur ci-dessus pour commencer.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selectedProvider && (
          <ProviderModal
            provider={selectedProvider}
            onClose={() => setSelectedProvider(null)}
            onUpdate={() => refresh()}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer le fournisseur"
        message="Supprimer définitivement ce fournisseur et toutes ses clés/modèles ? Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api.delete(`/ai-providers/${pendingDelete}`);
            setPendingDelete(null);
            refresh();
          } catch (err) {
            setError(err.response?.data?.error || 'Erreur lors de la suppression');
          } finally {
            setDeleting(false);
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </motion.div>
  );
}
