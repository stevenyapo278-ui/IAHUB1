import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { isVoiceAlertEnabled, getVoiceAlertLang } from '../utils/voiceAlertPreference';

// Messages d'annonce traduits — la langue affichée suit le réglage choisi par l'utilisateur dans
// Paramètres > Automatisation (préférence locale au navigateur, indépendante des autres utilisateurs).
const ANNOUNCE_MESSAGES = {
  drafts: {
    'fr-FR': 'Nouvelle réponse IA en attente de validation.',
    'en-US': 'New AI reply waiting for approval.',
    'es-ES': 'Nueva respuesta de la IA en espera de validación.',
    'de-DE': 'Neue KI-Antwort wartet auf Genehmigung.',
    'pt-PT': 'Nova resposta da IA à espera de validação.',
    'ar-SA': 'رد جديد من الذكاء الاصطناعي في انتظار الموافقة.',
  },
  review: {
    'fr-FR': "Un ticket nécessite une revue humaine, l'intelligence artificielle n'est pas certaine de la décision à prendre.",
    'en-US': 'A ticket needs human review, the AI is not confident about the decision to make.',
    'es-ES': 'Un ticket necesita revisión humana, la IA no está segura de la decisión a tomar.',
    'de-DE': 'Ein Ticket benötigt eine menschliche Überprüfung, die KI ist sich der Entscheidung nicht sicher.',
    'pt-PT': 'Um ticket precisa de revisão humana, a IA não tem certeza da decisão a tomar.',
    'ar-SA': 'تذكرة تحتاج إلى مراجعة بشرية، الذكاء الاصطناعي غير متأكد من القرار المناسب.',
  },
  draftsOverdue: {
    'fr-FR': "Rappel : une réponse IA attend toujours votre validation.",
    'en-US': 'Reminder: an AI reply is still waiting for your approval.',
    'es-ES': 'Recordatorio: una respuesta de la IA sigue esperando su validación.',
    'de-DE': 'Erinnerung: Eine KI-Antwort wartet immer noch auf Ihre Genehmigung.',
    'pt-PT': 'Lembrete: uma resposta da IA ainda está à espera da sua validação.',
    'ar-SA': 'تذكير: لا يزال هناك رد من الذكاء الاصطناعي في انتظار موافقتك.',
  },
};

const colors = {
  ink: '#0b1c30',
  outline: '#777587',
  grid: '#d3e4fe',
};

const PIE_COLORS = ['#0b1c30', '#5b5f6b', '#8a8d97', '#b9bbc2', '#dcdde1'];

const STATUS_LABELS = {
  NEW: 'Nouveau',
  OPEN: 'Ouvert',
  PENDING: 'En attente',
  SOLVED: 'Résolu',
  CLOSED: 'Fermé',
};

const PRIORITY_LABELS = {
  P1: 'P1 - Critique',
  P2: 'P2 - Haute',
  P3: 'P3 - Moyenne',
  P4: 'P4 - Basse',
};

// Panneau "carré" — style simple sans coins arrondis (cf. THEME_SYSTEM.md, mode "Carré")
function Panel({ title, icon, action, children }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-none flex flex-col">
      <div className="p-md border-b border-outline-variant flex items-center justify-between">
        <h3 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-sm">
          {icon && <span className="material-symbols-outlined text-[18px]">{icon}</span>}
          {title}
        </h3>
        {action}
      </div>
      <div className="p-md flex-1">{children}</div>
    </div>
  );
}

function ConnectionDot({ connected }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-on-surface' : 'bg-outline-variant'}`} />;
}

function StatCard({ label, value, icon, footer }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant flex flex-col p-lg">
      <div className="flex justify-between items-start mb-md">
        <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">{label}</p>
        <span className="material-symbols-outlined text-on-surface-variant">{icon}</span>
      </div>
      <h3 className="font-display-lg text-display-lg text-on-background">{value}</h3>
      {footer && <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">{footer}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [integrations, setIntegrations] = useState(null);
  const [techPerformance, setTechPerformance] = useState([]);
  const [pendingAiDrafts, setPendingAiDrafts] = useState([]);
  const [needsReview, setNeedsReview] = useState([]);
  const [error, setError] = useState('');
  const autoSendAiEmailsRef = useRef(false);
  const draftReminderDelayMinutesRef = useRef(30);
  // Brouillons déjà signalés "en retard" lors du cycle précédent — sert à ne ré-annoncer
  // que les brouillons qui viennent juste de dépasser le délai, pas à chaque rafraîchissement.
  const overdueAnnouncedRef = useRef(new Set());

  function loadPendingAiDrafts() {
    api.get('/dashboard/pending-ai-drafts').then(({ data }) => {
      announceIfNew('drafts', data.map((d) => d.id));

      const delayMs = draftReminderDelayMinutesRef.current * 60 * 1000;
      const now = Date.now();
      const overdueIds = data.filter((d) => now - new Date(d.createdAt).getTime() >= delayMs).map((d) => d.id);
      const stillPendingIds = new Set(data.map((d) => d.id));
      // Un brouillon qui n'est plus en attente (traité) sort du suivi, pour pouvoir être réannoncé
      // s'il revenait un jour avec le même id (cas improbable mais évite une fuite mémoire du Set).
      for (const id of overdueAnnouncedRef.current) {
        if (!stillPendingIds.has(id)) overdueAnnouncedRef.current.delete(id);
      }
      announceIfNew('draftsOverdue', overdueIds.filter((id) => !overdueAnnouncedRef.current.has(id)));
      overdueIds.forEach((id) => overdueAnnouncedRef.current.add(id));

      setPendingAiDrafts(data);
    }).catch(() => {});
  }

  function loadNeedsReview() {
    api.get('/dashboard/needs-human-review').then(({ data }) => {
      announceIfNew('review', data.map((e) => e.ticketId));
      setNeedsReview(data);
    }).catch(() => {});
  }

  // Annonce vocalement (synthèse vocale du navigateur) uniquement les NOUVEAUX éléments apparus
  // depuis le dernier rafraîchissement, pour ne pas répéter la même alerte toutes les 15s.
  const seenIdsRef = useRef({ drafts: new Set(), review: new Set(), draftsOverdue: new Set() });
  function announceIfNew(kind, currentIds) {
    const seen = seenIdsRef.current[kind];
    const newOnes = currentIds.filter((id) => !seen.has(id));
    currentIds.forEach((id) => seen.add(id));

    if (newOnes.length === 0 || typeof window === 'undefined' || !window.speechSynthesis) return;
    if (!isVoiceAlertEnabled()) return;
    // Si l'auto-envoi des emails IA est activé (Paramètres > Automatisation), les réponses partent
    // directement sans jamais créer de brouillon en attente — annoncer "drafts" n'aurait alors aucun sens.
    if (kind === 'drafts' && autoSendAiEmailsRef.current) return;

    const lang = getVoiceAlertLang();
    const message = ANNOUNCE_MESSAGES[kind][lang] || ANNOUNCE_MESSAGES[kind]['fr-FR'];
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = lang;
    window.speechSynthesis.speak(utterance);
  }

  function loadAll() {
    api
      .get('/dashboard/stats')
      .then(({ data }) => setStats(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));

    api.get('/dashboard/pending-approvals').then(({ data }) => setPendingApprovals(data)).catch(() => {});
    api.get('/dashboard/recent-activity').then(({ data }) => setRecentActivity(data)).catch(() => {});
    api.get('/dashboard/integrations').then(({ data }) => setIntegrations(data)).catch(() => {});
    api.get('/dashboard/technician-performance').then(({ data }) => setTechPerformance(data)).catch(() => {});
    api.get('/system-settings').then(({ data }) => {
      autoSendAiEmailsRef.current = !!data.autoSendAiEmails;
      draftReminderDelayMinutesRef.current = data.draftReminderDelayMinutes || 30;
    }).catch(() => {});
    loadPendingAiDrafts();
    loadNeedsReview();
  }

  useEffect(() => {
    loadAll();
    const intervalId = setInterval(loadAll, 15000);
    return () => clearInterval(intervalId);
  }, []);

  const [editedDrafts, setEditedDrafts] = useState({});
  const [editedRecipients, setEditedRecipients] = useState({});
  const [editedCc, setEditedCc] = useState({});
  const [ccInput, setCcInput] = useState({});

  function setDraftContent(id, content) {
    setEditedDrafts((prev) => ({ ...prev, [id]: content }));
  }

  function getCcList(draft) {
    return editedCc[draft.id] !== undefined ? editedCc[draft.id] : (draft.ccRecipients || []);
  }

  function addCc(draft) {
    const value = (ccInput[draft.id] || '').trim();
    if (!value) return;
    const current = getCcList(draft);
    if (!current.includes(value)) {
      setEditedCc((prev) => ({ ...prev, [draft.id]: [...current, value] }));
    }
    setCcInput((prev) => ({ ...prev, [draft.id]: '' }));
  }

  function removeCc(draft, email) {
    setEditedCc((prev) => ({ ...prev, [draft.id]: getCcList(draft).filter((e) => e !== email) }));
  }

  const [confirmReview, setConfirmReview] = useState(null); // { id, action, draft }
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  function askReview(id, action, draft) {
    setConfirmReview({ id, action, draft });
  }

  async function confirmReviewRun() {
    if (!confirmReview) return;
    const { id, action, draft } = confirmReview;
    setReviewSubmitting(true);
    try {
      const body = action === 'approve'
        ? {
            proposedContent: editedDrafts[id] !== undefined ? editedDrafts[id] : draft.proposedContent,
            recipientEmail: editedRecipients[id] !== undefined ? editedRecipients[id] : draft.recipientEmail,
            ccRecipients: getCcList(draft),
          }
        : {};
      await api.post(`/ai-email-drafts/${id}/${action}`, body);
      setEditedDrafts((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setEditedRecipients((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setEditedCc((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setConfirmReview(null);
      loadPendingAiDrafts();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la validation');
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="bg-error-container text-on-error-container p-md rounded-lg">
        {error}
      </div>
    );
  }

  if (!stats) {
    return <p className="font-body-md text-body-md text-on-surface-variant">Chargement...</p>;
  }

  const statusData = stats.byStatus.map((s) => ({ name: STATUS_LABELS[s.status] || s.status, value: s.count }));
  const priorityData = stats.byPriority.map((p) => ({ name: PRIORITY_LABELS[p.priority] || p.priority, value: p.count }));
  const teamData = stats.byTeam.map((t) => ({ name: t.teamName || 'Non assigné', value: t.count }));

  return (
    <div>
      <header className="mb-xl flex justify-between items-center">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Vue d'ensemble</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Indicateurs clés et état actuel du système.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter mb-xl">
        <StatCard label="Total tickets" value={stats.total} icon="confirmation_number" />
        <StatCard label="Tickets ouverts" value={stats.open} icon="pending_actions" />
        <StatCard label="Équipes" value={teamData.length} icon="groups" footer="Répartition de la charge" />
        <StatCard
          label="Priorités P1"
          value={priorityData.find((p) => p.name.startsWith('P1'))?.value ?? 0}
          icon="warning"
          footer="Nécessite une attention immédiate"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        <div className="bg-surface-container-lowest border border-outline-variant lg:col-span-2 flex flex-col">
          <div className="p-lg border-b border-outline-variant">
            <h3 className="font-headline-md text-headline-md text-on-background">Répartition par statut</h3>
          </div>
          <div className="p-lg flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={statusData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.outline} opacity={0.2} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: colors.ink, fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: colors.ink, fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: colors.grid, opacity: 0.4 }}
                  contentStyle={{ border: `1px solid ${colors.outline}` }}
                />
                <Bar dataKey="value" fill={colors.ink} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant flex flex-col">
          <div className="p-lg border-b border-outline-variant">
            <h3 className="font-headline-md text-headline-md text-on-background">Charge par équipe</h3>
          </div>
          <div className="p-lg flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={teamData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value" stroke="none">
                  {teamData.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ border: `1px solid ${colors.outline}` }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant lg:col-span-3 flex flex-col mt-gutter">
          <div className="p-lg border-b border-outline-variant">
            <h3 className="font-headline-md text-headline-md text-on-background">Répartition par priorité</h3>
          </div>
          <div className="p-lg flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={priorityData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.outline} opacity={0.2} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: colors.ink, fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: colors.ink, fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: colors.grid, opacity: 0.4 }}
                  contentStyle={{ border: `1px solid ${colors.outline}` }}
                />
                <Bar dataKey="value" fill={colors.ink} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Widgets supplémentaires - style carré (THEME_SYSTEM.md) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter mt-gutter">
        <Panel
          title="En attente d'approbation"
          icon="fact_check"
          action={<span className="font-mono-sm text-mono-sm text-on-surface-variant">{pendingApprovals.length}</span>}
        >
          {pendingApprovals.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">Aucun ticket en attente.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant">
            {pendingApprovals.map((t) => (
              <Link
                key={t.id}
                to={`/tickets/${t.id}`}
                className="py-sm flex items-center justify-between hover:bg-surface-container-low transition-colors -mx-md px-md"
              >
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface">#{t.id} {t.title}</div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant">
                    {t.requester?.fullName || '-'} · {t.team?.name || 'Non assignée'}
                  </div>
                </div>
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">{t.priority}</span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="Réponses IA en attente"
          icon="smart_toy"
          action={
            <div className="flex items-center gap-sm">
              <span className="font-mono-sm text-mono-sm text-on-surface-variant">{pendingAiDrafts.length}</span>
              <Link to="/email-drafts" className="text-xs text-on-surface-variant hover:underline">
                Voir tout (incl. rejetées) →
              </Link>
            </div>
          }
        >
          {pendingAiDrafts.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">Aucune réponse IA en attente.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant">
            {pendingAiDrafts.map((d) => {
              const isOverdue = Date.now() - new Date(d.createdAt).getTime() >= draftReminderDelayMinutesRef.current * 60 * 1000;
              return (
              <div key={d.id} className={`py-sm flex flex-col gap-xs ${isOverdue ? 'bg-surface-container-low -mx-md px-md border-l-2 border-on-surface' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="font-headline-sm text-headline-sm text-on-surface truncate flex items-center gap-xs">
                    {d.ticket ? `#${d.ticket.id} ${d.ticket.title}` : d.subject}
                    {isOverdue && (
                      <span className="font-label-md text-label-md text-on-surface bg-surface-container-high border border-outline-variant px-1.5 py-0.5 shrink-0">
                        En retard
                      </span>
                    )}
                  </div>
                </div>
                <div className="font-body-sm text-body-sm text-on-surface-variant">{d.subject}</div>

                <div className="flex items-center gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase shrink-0">À</span>
                  <input
                    type="email"
                    value={editedRecipients[d.id] !== undefined ? editedRecipients[d.id] : d.recipientEmail}
                    onChange={(e) => setEditedRecipients((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    className="flex-1 border border-outline-variant rounded-none px-2 py-1 text-body-sm text-on-surface bg-surface focus:outline-none focus:border-on-surface"
                  />
                </div>

                <div className="flex flex-col gap-xs">
                  <div className="flex items-center gap-xs">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase shrink-0">Cc</span>
                    <input
                      type="email"
                      placeholder="Ajouter un email en copie..."
                      value={ccInput[d.id] || ''}
                      onChange={(e) => setCcInput((prev) => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCc(d); } }}
                      className="flex-1 border border-outline-variant rounded-none px-2 py-1 text-body-sm text-on-surface bg-surface focus:outline-none focus:border-on-surface"
                    />
                    <button
                      onClick={() => addCc(d)}
                      className="px-2 py-1 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                    </button>
                  </div>
                  {getCcList(d).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {getCcList(d).map((email) => (
                        <span key={email} className="flex items-center gap-1 px-2 py-0.5 border border-outline-variant text-on-surface-variant text-xs">
                          {email}
                          <button onClick={() => removeCc(d, email)} className="hover:text-error">
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-outline-variant rounded-none p-sm bg-surface-container-lowest text-on-surface font-body-sm text-body-sm max-h-40 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: editedDrafts[d.id] !== undefined ? editedDrafts[d.id] : d.proposedContent }}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => setDraftContent(d.id, e.currentTarget.innerHTML)}
                />
                <p className="text-xs text-outline italic">Destinataire, Cc et contenu sont modifiables avant validation.</p>
                <div className="flex gap-sm mt-xs">
                  <button
                    onClick={() => askReview(d.id, 'approve', d)}
                    className="px-3 py-1 border border-on-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors"
                  >
                    Approuver et envoyer
                  </button>
                  <button
                    onClick={() => askReview(d.id, 'reject', d)}
                    className="px-3 py-1 border border-outline-variant text-on-surface-variant font-body-sm text-body-sm hover:bg-surface-container-high transition-colors"
                  >
                    Rejeter
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Tickets nécessitant une revue humaine"
          icon="warning"
          action={<span className="font-mono-sm text-mono-sm text-on-surface-variant">{needsReview.length}</span>}
        >
          {needsReview.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">Aucun ticket en attente de revue.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant">
            {needsReview.map((e) => (
              <Link
                key={e.ticketId}
                to={`/tickets/${e.ticketId}`}
                className="py-sm flex items-center justify-between hover:bg-surface-container-low transition-colors"
              >
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface truncate">
                    #{e.ticketId} {e.ticket?.title}
                  </div>
                  <div className="text-body-sm text-on-surface-variant">
                    L'IA n'est pas certaine de la décision à prendre sur la réponse reçue.
                  </div>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Activité récente" icon="history">
          {recentActivity.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">Aucune activité récente.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant">
            {recentActivity.map((t) => (
              <Link
                key={t.id}
                to={`/tickets/${t.id}`}
                className="py-sm flex items-center gap-sm hover:bg-surface-container-low transition-colors -mx-md px-md"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-headline-sm text-headline-sm text-on-surface truncate flex items-center gap-xs">
                    #{t.id} {t.title}
                    {t.aiProcessed && (
                      <span
                        title="Traité par l'agent IA"
                        className="inline-flex items-center gap-1 px-2 py-0.5 border border-outline-variant text-on-surface-variant font-medium text-[11px] shrink-0"
                      >
                        <span className="material-symbols-outlined text-[12px]">smart_toy</span>
                        IA
                      </span>
                    )}
                  </div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant">
                    {STATUS_LABELS[t.status] || t.status} · {t.assignedTo?.fullName || 'Non assigné'}
                  </div>
                </div>
                <time className="font-mono-sm text-mono-sm text-on-surface-variant shrink-0">
                  {new Date(t.updatedAt).toLocaleDateString('fr-FR')}
                </time>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Statut des intégrations" icon="cable">
          {!integrations && <p className="font-body-sm text-body-sm text-on-surface-variant">Chargement...</p>}
          {integrations && (
            <div className="flex flex-col gap-sm">
              <div>
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs">Services externes</h4>
                <div className="flex flex-col divide-y divide-outline-variant">
                  {integrations.apiConfigs.map((c) => (
                    <div key={c.id} className="py-xs flex items-center justify-between">
                      <span className="font-body-sm text-body-sm text-on-surface capitalize">{c.name}</span>
                      <div className="flex items-center gap-xs">
                        <ConnectionDot connected={c.connected} />
                        <span className="font-label-md text-label-md text-on-surface-variant uppercase">
                          {c.connected ? 'Connecté' : 'Déconnecté'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {integrations.apiConfigs.length === 0 && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant py-xs">Aucune intégration configurée.</p>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs mt-sm">Workflows n8n</h4>
                <div className="flex flex-col divide-y divide-outline-variant">
                  {integrations.n8nWorkflows.map((w) => (
                    <div key={w.id} className="py-xs flex items-center justify-between">
                      <span className="font-body-sm text-body-sm text-on-surface">{w.name}</span>
                      <div className="flex items-center gap-xs">
                        <ConnectionDot connected={w.isActive} />
                        <span className="font-label-md text-label-md text-on-surface-variant uppercase">
                          {w.isActive ? 'Actif' : 'Inactif'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {integrations.n8nWorkflows.length === 0 && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant py-xs">Aucun workflow configuré.</p>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs mt-sm">Modèles IA</h4>
                <div className="flex flex-col divide-y divide-outline-variant">
                  {integrations.aiProviders.map((p) => (
                    <div key={p.id} className="py-xs flex items-center justify-between">
                      <span className="font-body-sm text-body-sm text-on-surface">{p.label}</span>
                      <div className="flex items-center gap-xs">
                        <ConnectionDot connected={p.connected} />
                        <span className="font-label-md text-label-md text-on-surface-variant uppercase">
                          {p.connected ? `${p.activeKeys} clé(s)` : 'Non connecté'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {integrations.aiProviders.length === 0 && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant py-xs">Aucun fournisseur configuré.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Performance par technicien" icon="engineering">
          {techPerformance.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">Aucune donnée disponible.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant">
            {techPerformance.map((t) => (
              <div key={t.id} className="py-sm flex items-center justify-between">
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface">{t.fullName}</div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant">{t.assigned} ticket(s) assigné(s)</div>
                </div>
                <div className="flex items-center gap-md font-mono-sm text-mono-sm text-on-surface-variant">
                  <span>{t.open} ouverts</span>
                  <span>{t.solved} résolus</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={!!confirmReview}
        title={confirmReview?.action === 'approve' ? 'Approuver et envoyer' : 'Rejeter cette réponse'}
        message={
          confirmReview?.action === 'approve'
            ? "Cette réponse va être envoyée immédiatement par email au destinataire (et en copie aux Cc s'il y en a). Confirmer ?"
            : 'Ce brouillon sera rejeté et ne sera jamais envoyé. Vous pourrez le consulter dans les réponses rejetées.'
        }
        confirmLabel={confirmReview?.action === 'approve' ? 'Envoyer' : 'Rejeter'}
        danger={confirmReview?.action === 'reject'}
        loading={reviewSubmitting}
        onConfirm={confirmReviewRun}
        onCancel={() => setConfirmReview(null)}
      />
    </div>
  );
}
