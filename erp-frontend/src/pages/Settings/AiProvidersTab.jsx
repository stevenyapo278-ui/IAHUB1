import { useEffect, useState } from 'react';
import api from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog';

function Toggle({ checked, onChange }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
      <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-on-surface after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-on-surface-variant"></div>
    </label>
  );
}

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

export default function AiProvidersTab() {
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState('');

  const [providerForm, setProviderForm] = useState({ name: '', label: '', baseUrl: '' });
  const [modelForms, setModelForms] = useState({});
  const [keyForms, setKeyForms] = useState({});
  const [syncing, setSyncing] = useState(null);
  const [info, setInfo] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'provider'|'model'|'key', id }
  const [deleting, setDeleting] = useState(false);

  function load() {
    api
      .get('/ai-providers')
      .then(({ data }) => setProviders(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  async function handleCreateProvider(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/ai-providers', providerForm);
      setProviderForm({ name: '', label: '', baseUrl: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
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
    try {
      await api.post(`/ai-providers/${providerId}/models`, { ...form, type: form.type || 'CHAT' });
      setModelForms({ ...modelForms, [providerId]: { name: '', label: '', type: 'CHAT' } });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout du modèle");
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

  // Surcharge pour utiliser le style standard de Toggle ou un input checkbox de base plus soigné
  function CustomToggle({ checked, onChange }) {
    return (
      <label className="relative inline-flex items-center cursor-pointer">
        <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
        <div className="w-11 h-6 bg-surface-container-high rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-outline-variant/60 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
      </label>
    );
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

  return (
    <div className="space-y-lg">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Configurez les fournisseurs d'IA, leurs modèles, et les clés API associées. Vous pouvez ajouter
        plusieurs clés pour un même fournisseur ou un même modèle (rotation, comptes différents),
        et choisir laquelle est utilisée par défaut.
      </p>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}
      {info && (
        <div className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-md rounded-xl font-body-md">
          {info}
        </div>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
        <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold mb-md">Ajouter un fournisseur</h3>
        <form onSubmit={handleCreateProvider} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end">
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
            <button
              type="submit"
              className="bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
            >
              Ajouter le fournisseur
            </button>
          </div>
        </form>
      </div>

      <h3 className="font-headline-md text-headline-md text-on-surface font-bold">Fournisseurs configurés</h3>

      {providers.map((provider) => (
        <div key={provider.id} className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-lg">
          <div className="flex justify-between items-start border-b border-outline-variant/40 pb-md">
            <div className="flex items-center gap-md">
              <div className="w-12 h-12 bg-surface-container-low rounded-xl border border-outline-variant/60 flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-primary text-2xl">memory</span>
              </div>
              <div className="space-y-1">
                <h4 className="font-headline-md text-headline-md text-on-surface flex items-center gap-sm font-semibold">
                  {provider.label}
                  <span className="border border-outline-variant/60 text-on-surface-variant px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-semibold">{provider.name}</span>
                  {provider.isActive && (
                    <span className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-bold dark:bg-emerald-500/15 dark:text-emerald-400">Actif</span>
                  )}
                </h4>
                <input
                  defaultValue={provider.baseUrl || ''}
                  onBlur={(e) => handleUpdateProvider(provider.id, 'baseUrl', e.target.value)}
                  placeholder="URL de base"
                  className="font-mono-sm text-mono-sm text-on-surface bg-surface border border-outline-variant/60 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 w-full max-w-md"
                />
              </div>
            </div>
            <div className="flex items-center gap-md">
              <CustomToggle checked={provider.isActive} onChange={(v) => handleUpdateProvider(provider.id, 'isActive', v)} />
              <button onClick={() => askDeleteProvider(provider.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
                <span className="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-sm">
              <h5 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Modèles</h5>
              <button
                onClick={() => handleSyncModels(provider.id)}
                disabled={syncing === provider.id}
                className="flex items-center gap-1 text-primary font-semibold text-body-sm hover:underline disabled:opacity-50 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">sync</span>
                {syncing === provider.id ? 'Synchronisation...' : 'Synchroniser les modèles'}
              </button>
            </div>
            <div className="border border-outline-variant/60 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Nom</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">Libellé</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-28">Type</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Par défaut</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Actif</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-16 text-right"></th>
                  </tr>
                </thead>
                <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant/40">
                  {provider.models.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="p-3 font-semibold">{m.name}</td>
                      <td className="p-3 text-on-surface-variant">{m.label || '-'}</td>
                      <td className="p-3 text-on-surface-variant">
                        <span className="border border-outline-variant/60 px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold">
                          {m.type === 'EMBEDDING' ? 'Embedding' : 'Chat'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="radio"
                          className="accent-primary w-4 h-4 cursor-pointer"
                          name={`default-model-${provider.id}-${m.type}`}
                          checked={m.isDefault}
                          onChange={() => handleSetDefaultModel(m.id, true)}
                        />
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-primary cursor-pointer"
                          checked={m.isActive}
                          onChange={(e) => api.patch(`/ai-providers/models/${m.id}`, { isActive: e.target.checked }).then(load)}
                        />
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => askDeleteModel(m.id)} className="text-on-surface-variant hover:text-error transition-colors">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </td>
                    </tr>
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
              <input
                className={`${inputClass} flex-1 min-w-[180px]`}
                placeholder="Nom du modèle (ex: gpt-4o)"
                value={modelForms[provider.id]?.name || ''}
                onChange={(e) => setModelForms({ ...modelForms, [provider.id]: { ...modelForms[provider.id], name: e.target.value } })}
              />
              <input
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
              </select>
              <button 
                type="submit" 
                className="px-4 py-2 border border-outline-variant/60 rounded-xl bg-surface hover:bg-surface-container-high transition-all text-body-sm font-semibold shadow-sm flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[18px]">add</span> 
                Ajouter le modèle
              </button>
            </form>
          </div>

          <div className="border-t border-outline-variant/40 pt-md">
            <h5 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-sm">Clés API</h5>
            <div className="border border-outline-variant/60 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse">
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
                    <tr key={k.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="p-3 font-semibold">{k.label}</td>
                      <td className="p-3 font-mono-sm text-mono-sm text-on-surface-variant truncate max-w-xs">{k.apiKey}</td>
                      <td className="p-3 text-on-surface-variant font-medium">{k.model?.name || 'Tous les modèles'}</td>
                      <td className="p-3 text-center">
                        <input
                          type="radio"
                          className="accent-primary w-4 h-4 cursor-pointer"
                          name={`default-key-${provider.id}-${k.modelId || 'none'}`}
                          checked={k.isDefault}
                          onChange={() => handleSetDefaultKey(k.id, true)}
                        />
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-primary cursor-pointer"
                          checked={k.isActive}
                          onChange={(e) => handleToggleKeyActive(k.id, e.target.checked)}
                        />
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => askDeleteKey(k.id)} className="text-on-surface-variant hover:text-error transition-colors">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </td>
                    </tr>
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
              <input
                className={`${inputClass} flex-1 min-w-[160px]`}
                placeholder="Libellé (ex: Clé société)"
                value={keyForms[provider.id]?.label || ''}
                onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], label: e.target.value } })}
              />
              <input
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
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary cursor-pointer"
                  checked={keyForms[provider.id]?.isDefault || false}
                  onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], isDefault: e.target.checked } })}
                />
                Par défaut
              </label>
              <button 
                type="submit" 
                className="px-4 py-2 border border-outline-variant/60 rounded-xl bg-surface hover:bg-surface-container-high transition-all text-body-sm font-semibold shadow-sm flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[18px]">add</span> 
                Ajouter la clé
              </button>
            </form>
          </div>
        </div>
      ))}

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
    </div>
  );
}
