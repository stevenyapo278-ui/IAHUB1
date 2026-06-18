import { useEffect, useState } from 'react';
import api from '../../api/client';

const EMPTY_FORM = {
  label: '',
  provider: 'OUTLOOK',
  emailAddress: '',
  clientId: '',
  clientSecret: '',
  tenantId: '',
  refreshToken: '',
  imapHost: '',
  imapPort: '',
  smtpHost: '',
  smtpPort: '',
  username: '',
  password: '',
  useTls: true,
  isActive: true,
  isDefault: false,
};

const inputClass =
  'h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface';

const labelClass = 'flex flex-col gap-xs';
const labelTextClass = 'font-label-md text-label-md text-on-surface uppercase';

function Toggle({ checked, onChange }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
      <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-on-surface after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-on-surface-variant"></div>
    </label>
  );
}

export default function EmailAccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  function load() {
    api
      .get('/email-accounts')
      .then(({ data }) => setAccounts(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form };
      if (payload.imapPort) payload.imapPort = Number(payload.imapPort);
      else delete payload.imapPort;
      if (payload.smtpPort) payload.smtpPort = Number(payload.smtpPort);
      else delete payload.smtpPort;

      await api.post('/email-accounts', payload);
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  async function handleUpdate(id, field, value) {
    try {
      await api.patch(`/email-accounts/${id}`, { [field]: value });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer ce compte mail ?')) return;
    try {
      await api.delete(`/email-accounts/${id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  async function handleConnectOutlook(id) {
    setError('');
    try {
      const { data } = await api.get(`/email-accounts/${id}/oauth/connect`);
      window.open(data.url, '_blank');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la connexion à Outlook');
    }
  }

  return (
    <div className="space-y-lg">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Configure les boîtes mail utilisées pour la réception/réponse aux tickets (Outlook / Microsoft 365,
        Gmail, ou IMAP/SMTP générique). Ces informations sont utilisées par le workflow de triage automatique.
      </p>
      {error && <div className="border border-outline-variant text-on-surface p-md rounded-none">{error}</div>}

      <div className="flex justify-between items-center">
        <h3 className="font-headline-md text-headline-md text-on-surface">Comptes mail</h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-surface-container-lowest text-on-surface border border-outline-variant py-sm px-md rounded-none font-headline-sm text-headline-sm flex items-center gap-xs hover:bg-surface-container-low transition-colors"
        >
          <span className="material-symbols-outlined">{showForm ? 'close' : 'add'}</span>
          {showForm ? 'Annuler' : 'Ajouter un compte'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg space-y-md">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            <label className={labelClass}>
              <span className={labelTextClass}>Libellé</span>
              <input className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex: Support IT" required />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Fournisseur</span>
              <select className={inputClass} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                <option value="OUTLOOK">Outlook / Microsoft 365</option>
                <option value="GMAIL">Gmail</option>
                <option value="IMAP_SMTP">IMAP / SMTP générique</option>
              </select>
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Adresse email</span>
              <input className={inputClass} type="email" value={form.emailAddress} onChange={(e) => setForm({ ...form, emailAddress: e.target.value })} required />
            </label>
          </div>

          {(form.provider === 'OUTLOOK' || form.provider === 'GMAIL') && (
            <div>
              <h4 className="font-headline-sm text-headline-sm text-on-surface mb-sm">OAuth2</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                <label className={labelClass}>
                  <span className={labelTextClass}>Client ID</span>
                  <input className={inputClass} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>Client Secret</span>
                  <input className={inputClass} type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
                </label>
                {form.provider === 'OUTLOOK' && (
                  <label className={labelClass}>
                    <span className={labelTextClass}>Tenant ID</span>
                    <input className={inputClass} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} />
                  </label>
                )}
                <label className={labelClass}>
                  <span className={labelTextClass}>Refresh Token</span>
                  <input className={inputClass} type="password" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} />
                </label>
              </div>
            </div>
          )}

          {form.provider === 'IMAP_SMTP' && (
            <div>
              <h4 className="font-headline-sm text-headline-sm text-on-surface mb-sm">IMAP / SMTP</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                <label className={labelClass}>
                  <span className={labelTextClass}>Hôte IMAP</span>
                  <input className={inputClass} value={form.imapHost} onChange={(e) => setForm({ ...form, imapHost: e.target.value })} />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>Port IMAP</span>
                  <input className={inputClass} type="number" value={form.imapPort} onChange={(e) => setForm({ ...form, imapPort: e.target.value })} placeholder="993" />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>Hôte SMTP</span>
                  <input className={inputClass} value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>Port SMTP</span>
                  <input className={inputClass} type="number" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} placeholder="587" />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>Nom d'utilisateur</span>
                  <input className={inputClass} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>Mot de passe</span>
                  <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </label>
              </div>
              <label className="flex items-center gap-xs font-body-sm text-body-sm text-on-surface-variant mt-sm">
                <input type="checkbox" className="w-4 h-4 accent-on-surface border-outline-variant" checked={form.useTls} onChange={(e) => setForm({ ...form, useTls: e.target.checked })} />
                Utiliser TLS
              </label>
            </div>
          )}

          <label className="flex items-center gap-xs font-body-sm text-body-sm text-on-surface-variant">
            <input type="checkbox" className="w-4 h-4 accent-on-surface border-outline-variant" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Compte par défaut
          </label>

          <button type="submit" className="px-md py-sm rounded-none border border-outline-variant text-on-surface font-headline-sm text-headline-sm hover:bg-surface-container-low transition-colors">
            Enregistrer
          </button>
        </form>
      )}

      {accounts.map((acc) => (
        <div key={acc.id} className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
          <div className="flex justify-between items-start border-b border-outline-variant pb-md mb-md">
            <div>
              <h4 className="font-headline-md text-headline-md text-on-surface flex items-center gap-sm">
                {acc.label}
                <span className="border border-outline-variant text-on-surface-variant px-xs py-[2px] rounded-none font-label-md text-[10px] uppercase">{acc.provider}</span>
                {acc.isDefault && (
                  <span className="border border-outline-variant text-on-surface-variant px-xs py-[2px] rounded-none font-label-md text-[10px] uppercase">Par défaut</span>
                )}
              </h4>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">{acc.emailAddress}</p>
            </div>
            <div className="flex items-center gap-md">
              <Toggle checked={acc.isActive} onChange={(v) => handleUpdate(acc.id, 'isActive', v)} />
              <button onClick={() => handleDelete(acc.id)} className="text-on-surface-variant hover:text-error transition-colors">
                <span className="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>

          {(acc.provider === 'OUTLOOK' || acc.provider === 'GMAIL') && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              <label className={labelClass}>
                <span className={labelTextClass}>Client ID</span>
                <input className={inputClass} defaultValue={acc.clientId || ''} onBlur={(e) => handleUpdate(acc.id, 'clientId', e.target.value)} />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Client Secret</span>
                <input className={inputClass} type="password" placeholder={acc.clientSecret || 'Non défini'} onBlur={(e) => { if (e.target.value) handleUpdate(acc.id, 'clientSecret', e.target.value); }} />
              </label>
              {acc.provider === 'OUTLOOK' && (
                <label className={labelClass}>
                  <span className={labelTextClass}>Tenant ID</span>
                  <input className={inputClass} defaultValue={acc.tenantId || ''} onBlur={(e) => handleUpdate(acc.id, 'tenantId', e.target.value)} />
                </label>
              )}
              <label className={labelClass}>
                <span className={labelTextClass}>Refresh Token</span>
                <input className={inputClass} type="password" placeholder={acc.refreshToken || 'Non défini'} onBlur={(e) => { if (e.target.value) handleUpdate(acc.id, 'refreshToken', e.target.value); }} />
              </label>
            </div>
          )}

          {acc.provider === 'OUTLOOK' && (
            <button
              onClick={() => handleConnectOutlook(acc.id)}
              className="mt-md px-md py-sm rounded-none border border-outline-variant text-on-surface font-headline-sm text-headline-sm hover:bg-surface-container-low transition-colors flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[18px]">mail</span>
              {acc.refreshToken ? 'Reconnecter Outlook' : 'Connecter Outlook'}
            </button>
          )}

          {acc.provider === 'IMAP_SMTP' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              <label className={labelClass}>
                <span className={labelTextClass}>Hôte IMAP</span>
                <input className={inputClass} defaultValue={acc.imapHost || ''} onBlur={(e) => handleUpdate(acc.id, 'imapHost', e.target.value)} />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Port IMAP</span>
                <input className={inputClass} type="number" defaultValue={acc.imapPort || ''} onBlur={(e) => handleUpdate(acc.id, 'imapPort', Number(e.target.value))} />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Hôte SMTP</span>
                <input className={inputClass} defaultValue={acc.smtpHost || ''} onBlur={(e) => handleUpdate(acc.id, 'smtpHost', e.target.value)} />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Port SMTP</span>
                <input className={inputClass} type="number" defaultValue={acc.smtpPort || ''} onBlur={(e) => handleUpdate(acc.id, 'smtpPort', Number(e.target.value))} />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Nom d'utilisateur</span>
                <input className={inputClass} defaultValue={acc.username || ''} onBlur={(e) => handleUpdate(acc.id, 'username', e.target.value)} />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Mot de passe</span>
                <input className={inputClass} type="password" placeholder={acc.password || 'Non défini'} onBlur={(e) => { if (e.target.value) handleUpdate(acc.id, 'password', e.target.value); }} />
              </label>
            </div>
          )}

          {!acc.isDefault && (
            <button
              onClick={() => handleUpdate(acc.id, 'isDefault', true)}
              className="mt-md text-on-surface font-headline-sm text-body-sm hover:underline"
            >
              Définir par défaut
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
