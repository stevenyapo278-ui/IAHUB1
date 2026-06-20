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
  'h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface';

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
        Configure les fournisseurs d'IA, leurs modèles, et les clés API associées. Tu peux ajouter
        plusieurs clés pour un même fournisseur ou un même modèle (rotation, comptes différents),
        et choisir laquelle est utilisée par défaut.
      </p>
      {error && <div className="border border-outline-variant p-md rounded-none text-on-surface">{error}</div>}
      {info && <div className="border border-outline-variant p-md rounded-none text-on-surface">{info}</div>}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
        <h3 className="font-headline-md text-headline-md text-on-surface mb-md">Ajouter un fournisseur</h3>
        <form onSubmit={handleCreateProvider} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end">
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Identifiant technique</span>
            <input
              className={inputClass}
              value={providerForm.name}
              onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
              placeholder="ex: openai, anthropic"
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Nom affiché</span>
            <input
              className={inputClass}
              value={providerForm.label}
              onChange={(e) => setProviderForm({ ...providerForm, label: e.target.value })}
              placeholder="ex: OpenAI"
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">URL de base (optionnel)</span>
            <input
              className={inputClass}
              value={providerForm.baseUrl}
              onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <div className="md:col-span-3">
            <button
              type="submit"
              className="px-md py-sm rounded-none border border-outline-variant text-on-surface font-headline-sm text-headline-sm hover:bg-surface-container-low transition-colors"
            >
              Ajouter le fournisseur
            </button>
          </div>
        </form>
      </div>

      <h3 className="font-headline-md text-headline-md text-on-surface">Fournisseurs configurés</h3>

      {providers.map((provider) => (
        <div key={provider.id} className="bg-surface-container-lowest border border-outline-variant rounded-none p-xl">
          <div className="flex justify-between items-start border-b border-outline-variant pb-md mb-md">
            <div className="flex items-center gap-md">
              <div className="w-12 h-12 bg-surface-container rounded-none border border-outline-variant flex items-center justify-center">
                <span className="material-symbols-outlined text-on-surface text-2xl">memory</span>
              </div>
              <div>
                <h4 className="font-headline-md text-headline-md text-on-surface flex items-center gap-sm">
                  {provider.label}
                  <span className="border border-outline-variant text-on-surface-variant px-xs py-[2px] rounded-none font-label-md text-[10px] uppercase">{provider.name}</span>
                  {provider.isActive && (
                    <span className="border border-outline-variant text-on-surface-variant px-xs py-[2px] rounded-none font-label-md text-[10px] uppercase">Actif</span>
                  )}
                </h4>
                <input
                  defaultValue={provider.baseUrl || ''}
                  onBlur={(e) => handleUpdateProvider(provider.id, 'baseUrl', e.target.value)}
                  placeholder="URL de base"
                  className="font-mono-sm text-mono-sm text-on-surface-variant mt-xs bg-transparent border-b border-transparent hover:border-outline-variant focus:border-on-surface focus:outline-none w-full max-w-md"
                />
              </div>
            </div>
            <div className="flex items-center gap-md">
              <Toggle checked={provider.isActive} onChange={(v) => handleUpdateProvider(provider.id, 'isActive', v)} />
              <button onClick={() => askDeleteProvider(provider.id)} className="text-on-surface-variant hover:text-error transition-colors">
                <span className="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>

          <div className="mb-lg">
            <div className="flex items-center justify-between mb-sm">
              <h5 className="font-headline-sm text-headline-sm text-on-surface">Modèles</h5>
              <button
                onClick={() => handleSyncModels(provider.id)}
                disabled={syncing === provider.id}
                className="flex items-center gap-1 text-on-surface font-headline-sm text-body-sm hover:underline disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">sync</span>
                {syncing === provider.id ? 'Synchronisation...' : 'Synchroniser les modèles'}
              </button>
            </div>
            <div className="border border-outline-variant rounded-none overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant">
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Nom</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Libellé</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-28">Type</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-24 text-center">Par défaut</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-24 text-center">Actif</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-16"></th>
                  </tr>
                </thead>
                <tbody className="font-body-md text-body-md text-on-surface">
                  {provider.models.map((m) => (
                    <tr key={m.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                      <td className="p-sm">{m.name}</td>
                      <td className="p-sm text-on-surface-variant">{m.label || '-'}</td>
                      <td className="p-sm text-on-surface-variant">
                        <span className="border border-outline-variant px-xs py-[2px] rounded-none text-[10px] uppercase">
                          {m.type === 'EMBEDDING' ? 'Embedding' : 'Chat'}
                        </span>
                      </td>
                      <td className="p-sm text-center" title="Par défaut pour ce type (chat ou embedding)">
                        <input
                          type="radio"
                          className="accent-on-surface w-4 h-4"
                          name={`default-model-${provider.id}-${m.type}`}
                          checked={m.isDefault}
                          onChange={() => handleSetDefaultModel(m.id, true)}
                        />
                      </td>
                      <td className="p-sm text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-on-surface border-outline-variant"
                          checked={m.isActive}
                          onChange={(e) => api.patch(`/ai-providers/models/${m.id}`, { isActive: e.target.checked }).then(load)}
                        />
                      </td>
                      <td className="p-sm text-right">
                        <button onClick={() => askDeleteModel(m.id)} className="text-on-surface-variant hover:text-error">
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {provider.models.length === 0 && (
                    <tr><td colSpan={6} className="p-sm text-center text-on-surface-variant">Aucun modèle configuré</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <form onSubmit={(e) => handleAddModel(provider.id, e)} className="flex flex-wrap gap-sm mt-sm">
              <input
                className={`${inputClass} flex-1 min-w-[160px]`}
                placeholder="Nom du modèle (ex: gpt-4o)"
                value={modelForms[provider.id]?.name || ''}
                onChange={(e) => setModelForms({ ...modelForms, [provider.id]: { ...modelForms[provider.id], name: e.target.value } })}
              />
              <input
                className={`${inputClass} flex-1 min-w-[160px]`}
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
              <button type="submit" className="text-on-surface font-headline-sm text-body-sm hover:underline flex items-center gap-xs px-sm">
                <span className="material-symbols-outlined text-sm">add</span> Ajouter le modèle
              </button>
            </form>
          </div>

          <div>
            <h5 className="font-headline-sm text-headline-sm text-on-surface mb-sm">Clés API</h5>
            <div className="border border-outline-variant rounded-none overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant">
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Libellé</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Clé</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Modèle</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-24 text-center">Par défaut</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-24 text-center">Actif</th>
                    <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-16"></th>
                  </tr>
                </thead>
                <tbody className="font-body-md text-body-md text-on-surface">
                  {provider.keys.map((k) => (
                    <tr key={k.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                      <td className="p-sm font-medium">{k.label}</td>
                      <td className="p-sm font-mono-sm text-mono-sm text-on-surface-variant">{k.apiKey}</td>
                      <td className="p-sm text-on-surface-variant">{k.model?.name || 'Tous les modèles'}</td>
                      <td className="p-sm text-center">
                        <input
                          type="radio"
                          className="accent-on-surface w-4 h-4"
                          name={`default-key-${provider.id}-${k.modelId || 'none'}`}
                          checked={k.isDefault}
                          onChange={() => handleSetDefaultKey(k.id, true)}
                        />
                      </td>
                      <td className="p-sm text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-on-surface border-outline-variant"
                          checked={k.isActive}
                          onChange={(e) => handleToggleKeyActive(k.id, e.target.checked)}
                        />
                      </td>
                      <td className="p-sm text-right">
                        <button onClick={() => askDeleteKey(k.id)} className="text-on-surface-variant hover:text-error">
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {provider.keys.length === 0 && (
                    <tr><td colSpan={6} className="p-sm text-center text-on-surface-variant">Aucune clé configurée</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <form onSubmit={(e) => handleAddKey(provider.id, e)} className="flex flex-wrap items-center gap-sm mt-sm">
              <input
                className={`${inputClass} flex-1 min-w-[140px]`}
                placeholder="Libellé (ex: Clé société)"
                value={keyForms[provider.id]?.label || ''}
                onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], label: e.target.value } })}
              />
              <input
                type="password"
                className={`${inputClass} flex-1 min-w-[140px]`}
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
              <label className="flex items-center gap-xs font-body-sm text-body-sm text-on-surface-variant">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-on-surface border-outline-variant"
                  checked={keyForms[provider.id]?.isDefault || false}
                  onChange={(e) => setKeyForms({ ...keyForms, [provider.id]: { ...keyForms[provider.id], isDefault: e.target.checked } })}
                />
                Par défaut
              </label>
              <button type="submit" className="text-on-surface font-headline-sm text-body-sm hover:underline flex items-center gap-xs px-sm">
                <span className="material-symbols-outlined text-sm">add</span> Ajouter la clé
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
