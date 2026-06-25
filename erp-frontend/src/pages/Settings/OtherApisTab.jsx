import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../utils/permissions';
import ConfirmDialog from '../../components/ConfirmDialog';

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

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
    <div className="space-y-lg">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Gérez les autres intégrations externes (Supabase, GLPI, etc.) utilisées par l'ERP et le workflow n8n.
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
        <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold mb-md">Ajouter une intégration</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end">
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom du service</span>
            <input
              className={inputClass}
              value={form.serviceName}
              onChange={(e) => setForm({ ...form, serviceName: e.target.value })}
              placeholder="ex: supabase, glpi"
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">URL de base</span>
            <input className={inputClass} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://..." />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
              Clé API{form.serviceName === 'glpi' ? ' (User Token)' : ''}
            </span>
            <input className={inputClass} type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </label>
          {form.serviceName === 'glpi' && (
            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">App Token (GLPI)</span>
              <input
                className={inputClass}
                type="password"
                value={form.appToken}
                onChange={(e) => setForm({ ...form, appToken: e.target.value })}
                placeholder="Jeton du client API GLPI"
              />
            </label>
          )}
          <div className="md:col-span-3 flex justify-end mt-2">
            <button
              type="submit"
              className="bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
            >
              Ajouter l'intégration
            </button>
          </div>
        </form>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow overflow-hidden flex flex-col">
        <div className="p-md border-b border-outline-variant/40 bg-surface-container-low/20 flex justify-between items-center">
          <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Intégrations configurées</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-32">Service</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3">URL de base</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-40">Clé API</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-40">App Token</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-36">Statut</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-24 text-center">Active</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-40 text-center">Actions</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold p-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant/40">
              {configs.map((c) => (
                <tr key={c.id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="p-3 font-semibold uppercase text-primary">{c.serviceName}</td>
                  <td className="p-3">
                    <input
                      className={`${inputClass} w-full`}
                      defaultValue={c.baseUrl || ''}
                      onBlur={(e) => handleUpdate(c.id, 'baseUrl', e.target.value)}
                    />
                  </td>
                  <td className="p-3">
                    <input
                      className={`${inputClass} w-full`}
                      type="password"
                      placeholder={c.apiKey || 'Non définie'}
                      onBlur={(e) => {
                        if (e.target.value) handleUpdate(c.id, 'apiKey', e.target.value);
                      }}
                    />
                  </td>
                  <td className="p-3">
                    {c.serviceName === 'glpi' ? (
                      <input
                        className={`${inputClass} w-full`}
                        type="password"
                        placeholder={c.extra?.appToken ? 'Défini' : 'Non défini'}
                        onBlur={(e) => handleUpdateAppToken(c.id, c.extra, e.target.value)}
                      />
                    ) : (
                      <span className="text-on-surface-variant/60 italic p-2 block">-</span>
                    )}
                  </td>
                  <td className="p-3">
                    {REQUIRED_FIELDS[c.serviceName] && (
                      <button
                        onClick={() => handleTestConnection(c)}
                        disabled={testingId === c.id}
                        title="Tester la connexion"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-outline-variant/60 rounded-xl text-[11px] font-semibold bg-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {testingId === c.id ? (
                          <span className="text-on-surface-variant">Test...</span>
                        ) : connectionStatus[c.id]?.connected ? (
                          <>
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20"></span>
                            <span className="text-on-surface">Connecté</span>
                          </>
                        ) : connectionStatus[c.id] ? (
                          <>
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/20"></span>
                            <span className="text-error" title={connectionStatus[c.id].error}>Échec</span>
                          </>
                        ) : (
                          <span className="text-on-surface-variant">Tester</span>
                        )}
                      </button>
                    )}
                    {connectionStatus[c.id]?.error && (
                      <div className="text-[10px] text-error mt-1 max-w-[180px] bg-error/5 border border-error/15 px-2 py-0.5 rounded-lg font-medium">{connectionStatus[c.id].error}</div>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary cursor-pointer"
                      checked={c.isActive}
                      onChange={(e) => handleUpdate(c.id, 'isActive', e.target.checked)}
                    />
                  </td>
                  <td className="p-3 text-center">
                    {c.serviceName === 'glpi' && canManageGlpi && (
                      <button
                        onClick={handleSyncGlpi}
                        disabled={syncingGlpi}
                        className="px-3.5 py-1.5 rounded-xl border border-outline-variant/60 text-on-surface font-semibold text-body-sm hover:bg-surface-container-high transition-colors disabled:opacity-50 shadow-sm flex items-center gap-1 mx-auto"
                      >
                        <span className="material-symbols-outlined text-[16px]">sync</span>
                        {syncingGlpi ? 'Synchro...' : 'Synchroniser GLPI'}
                      </button>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => askDelete(c.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
              {configs.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-on-surface-variant italic font-body-md">Aucune intégration configurée.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md">
        <div className="border-b border-outline-variant/40 pb-md mb-xs">
          <h3 className="font-headline-md text-headline-md text-on-surface font-bold">Workflows n8n</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">
            Déclenchez des workflows n8n (webhooks) directement depuis l'ERP, par exemple pour synchroniser GLPI ou notifier une équipe.
          </p>
        </div>
        <form onSubmit={handleCreateWorkflow} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end mb-lg">
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
            <button
              type="submit"
              className="bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
            >
              Ajouter le workflow
            </button>
          </div>
        </form>

        <div className="border border-outline-variant/60 rounded-xl overflow-hidden">
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
                <tr key={w.id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="p-3 font-semibold">
                    {w.name}
                    {w.description && <div className="font-body-xs text-xs text-on-surface-variant mt-0.5 font-normal">{w.description}</div>}
                  </td>
                  <td className="p-3 font-mono-sm text-mono-sm text-on-surface-variant truncate max-w-xs">{w.webhookUrl}</td>
                  <td className="p-3 font-medium">
                    {w.lastRunAt ? (
                      <span className={w.lastStatus === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-error'}>
                        {new Date(w.lastRunAt).toLocaleString('fr-FR')} ({w.lastStatus})
                      </span>
                    ) : (
                      <span className="text-on-surface-variant/60 italic">Jamais exécuté</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary cursor-pointer"
                      checked={w.isActive}
                      onChange={(e) => handleUpdateWorkflow(w.id, 'isActive', e.target.checked)}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleTrigger(w.id)}
                        disabled={!w.isActive || triggering === w.id}
                        className="flex items-center gap-1 border border-outline-variant/60 text-on-surface px-3 py-1.5 rounded-xl font-semibold text-body-sm hover:bg-surface-container-high transition-colors disabled:opacity-50 shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                        {triggering === w.id ? '...' : 'Lancer'}
                      </button>
                      <button onClick={() => askDeleteWorkflow(w.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {workflows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-on-surface-variant italic font-body-md">Aucun workflow configuré.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
