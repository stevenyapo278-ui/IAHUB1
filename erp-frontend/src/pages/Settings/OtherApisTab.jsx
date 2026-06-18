import { useEffect, useState } from 'react';
import api from '../../api/client';

const inputClass =
  'h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface';

export default function OtherApisTab() {
  const [configs, setConfigs] = useState([]);
  const [form, setForm] = useState({ serviceName: '', baseUrl: '', apiKey: '' });
  const [workflows, setWorkflows] = useState([]);
  const [workflowForm, setWorkflowForm] = useState({ name: '', webhookUrl: '', description: '' });
  const [triggering, setTriggering] = useState(null);
  const [syncingGlpi, setSyncingGlpi] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function load() {
    api
      .get('/api-configs')
      .then(({ data }) => setConfigs(data))
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

  async function handleDeleteWorkflow(id) {
    if (!confirm('Supprimer ce workflow ?')) return;
    try {
      await api.delete(`/n8n-workflows/${id}`);
      loadWorkflows();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
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
    try {
      await api.post('/api-configs', form);
      setForm({ serviceName: '', baseUrl: '', apiKey: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  async function handleUpdate(id, field, value) {
    try {
      await api.patch(`/api-configs/${id}`, { [field]: value });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cette configuration ?')) return;
    try {
      await api.delete(`/api-configs/${id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  return (
    <div className="space-y-lg">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Gère les autres intégrations externes (Supabase, GLPI, etc.) utilisées par l'ERP et le workflow n8n.
      </p>
      {error && <div className="border border-outline-variant text-on-surface p-md rounded-none">{error}</div>}
      {info && <div className="border border-outline-variant text-on-surface p-md rounded-none">{info}</div>}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
        <h3 className="font-headline-md text-headline-md text-on-surface mb-md">Ajouter une intégration</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end">
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Nom du service</span>
            <input
              className={inputClass}
              value={form.serviceName}
              onChange={(e) => setForm({ ...form, serviceName: e.target.value })}
              placeholder="ex: supabase, glpi"
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">URL de base</span>
            <input className={inputClass} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://..." />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Clé API</span>
            <input className={inputClass} type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </label>
          <div className="md:col-span-3">
            <button
              type="submit"
              className="px-md py-sm rounded-none border border-outline-variant text-on-surface font-headline-sm text-headline-sm hover:bg-surface-container-low transition-colors"
            >
              Ajouter
            </button>
          </div>
        </form>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-none overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Service</th>
              <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">URL de base</th>
              <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Clé API</th>
              <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-24 text-center">Active</th>
              <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-32"></th>
              <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-16"></th>
            </tr>
          </thead>
          <tbody className="font-body-md text-body-md text-on-surface">
            {configs.map((c) => (
              <tr key={c.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                <td className="p-sm font-medium">{c.serviceName}</td>
                <td className="p-sm">
                  <input
                    className={`${inputClass} w-full`}
                    defaultValue={c.baseUrl || ''}
                    onBlur={(e) => handleUpdate(c.id, 'baseUrl', e.target.value)}
                  />
                </td>
                <td className="p-sm">
                  <input
                    className={`${inputClass} w-full`}
                    type="password"
                    placeholder={c.apiKey || 'Non définie'}
                    onBlur={(e) => {
                      if (e.target.value) handleUpdate(c.id, 'apiKey', e.target.value);
                    }}
                  />
                </td>
                <td className="p-sm text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-on-surface border-outline-variant"
                    checked={c.isActive}
                    onChange={(e) => handleUpdate(c.id, 'isActive', e.target.checked)}
                  />
                </td>
                <td className="p-sm">
                  {c.serviceName === 'glpi' && (
                    <button
                      onClick={handleSyncGlpi}
                      disabled={syncingGlpi}
                      className="px-3 py-1.5 rounded-none border border-outline-variant text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors disabled:opacity-50"
                    >
                      {syncingGlpi ? 'Synchro...' : 'Synchroniser GLPI'}
                    </button>
                  )}
                </td>
                <td className="p-sm text-right">
                  <button onClick={() => handleDelete(c.id)} className="text-on-surface-variant hover:text-error">
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                </td>
              </tr>
            ))}
            {configs.length === 0 && (
              <tr><td colSpan={6} className="p-sm text-center text-on-surface-variant">Aucune intégration configurée</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
        <h3 className="font-headline-md text-headline-md text-on-surface mb-md">Workflows n8n</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
          Déclenche des workflows n8n (webhooks) directement depuis l'ERP, par exemple pour synchroniser GLPI ou notifier une équipe.
        </p>
        <form onSubmit={handleCreateWorkflow} className="grid grid-cols-1 md:grid-cols-3 gap-md items-end mb-lg">
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Nom</span>
            <input
              className={inputClass}
              value={workflowForm.name}
              onChange={(e) => setWorkflowForm({ ...workflowForm, name: e.target.value })}
              placeholder="ex: Synchro GLPI"
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">URL du webhook</span>
            <input
              className={inputClass}
              value={workflowForm.webhookUrl}
              onChange={(e) => setWorkflowForm({ ...workflowForm, webhookUrl: e.target.value })}
              placeholder="https://n8n.example.com/webhook/..."
              required
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Description</span>
            <input
              className={inputClass}
              value={workflowForm.description}
              onChange={(e) => setWorkflowForm({ ...workflowForm, description: e.target.value })}
              placeholder="Optionnel"
            />
          </label>
          <div className="md:col-span-3">
            <button
              type="submit"
              className="px-md py-sm rounded-none border border-outline-variant text-on-surface font-headline-sm text-headline-sm hover:bg-surface-container-low transition-colors"
            >
              Ajouter
            </button>
          </div>
        </form>

        <div className="border border-outline-variant rounded-none overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant">
                <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Nom</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Webhook</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm">Dernière exécution</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-24 text-center">Active</th>
                <th className="font-label-md text-label-md text-on-surface-variant uppercase p-sm w-40"></th>
              </tr>
            </thead>
            <tbody className="font-body-md text-body-md text-on-surface">
              {workflows.map((w) => (
                <tr key={w.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                  <td className="p-sm font-medium">
                    {w.name}
                    {w.description && <div className="font-body-sm text-body-sm text-on-surface-variant">{w.description}</div>}
                  </td>
                  <td className="p-sm font-mono-sm text-mono-sm text-on-surface-variant truncate max-w-xs">{w.webhookUrl}</td>
                  <td className="p-sm">
                    {w.lastRunAt ? (
                      <span className={w.lastStatus === 'success' ? 'text-on-surface' : 'text-error'}>
                        {new Date(w.lastRunAt).toLocaleString('fr-FR')} ({w.lastStatus})
                      </span>
                    ) : (
                      <span className="text-on-surface-variant">Jamais exécuté</span>
                    )}
                  </td>
                  <td className="p-sm text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-on-surface border-outline-variant"
                      checked={w.isActive}
                      onChange={(e) => handleUpdateWorkflow(w.id, 'isActive', e.target.checked)}
                    />
                  </td>
                  <td className="p-sm text-right">
                    <div className="flex items-center justify-end gap-sm">
                      <button
                        onClick={() => handleTrigger(w.id)}
                        disabled={!w.isActive || triggering === w.id}
                        className="flex items-center gap-1 border border-outline-variant text-on-surface px-sm py-1 rounded-none font-label-md text-label-md hover:bg-surface-container-low transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-sm">play_arrow</span>
                        {triggering === w.id ? '...' : 'Lancer'}
                      </button>
                      <button onClick={() => handleDeleteWorkflow(w.id)} className="text-on-surface-variant hover:text-error">
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {workflows.length === 0 && (
                <tr><td colSpan={5} className="p-sm text-center text-on-surface-variant">Aucun workflow configuré</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
