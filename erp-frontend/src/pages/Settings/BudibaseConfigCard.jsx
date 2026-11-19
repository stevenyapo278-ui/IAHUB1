import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../../api/client';
import { inputClass, itemVariants } from './SettingsComponents';

// ── Configuration de l'intégration Budibase (miroir des déclarations) ──────
// L'appel Budibase est fait exclusivement côté serveur : la clé API est stockée
// chiffrée (AES-256-GCM) dans ApiConfig et n'est jamais exposée au navigateur.
const DEFAULT_ROWS_PATH = '/api/public/v1/tables/{tableId}/rows';

export default function BudibaseConfigCard({ config, onReload }) {
  const [form, setForm] = useState({
    baseUrl: '',
    apiKey: '',
    appId: '',
    tableId: '',
    rowsPath: DEFAULT_ROWS_PATH,
    isActive: true,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!config) {
      setForm({ baseUrl: '', apiKey: '', appId: '', tableId: '', rowsPath: DEFAULT_ROWS_PATH, isActive: true });
      return;
    }
    setForm({
      baseUrl: config.baseUrl || '',
      apiKey: '',
      appId: config.extra?.appId || '',
      tableId: config.extra?.tableId || '',
      rowsPath: config.extra?.rowsPath || DEFAULT_ROWS_PATH,
      isActive: config.isActive !== false,
    });
  }, [config]);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!form.baseUrl.trim()) return setError('L’URL de base Budibase est obligatoire.');
    if (!config && !form.apiKey.trim()) return setError('La clé API Budibase est obligatoire.');
    if (!form.appId.trim()) return setError('L’App ID Budibase est obligatoire (ex. app_dev_…).');
    if (!form.tableId.trim()) return setError('L’identifiant de table Budibase est obligatoire.');

    setSaving(true);
    try {
      const extra = {
        ...(config?.extra && typeof config.extra === 'object' ? config.extra : {}),
        appId: form.appId.trim(),
        tableId: form.tableId.trim(),
        rowsPath: form.rowsPath.trim() || DEFAULT_ROWS_PATH,
      };
      if (config) {
        const payload = { baseUrl: form.baseUrl.trim(), extra, isActive: form.isActive };
        if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
        await api.patch(`/api-configs/${config.id}`, payload);
      } else {
        await api.post('/api-configs', {
          serviceName: 'budibase',
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
          extra,
          isActive: form.isActive,
        });
      }
      setForm((prev) => ({ ...prev, apiKey: '' }));
      setInfo('Configuration Budibase enregistrée. Les prochaines déclarations seront synchronisées.');
      onReload?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible d’enregistrer la configuration Budibase.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!config) return;
    setError('');
    setInfo('');
    setTesting(true);
    try {
      await api.post(`/api-configs/${config.id}/test-connection`);
      setInfo('Connexion Budibase réussie : table accessible.');
    } catch (err) {
      setError(err.response?.data?.error || 'Connexion Budibase impossible.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <motion.div variants={itemVariants} className="bento-card p-lg space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-500 shrink-0">
            <span className="material-symbols-outlined text-[20px]">database</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-headline-sm text-headline-sm text-on-surface font-bold">Budibase — comptes applicatifs</h4>
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                config
                  ? config.isActive
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                  : 'bg-surface-container-high text-on-surface-variant border-outline-variant/40'
              }`}>
                {config ? (config.isActive ? 'Configuré' : 'Inactif') : 'Non configuré'}
              </span>
            </div>
            <p className="text-[11px] text-on-surface-variant mt-1 leading-relaxed max-w-2xl">
              Destination des déclarations de comptes (miroir). En cas d’indisponibilité, l’enregistrement local
              reste valide et un rejeu automatique est effectué. La clé est chiffrée en base et n’est jamais
              envoyée au navigateur.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          {info}
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">URL de base *</span>
          <input
            className={inputClass}
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="https://budibase.example.com"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">
            Clé API {config ? '(laisser vide pour conserver)' : '*'}
          </span>
          <div className="relative flex items-center">
            <input
              className={`${inputClass} w-full pr-10`}
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={config?.apiKey ? '••••••••••••••••' : 'x-budibase-api-key'}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface"
              aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'}
            >
              <span className="material-symbols-outlined text-[18px]">{showKey ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">App ID *</span>
          <input
            className={inputClass}
            value={form.appId}
            onChange={(e) => setForm({ ...form, appId: e.target.value })}
            placeholder="app_dev_xxxxxxxxxxxx"
          />
          <span className="text-[10px] text-on-surface-variant/80">
            Visible dans l’URL de l’app Budibase (en-tête <code>x-budibase-app-id</code>).
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Table ID *</span>
          <input
            className={inputClass}
            value={form.tableId}
            onChange={(e) => setForm({ ...form, tableId: e.target.value })}
            placeholder="ta_xxxxxxxxxxxx"
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Chemin des lignes</span>
          <input
            className={inputClass}
            value={form.rowsPath}
            onChange={(e) => setForm({ ...form, rowsPath: e.target.value })}
            placeholder={DEFAULT_ROWS_PATH}
          />
          <span className="text-[10px] text-on-surface-variant/80">
            API publique Budibase v4 : {DEFAULT_ROWS_PATH} (le test ajoute <code>/search</code>).
          </span>
        </label>

        <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-on-surface cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-primary cursor-pointer"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Intégration active
          </label>

          <div className="flex items-center gap-2">
            {config && (
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || saving}
                className="px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">{testing ? 'progress_activity' : 'cable'}</span>
                {testing ? 'Test…' : 'Tester'}
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="btn-gradient px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : config ? 'Enregistrer' : 'Configurer Budibase'}
            </button>
          </div>
        </div>
      </form>

      <details className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-3 py-2">
        <summary className="text-[11px] font-bold text-on-surface-variant cursor-pointer select-none">
          Colonnes attendues dans la table Budibase
        </summary>
        <p className="text-[11px] text-on-surface-variant mt-2 leading-relaxed font-mono break-words">
          ticketId · ticketTitle · ticketStatus · applicationNames · applications (JSON) · accounts (JSON) ·
          accountsCount · operations (JSON) · hasRightsUpdate (booléen) · source · aiConfidence · createdByEmail ·
          declaredAt · idempotencyKey
        </p>
      </details>
    </motion.div>
  );
}
