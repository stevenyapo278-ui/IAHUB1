import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
      toast.success('Synchronisation terminée', {
        description: `${data.processed} email(s) traité(s) par l\'agent IA.`,
      });
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
          <h2 className="font-display-lg text-display-lg text-on-background font-bold">Boîte mail</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Emails reçus et traités automatiquement par l'agent IA.
          </p>
        </div>
        {canSync && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-xs px-md py-sm rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-headline-sm"
          >
            <span className="material-symbols-outlined text-[18px]">sync</span>
            {syncing ? 'Synchronisation...' : 'Sync maintenant'}
          </button>
        )}
      </header>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <div className="xl:col-span-2 flex flex-col gap-md">
          {/* Filtres */}
          <div className="flex gap-sm flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-xl border transition-all duration-300 font-body-sm text-body-sm font-semibold ${
                  filter === f
                    ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/5'
                    : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high/60 hover:text-on-surface'
                }`}
              >
                {f === 'Tous' ? `Tous (${total})` : STATUS_LABELS[f]}
              </button>
            ))}
          </div>

          {/* Liste emails */}
          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow overflow-hidden">
            {emails.length === 0 ? (
              <div className="p-xl text-center text-on-surface-variant font-body-md text-body-md italic">
                Aucun email. Cliquez sur "Sync maintenant" pour récupérer les emails.
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/40">
                {emails.map((email) => (
                  <button
                    key={email.id}
                    onClick={() => setSelected(selected?.id === email.id ? null : email)}
                    className={`w-full text-left p-md hover:bg-surface-container-low/40 transition-colors ${PRIORITY_COLORS[email.aiPriority] || ''} ${selected?.id === email.id ? 'bg-surface-container-low/40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-headline-sm text-headline-sm text-on-surface font-semibold truncate">{email.subject}</p>
                        <p className="font-body-sm text-body-sm text-on-surface-variant truncate mt-0.5">
                          {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}
                        </p>
                        {email.aiSummary && (
                          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 line-clamp-1 italic bg-surface-container-low/30 px-2.5 py-1 rounded-lg w-fit max-w-full">
                            {email.aiSummary}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-xs shrink-0">
                        <span className={`badge px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                          email.status === 'DONE' 
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30' 
                            : email.status === 'ERROR'
                            ? 'bg-error/10 text-error border-error/20'
                            : 'bg-surface-container border-outline-variant text-on-surface-variant'
                        }`}>
                          {STATUS_LABELS[email.status]}
                        </span>
                        {email.aiPriority && (
                          <span className={`badge px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            email.aiPriority === 'P1'
                              ? 'bg-error/10 text-error border-error/20'
                              : email.aiPriority === 'P2'
                              ? 'bg-tertiary/10 text-tertiary border-tertiary/20'
                              : 'bg-surface-container border-outline-variant text-on-surface-variant'
                          }`}>
                            {email.aiPriority}
                          </span>
                        )}
                        <span className="font-mono-sm text-[10px] text-on-surface-variant">
                          {new Date(email.receivedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    {selected?.id === email.id && (
                      <div className="mt-md pt-md border-t border-outline-variant/40 space-y-md text-left">
                        <div className="p-md bg-surface-container-low/40 border border-outline-variant/40 rounded-xl grid grid-cols-2 gap-sm font-body-sm text-body-sm">
                          {email.aiCategory && (
                            <div>
                              <span className="text-on-surface-variant font-medium">Catégorie : </span>
                              <span className="text-on-surface font-semibold">{email.aiCategory}</span>
                            </div>
                          )}
                          {email.aiTeam && (
                            <div>
                              <span className="text-on-surface-variant font-medium">Équipe : </span>
                              <span className="text-on-surface font-semibold">{email.aiTeam}</span>
                            </div>
                          )}
                          {email.aiConfidence != null && (
                            <div>
                              <span className="text-on-surface-variant font-medium">Confiance IA : </span>
                              <span className="text-on-surface font-semibold">{Math.round(email.aiConfidence * 100)}%</span>
                            </div>
                          )}
                          {email.glpiTicketId && (
                            <div>
                              <span className="text-on-surface-variant font-medium">Ticket GLPI : </span>
                              <span className="text-on-surface font-semibold">#{email.glpiTicketId}</span>
                            </div>
                          )}
                        </div>

                        {email.error && (
                          <div className="p-sm bg-error/5 border border-error/15 rounded-xl text-error font-body-sm text-body-sm">
                            {email.error}
                          </div>
                        )}

                        {email.erpTicketId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/tickets/${email.erpTicketId}`);
                            }}
                            className="mt-xs px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm hover:bg-surface-container-high transition-colors rounded-xl flex items-center gap-xs shadow-sm"
                          >
                            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
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
            <div className="flex justify-center items-center gap-sm">
              <button
                disabled={page === 1}
                onClick={() => {
                  setPage(page - 1);
                  load(page - 1, filter);
                }}
                className="px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm disabled:opacity-40 hover:bg-surface-container-low rounded-xl transition-all duration-300 shadow-sm"
              >
                ← Précédent
              </button>
              <span className="px-md font-body-sm text-body-sm text-on-surface-variant font-medium">
                Page {page}
              </span>
              <button
                disabled={page * 20 >= total}
                onClick={() => {
                  setPage(page + 1);
                  load(page + 1, filter);
                }}
                className="px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm disabled:opacity-40 hover:bg-surface-container-low rounded-xl transition-all duration-300 shadow-sm"
              >
                Suivant →
              </button>
            </div>
          )}
        </div>

        {/* Panel test analyse IA */}
        {canSync && (
          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md h-fit">
            <div className="border-b border-outline-variant/40 pb-md">
              <h3 className="font-headline-md text-headline-md text-on-background font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">smart_toy</span>
                Test analyse IA
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 leading-relaxed">
                Simulez l'analyse d'un e-mail par Gemini sans créer de ticket réel dans le système.
              </p>
            </div>

            <form onSubmit={handleTestAnalyze} className="flex flex-col gap-md">
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Sujet *</span>
                <input
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                  value={testForm.subject}
                  onChange={(e) => setTestForm({ ...testForm, subject: e.target.value })}
                  placeholder="ex: Mon VPN ne fonctionne plus"
                  required
                />
              </label>

              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Corps *</span>
                <textarea
                  rows={4}
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 resize-none"
                  value={testForm.body}
                  onChange={(e) => setTestForm({ ...testForm, body: e.target.value })}
                  placeholder="Bonjour, depuis ce matin je ne peux plus me connecter au VPN..."
                  required
                />
              </label>

              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Email expéditeur</span>
                <input
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                  value={testForm.from}
                  onChange={(e) => setTestForm({ ...testForm, from: e.target.value })}
                  placeholder="user@example.com"
                />
              </label>

              <button
                type="submit"
                disabled={testing}
                className="w-full bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-body-sm"
              >
                {testing ? 'Analyse en cours...' : 'Analyser l\'e-mail'}
              </button>
            </form>

            {testResult && (
              <div className="border border-outline-variant/60 bg-surface-container-low/40 rounded-xl p-md space-y-2 font-body-sm text-body-sm">
                <p className="font-headline-sm text-headline-sm text-on-surface mb-2 font-semibold">Résultat Gemini</p>
                {Object.entries(testResult).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-sm border-b border-outline-variant/20 pb-1.5 last:border-0 last:pb-0">
                    <span className="text-on-surface-variant capitalize">{k}</span>
                    <span className="text-on-surface text-right font-medium">
                      {typeof v === 'boolean'
                        ? (v ? 'Oui' : 'Non')
                        : typeof v === 'number'
                        ? (k === 'confidence' ? `${Math.round(v * 100)}%` : v)
                        : String(v)}
                    </span>
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
