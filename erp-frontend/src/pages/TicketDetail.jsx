import { useEffect, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
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
  P1: 'bg-error/10 text-error border border-error/20 rounded-full px-2.5 py-0.5',
  P2: 'bg-tertiary/10 text-tertiary border border-tertiary/20 rounded-full px-2.5 py-0.5',
  P3: 'bg-secondary/10 text-secondary border border-secondary/20 rounded-full px-2.5 py-0.5',
  P4: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-full px-2.5 py-0.5',
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

// Sanitisation minimale du HTML provenant des suivis GLPI : supprime les event handlers
// (onclick, onerror...) et les protocoles javascript: dans les URLs, en complément de la
// sanitisation déjà faite côté serveur (suppression des balises <script>).
function decodeHtmlEntities(str) {
  if (!str) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

function sanitizeFollowupHtml(html) {
  if (!html) return '';
  // D'abord : décoder les entités HTML (&#60; → <, &#62; → >, &amp; → &, etc.)
  // pour que le HTML soit propre avant l'injection via dangerouslySetInnerHTML
  const decoded = decodeHtmlEntities(html);
  return decoded
    .replace(/<script\b[^<]*(?:<\/script>|<\/script\s*>)/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\s+on\w+\s*=\s*\S+/gi, '')
    .replace(/href\s*=\s*"\s*javascript:/gi, 'href="#')
    .replace(/href\s*=\s*'\s*javascript:/gi, "href='#")
    .replace(/src\s*=\s*"\s*javascript:/gi, 'src="#')
    .replace(/src\s*=\s*'\s*javascript:/gi, "src='#")
    // Supprime les <a href="/glpi/document/X/file"><img ...></a> — garde l'img, enlève le lien cassé
    .replace(/<a\s[^>]*href=["']\/glpi\/document\/\d+\/file["'][^>]*>\s*(<img[^>]*\/?>)\s*<\/a>/gi, '$1')
    .replace(/<a\s[^>]*href=["']\/glpi\/document\/\d+\/file["'][^>]*>\s*<\/a>/gi, '');
}

// Note : containsHtmlTags a été supprimée car les suivis GLPI utilisent des entités HTML
// (&#60; &#62;) au lieu de vrais tags. On utilise systématiquement dangerouslySetInnerHTML
// avec sanitisation — sans risque puisque la sanitisation est faite côté serveur ET client.

// Les pièces jointes exigent un token JWT (Authorization header), qu'une balise <img src> ne peut pas envoyer :
// on les récupère via axios puis on les affiche via une URL blob.
function AttachmentThumbnail({ ticketId, attachment }) {
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let url;
    api
      .get(`/tickets/${ticketId}/attachments/${attachment.id}/file`, { responseType: 'blob' })
      .then(({ data }) => {
        url = URL.createObjectURL(data);
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [ticketId, attachment.id]);

  if (!blobUrl) {
    return <div className="h-24 w-24 border border-outline-variant bg-surface-container-low rounded-xl animate-pulse" />;
  }
  return <img src={blobUrl} alt={attachment.filename} className="h-24 w-24 object-cover border border-outline-variant/60 rounded-xl shadow-sm hover:shadow-md transition-all duration-300" />;
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
  const [categories, setCategories] = useState([]);
  const [glpiUsers, setGlpiUsers] = useState([]);
  const [syncFailures, setSyncFailures] = useState([]);
  const [savingField, setSavingField] = useState(null);

  const canAssign = hasPermission(user, 'tickets.assign');
  const canApprove = hasPermission(user, 'tickets.approve');
  const canDelete = hasPermission(user, 'tickets.delete');

  // Référence au conteneur des suivis pour post-traiter les images GLPI
  const followupContainerRef = useRef(null);
  // Référence persistante aux blob URLs pour le nettoyage entre les cycles de rendu — évite
  // les fuites mémoire quand le useEffect se re-déclenche (auto-refresh) avant que toutes les
  // requêtes images soient résolues.
  const followupBlobUrlsRef = useRef([]);

  const load = useCallback(() => {
    api
      .get(`/tickets/${id}`)
      .then(({ data }) => setTicket(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api
      .get(`/tickets/${id}/events`)
      .then(({ data }) => setSyncFailures(data.filter((e) => e.type === 'GLPI_SYNC_FAILED')))
      .catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const intervalId = setInterval(load, 15000);
    return () => clearInterval(intervalId);
  }, [load]);

    // Post-traite les images des suivis GLPI et emails : les balises <img src="/glpi/document/X/file">
  // sont chargées via axios (qui envoie le JWT dans Authorization header) et converties en blob URLs.
  // Sans ce contournement, le navigateur tente de les charger directement mais reçoit une 401
  // car une balise <img> est incapable d'envoyer des en-têtes d'authentification personnalisés.
  // Les balises <a href="/glpi/document/X/file"> sont aussi réécrites pour pointer vers le blob URL
  // une fois l'image chargée, afin que le clic fonctionne aussi.
  useEffect(() => {
    const container = followupContainerRef.current;
    if (!container) return;

    // NE PAS révoquer les blob URLs du cycle précédent ici : React préserve le DOM quand le
    // contenu __html de dangerouslySetInnerHTML n'a pas changé (optimisation de React). Les
    // anciennes images référencent encore leurs blob URLs. Les révoquer les briserait.
    // Les blob URLs accumulées sont nettoyées UNIQUEMENT au démontage du composant (return).

    // Traite les images
    container.querySelectorAll('img[src^="/glpi/document/"]').forEach((img) => {
      if (img.getAttribute('data-blob-processed')) return;
      img.setAttribute('data-blob-processed', 'true');

      const src = img.getAttribute('src');
      if (!src) return;

      const parentLink = img.closest('a[href="' + CSS.escape(src) + '"]');

      api
        .get(src, { responseType: 'blob' })
        .then(({ data }) => {
          const url = URL.createObjectURL(data);
          followupBlobUrlsRef.current.push(url);
          img.setAttribute('data-blob-url', url);
          img.src = url;
          if (parentLink) {
            parentLink.href = url;
          }
        })
        .catch(() => {});
    });

    // Traite les liens seuls (sans image) vers les documents GLPI
    container.querySelectorAll('a[href^="/glpi/document/"]').forEach((link) => {
      if (link.getAttribute('data-blob-processed')) return;
      if (link.querySelector('img[src^="/glpi/document/"]')) return; // déjà traité via l'image
      link.setAttribute('data-blob-processed', 'true');

      const href = link.getAttribute('href');
      if (!href) return;

      api
        .get(href, { responseType: 'blob' })
        .then(({ data }) => {
          const url = URL.createObjectURL(data);
          followupBlobUrlsRef.current.push(url);
          link.href = url;
        })
        .catch(() => {});
    });

    // Nettoyage UNIQUEMENT au démontage du composant — ne JAMAIS révoquer entre les cycles
    // (cf. explication ci-dessus sur la préservation du DOM par React).
    return () => {
      followupBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      followupBlobUrlsRef.current = [];
    };
  }, [ticket?.followups, ticket?.messages]);

  async function downloadAttachment(attachment) {
    try {
      const { data } = await api.get(`/tickets/${id}/attachments/${attachment.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError('Échec du téléchargement de la pièce jointe');
    }
  }

  useEffect(() => {
    api.get('/glpi/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/glpi/users').then(({ data }) => setGlpiUsers(data)).catch(() => {});
    if (!canAssign) return;
    api.get('/teams').then(({ data }) => setTeams(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : (data.users || []))).catch(() => {});
  }, [canAssign]);

  async function updateField(field, value) {
    try {
      setSavingField(field);
      await api.patch(`/tickets/${id}`, { [field]: value });
      toast.success(`${field} mis à jour`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSavingField(null);
    }
  }

  async function handleAddFollowup(e) {
    e.preventDefault();
    if (!followup.trim()) return;
    try {
      await api.post(`/tickets/${id}/followups`, { content: followup });
      toast.success('Commentaire ajouté');
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
    return (
      <div className="p-lg flex flex-col items-center gap-3">
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">{error}</div>
        <button onClick={load} className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors">
          Réessayer
        </button>
      </div>
    );
  }
  if (!ticket) {
    return (
      <div className="p-lg flex flex-col gap-lg animate-pulse">
        <div className="flex items-center gap-sm">
          <div className="h-4 w-16 bg-surface-container-high/60 rounded" />
          <div className="h-4 w-8 bg-surface-container-high/60 rounded" />
          <div className="h-4 w-12 bg-surface-container-high/60 rounded" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-lg">
          <div className="xl:col-span-8 flex flex-col gap-lg">
            <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-lg space-y-4">
              <div className="h-6 w-48 bg-surface-container-high/60 rounded-xl" />
              <div className="h-4 w-full bg-surface-container-high/40 rounded" />
              <div className="h-4 w-3/4 bg-surface-container-high/40 rounded" />
              <div className="h-20 w-full bg-surface-container-high/30 rounded-xl" />
            </div>
          </div>
          <div className="xl:col-span-4 flex flex-col gap-lg">
            <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-lg space-y-3">
              <div className="h-5 w-32 bg-surface-container-high/60 rounded" />
              <div className="h-4 w-full bg-surface-container-high/40 rounded" />
              <div className="h-4 w-full bg-surface-container-high/40 rounded" />
              <div className="h-4 w-2/3 bg-surface-container-high/40 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-lg flex flex-col gap-lg">
      <div className="flex items-center gap-sm text-on-surface-variant font-body-sm text-body-sm">
        <Link to="/tickets" className="hover:text-on-surface hover:underline transition-colors">Tickets</Link>
        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
        <span className="font-headline-sm text-headline-sm text-on-surface">#{ticket.id}</span>
      </div>

      {syncFailures.length > 0 && (
        <div className="border border-red-500/20 text-red-500 bg-red-500/5 rounded-xl p-md mb-lg flex items-start gap-sm">
          <span className="material-symbols-outlined text-red-500">sync_problem</span>
          <div>
            <div className="font-headline-sm text-headline-sm font-semibold">Synchronisation GLPI incomplète</div>
            <ul className="font-body-sm text-body-sm mt-1 list-disc pl-md">
              {syncFailures.map((e) => (
                <li key={e.id}>
                  {new Date(e.createdAt).toLocaleString('fr-FR')} — {e.payload?.action || 'action'} : {e.payload?.error || 'erreur inconnue'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-lg">
        <div className="xl:col-span-8 flex flex-col gap-lg">
          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
            <div className="flex items-start justify-between mb-md">
              <div>
                <div className="flex items-center gap-sm mb-xs">
                  <span className={`font-label-md text-label-md px-2.5 py-0.5 rounded-full uppercase tracking-wide font-medium ${PRIORITY_BADGE[ticket.priority] || ''}`}>
                    {ticket.priority}
                  </span>
                  {ticket.category && (
                    <span className="bg-surface-container-high/60 text-on-surface-variant border border-outline-variant font-label-md text-[11px] px-2.5 py-0.5 rounded-full uppercase tracking-wider font-medium">
                      {ticket.category}
                    </span>
                  )}
                </div>
                <h2 className="font-display-lg text-display-lg text-on-surface mb-sm flex items-center gap-sm font-bold">
                  {ticket.title}
                  {ticket.aiProcessed && (
                    <span
                      title="Traité par l'agent IA"
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary font-medium text-[11px]"
                    >
                      <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                      IA
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex flex-col items-end shrink-0 ml-md">
                <span className="font-headline-md text-headline-md text-on-surface font-semibold">#{ticket.id}</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant italic">
                  {new Date(ticket.createdAt).toLocaleString('fr-FR')}
                </span>
              </div>
            </div>
            {ticket.content && (ticket.content.includes('<') || ticket.content.includes('&#') || ticket.content.includes('&lt;')) ? (
              <div
                className="leading-relaxed text-body-md text-on-surface-variant border-t border-outline-variant/40 pt-md mt-md [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-2 [&_a]:text-primary [&_a]:underline [&_a]:hover:text-primary/80 [&_p]:mb-2 [&_p]:last:mb-0"
                dangerouslySetInnerHTML={{ __html: sanitizeFollowupHtml(ticket.content) }}
              />
            ) : (
              <div className="font-body-md text-body-md text-on-surface-variant border-t border-outline-variant/40 pt-md mt-md whitespace-pre-wrap leading-relaxed">
                {ticket.content}
              </div>
            )}

            {ticket.attachments?.length > 0 && (
              <div className="border-t border-outline-variant/40 pt-md mt-md">
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-sm font-semibold">Pièces jointes</h4>
                <div className="flex flex-wrap gap-sm">
                  {ticket.attachments.map((a) => {
                    const isImage = a.mimeType?.startsWith('image/');
                    const fromEmail = a.source === 'INCOMING_EMAIL';
                    return isImage ? (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => downloadAttachment(a)}
                        title={fromEmail ? `${a.filename} (reçu par email)` : a.filename}
                        className="relative hover:opacity-90 transition-opacity"
                      >
                        <AttachmentThumbnail ticketId={ticket.id} attachment={a} />
                        {fromEmail && (
                          <span className="material-symbols-outlined text-[14px] absolute top-1.5 right-1.5 bg-surface rounded-full p-1 text-on-surface-variant shadow-sm border border-outline-variant/30">mail</span>
                        )}
                      </button>
                    ) : (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => downloadAttachment(a)}
                        title={fromEmail ? 'Reçu par email' : undefined}
                        className="flex items-center gap-xs px-3.5 py-1.5 border border-outline-variant/60 text-on-surface font-body-sm text-body-sm rounded-xl hover:bg-surface-container-high transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">{fromEmail ? 'mail' : 'attach_file'}</span>
                        {a.filename}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
            <h3 className="font-headline-md text-headline-md border-b border-outline-variant/60 pb-md mb-md flex items-center gap-sm font-semibold">
              <span className="material-symbols-outlined text-primary">forum</span>
              Suivi
            </h3>

            <div className="space-y-md" ref={followupContainerRef}>
              {(() => {
                const timeline = [
                  ...ticket.followups.map((f) => ({ kind: 'followup', date: f.createdAt, data: f })),
                  ...(ticket.messages || []).map((m) => ({ kind: 'email', date: m.timestamp, data: m })),
                ].sort((a, b) => new Date(a.date) - new Date(b.date));

                if (timeline.length === 0) {
                  return <p className="font-body-sm text-body-sm text-on-surface-variant italic">Aucun commentaire pour le moment.</p>;
                }

                return timeline.map((item) =>
                  item.kind === 'followup' ? (
                    <div key={`f-${item.data.id}`} className="p-md rounded-2xl border border-outline-variant/50 bg-surface-container-low/60 flex gap-md">
                      <div className="w-9 h-9 rounded-full border border-outline-variant/75 text-on-surface bg-surface-container-high flex items-center justify-center font-label-md text-label-md font-bold shrink-0 shadow-sm">
                        {initials(item.data.author?.fullName)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                              {item.data.source === 'glpi' ? 'GLPI' : (item.data.author?.fullName || 'Inconnu')}
                            </div>
                            {item.data.source === 'glpi' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-medium border border-amber-500/20">GLPI</span>
                            )}
                          </div>
                          <time className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 px-2 py-0.5 rounded-full">
                            {new Date(item.data.createdAt).toLocaleString('fr-FR')}
                          </time>
                        </div>
                        <div
                          className="leading-relaxed text-body-sm text-on-surface-variant [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-2 [&_a]:text-primary [&_a]:underline [&_a]:hover:text-primary/80 [&_p]:mb-2 [&_p]:last:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-outline-variant/40 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-outline-variant/40 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-surface-container-high/40 [&_pre]:bg-surface-container-high [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:bg-surface-container-high [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm"
                          dangerouslySetInnerHTML={{ __html: sanitizeFollowupHtml(item.data.content) }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div key={`m-${item.data.id}`} className="p-md rounded-2xl border border-outline-variant/50 bg-surface-container-lowest flex gap-md">
                      <div className="w-9 h-9 rounded-full border border-outline-variant/70 bg-surface-container-low text-on-surface-variant flex items-center justify-center shrink-0 shadow-sm">
                        <span className="material-symbols-outlined text-[18px]">mail</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                            {item.data.direction === 'INBOUND' ? `Email de ${item.data.sender}` : `Email envoyé à ${item.data.recipients?.join(', ')}`}
                          </div>
                          <time className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container-low/70 px-2 py-0.5 rounded-full">
                            {new Date(item.data.timestamp).toLocaleString('fr-FR')}
                          </time>
                        </div>
                        <div className="text-xs text-outline mb-1 font-medium italic">{item.data.subject}</div>
                        {(item.data.bodyHtml) ? (
                          <div
                            className="leading-relaxed text-body-sm text-on-surface-variant [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-outline-variant/50 [&_img]:my-2 [&_a]:text-primary [&_a]:underline [&_a]:hover:text-primary/80 [&_p]:mb-2 [&_p]:last:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-outline-variant/40 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-outline-variant/40 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-surface-container-high/40 [&_pre]:bg-surface-container-high [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:bg-surface-container-high [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm"
                            dangerouslySetInnerHTML={{ __html: sanitizeFollowupHtml(item.data.bodyHtml) }}
                          />
                        ) : (
                          <div className="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap leading-relaxed">{item.data.body}</div>
                        )}
                      </div>
                    </div>
                  )
                );
              })()}
            </div>

            <form onSubmit={handleAddFollowup} className="mt-lg pt-md border-t border-outline-variant/60">
              <textarea
                className="w-full bg-surface border border-outline-variant/60 rounded-xl p-md font-body-sm text-body-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 resize-y"
                placeholder="Ajouter un commentaire... (Ctrl+Entrée pour envoyer)"
                rows={3}
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleAddFollowup(e); } }}
              />
              <div className="flex justify-end mt-sm">
                <button
                  type="submit"
                  className="btn-gradient font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 rounded-xl px-5 py-2.5 text-body-sm"
                >
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="xl:col-span-4 flex flex-col gap-lg">
          {ticket.sourceEmail && (
            <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm font-semibold">
                <span className="material-symbols-outlined text-[18px] text-primary">mail</span>
                Email d'origine
              </h3>
              <dl className="flex flex-col gap-xs font-body-sm text-body-sm">
                <div className="flex justify-between gap-sm">
                  <dt className="text-on-surface-variant">De</dt>
                  <dd className="text-on-surface text-right truncate font-medium">
                    {ticket.sourceName ? `${ticket.sourceName} <${ticket.sourceEmail}>` : ticket.sourceEmail}
                  </dd>
                </div>
                {ticket.sourceSubject && (
                  <div className="flex justify-between gap-sm border-t border-outline-variant/40 pt-2 mt-1">
                    <dt className="text-on-surface-variant">Sujet</dt>
                    <dd className="text-on-surface text-right truncate font-medium">{ticket.sourceSubject}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {ticket.aiSuggestions?.length > 0 && (
            <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm font-semibold">
                <span className="material-symbols-outlined text-[18px] text-primary">smart_toy</span>
                Suggestions IA
              </h3>
              <div className="flex flex-col gap-sm">
                {ticket.aiSuggestions.map((s) => (
                  <div key={s.id} className="border border-outline-variant/60 bg-surface-container-low/30 rounded-xl p-sm">
                    <div className="flex items-start justify-between gap-sm">
                      <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{s.suggestion}</p>
                      <button
                        onClick={() => handleDismissSuggestion(s.id)}
                        title="Ignorer"
                        className="text-on-surface-variant hover:text-error shrink-0 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                    {s.reason && (
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs border-t border-outline-variant/30 pt-1.5 italic">{s.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {ticket.approvalStatus !== 'NOT_REQUIRED' && (
            <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm font-semibold">
                <span className="material-symbols-outlined text-[18px] text-primary">fact_check</span>
                Approbation
              </h3>

              <div className={`px-3 py-2 mb-md font-label-md text-label-md uppercase tracking-wide text-center rounded-xl border ${
                ticket.approvalStatus === 'REJECTED' 
                  ? 'bg-error/10 text-error border-error/20' 
                  : ticket.approvalStatus === 'APPROVED'
                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                  : 'bg-surface-container border-outline-variant text-on-surface-variant'
              }`}>
                {ticket.approvalStatus === 'PENDING' && 'En attente d\'approbation'}
                {ticket.approvalStatus === 'APPROVED' && 'Approuvé'}
                {ticket.approvalStatus === 'REJECTED' && 'Rejeté'}
              </div>

              {ticket.approvedBy && (
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-md italic">
                  Par {ticket.approvedBy.fullName} le {new Date(ticket.approvedAt).toLocaleString('fr-FR')}
                </p>
              )}

              {canApprove && ticket.approvalStatus === 'PENDING' && (
                <div className="flex gap-2">
                  <button
                    onClick={handleApprove}
                    className="flex-1 flex items-center justify-center gap-2 btn-gradient font-semibold py-2 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm"
                  >
                    <span className="material-symbols-outlined text-[18px]">check</span>
                    Approuver
                  </button>
                  <button
                    onClick={handleReject}
                    className="flex-1 flex items-center justify-center gap-2 bg-transparent border border-error text-error hover:bg-error-container transition-colors py-2 rounded-xl font-semibold text-body-sm"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                    Rejeter
                  </button>
                </div>
              )}

              {canApprove && ticket.approvalStatus !== 'PENDING' && (
                <button
                  onClick={handleRequestApproval}
                  className="w-full text-primary font-semibold text-body-sm hover:underline"
                >
                  Remettre en attente d'approbation
                </button>
              )}
            </div>
          )}

          {canApprove && ticket.approvalStatus === 'NOT_REQUIRED' && (
            <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm font-semibold">
                <span className="material-symbols-outlined text-[18px] text-primary">fact_check</span>
                Approbation
              </h3>
              <button
                onClick={handleRequestApproval}
                className="w-full bg-surface-container hover:bg-surface-container-high text-on-surface py-2.5 rounded-xl border border-outline-variant/60 font-semibold text-body-sm transition-all duration-300"
              >
                Soumettre pour approbation
              </button>
            </div>
          )}

          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-primary"></div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider font-semibold">Propriétés du ticket</h3>
            <div className="space-y-md">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Date d'ouverture</label>
                <div className="w-full bg-surface-container-low/60 border border-outline-variant/60 rounded-xl py-2.5 px-3.5 font-body-sm text-body-sm text-on-surface-variant">
                  {new Date(ticket.createdAt).toLocaleString('fr-FR')}
                </div>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Type</label>
                <select
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                  value={ticket.type}
                  disabled={!canAssign || savingField === 'type'}
                  onChange={(e) => updateField('type', e.target.value)}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Catégorie</label>
                {canAssign ? (
                  <select
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                    value={ticket.category || ''}
                    disabled={savingField === 'category'}
                    onChange={(e) => updateField('category', e.target.value)}
                  >
                    <option value="">-----</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full bg-surface-container-low/60 border border-outline-variant/60 rounded-xl py-2.5 px-3.5 font-body-sm text-body-sm text-on-surface-variant">
                    {ticket.category || '-'}
                  </div>
                )}
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Statut</label>
                <select
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                  value={ticket.status}
                  disabled={!canAssign || savingField === 'status'}
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
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                  value={ticket.source || ''}
                  disabled={!canAssign || savingField === 'source'}
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
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                  value={ticket.urgency}
                  disabled={!canAssign || savingField === 'urgency'}
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
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                  value={ticket.impact}
                  disabled={!canAssign || savingField === 'impact'}
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
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                  value={ticket.priority}
                  disabled={!canAssign || savingField === 'priority'}
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
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                  defaultValue={ticket.externalId || ''}
                  disabled={!canAssign}
                  onBlur={(e) => updateField('externalId', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Équipe</label>
                {canAssign ? (
                  <select
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                    value={ticket.teamId || ''}
                    disabled={savingField === 'teamId'}
                    onChange={(e) => updateField('teamId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Aucune</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full bg-surface-container-low/60 border border-outline-variant/60 rounded-xl py-2.5 px-3.5 font-body-sm text-body-sm text-on-surface-variant">
                    {ticket.team?.name || 'Non assignée'}
                  </div>
                )}
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Attribué à</label>
                {canAssign ? (
                  <select
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl py-2 px-3 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-all duration-300"
                    value={ticket.assignedToId || ''}
                    disabled={savingField === 'assignedToId'}
                    onChange={(e) => updateField('assignedToId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Non assigné</option>
                    {(Array.isArray(users) ? users : []).map((u) => {
                      const isGlpi = glpiUsers.some((gu) => gu.id === u.id);
                      return <option key={u.id} value={u.id}>{u.fullName}{isGlpi ? ' 🔗' : ''}</option>;
                    })}
                  </select>
                ) : (
                  <div className="w-full flex items-center gap-2 bg-surface-container-low/60 border border-outline-variant/60 rounded-xl py-2.5 px-3.5 font-body-sm text-body-sm text-on-surface">
                    {ticket.assignedTo ? (
                      <>
                        <div className="w-6 h-6 rounded-full border border-outline-variant/70 bg-surface-container-low text-on-surface flex items-center justify-center text-[10px] font-bold shrink-0 shadow-sm">
                          {initials(ticket.assignedTo.fullName)}
                        </div>
                        {ticket.assignedTo.fullName}
                      </>
                    ) : (
                      <span className="text-outline/65 italic">Non assigné</span>
                    )}
                  </div>
                )}
              </div>
              {ticket.observers?.length > 0 && (
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Observateur(s)</label>
                  <div className="w-full bg-surface-container-low/60 border border-outline-variant/60 rounded-xl py-2.5 px-3.5 font-body-sm text-body-sm text-on-surface-variant">
                    {ticket.observers.map((o) => o.fullName).join(', ')}
                  </div>
                </div>
              )}
              {ticket.glpiLocationName && (
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">
                    <span className="material-symbols-outlined text-[14px] align-middle mr-1">location_on</span>
                    Lieu
                  </label>
                  <div className="w-full bg-surface-container-low/60 border border-outline-variant/60 rounded-xl py-2.5 px-3.5 font-body-sm text-body-sm text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">location_on</span>
                    {ticket.glpiLocationName}
                  </div>
                </div>
              )}
              {ticket.glpiTicketId && (
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-xs">Ticket GLPI</label>
                  <div className="w-full bg-surface-container-low/60 border border-outline-variant/60 rounded-xl py-2.5 px-3.5 font-body-sm text-body-sm text-on-surface-variant">
                    #{ticket.glpiTicketId}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
            <h3 className="font-headline-sm text-headline-sm text-on-surface mb-md uppercase tracking-wider flex items-center gap-sm font-semibold">
              <span className="material-symbols-outlined text-[18px] text-primary">account_circle</span>
              Demandeur
            </h3>
            <div className="flex items-start gap-md">
              <div className="w-12 h-12 rounded-xl border border-outline-variant/60 bg-surface-container-low text-on-surface flex items-center justify-center font-headline-md text-headline-md font-bold shrink-0 shadow-sm">
                {initials(ticket.requester?.fullName)}
              </div>
              <div>
                <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{ticket.requester?.fullName || '-'}</div>
                <div className="font-body-sm text-body-sm text-on-surface-variant mb-2">{ticket.requester?.email}</div>
              </div>
            </div>
          </div>

          {canDelete && (
            <div className="pt-lg border-t border-outline-variant border-dashed">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center justify-center gap-2 bg-transparent border border-error text-error hover:bg-error/5 transition-all duration-300 rounded-xl py-2.5 font-semibold text-body-sm"
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
