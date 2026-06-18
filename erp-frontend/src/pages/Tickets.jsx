import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';

const STATUS_OPTIONS = ['NEW', 'OPEN', 'PENDING', 'SOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
const CATEGORY_OPTIONS = ['Logiciel', 'Matériel', 'Réseau', 'Téléphonie', 'Système'];

const STATUS_STYLES = {
  NEW: 'border border-outline-variant text-on-surface',
  OPEN: 'border border-outline-variant text-on-surface',
  PENDING: 'border border-outline-variant text-on-surface',
  SOLVED: 'border border-outline-variant text-on-surface',
  CLOSED: 'bg-surface-container-high text-on-surface',
};

const STATUS_DOT = {
  NEW: 'bg-on-surface',
  OPEN: 'bg-on-surface',
  PENDING: 'bg-on-surface-variant',
  SOLVED: 'bg-outline',
  CLOSED: 'bg-outline',
};

const PRIORITY_STYLES = {
  P1: 'border-error/20 text-error bg-error/5',
  P2: 'border-outline-variant text-on-surface',
  P3: 'border-outline-variant text-on-surface-variant',
  P4: 'border-outline-variant text-on-surface-variant',
};

export default function Tickets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [filters, setFilters] = useState({ status: '', priority: '' });
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState({ title: '', content: '', priority: 'P3', category: '', requiresApproval: false });
  const [error, setError] = useState('');

  function loadTickets() {
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;

    api
      .get('/tickets', { params })
      .then(({ data }) => setTickets(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(loadTickets, [filters]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/tickets', form);
      setForm({ title: '', content: '', priority: 'P3', category: '', requiresApproval: false });
      setShowForm(false);
      setSearchParams({});
      loadTickets();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  function toggleForm() {
    setShowForm((v) => !v);
    setSearchParams({});
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Tickets</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Gestion et suivi des demandes.</p>
        </div>
      </header>

      {error && (
        <div className="border border-outline-variant text-on-surface p-md rounded-none">{error}</div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-surface-container-lowest rounded-none border border-outline-variant p-lg flex flex-col gap-md"
        >
          <h3 className="font-headline-md text-headline-md text-on-background">Nouveau ticket</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface uppercase">Titre</span>
              <input
                className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface uppercase">Catégorie</span>
              <select
                className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="">Sélectionner...</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Description</span>
            <textarea
              className="px-sm py-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface min-h-[100px]"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              required
            />
          </label>
          <label className="flex flex-col gap-xs max-w-xs">
            <span className="font-label-md text-label-md text-on-surface uppercase">Priorité</span>
            <select
              className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-xs font-body-sm text-body-sm text-on-surface-variant">
            <input
              type="checkbox"
              className="w-4 h-4 accent-on-surface border-outline-variant"
              checked={form.requiresApproval}
              onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
            />
            Nécessite une approbation avant traitement
          </label>
          <div className="flex gap-sm">
            <button
              type="submit"
              className="px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all"
            >
              Créer
            </button>
            <button
              type="button"
              onClick={toggleForm}
              className="px-4 py-2 rounded-none border border-outline-variant text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface-container-lowest p-md rounded-none border border-outline-variant">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="px-3 py-1.5 rounded-none border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors focus:outline-none"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Statut : Tous</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="px-3 py-1.5 rounded-none border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors focus:outline-none"
            value={filters.priority}
            onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
          >
            <option value="">Priorité : Toutes</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <button
          onClick={toggleForm}
          className="flex items-center gap-2 px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px]">{showForm ? 'close' : 'add'}</span>
          {showForm ? 'Annuler' : 'Nouveau ticket'}
        </button>
      </div>

      <div className="bg-surface-container-lowest rounded-none border border-outline-variant overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-surface-bright border-b border-outline-variant">
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-20">ID</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Titre</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-16">IA</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Statut</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Priorité</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-40">Équipe</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-48">Assigné à</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-48">Demandeur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-md py-3 font-mono-sm text-mono-sm text-outline">
                    <Link to={`/tickets/${t.id}`} className="hover:text-on-surface hover:underline">#{t.id}</Link>
                  </td>
                  <td className="px-md py-3">
                    <Link to={`/tickets/${t.id}`} className="font-semibold text-on-surface hover:text-on-surface hover:underline truncate max-w-xs block">
                      {t.title}
                    </Link>
                  </td>
                  <td className="px-md py-3">
                    {t.aiProcessed && (
                      <span
                        title="Traité par l'agent IA"
                        className="inline-flex items-center gap-1 px-2 py-1 border border-outline-variant text-on-surface-variant font-medium text-[11px]"
                      >
                        <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                        IA
                      </span>
                    )}
                  </td>
                  <td className="px-md py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium text-[11px] ${STATUS_STYLES[t.status] || ''}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[t.status] || ''}`}></span>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-md py-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-none border font-medium text-[11px] ${PRIORITY_STYLES[t.priority] || ''}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-md py-3 text-on-surface-variant">{t.team?.name || '-'}</td>
                  <td className="px-md py-3 text-on-surface">{t.assignedTo?.fullName || <span className="text-outline italic">Non assigné</span>}</td>
                  <td className="px-md py-3 text-on-surface-variant">{t.requester?.fullName || '-'}</td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-md py-8 text-center text-on-surface-variant">
                    Aucun ticket trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
