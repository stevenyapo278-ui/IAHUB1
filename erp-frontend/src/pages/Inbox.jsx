import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';

const STATUS_LABELS = {
  PENDING: 'En attente',
  PROCESSING: 'Traitement...',
  DONE: 'Traité',
  ERROR: 'Erreur',
  SPAM: 'Spam',
};

const STATUS_COLORS = {
  PENDING: 'text-on-surface-variant',
  PROCESSING: 'text-on-surface-variant',
  DONE: 'text-on-surface',
  ERROR: 'text-error',
  SPAM: 'text-on-surface-variant',
};

const PRIORITY_COLORS = {
  P1: 'border-l-4 border-l-error',
  P2: 'border-l-4 border-l-on-surface',
  P3: '',
  P4: '',
};

const FILTERS = ['Tous', 'PENDING', 'DONE', 'ERROR', 'SPAM'];

export default function Inbox() {
  const { user } = useAuth();
  const canSync = hasPermission(user, 'inbox.sync');
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('Tous');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testForm, setTestForm] = useState({ subject: '', body: '', from: '', fromName: '' });
  const [testResult, setTestResult] = useState(null);
  const navigate = useNavigate();

  function load(p = page, f = filter) {
    const params = new URLSearchParams({ page: p, limit: 20 });
    if (f !== 'Tous') params.set('status', f);
    api
      .get(`/inbox?${params}`)
      .then(({ data }) => { setEmails(data.items); setTotal(data.total); })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(() => { load(1, filter); setPage(1); }, [filter]);

  // Rafraîchit silencieusement la liste en arrière-plan pour voir arriver les nouveaux emails sans recharger la page
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (page === 1) load(1, filter);
    }, 15000);
    return () => clearInterval(intervalId);
  }, [page, filter]);

  async function handleSync() {
    setSyncing(true);
    setError('');
    try {
      const { data } = await api.post('/inbox/sync');
      load(1, filter);
      setError('');
      alert(`Sync terminé : ${data.processed} email(s) traité(s)`);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du sync');
    } finally {
      setSyncing(false);
    }
  }

  async function handleTestAnalyze(e) {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const { data } = await api.post('/inbox/test-analyze', testForm);
      setTestResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du test');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Boîte mail</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">
            Emails reçus et traités automatiquement par l'agent IA.
          </p>
        </div>
        {canSync && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-xs px-md py-sm rounded-none border border-outline-variant bg-on-surface text-surface font-headline-sm text-headline-sm hover:opacity-80 transition-all disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">sync</span>
            {syncing ? 'Synchronisation...' : 'Sync maintenant'}
          </button>
        )}
      </header>

      {error && <div className="border border-outline-variant text-on-surface p-md rounded-none">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <div className="xl:col-span-2 flex flex-col gap-md">
          {/* Filtres */}
          <div className="flex gap-xs flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-md py-xs rounded-none border font-body-sm text-body-sm transition-colors ${
                  filter === f
                    ? 'border-on-surface bg-on-surface text-surface'
                    : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {f === 'Tous' ? `Tous (${total})` : STATUS_LABELS[f]}
              </button>
            ))}
          </div>

          {/* Liste emails */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-none overflow-hidden">
            {emails.length === 0 ? (
              <div className="p-xl text-center text-on-surface-variant font-body-md text-body-md">
                Aucun email. Clique sur "Sync maintenant" pour récupérer les emails Outlook.
              </div>
            ) : (
              <div className="divide-y divide-outline-variant">
                {emails.map((email) => (
                  <button
                    key={email.id}
                    onClick={() => setSelected(selected?.id === email.id ? null : email)}
                    className={`w-full text-left p-md hover:bg-surface-container-low transition-colors ${PRIORITY_COLORS[email.aiPriority] || ''} ${selected?.id === email.id ? 'bg-surface-container-low' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-headline-sm text-headline-sm text-on-surface truncate">{email.subject}</p>
                        <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                          {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}
                        </p>
                        {email.aiSummary && (
                          <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs line-clamp-1">{email.aiSummary}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-xs shrink-0">
                        <span className={`font-label-md text-[10px] uppercase font-medium ${STATUS_COLORS[email.status]}`}>
                          {STATUS_LABELS[email.status]}
                        </span>
                        {email.aiPriority && (
                          <span className="border border-outline-variant px-xs py-[1px] font-label-md text-[10px] text-on-surface-variant">
                            {email.aiPriority}
                          </span>
                        )}
                        <span className="font-body-sm text-[10px] text-on-surface-variant">
                          {new Date(email.receivedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    {selected?.id === email.id && (
                      <div className="mt-md pt-md border-t border-outline-variant space-y-xs text-left">
                        <div className="grid grid-cols-2 gap-xs font-body-sm text-body-sm">
                          {email.aiCategory && <div><span className="text-on-surface-variant">Catégorie : </span><span className="text-on-surface">{email.aiCategory}</span></div>}
                          {email.aiTeam && <div><span className="text-on-surface-variant">Équipe : </span><span className="text-on-surface">{email.aiTeam}</span></div>}
                          {email.aiConfidence != null && <div><span className="text-on-surface-variant">Confiance IA : </span><span className="text-on-surface">{Math.round(email.aiConfidence * 100)}%</span></div>}
                          {email.glpiTicketId && <div><span className="text-on-surface-variant">Ticket GLPI : </span><span className="text-on-surface">#{email.glpiTicketId}</span></div>}
                        </div>
                        {email.error && <p className="text-error font-body-sm text-body-sm">{email.error}</p>}
                        {email.erpTicketId && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/tickets/${email.erpTicketId}`); }}
                            className="mt-xs px-md py-xs border border-outline-variant text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors rounded-none flex items-center gap-xs"
                          >
                            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                            Voir le ticket
                          </button>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {total > 20 && (
            <div className="flex justify-center gap-sm">
              <button disabled={page === 1} onClick={() => { setPage(page - 1); load(page - 1, filter); }}
                className="px-md py-xs border border-outline-variant text-on-surface font-body-sm text-body-sm disabled:opacity-40 hover:bg-surface-container-low rounded-none">
                ← Précédent
              </button>
              <span className="px-md py-xs font-body-sm text-body-sm text-on-surface-variant">
                Page {page}
              </span>
              <button disabled={page * 20 >= total} onClick={() => { setPage(page + 1); load(page + 1, filter); }}
                className="px-md py-xs border border-outline-variant text-on-surface font-body-sm text-body-sm disabled:opacity-40 hover:bg-surface-container-low rounded-none">
                Suivant →
              </button>
            </div>
          )}
        </div>

        {/* Panel test analyse IA */}
        {canSync && (
          <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-md h-fit">
            <h3 className="font-headline-md text-headline-md text-on-background">Test analyse IA</h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Simule l'analyse d'un email par Gemini sans créer de ticket.
            </p>
            <form onSubmit={handleTestAnalyze} className="flex flex-col gap-md">
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Sujet *</span>
                <input
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={testForm.subject}
                  onChange={(e) => setTestForm({ ...testForm, subject: e.target.value })}
                  placeholder="ex: Mon VPN ne fonctionne plus"
                  required
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Corps *</span>
                <textarea
                  rows={4}
                  className="px-sm py-xs rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface resize-none"
                  value={testForm.body}
                  onChange={(e) => setTestForm({ ...testForm, body: e.target.value })}
                  placeholder="Bonjour, depuis ce matin je ne peux plus me connecter au VPN..."
                  required
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Email expéditeur</span>
                <input
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={testForm.from}
                  onChange={(e) => setTestForm({ ...testForm, from: e.target.value })}
                  placeholder="user@example.com"
                />
              </label>
              <button
                type="submit"
                disabled={testing}
                className="px-md py-sm rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all disabled:opacity-60"
              >
                {testing ? 'Analyse en cours...' : 'Analyser'}
              </button>
            </form>

            {testResult && (
              <div className="border border-outline-variant p-md space-y-xs font-body-sm text-body-sm">
                <p className="font-headline-sm text-headline-sm text-on-surface mb-xs">Résultat Gemini</p>
                {Object.entries(testResult).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-sm">
                    <span className="text-on-surface-variant capitalize">{k}</span>
                    <span className="text-on-surface text-right">{typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : typeof v === 'number' ? (k === 'confidence' ? `${Math.round(v * 100)}%` : v) : String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
