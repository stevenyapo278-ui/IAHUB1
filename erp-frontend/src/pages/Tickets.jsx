import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const STATUS_OPTIONS = ['NEW', 'OPEN', 'PENDING', 'SOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
const CATEGORY_OPTIONS = ['Logiciel', 'Matériel', 'Réseau', 'Téléphonie', 'Système'];
const TYPE_OPTIONS = [
  { value: 'INCIDENT', label: 'Incident' },
  { value: 'REQUEST', label: 'Demande' },
];
const SOURCE_OPTIONS = ['Helpdesk', 'Email', 'Téléphone'];
const URGENCY_IMPACT_OPTIONS = [
  { value: 'VERY_LOW', label: 'Très basse' },
  { value: 'LOW', label: 'Basse' },
  { value: 'MEDIUM', label: 'Moyenne' },
  { value: 'HIGH', label: 'Haute' },
  { value: 'VERY_HIGH', label: 'Très haute' },
  { value: 'MAJOR', label: 'Majeure' },
];

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

const EMPTY_FORM = {
  title: '',
  content: '',
  openedAt: '',
  type: 'INCIDENT',
  category: '',
  status: 'NEW',
  source: 'Helpdesk',
  urgency: 'MEDIUM',
  impact: 'MEDIUM',
  priority: 'P3',
  externalId: '',
  teamId: '',
  assignedToId: '',
  requesterId: '',
  observerIds: [],
  requiresApproval: false,
};

export default function Tickets() {
  const { user } = useAuth();
  const canAssign = user?.role === 'ADMIN' || user?.role === 'TECHNICIAN';
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ status: '', priority: '', source: '' });
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachment, setAttachment] = useState(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  function loadTickets() {
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;

    api
      .get('/tickets', { params })
      .then(({ data }) => {
        setTickets(data);
        setSelectedIds([]);
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(loadTickets, [filters]);

  function toggleSelect(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  function toggleSelectAll() {
    setSelectedIds((ids) => (ids.length === tickets.length ? [] : tickets.map((t) => t.id)));
  }

  async function handleDeleteOne(id) {
    if (!confirm(`Supprimer le ticket #${id} ?`)) return;
    try {
      await api.delete(`/tickets/${id}`);
      loadTickets();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) return;
    if (!confirm(`Supprimer définitivement ${selectedIds.length} ticket(s) ?`)) return;
    setDeleting(true);
    setError('');
    try {
      await api.post('/tickets/bulk-delete', { ids: selectedIds });
      loadTickets();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression en masse');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!canAssign) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(data)).catch(() => {});
  }, [canAssign]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === 'observerIds') {
          if (value.length > 0) payload.append('observerIds', JSON.stringify(value));
          return;
        }
        if (value !== '' && value !== undefined && value !== null) payload.append(key, value);
      });
      if (attachment) payload.append('attachment', attachment);

      await api.post('/tickets', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm(EMPTY_FORM);
      setAttachment(null);
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
          className="bg-surface-container-lowest rounded-none border border-outline-variant p-lg flex flex-col gap-lg"
        >
          <h3 className="font-headline-md text-headline-md text-on-background">Nouveau ticket</h3>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-lg">
            {/* Colonne gauche : titre, description, pièce jointe */}
            <div className="flex flex-col gap-md">
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
                <span className="font-label-md text-label-md text-on-surface uppercase">Description</span>
                <textarea
                  className="px-sm py-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface min-h-[160px]"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Pièce jointe (2 Mio maximum)</span>
                <input
                  type="file"
                  className="font-body-sm text-body-sm text-on-surface-variant"
                  onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {/* Colonne droite : champs façon GLPI */}
            <div className="flex flex-col gap-md bg-surface-bright border border-outline-variant p-md">
              <h4 className="font-headline-sm text-headline-sm text-on-background">Ticket</h4>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Date d'ouverture</span>
                <input
                  type="datetime-local"
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={form.openedAt}
                  onChange={(e) => setForm({ ...form, openedAt: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Type</span>
                <select
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Catégorie</span>
                <select
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="">-----</option>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              {canAssign && (
                <label className="flex flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface uppercase">Statut</span>
                  <select
                    className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Source de la demande</span>
                <select
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                >
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Urgence</span>
                <select
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={form.urgency}
                  onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Impact</span>
                <select
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={form.impact}
                  onChange={(e) => setForm({ ...form, impact: e.target.value })}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
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
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">ID externe</span>
                <input
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={form.externalId}
                  onChange={(e) => setForm({ ...form, externalId: e.target.value })}
                />
              </label>

              {canAssign && (
                <>
                  <h4 className="font-headline-sm text-headline-sm text-on-background mt-md">Acteurs</h4>
                  <label className="flex flex-col gap-xs">
                    <span className="font-label-md text-label-md text-on-surface uppercase">Demandeur</span>
                    <select
                      className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                      value={form.requesterId}
                      onChange={(e) => setForm({ ...form, requesterId: e.target.value })}
                    >
                      <option value="">Moi-même</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-xs">
                    <span className="font-label-md text-label-md text-on-surface uppercase">Observateur(s)</span>
                    <select
                      multiple
                      className="px-sm py-1 rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface min-h-[80px]"
                      value={form.observerIds}
                      onChange={(e) => setForm({ ...form, observerIds: Array.from(e.target.selectedOptions, (o) => o.value) })}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-xs">
                    <span className="font-label-md text-label-md text-on-surface uppercase">Attribué à</span>
                    <select
                      className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                      value={form.assignedToId}
                      onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
                    >
                      <option value="">Non assigné</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-xs">
                    <span className="font-label-md text-label-md text-on-surface uppercase">Équipe</span>
                    <select
                      className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                      value={form.teamId}
                      onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                    >
                      <option value="">Aucune</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className="flex items-center gap-xs font-body-sm text-body-sm text-on-surface-variant mt-md">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-on-surface border-outline-variant"
                  checked={form.requiresApproval}
                  onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
                />
                Nécessite une approbation avant traitement
              </label>
            </div>
          </div>

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
          <select
            className="px-3 py-1.5 rounded-none border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors focus:outline-none"
            value={filters.source}
            onChange={(e) => setFilters({ ...filters, source: e.target.value })}
          >
            <option value="">Source : Toutes</option>
            <option value="glpi">Synchronisés GLPI</option>
            <option value="erp">Internes ERP uniquement</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && selectedIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 rounded-none border border-error/30 text-error font-body-sm text-body-sm font-semibold hover:bg-error/5 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              Supprimer la sélection ({selectedIds.length})
            </button>
          )}
          <button
            onClick={toggleForm}
            className="flex items-center gap-2 px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">{showForm ? 'close' : 'add'}</span>
            {showForm ? 'Annuler' : 'Nouveau ticket'}
          </button>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-none border border-outline-variant overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-surface-bright border-b border-outline-variant">
                {isAdmin && (
                  <th className="px-md py-3 w-10">
                    <input
                      type="checkbox"
                      checked={tickets.length > 0 && selectedIds.length === tickets.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-20">ID</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Titre</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-16">IA</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-28">GLPI</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Statut</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Priorité</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-40">Équipe</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-48">Assigné à</th>
                <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-48">Demandeur</th>
                {isAdmin && <th className="px-md py-3 w-12"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                  {isAdmin && (
                    <td className="px-md py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        className="cursor-pointer"
                      />
                    </td>
                  )}
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
                    {t.glpiTicketId ? (
                      <span
                        title="Synchronisé avec GLPI"
                        className="inline-flex items-center gap-1 px-2 py-1 border border-outline-variant text-on-surface-variant font-medium text-[11px]"
                      >
                        <span className="material-symbols-outlined text-[14px]">sync</span>
                        #{t.glpiTicketId}
                      </span>
                    ) : (
                      <span title="Ticket interne, non synchronisé avec GLPI" className="text-outline italic text-[11px]">
                        Interne
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
                  {isAdmin && (
                    <td className="px-md py-3">
                      <button
                        onClick={() => handleDeleteOne(t.id)}
                        title="Supprimer ce ticket"
                        className="text-outline hover:text-error transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 11 : 9} className="px-md py-8 text-center text-on-surface-variant">
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
