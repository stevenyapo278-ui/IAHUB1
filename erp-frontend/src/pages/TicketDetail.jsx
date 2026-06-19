import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUS_OPTIONS = ['NEW', 'OPEN', 'PENDING', 'SOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
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

const PRIORITY_BADGE = {
  P1: 'bg-error-container text-on-error-container',
  P2: 'border border-outline-variant text-on-surface',
  P3: 'border border-outline-variant text-on-surface-variant',
  P4: 'border border-outline-variant text-on-surface-variant',
};

function initials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [followup, setFollowup] = useState('');
  const [error, setError] = useState('');
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);

  const canManage = user?.role === 'ADMIN' || user?.role === 'TECHNICIAN';

  function load() {
    api
      .get(`/tickets/${id}`)
      .then(({ data }) => setTicket(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, [id]);

  useEffect(() => {
    if (!canManage) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(data)).catch(() => {});
  }, [canManage]);

  async function updateField(field, value) {
    try {
      await api.patch(`/tickets/${id}`, { [field]: value });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  }

  async function handleAddFollowup(e) {
    e.preventDefault();
    if (!followup.trim()) return;
    try {
      await api.post(`/tickets/${id}/followups`, { content: followup });
      setFollowup('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'ajout du commentaire");
    }
  }

  async function handleDismissSuggestion(suggestionId) {
    try {
      await api.delete(`/ai-ticket-suggestions/${suggestionId}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression de la suggestion');
    }
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/tickets/${id}`);
      navigate('/tickets');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
      setDeleting(false);
    }
  }

  async function handleApprove() {
    try {
      await api.post(`/tickets/${id}/approve`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'approbation");
    }
  }

  async function handleReject() {
    try {
      await api.post(`/tickets/${id}/reject`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du rejet');
    }
  }

  async function handleRequestApproval() {
    try {
      await api.patch(`/tickets/${id}`, { approvalStatus: 'PENDING' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
    }
  }

  if (error) {
    return <div className="border border-outline-variant text-on-surface p-md rounded-none">{error}</div>;
  }
  if (!ticket) {
    return <p className="font-body-md text-body-md text-on-surface-variant">Chargement...</p>;
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex items-center gap-sm text-on-surface-variant font-body-sm text-body-sm">
        <Link to="/tickets" className="hover:text-on-surface hover:underline transition-colors">Tickets</Link>
        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
        <span className="font-headline-sm text-headline-sm text-on-surface">#{ticket.id}</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-lg">
        <div className="xl:col-span-8 flex flex-col gap-lg">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
            <div className="flex items-start justify-between mb-md">
              <div>
                <div className="flex items-center gap-sm mb-xs">
                  <span className={`font-label-md text-label-md px-2 py-1 rounded-none uppercase tracking-wide ${PRIORITY_BADGE[ticket.priority] || ''}`}>
                    {ticket.priority}
                  </span>
                  {ticket.category && (
                    <span className="bg-surface-container-high text-on-surface-variant font-label-md text-label-md px-2 py-1 rounded-none uppercase tracking-wide">
                      {ticket.category}
                    </span>
                  )}
                </div>
                <h2 className="font-display-lg text-display-lg text-on-surface mb-sm flex items-center gap-sm">
                  {ticket.title}
                  {ticket.aiProcessed && (
                    <span
                      title="Traité par l'agent IA"
                      className="inline-flex items-center gap-1 px-2 py-1 border border-outline-variant text-on-surface-variant font-medium text-[11px]"
                    >
                      <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                      IA
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex flex-col items-end shrink-0 ml-md">
                <span className="font-headline-md text-headline-md text-on-surface">#{ticket.id}</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {new Date(ticket.createdAt).toLocaleString('fr-FR')}
                </span>
              </div>
            </div>
            <div className="font-body-md text-body-md text-on-surface-variant border-t border-outline-variant pt-md mt-md whitespace-pre-wrap">
              {ticket.content}
            </div>

            {ticket.attachments?.length > 0 && (
              <div className="border-t border-outline-variant pt-md mt-md">
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-sm">Pièces jointes</h4>
                <div className="flex flex-wrap gap-sm">
                  {ticket.attachments.map((a) => {
                    const fileUrl = `${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/tickets/${ticket.id}/attachments/${a.id}/file`;
                    const isImage = a.mimeType?.startsWith('image/');
                    return isImage ? (
                      <a key={a.id} href={fileUrl} target="_blank" rel="noreferrer" title={a.filename}>
                        <img src={fileUrl} alt={a.filename} className="h-24 w-24 object-cover border border-outline-variant" />
                      </a>
                    ) : (
                      <a
                        key={a.id}
                        href={fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-xs px-3 py-2 border border-outline-variant text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">attach_file</span>
                        {a.filename}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
            <h3 className="font-headline-md text-headline-md border-b border-outline-variant pb-sm mb-md flex items-center gap-sm">
              <span className="material-symbols-outlined">forum</span>
              Suivi
            </h3>

            <div className="space-y-md">
              {ticket.followups.length === 0 && (
                <p className="font-body-sm text-body-sm text-on-surface-variant">Aucun commentaire pour le moment.</p>
              )}
              {ticket.followups.map((f) => (
                <div key={f.id} className="p-md rounded-none border border-outline-variant bg-surface-container-low flex gap-md">
                  <div className="w-9 h-9 rounded-full border border-outline-variant text-on-surface flex items-center justify-center font-label-md text-label-md font-bold shrink-0">
                    {initials(f.author?.fullName)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-headline-sm text-headline-sm text-on-surface">{f.author?.fullName || 'Inconnu'}</div>
                      <time className="font-mono-sm text-mono-sm text-on-surface-variant">
                        {new Date(f.createdAt).toLocaleString('fr-FR')}
                      </time>
                    </div>
                    <div className="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap">{f.content}</div>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddFollowup} className="mt-lg pt-md border-t border-outline-variant">
              <textarea
                className="w-full bg-surface-container-low border border-outline-variant rounded-none p-sm font-body-sm text-body-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-on-surface resize-y"
                placeholder="Ajouter un commentaire..."
                rows={3}
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
              />
              <div className="flex justify-end mt-sm">
                <button
                  type="submit"
                  className="bg-on-surface text-surface hover:opacity-80 transition-colors duration-200 rounded-none px-md py-sm font-headline-sm text-headline-sm"
                >
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="xl:col-span-4 flex flex-col gap-lg">
          {ticket.sourceEmail && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm">
                <span className="material-symbols-outlined text-[18px]">mail</span>
                Email d'origine
              </h3>
              <dl className="flex flex-col gap-xs font-body-sm text-body-sm">
                <div className="flex justify-between gap-sm">
                  <dt className="text-on-surface-variant">De</dt>
                  <dd className="text-on-surface text-right truncate">
                    {ticket.sourceName ? `${ticket.sourceName} <${ticket.sourceEmail}>` : ticket.sourceEmail}
                  </dd>
                </div>
                {ticket.sourceSubject && (
                  <div className="flex justify-between gap-sm">
                    <dt className="text-on-surface-variant">Sujet</dt>
                    <dd className="text-on-surface text-right truncate">{ticket.sourceSubject}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {ticket.aiSuggestions?.length > 0 && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm">
                <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                Suggestions IA
              </h3>
              <div className="flex flex-col gap-sm">
                {ticket.aiSuggestions.map((s) => (
                  <div key={s.id} className="border border-outline-variant p-sm">
                    <div className="flex items-start justify-between gap-sm">
                      <p className="font-body-sm text-body-sm text-on-surface">{s.suggestion}</p>
                      <button
                        onClick={() => handleDismissSuggestion(s.id)}
                        title="Ignorer"
                        className="text-on-surface-variant hover:text-on-surface shrink-0"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                    {s.reason && (
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">{s.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {ticket.approvalStatus !== 'NOT_REQUIRED' && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm">
                <span className="material-symbols-outlined text-[18px]">fact_check</span>
                Approbation
              </h3>

              <div className={`px-3 py-2 mb-md font-label-md text-label-md uppercase tracking-wide text-center border border-outline-variant ${
                ticket.approvalStatus === 'REJECTED' ? 'bg-error-container text-on-error-container' : 'text-on-surface'
              }`}>
                {ticket.approvalStatus === 'PENDING' && 'En attente d\'approbation'}
                {ticket.approvalStatus === 'APPROVED' && 'Approuvé'}
                {ticket.approvalStatus === 'REJECTED' && 'Rejeté'}
              </div>

              {ticket.approvedBy && (
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
                  Par {ticket.approvedBy.fullName} le {new Date(ticket.approvedAt).toLocaleString('fr-FR')}
                </p>
              )}

              {canManage && ticket.approvalStatus === 'PENDING' && (
                <div className="flex gap-2">
                  <button
                    onClick={handleApprove}
                    className="flex-1 flex items-center justify-center gap-2 bg-on-surface text-surface hover:opacity-80 transition-opacity py-sm font-headline-sm text-headline-sm rounded-none"
                  >
                    <span className="material-symbols-outlined text-[18px]">check</span>
                    Approuver
                  </button>
                  <button
                    onClick={handleReject}
                    className="flex-1 flex items-center justify-center gap-2 bg-transparent border border-error text-error hover:bg-error-container transition-colors py-sm font-headline-sm text-headline-sm rounded-none"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                    Rejeter
                  </button>
                </div>
              )}

              {canManage && ticket.approvalStatus !== 'PENDING' && (
                <button
                  onClick={handleRequestApproval}
                  className="w-full text-on-surface font-headline-sm text-body-sm hover:underline"
                >
                  Remettre en attente d'approbation
                </button>
              )}
            </div>
          )}

          {canManage && ticket.approvalStatus === 'NOT_REQUIRED' && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm">
                <span className="material-symbols-outlined text-[18px]">fact_check</span>
                Approbation
              </h3>
              <button
                onClick={handleRequestApproval}
                className="w-full bg-surface-container-low border border-outline-variant text-on-surface hover:bg-surface-container py-sm font-headline-sm text-headline-sm rounded-none transition-colors"
              >
                Soumettre pour approbation
              </button>
            </div>
          )}

          <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-on-surface"></div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider">Propriétés du ticket</h3>
            <div className="space-y-md">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Date d'ouverture</label>
                <div className="w-full bg-surface-container-low border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface-variant">
                  {new Date(ticket.createdAt).toLocaleString('fr-FR')}
                </div>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Type</label>
                <select
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                  value={ticket.type}
                  disabled={!canManage}
                  onChange={(e) => updateField('type', e.target.value)}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Statut</label>
                <select
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                  value={ticket.status}
                  disabled={!canManage}
                  onChange={(e) => updateField('status', e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Source de la demande</label>
                <select
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                  value={ticket.source || ''}
                  disabled={!canManage}
                  onChange={(e) => updateField('source', e.target.value)}
                >
                  <option value="">-----</option>
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Urgence</label>
                <select
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                  value={ticket.urgency}
                  disabled={!canManage}
                  onChange={(e) => updateField('urgency', e.target.value)}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Impact</label>
                <select
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                  value={ticket.impact}
                  disabled={!canManage}
                  onChange={(e) => updateField('impact', e.target.value)}
                >
                  {URGENCY_IMPACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Priorité</label>
                <select
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                  value={ticket.priority}
                  disabled={!canManage}
                  onChange={(e) => updateField('priority', e.target.value)}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">ID externe</label>
                <input
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                  defaultValue={ticket.externalId || ''}
                  disabled={!canManage}
                  onBlur={(e) => updateField('externalId', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Équipe</label>
                {canManage ? (
                  <select
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface"
                    value={ticket.teamId || ''}
                    onChange={(e) => updateField('teamId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Aucune</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full bg-surface-container-low border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface-variant">
                    {ticket.team?.name || 'Non assignée'}
                  </div>
                )}
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Attribué à</label>
                {canManage ? (
                  <select
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-on-surface"
                    value={ticket.assignedToId || ''}
                    onChange={(e) => updateField('assignedToId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Non assigné</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full flex items-center gap-2 bg-surface-container-low border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface">
                    {ticket.assignedTo ? (
                      <>
                        <div className="w-6 h-6 rounded-full border border-outline-variant text-on-surface flex items-center justify-center text-[10px] font-bold shrink-0">
                          {initials(ticket.assignedTo.fullName)}
                        </div>
                        {ticket.assignedTo.fullName}
                      </>
                    ) : (
                      <span className="text-outline italic">Non assigné</span>
                    )}
                  </div>
                )}
              </div>
              {ticket.observers?.length > 0 && (
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Observateur(s)</label>
                  <div className="w-full bg-surface-container-low border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface-variant">
                    {ticket.observers.map((o) => o.fullName).join(', ')}
                  </div>
                </div>
              )}
              {ticket.glpiTicketId && (
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Ticket GLPI</label>
                  <div className="w-full bg-surface-container-low border border-outline-variant rounded-none py-2 px-3 font-body-sm text-body-sm text-on-surface-variant">
                    #{ticket.glpiTicketId}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg">
            <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm">
              <span className="material-symbols-outlined text-[18px]">account_circle</span>
              Demandeur
            </h3>
            <div className="flex items-start gap-md">
              <div className="w-12 h-12 rounded-none border border-outline-variant text-on-surface flex items-center justify-center font-headline-md text-headline-md font-bold shrink-0">
                {initials(ticket.requester?.fullName)}
              </div>
              <div>
                <div className="font-headline-sm text-headline-sm text-on-surface">{ticket.requester?.fullName || '-'}</div>
                <div className="font-body-sm text-body-sm text-on-surface-variant mb-2">{ticket.requester?.email}</div>
              </div>
            </div>
          </div>

          {user?.role === 'ADMIN' && (
            <div className="pt-lg border-t border-outline-variant border-dashed">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center justify-center gap-2 bg-transparent border border-error text-error hover:bg-error-container transition-colors duration-200 rounded-lg py-sm font-headline-sm text-headline-sm"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
                Supprimer le ticket
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Supprimer le ticket"
        message={`Supprimer définitivement le ticket #${id} ? Cette action est irréversible et supprime aussi le ticket GLPI lié.`}
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
