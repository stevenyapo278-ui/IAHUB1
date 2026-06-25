import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';

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
  NEW: 'bg-primary/10 text-primary border border-primary/20',
  OPEN: 'bg-secondary/10 text-secondary border border-secondary/20',
  PENDING: 'bg-tertiary/10 text-tertiary border border-tertiary/20',
  SOLVED: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20',
  CLOSED: 'bg-slate-500/10 text-slate-600 border border-slate-500/20',
};

const STATUS_DOT = {
  NEW: 'bg-primary',
  OPEN: 'bg-secondary',
  PENDING: 'bg-tertiary',
  SOLVED: 'bg-emerald-500',
  CLOSED: 'bg-slate-500',
};

const PRIORITY_STYLES = {
  P1: 'border border-error/25 text-error bg-error/5 rounded-full px-2.5 py-0.5',
  P2: 'border border-tertiary/25 text-tertiary bg-tertiary/5 rounded-full px-2.5 py-0.5',
  P3: 'border border-secondary/25 text-secondary bg-secondary/5 rounded-full px-2.5 py-0.5',
  P4: 'border border-emerald-500/25 text-emerald-600 bg-emerald-500/5 rounded-full px-2.5 py-0.5',
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
  const canAssign = hasPermission(user, 'tickets.assign');
  const canDelete = hasPermission(user, 'tickets.delete');
  const canBulkDelete = hasPermission(user, 'tickets.bulkDelete');
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
  // Les cases à cocher de sélection multiple n'ont de sens que pour la suppression en masse — donc
  // gérées par tickets.bulkDelete, distinct de tickets.delete (suppression unitaire à la ligne).
  const showSelectionColumn = canBulkDelete;

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

  // Rafraîchit la liste en arrière-plan sans réinitialiser la sélection en cours
  function refreshTicketsSilently() {
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;

    api.get('/tickets', { params }).then(({ data }) => setTickets(data)).catch(() => {});
  }

  useEffect(loadTickets, [filters]);

  useEffect(() => {
    const intervalId = setInterval(refreshTicketsSilently, 15000);
    return () => clearInterval(intervalId);
  }, [filters]);

  function toggleSelect(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  function toggleSelectAll() {
    setSelectedIds((ids) => (ids.length === tickets.length ? [] : tickets.map((t) => t.id)));
  }

  const [confirmDelete, setConfirmDelete] = useState(null); // { mode: 'one'|'bulk', id? }

  function askDeleteOne(id) {
    setConfirmDelete({ mode: 'one', id });
  }

  function askDeleteSelected() {
    if (selectedIds.length === 0) return;
    setConfirmDelete({ mode: 'bulk' });
  }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    setDeleting(true);
    setError('');
    try {
      if (confirmDelete.mode === 'one') {
        await api.delete(`/tickets/${confirmDelete.id}`);
      } else {
        await api.post('/tickets/bulk-delete', { ids: selectedIds });
      }
      loadTickets();
      setConfirmDelete(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
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
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">{error}</div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow p-lg flex flex-col gap-lg"
        >
          <h3 className="font-headline-md text-headline-md text-on-background font-semibold">Nouveau ticket</h3>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-lg">
            {/* Colonne gauche : titre, description, pièce jointe */}
            <div className="flex flex-col gap-md">
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Titre</span>
                <input
                  className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Description</span>
                <textarea
                  className="w-full px-sm py-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface min-h-[160px]"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Pièce jointe (2 Mio maximum)</span>
                <input
                  type="file"
                  className="font-body-sm text-body-sm text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                  onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {/* Colonne droite : champs façon GLPI */}
            <div className="flex flex-col gap-md bg-surface-bright/35 border border-outline-variant/65 p-lg rounded-2xl">
              <h4 className="font-headline-sm text-headline-sm text-on-background font-semibold">Ticket</h4>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Date d'ouverture</span>
                <input
                  type="datetime-local"
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.openedAt}
                  onChange={(e) => setForm({ ...form, openedAt: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Type</span>
                <select
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Catégorie</span>
                <select
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
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
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase">Statut</span>
                  <select
                    className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
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
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Source de la demande</span>
                <select
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                >
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Urgence</span>
                <select
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.urgency}
                  onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Impact</span>
                <select
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.impact}
                  onChange={(e) => setForm({ ...form, impact: e.target.value })}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Priorité</span>
                <select
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">ID externe</span>
                <input
                  className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
                  value={form.externalId}
                  onChange={(e) => setForm({ ...form, externalId: e.target.value })}
                />
              </label>

              {canAssign && (
                <>
                  <h4 className="font-headline-sm text-headline-sm text-on-background mt-md font-semibold">Acteurs</h4>
                  <label className="flex flex-col gap-xs">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase">Demandeur</span>
                    <select
                      className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
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
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase">Observateur(s)</span>
                    <select
                      multiple
                      className="px-sm py-2 rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface min-h-[80px]"
                      value={form.observerIds}
                      onChange={(e) => setForm({ ...form, observerIds: Array.from(e.target.selectedOptions, (o) => o.value) })}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-xs">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase">Attribué à</span>
                    <select
                      className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
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
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase">Équipe</span>
                    <select
                      className="h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-md text-body-md text-on-surface"
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

              <label className="flex items-center gap-xs font-body-sm text-body-sm text-on-surface-variant mt-md cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary/20 accent-primary"
                  checked={form.requiresApproval}
                  onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
                />
                Nécessite une approbation avant traitement
              </label>
            </div>
          </div>

          <div className="flex gap-sm pt-4 border-t border-outline-variant/50">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold text-body-sm shadow-md shadow-primary/20 hover:shadow-lg transition-all duration-300"
            >
              Créer
            </button>
            <button
              type="button"
              onClick={toggleForm}
              className="px-5 py-2.5 rounded-xl border border-outline-variant text-on-surface font-semibold text-body-sm hover:bg-surface-container-low transition-colors"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface-container-lowest p-md rounded-2xl border border-outline-variant/60 card-shadow">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="px-3.5 py-1.8 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Statut : Tous</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="px-3.5 py-1.8 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            value={filters.priority}
            onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
          >
            <option value="">Priorité : Toutes</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            className="px-3.5 py-1.8 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            value={filters.source}
            onChange={(e) => setFilters({ ...filters, source: e.target.value })}
          >
            <option value="">Source : Toutes</option>
            <option value="glpi">Synchronisés GLPI</option>
            <option value="erp">Internes ERP uniquement</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          {canBulkDelete && selectedIds.length > 0 && (
            <button
              onClick={askDeleteSelected}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-error/30 text-error font-body-sm text-body-sm font-semibold hover:bg-error/5 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              Supprimer la sélection ({selectedIds.length})
            </button>
          )}
          <button
            onClick={toggleForm}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-body-sm text-body-sm font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">{showForm ? 'close' : 'add'}</span>
            {showForm ? 'Annuler' : 'Nouveau ticket'}
          </button>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                {showSelectionColumn && (
                  <th className="px-md py-3 w-10">
                    <input
                      type="checkbox"
                      checked={tickets.length > 0 && selectedIds.length === tickets.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer accent-primary"
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
                {canDelete && <th className="px-md py-3 w-12"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/40 font-body-sm text-body-sm">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-surface-container-low/70 transition-colors">
                  {showSelectionColumn && (
                    <td className="px-md py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        className="cursor-pointer accent-primary"
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
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary font-medium text-[11px]"
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
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-outline-variant bg-surface-container-low text-on-surface-variant font-medium text-[11px]"
                      >
                        <span className="material-symbols-outlined text-[14px]">sync</span>
                        #{t.glpiTicketId}
                      </span>
                    ) : (
                      <span title="Ticket interne, non synchronisé avec GLPI" className="text-outline/60 italic text-[11px]">
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
                    <span className={`inline-flex items-center font-medium text-[11px] ${PRIORITY_STYLES[t.priority] || ''}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-md py-3 text-on-surface-variant">{t.team?.name || '-'}</td>
                  <td className="px-md py-3 text-on-surface">{t.assignedTo?.fullName || <span className="text-outline/65 italic">Non assigné</span>}</td>
                  <td className="px-md py-3 text-on-surface-variant">{t.requester?.fullName || '-'}</td>
                  {canDelete && (
                    <td className="px-md py-3">
                      <button
                        onClick={() => askDeleteOne(t.id)}
                        title="Supprimer ce ticket"
                        className="text-outline/60 hover:text-error transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={9 + (showSelectionColumn ? 1 : 0) + (canDelete ? 1 : 0)} className="px-md py-8 text-center text-on-surface-variant italic">
                    Aucun ticket trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Supprimer le ticket"
        message={
          confirmDelete?.mode === 'bulk'
            ? `Supprimer définitivement ${selectedIds.length} ticket(s) ? Cette action est irréversible et supprime aussi le(s) ticket(s) GLPI lié(s).`
            : `Supprimer définitivement le ticket #${confirmDelete?.id} ? Cette action est irréversible et supprime aussi le ticket GLPI lié.`
        }
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
