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

const colors = {
  ink: 'var(--color-primary)',
  outline: 'var(--color-outline)',
  grid: 'var(--color-outline-variant)',
};

const PIE_COLORS = ['#4f46e5', '#38bdf8', '#f97316', '#a855f7', '#64748b'];

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
    <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow flex flex-col overflow-hidden">
      <div className="p-md border-b border-outline-variant/60 bg-surface-bright/35 flex items-center justify-between">
        <h3 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-sm font-semibold">
          {icon && <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>}
          {title}
        </h3>
        {action}
      </div>
      <div className="p-md flex-1">{children}</div>
    </div>
  );
}

function ConnectionDot({ connected }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-primary' : 'bg-outline/30'}`} />;
}

function StatCard({ label, value, icon, footer }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow hover-interactive flex flex-col p-lg justify-between">
      <div>
        <div className="flex justify-between items-start mb-md">
          <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">{label}</p>
          <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary border border-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-sm">{icon}</span>
          </div>
        </div>
        <h3 className="font-display-lg text-display-lg text-on-background font-bold">{value}</h3>
      </div>
      {footer && <p className="font-body-sm text-body-sm text-on-surface-variant mt-sm border-t border-outline-variant/40 pt-2 italic">{footer}</p>}
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
  const signatureLogoUrlRef = useRef(null);
  const draftReminderDelayMinutesRef = useRef(30);

  // Affichage uniquement ici (les panneaux "Réponses IA en attente" / "Tickets nécessitant une
  // revue" sont propres au Dashboard) — l'alerte vocale correspondante tourne séparément sur
  // toutes les pages via useVoiceAlerts (MainLayout.jsx), pas seulement pendant que cette page est ouverte.
  function loadPendingAiDrafts() {
    api.get('/dashboard/pending-ai-drafts').then(({ data }) => setPendingAiDrafts(data)).catch(() => {});
  }

  function loadNeedsReview() {
    api.get('/dashboard/needs-human-review').then(({ data }) => setNeedsReview(data)).catch(() => {});
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
      signatureLogoUrlRef.current = data.signatureLogoUrl || null;
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

  // L'aperçu navigateur ne peut pas résoudre cid:logo-signature (réservé aux emails réellement
  // envoyés, où le logo est joint en pièce jointe inline) — on l'échange pour l'URL réelle juste
  // pour l'affichage, puis on revient à cid: avant sauvegarde pour ne pas casser l'envoi.
  function toDisplayHtml(html) {
    if (!signatureLogoUrlRef.current) return html;
    return html.replaceAll('cid:logo-signature', signatureLogoUrlRef.current);
  }

  function fromDisplayHtml(html) {
    if (!signatureLogoUrlRef.current) return html;
    return html.split(signatureLogoUrlRef.current).join('cid:logo-signature');
  }

  function setDraftContent(id, content) {
    setEditedDrafts((prev) => ({ ...prev, [id]: fromDisplayHtml(content) }));
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
      <div className="bg-error-container text-on-error-container p-md rounded-xl border border-red-500/20">
        {error}
      </div>
    );
  }

  if (!stats) {
    return <p className="font-body-md text-body-md text-on-surface-variant italic">Chargement...</p>;
  }

  const statusData = stats.byStatus.map((s) => ({ name: STATUS_LABELS[s.status] || s.status, value: s.count }));
  const priorityData = stats.byPriority.map((p) => ({ name: PRIORITY_LABELS[p.priority] || p.priority, value: p.count }));
  const teamData = stats.byTeam.map((t) => ({ name: t.teamName || 'Non assigné', value: t.count }));

  return (
    <div className="space-y-lg">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">Vue d'ensemble</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Indicateurs clés et état actuel du système.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
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
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow lg:col-span-2 flex flex-col overflow-hidden">
          <div className="p-lg border-b border-outline-variant/60 bg-surface-bright/35">
            <h3 className="font-headline-md text-headline-md text-on-background font-semibold">Répartition par statut</h3>
          </div>
          <div className="p-lg flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={statusData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.outline} opacity={0.2} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-container-high)', opacity: 0.4 }}
                  contentStyle={{ border: `1px solid var(--color-outline-variant)`, borderRadius: '12px', backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}
                />
                <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow flex flex-col overflow-hidden">
          <div className="p-lg border-b border-outline-variant/60 bg-surface-bright/35">
            <h3 className="font-headline-md text-headline-md text-on-background font-semibold">Charge par équipe</h3>
          </div>
          <div className="p-lg flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={teamData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value" stroke="none">
                  {teamData.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ border: `1px solid var(--color-outline-variant)`, borderRadius: '12px', backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow lg:col-span-3 flex flex-col overflow-hidden">
          <div className="p-lg border-b border-outline-variant/60 bg-surface-bright/35">
            <h3 className="font-headline-md text-headline-md text-on-background font-semibold">Répartition par priorité</h3>
          </div>
          <div className="p-lg flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={priorityData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.outline} opacity={0.2} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-container-high)', opacity: 0.4 }}
                  contentStyle={{ border: `1px solid var(--color-outline-variant)`, borderRadius: '12px', backgroundColor: 'var(--color-surface-container-lowest)', color: 'var(--color-on-surface)' }}
                />
                <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter mt-gutter">
        <Panel
          title="En attente d'approbation"
          icon="fact_check"
          action={<span className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container/60 border border-outline-variant/40 px-2 py-0.5 rounded-full">{pendingApprovals.length}</span>}
        >
          {pendingApprovals.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant italic">Aucun ticket en attente.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant/40">
            {pendingApprovals.map((t) => (
              <Link
                key={t.id}
                to={`/tickets/${t.id}`}
                className="py-md flex items-center justify-between hover:bg-surface-container-low/50 -mx-md px-md transition-colors"
              >
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">#{t.id} {t.title}</div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                    {t.requester?.fullName || '-'} · {t.team?.name || 'Non assignée'}
                  </div>
                </div>
                <span className="font-label-md text-label-md text-on-surface bg-surface-container border border-outline-variant px-2.5 py-0.5 rounded-full uppercase tracking-wider">{t.priority}</span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="Réponses IA en attente"
          icon="smart_toy"
          action={
            <div className="flex items-center gap-sm">
              <span className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container/60 border border-outline-variant/40 px-2 py-0.5 rounded-full">{pendingAiDrafts.length}</span>
              <Link to="/email-drafts" className="text-xs text-primary hover:underline font-semibold">
                Voir tout (incl. rejetées) →
              </Link>
            </div>
          }
        >
          {pendingAiDrafts.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant italic">Aucune réponse IA en attente.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant/40">
            {pendingAiDrafts.map((d) => {
              const isOverdue = Date.now() - new Date(d.createdAt).getTime() >= draftReminderDelayMinutesRef.current * 60 * 1000;
              return (
              <div key={d.id} className={`py-md flex flex-col gap-sm ${isOverdue ? 'bg-error/5 -mx-md px-md border-l-2 border-error' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="font-headline-sm text-headline-sm text-on-surface truncate flex items-center gap-xs font-semibold">
                    {d.ticket ? `#${d.ticket.id} ${d.ticket.title}` : d.subject}
                    {isOverdue && (
                      <span className="font-label-md text-label-md text-error bg-error/10 border border-error/20 px-2 py-0.5 rounded-full shrink-0">
                        En retard
                      </span>
                    )}
                  </div>
                </div>
                <div className="font-body-sm text-body-sm text-on-surface-variant italic">{d.subject}</div>

                <div className="flex items-center gap-md">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase shrink-0 w-8">À</span>
                  <input
                    type="email"
                    value={editedRecipients[d.id] !== undefined ? editedRecipients[d.id] : d.recipientEmail}
                    onChange={(e) => setEditedRecipients((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    className="flex-1 border border-outline-variant/60 rounded-xl px-3 py-1.5 text-body-sm text-on-surface bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                  />
                </div>

                <div className="flex flex-col gap-sm">
                  <div className="flex items-center gap-md">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase shrink-0 w-8">Cc</span>
                    <input
                      type="email"
                      placeholder="Ajouter un email en copie..."
                      value={ccInput[d.id] || ''}
                      onChange={(e) => setCcInput((prev) => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCc(d); } }}
                      className="flex-1 border border-outline-variant/60 rounded-xl px-3 py-1.5 text-body-sm text-on-surface bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                    />
                    <button
                      onClick={() => addCc(d)}
                      className="p-2 border border-outline-variant/60 rounded-xl text-on-surface-variant hover:bg-surface-container-high transition-all flex items-center justify-center shrink-0"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                    </button>
                  </div>
                  {getCcList(d).length > 0 && (
                    <div className="flex flex-wrap gap-1 ml-12">
                      {getCcList(d).map((email) => (
                        <span key={email} className="flex items-center gap-1 px-2.5 py-0.5 border border-outline-variant/60 rounded-full bg-surface-container-low text-on-surface-variant text-xs font-medium">
                          {email}
                          <button onClick={() => removeCc(d, email)} className="hover:text-error transition-colors">
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-outline-variant/60 rounded-xl p-md bg-surface-container-lowest text-on-surface font-body-sm text-body-sm max-h-40 overflow-y-auto focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  dangerouslySetInnerHTML={{ __html: toDisplayHtml(editedDrafts[d.id] !== undefined ? editedDrafts[d.id] : d.proposedContent) }}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => setDraftContent(d.id, e.currentTarget.innerHTML)}
                />
                <p className="text-xs text-outline italic">Destinataire, Cc et contenu sont modifiables avant validation.</p>
                <div className="flex gap-sm mt-xs">
                  <button
                    onClick={() => askReview(d.id, 'approve', d)}
                    className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold text-body-sm shadow-sm transition-all duration-300"
                  >
                    Approuver et envoyer
                  </button>
                  <button
                    onClick={() => askReview(d.id, 'reject', d)}
                    className="px-4 py-1.5 rounded-xl border border-outline-variant/60 text-on-surface-variant font-semibold text-body-sm hover:bg-surface-container-high transition-colors"
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
          action={<span className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container/60 border border-outline-variant/40 px-2 py-0.5 rounded-full">{needsReview.length}</span>}
        >
          {needsReview.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant italic">Aucun ticket en attente de revue.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant/40">
            {needsReview.map((e) => (
              <Link
                key={e.ticketId}
                to={`/tickets/${e.ticketId}`}
                className="py-md flex items-center justify-between hover:bg-surface-container-low/50 transition-colors"
              >
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface truncate font-semibold">
                    #{e.ticketId} {e.ticket?.title}
                  </div>
                  <div className="text-body-sm text-on-surface-variant mt-1">
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
            <p className="font-body-sm text-body-sm text-on-surface-variant italic">Aucune activité récente.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant/40">
            {recentActivity.map((t) => (
              <Link
                key={t.id}
                to={`/tickets/${t.id}`}
                className="py-md flex items-center gap-sm hover:bg-surface-container-low/50 -mx-md px-md transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-headline-sm text-headline-sm text-on-surface truncate flex items-center gap-xs font-semibold">
                    #{t.id} {t.title}
                    {t.aiProcessed && (
                      <span
                        title="Traité par l'agent IA"
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary font-medium text-[11px] shrink-0"
                      >
                        <span className="material-symbols-outlined text-[12px]">smart_toy</span>
                        IA
                      </span>
                    )}
                  </div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                    {STATUS_LABELS[t.status] || t.status} · {t.assignedTo?.fullName || 'Non assigné'}
                  </div>
                </div>
                <time className="font-mono-sm text-mono-sm text-on-surface-variant shrink-0 bg-surface-container/60 border border-outline-variant/40 px-2 py-0.5 rounded-full">
                  {new Date(t.updatedAt).toLocaleDateString('fr-FR')}
                </time>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Statut des intégrations" icon="cable">
          {integrations && (
            <div className="flex flex-col gap-sm">
              <div>
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs font-bold">Services externes</h4>
                <div className="flex flex-col divide-y divide-outline-variant/40">
                  {integrations.apiConfigs.map((c) => (
                    <div key={c.id} className="py-2 flex items-center justify-between">
                      <span className="font-body-sm text-body-sm text-on-surface capitalize font-medium">{c.name}</span>
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
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs mt-sm font-bold">Workflows n8n</h4>
                <div className="flex flex-col divide-y divide-outline-variant/40">
                  {integrations.n8nWorkflows.map((w) => (
                    <div key={w.id} className="py-2 flex items-center justify-between">
                      <span className="font-body-sm text-body-sm text-on-surface font-medium">{w.name}</span>
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
                <h4 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs mt-sm font-bold">Modèles IA</h4>
                <div className="flex flex-col divide-y divide-outline-variant/40">
                  {integrations.aiProviders.map((p) => (
                    <div key={p.id} className="py-2 flex items-center justify-between">
                      <span className="font-body-sm text-body-sm text-on-surface font-medium">{p.label}</span>
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
            <p className="font-body-sm text-body-sm text-on-surface-variant italic">Aucune donnée disponible.</p>
          )}
          <div className="flex flex-col divide-y divide-outline-variant/40">
            {techPerformance.map((t) => (
              <div key={t.id} className="py-sm flex items-center justify-between">
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{t.fullName}</div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant mt-1">{t.assigned} ticket(s) assigné(s)</div>
                </div>
                <div className="flex items-center gap-md font-mono-sm text-mono-sm text-on-surface-variant">
                  <span className="bg-primary/5 text-primary border border-primary/10 px-2 py-0.5 rounded-full">{t.open} ouverts</span>
                  <span className="bg-emerald-500/5 text-emerald-500 border border-emerald-500/10 px-2 py-0.5 rounded-full">{t.solved} résolus</span>
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
