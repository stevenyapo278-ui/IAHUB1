import { useEffect, useState } from 'react';
import api from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog';

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
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

const labelClass = 'flex flex-col gap-xs';
const labelTextClass = 'font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold';

function CustomToggle({ checked, onChange }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
      <div className="w-11 h-6 bg-surface-container-high rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-outline-variant/60 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
    </label>
  );
}

export default function EmailAccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  function askDelete(id) {
    setConfirmDeleteId(id);
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/email-accounts/${confirmDeleteId}`);
      load();
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
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
        Configurez les boîtes mail utilisées pour la réception/réponse aux tickets (Outlook / Microsoft 365,
        Gmail, ou IMAP/SMTP générique). Ces informations sont utilisées par le workflow de triage automatique.
      </p>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="font-headline-md text-headline-md text-on-surface font-bold">Comptes mail</h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="border border-outline-variant/60 py-2 px-4 rounded-xl font-semibold text-body-sm text-on-surface hover:bg-surface-container-high transition-all duration-300 shadow-sm flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[18px]">{showForm ? 'close' : 'add'}</span>
          {showForm ? 'Annuler' : 'Ajouter un compte'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg space-y-md">
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
            <div className="border-t border-outline-variant/40 pt-md">
              <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-sm">OAuth2</h4>
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
            <div className="border-t border-outline-variant/40 pt-md">
              <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-sm">IMAP / SMTP</h4>
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
              <label className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant mt-md cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-primary cursor-pointer" checked={form.useTls} onChange={(e) => setForm({ ...form, useTls: e.target.checked })} />
                Utiliser TLS
              </label>
            </div>
          )}

          <div className="flex flex-col gap-md border-t border-outline-variant/40 pt-md">
            <label className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-primary cursor-pointer" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Compte par défaut
            </label>

            <div className="flex justify-end">
              <button type="submit" className="bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm">
                Enregistrer
              </button>
            </div>
          </div>
        </form>
      )}

      {accounts.map((acc) => (
        <div key={acc.id} className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md">
          <div className="flex justify-between items-start border-b border-outline-variant/40 pb-md">
            <div>
              <h4 className="font-headline-md text-headline-md text-on-surface flex items-center gap-sm font-semibold">
                {acc.label}
                <span className="border border-outline-variant/60 text-on-surface-variant px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-bold">{acc.provider}</span>
                {acc.isDefault && (
                  <span className="bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-bold">Par défaut</span>
                )}
              </h4>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{acc.emailAddress}</p>
            </div>
            <div className="flex items-center gap-md">
              <CustomToggle checked={acc.isActive} onChange={(v) => handleUpdate(acc.id, 'isActive', v)} />
              <button onClick={() => askDelete(acc.id)} className="text-on-surface-variant hover:text-error transition-colors p-1">
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
            <div className="flex justify-start">
              <button
                onClick={() => handleConnectOutlook(acc.id)}
                className="px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm hover:bg-surface-container-high transition-colors rounded-xl shadow-sm flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[18px]">mail</span>
                {acc.refreshToken ? 'Reconnecter Outlook' : 'Connecter Outlook'}
              </button>
            </div>
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
            <div className="flex border-t border-outline-variant/40 pt-md mt-xs">
              <button
                onClick={() => handleUpdate(acc.id, 'isDefault', true)}
                className="text-primary font-semibold text-body-sm hover:underline"
              >
                Définir par défaut
              </button>
            </div>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Supprimer le compte mail"
        message="Supprimer définitivement ce compte mail ? Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
