import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

export default function EmailAccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const [showSecrets, setShowSecrets] = useState({});

  function toggleAccount(id) {
    setExpandedAccounts((p) => ({ ...p, [id]: !p[id] }));
  }

  function toggleSecretVisibility(accountId, field) {
    const key = `${accountId}-${field}`;
    setShowSecrets((p) => ({ ...p, [key]: !p[key] }));
  }

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [testResults, setTestResults] = useState({}); // { [accountId]: { loading, ok, latencyMs, details, error } }

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

  async function handleTestAccount(id) {
    setTestResults((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const { data } = await api.post(`/email-accounts/${id}/test`);
      setTestResults((prev) => ({ ...prev, [id]: { loading: false, ...data } }));
      setTimeout(() => setTestResults((prev) => { const n = { ...prev }; delete n[id]; return n; }), 8000);
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { loading: false, ok: false, error: err.response?.data?.error || err.message } }));
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
            key="email-error"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md overflow-hidden"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={itemVariants} className="flex justify-between items-center">
        <h3 className="font-headline-md text-headline-md text-on-surface font-bold">Comptes mail</h3>
        <motion.button
          onClick={() => setShowForm((v) => !v)}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          className="border border-outline-variant/60 py-2 px-4 rounded-xl font-semibold text-body-sm text-on-surface hover:bg-surface-container-high transition-all duration-300 shadow-sm flex items-center gap-1"
        >
          <motion.span
            animate={{ rotate: showForm ? 180 : 0 }}
            transition={{ duration: 0.3 }}
            className="material-symbols-outlined text-[18px]"
          >
            {showForm ? 'close' : 'add'}
          </motion.span>
          {showForm ? 'Annuler' : 'Ajouter un compte'}
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {showForm && (
          <motion.form
            key="email-form"
            onSubmit={handleCreate}
            initial={{ opacity: 0, height: 0, scale: 0.97 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.97 }}
            transition={{ duration: 0.3, type: 'spring', stiffness: 200, damping: 22 }}
            className="bento-card p-lg space-y-md overflow-hidden"
          >
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

            <AnimatePresence mode="wait">
              {(form.provider === 'OUTLOOK' || form.provider === 'GMAIL') && (
                <motion.div
                  key="oauth-fields"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="border-t border-outline-variant/40 pt-md overflow-hidden"
                >
                  <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-sm">OAuth2</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    <label className={labelClass}>
                      <span className={labelTextClass}>Client ID</span>
                      <input className={inputClass} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
                    </label>
                    <label className={labelClass}>
                      <span className={labelTextClass}>Client Secret</span>
                      <div className="relative flex items-center w-full">
                        <input
                          className={`${inputClass} w-full pr-10`}
                          type={showSecrets['new-clientSecret'] ? 'text' : 'password'}
                          value={form.clientSecret}
                          onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility('new', 'clientSecret')}
                          className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {showSecrets['new-clientSecret'] ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                      </div>
                    </label>
                    {form.provider === 'OUTLOOK' && (
                      <label className={labelClass}>
                        <span className={labelTextClass}>Tenant ID</span>
                        <input className={inputClass} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} />
                      </label>
                    )}
                    <label className={labelClass}>
                      <span className={labelTextClass}>Refresh Token</span>
                      <div className="relative flex items-center w-full">
                        <input
                          className={`${inputClass} w-full pr-10`}
                          type={showSecrets['new-refreshToken'] ? 'text' : 'password'}
                          value={form.refreshToken}
                          onChange={(e) => setForm({ ...form, refreshToken: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility('new', 'refreshToken')}
                          className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {showSecrets['new-refreshToken'] ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                      </div>
                    </label>
                  </div>
                </motion.div>
              )}

              {form.provider === 'IMAP_SMTP' && (
                <motion.div
                  key="imap-fields"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="border-t border-outline-variant/40 pt-md overflow-hidden"
                >
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
                      <div className="relative flex items-center w-full">
                        <input
                          className={`${inputClass} w-full pr-10`}
                          type={showSecrets['new-password'] ? 'text' : 'password'}
                          value={form.password}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility('new', 'password')}
                          className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {showSecrets['new-password'] ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                      </div>
                    </label>
                  </div>
                  <label className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant mt-md cursor-pointer">
                    <motion.input type="checkbox" className="w-4 h-4 accent-primary cursor-pointer" checked={form.useTls} onChange={(e) => setForm({ ...form, useTls: e.target.checked })} whileTap={{ scale: 1.2 }} />
                    Utiliser TLS
                  </label>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-col gap-md border-t border-outline-variant/40 pt-md">
              <label className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant cursor-pointer">
                <motion.input type="checkbox" className="w-4 h-4 accent-primary cursor-pointer" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} whileTap={{ scale: 1.2 }} />
                Compte par défaut
              </label>

              <div className="flex justify-end">
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  className="btn-gradient font-semibold py-2.5 px-6 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
                >
                  Enregistrer
                </motion.button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {accounts.map((acc, aIdx) => {
        const isExpanded = !!expandedAccounts[acc.id];
        return (
          <motion.div
            key={acc.id}
            variants={itemVariants}
            layout
            className="bento-card p-lg flex flex-col gap-md"
          >
            <div className="flex justify-between items-start border-b border-outline-variant/40 pb-md">
              <div>
                <h4 className="font-headline-md text-headline-md text-on-surface flex items-center gap-sm font-semibold">
                  {acc.label}
                  <span className="border border-outline-variant/60 text-on-surface-variant px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-bold">{acc.provider}</span>
                  {acc.isDefault && (
                    <motion.span
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full font-label-md text-[10px] uppercase font-bold"
                    >
                      Par défaut
                    </motion.span>
                  )}
                </h4>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{acc.emailAddress}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* Bouton test connectivité */}
                <div className="flex items-center gap-1.5">
                  <motion.button
                    onClick={() => handleTestAccount(acc.id)}
                    disabled={testResults[acc.id]?.loading}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title="Tester la connectivité"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition-all duration-150
                               text-on-surface-variant border-outline-variant/40 hover:border-primary/40 hover:text-primary hover:bg-primary/5
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testResults[acc.id]?.loading ? (
                      <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-[15px]">network_check</span>
                    )}
                    Tester
                  </motion.button>
                  {testResults[acc.id] && !testResults[acc.id].loading && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[10px] font-bold border ${
                        testResults[acc.id].ok
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : 'bg-red-500/10 text-red-500 border-red-500/20'
                      }`}
                      title={testResults[acc.id].error || testResults[acc.id].details}
                    >
                      <span className="material-symbols-outlined text-[12px]">{testResults[acc.id].ok ? 'check_circle' : 'cancel'}</span>
                      {testResults[acc.id].ok ? `${testResults[acc.id].latencyMs}ms — OK` : 'Échec'}
                    </motion.span>
                  )}
                </div>
                <CustomToggle checked={acc.isActive} onChange={(v) => handleUpdate(acc.id, 'isActive', v)} />
                <motion.button
                  onClick={() => askDelete(acc.id)}
                  whileHover={{ scale: 1.15, color: 'var(--color-error)' }}
                  whileTap={{ scale: 0.9 }}
                  className="text-on-surface-variant hover:text-error transition-colors p-1"
                >
                  <span className="material-symbols-outlined">delete</span>
                </motion.button>
              </div>
            </div>

            {/* Accordion toggle section */}
            <div
              onClick={() => toggleAccount(acc.id)}
              className="flex items-center justify-between cursor-pointer py-1.5 text-primary hover:text-primary-dark transition-colors font-semibold text-body-sm select-none border-b border-outline-variant/20 pb-2"
            >
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px]">settings</span>
                {isExpanded ? 'Masquer la configuration de connexion' : 'Afficher la configuration de connexion'}
              </span>
              <motion.span
                animate={{ rotate: isExpanded ? 180 : 0 }}
                className="material-symbols-outlined text-[18px]"
              >
                expand_more
              </motion.span>
            </div>

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="pt-md space-y-md">
                    {(acc.provider === 'OUTLOOK' || acc.provider === 'GMAIL') && (
                      <div className="space-y-md">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                          <label className={labelClass}>
                            <span className={labelTextClass}>Client ID</span>
                            <input className={inputClass} defaultValue={acc.clientId || ''} onBlur={(e) => handleUpdate(acc.id, 'clientId', e.target.value)} />
                          </label>
                          <label className={labelClass}>
                            <span className={labelTextClass}>Client Secret</span>
                            <div className="relative flex items-center w-full">
                              <input
                                className={`${inputClass} w-full pr-10`}
                                type={showSecrets[`${acc.id}-clientSecret`] ? 'text' : 'password'}
                                placeholder={acc.clientSecret ? '••••••••••••••••' : 'Non défini'}
                                onBlur={(e) => { if (e.target.value) handleUpdate(acc.id, 'clientSecret', e.target.value); }}
                              />
                              <button
                                type="button"
                                onClick={() => toggleSecretVisibility(acc.id, 'clientSecret')}
                                className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                              >
                                <span className="material-symbols-outlined text-[18px]">
                                  {showSecrets[`${acc.id}-clientSecret`] ? 'visibility_off' : 'visibility'}
                                </span>
                              </button>
                            </div>
                          </label>
                          {acc.provider === 'OUTLOOK' && (
                            <label className={labelClass}>
                              <span className={labelTextClass}>Tenant ID</span>
                              <input className={inputClass} defaultValue={acc.tenantId || ''} onBlur={(e) => handleUpdate(acc.id, 'tenantId', e.target.value)} />
                            </label>
                          )}
                          <label className={labelClass}>
                            <span className={labelTextClass}>Refresh Token</span>
                            <div className="relative flex items-center w-full">
                              <input
                                className={`${inputClass} w-full pr-10`}
                                type={showSecrets[`${acc.id}-refreshToken`] ? 'text' : 'password'}
                                placeholder={acc.refreshToken ? '••••••••••••••••' : 'Non défini'}
                                onBlur={(e) => { if (e.target.value) handleUpdate(acc.id, 'refreshToken', e.target.value); }}
                              />
                              <button
                                type="button"
                                onClick={() => toggleSecretVisibility(acc.id, 'refreshToken')}
                                className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                              >
                                <span className="material-symbols-outlined text-[18px]">
                                  {showSecrets[`${acc.id}-refreshToken`] ? 'visibility_off' : 'visibility'}
                                </span>
                              </button>
                            </div>
                          </label>
                        </div>
                        {acc.provider === 'OUTLOOK' && (
                          <div className="flex justify-start pt-xs">
                            <motion.button
                              onClick={() => handleConnectOutlook(acc.id)}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                              className="px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm hover:bg-surface-container-high transition-colors rounded-xl shadow-sm flex items-center gap-xs"
                            >
                              <span className="material-symbols-outlined text-[18px]">mail</span>
                              {acc.refreshToken ? 'Reconnecter Outlook' : 'Connecter Outlook'}
                            </motion.button>
                          </div>
                        )}
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
                          <div className="relative flex items-center w-full">
                            <input
                              className={`${inputClass} w-full pr-10`}
                              type={showSecrets[`${acc.id}-password`] ? 'text' : 'password'}
                              placeholder={acc.password ? '••••••••••••••••' : 'Non défini'}
                              onBlur={(e) => { if (e.target.value) handleUpdate(acc.id, 'password', e.target.value); }}
                            />
                            <button
                              type="button"
                              onClick={() => toggleSecretVisibility(acc.id, 'password')}
                              className="absolute right-3 text-on-surface-variant/80 hover:text-on-surface select-none flex items-center"
                            >
                              <span className="material-symbols-outlined text-[18px]">
                                {showSecrets[`${acc.id}-password`] ? 'visibility_off' : 'visibility'}
                              </span>
                            </button>
                          </div>
                        </label>
                      </div>
                    )}

                    {!acc.isDefault && (
                      <div className="flex border-t border-outline-variant/40 pt-md mt-xs">
                        <motion.button
                          onClick={() => handleUpdate(acc.id, 'isDefault', true)}
                          whileHover={{ x: 4 }}
                          className="text-primary font-semibold text-body-sm hover:underline flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[16px]">star</span>
                          Définir par défaut
                        </motion.button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}

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
    </motion.div>
  );
}
