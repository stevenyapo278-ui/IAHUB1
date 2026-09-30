import { useEffect, useMemo, useState } from 'react';
import {
  Inbox, ChevronDown, Sparkles, Plus, RefreshCw, Flame,
  UserCheck, MessageSquare, Trash2, FileText, HelpCircle, TrendingUp,
  Clock, CheckCircle2, Shield, AlertTriangle, Layers, Link2, History,
} from 'lucide-react';
import { sanitizeHtml } from '../utils/sanitize';

/* ════════════════════════════════════════════════════════════════════════
   ActivityStream — historique en timeline « à gouttière »
   • colonne de date à gauche (heure + jour)
   • rail vertical continu avec nœud coloré par type d'entrée
   • contenu à droite : titre, méta, notes
   • séparateurs pointillés entre les entrées + terminal de rail
   • en-têtes de jour collants (en couleur d'accent)
   ════════════════════════════════════════════════════════════════════════ */

const TONES = {
  info:    'bg-blue-500/10    text-blue-600    dark:text-blue-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn:    'bg-amber-500/10   text-amber-600   dark:text-amber-400',
  danger:  'bg-red-500/10     text-red-600     dark:text-red-400',
  ai:      'bg-violet-500/10  text-violet-600  dark:text-violet-400',
  neutral: 'bg-slate-500/10   text-slate-600   dark:text-slate-400',
};

/* Couleur du nœud (le point plein posé sur le rail) */
const NODE = {
  info:    'text-blue-500    dark:text-blue-400',
  success: 'text-emerald-500 dark:text-emerald-400',
  warn:    'text-amber-500   dark:text-amber-400',
  danger:  'text-red-500     dark:text-red-400',
  ai:      'text-violet-500  dark:text-violet-400',
  neutral: 'text-slate-400   dark:text-slate-500',
};

function toneOf(type) {
  if (/SLA_BREACHED|GLPI_SYNC_FAILED|REJECTED|CLOSURE_REJECTED/.test(type)) return 'danger';
  if (/APPROVED|CLOSURE_VALIDATED|SOLVED|CLOSED/.test(type)) return 'success';
  if (/PRIORITY|ESCALAT|REMINDER|SLA_UPDATED|CLOSURE_SUGGESTED|WAIT/.test(type)) return 'warn';
  if (/^AI_|SUGGEST/.test(type)) return 'ai';
  if (/CREATED|ASSIGNED|LINKED|MERGED|REOPEN/.test(type)) return 'info';
  return 'neutral';
}

function eventIcon(type) {
  switch (type) {
    case 'CREATED': return <Plus className="w-3 h-3" />;
    case 'STATUS_CHANGED': return <RefreshCw className="w-3 h-3" />;
    case 'PRIORITY_CHANGED': return <Flame className="w-3 h-3" />;
    case 'ASSIGNED': return <UserCheck className="w-3 h-3" />;
    case 'EMAIL_RECEIVED': case 'EMAIL_SENT': return <Inbox className="w-3 h-3" />;
    case 'FOLLOWUP_ADDED': return <MessageSquare className="w-3 h-3" />;
    case 'FOLLOWUP_DELETED': return <Trash2 className="w-3 h-3" />;
    case 'AI_ANALYZED': case 'AI_DRAFT_GENERATED': case 'AI_FOLLOWUP_DRAFT_GENERATED':
    case 'AI_AUTO_REPLY_IGNORED': case 'AI_CONVERSATION_ESCALATED': return <Sparkles className="w-3 h-3" />;
    case 'KNOWLEDGE_CREATED': return <FileText className="w-3 h-3" />;
    case 'REOPENED': return <HelpCircle className="w-3 h-3" />;
    case 'ESCALATED': case 'ESCALATION_REQUESTED': return <TrendingUp className="w-3 h-3" />;
    case 'REMINDER_SENT': return <Clock className="w-3 h-3" />;
    case 'CLOSED_AUTO': case 'CLOSURE_SUGGESTED': return <CheckCircle2 className="w-3 h-3" />;
    case 'CLOSURE_VALIDATED': case 'APPROVED': return <Shield className="w-3 h-3" />;
    case 'CLOSURE_REJECTED': case 'REJECTED': return <Trash2 className="w-3 h-3" />;
    case 'SLA_BREACHED': case 'GLPI_SYNC_FAILED': return <AlertTriangle className="w-3 h-3" />;
    case 'SLA_UPDATED': return <Clock className="w-3 h-3" />;
    case 'MERGED_INTO': case 'MERGED_FROM': return <Layers className="w-3 h-3" />;
    case 'LINKED': case 'UNLINKED': return <Link2 className="w-3 h-3" />;
    default: return <History className="w-3 h-3" />;
  }
}

function eventLabel(type) {
  const labels = {
    CREATED: 'Ticket créé',
    STATUS_CHANGED: 'Statut modifié',
    PRIORITY_CHANGED: 'Priorité modifiée',
    ASSIGNED: 'Ticket assigné',
    EMAIL_RECEIVED: 'Email reçu',
    EMAIL_SENT: 'Email envoyé',
    FOLLOWUP_ADDED: 'Commentaire ajouté',
    FOLLOWUP_EDITED: 'Commentaire modifié',
    FOLLOWUP_DELETED: 'Commentaire supprimé',
    FOLLOWUP_MADE_PRIVATE: 'Commentaire rendu privé',
    FOLLOWUP_MADE_PUBLIC: 'Commentaire rendu public',
    AI_ANALYZED: 'Analyse IA',
    AI_DRAFT_GENERATED: 'Brouillon IA généré',
    AI_FOLLOWUP_DRAFT_GENERATED: 'Brouillon de réponse IA',
    AI_AUTO_REPLY_IGNORED: 'Réponse auto IA ignorée',
    AI_CONVERSATION_ESCALATED: 'Escalade vers un humain',
    KNOWLEDGE_CREATED: 'Article de connaissance créé',
    REOPENED: 'Ticket rouvert',
    ESCALATED: 'Ticket escaladé',
    ESCALATION_REQUESTED: 'Escalade demandée',
    REMINDER_SENT: 'Relance envoyée',
    CLOSED_AUTO: 'Clôture automatique',
    CLOSURE_SUGGESTED: 'Clôture suggérée',
    CLOSURE_VALIDATED: 'Clôture validée',
    CLOSURE_REJECTED: 'Clôture rejetée',
    APPROVED: 'Approuvé (Hotline)',
    REJECTED: 'Rejeté (Hotline)',
    SLA_BREACHED: 'SLA dépassé',
    SLA_UPDATED: 'SLA mis à jour',
    MERGED_INTO: 'Fusionné dans un autre ticket',
    MERGED_FROM: 'Ticket fusionné ici',
    LINKED: 'Ticket lié',
    UNLINKED: 'Lien supprimé',
    GLPI_SYNC_FAILED: 'Échec synchronisation GLPI',
    REPLY_ON_CLOSED_SUGGESTED: 'Réponse suggérée (ticket fermé)',
    REPLY_ON_CLOSED_REOPENED: 'Réponse sur ticket fermé : ticket rouvert',
    REPLY_ON_CLOSED_NEW_TICKET: 'Réponse sur ticket fermé : nouvelle demande créée',
    REPLY_ON_CLOSED_DISMISSED: 'Suggestion de réponse ignorée',
    NEW_TICKET_SUGGESTED: 'Nouvelle demande détectée dans le fil',
    NEW_TICKET_SUGGESTED_CREATED: 'Nouvelle demande créée depuis la suggestion',
    NEW_TICKET_SUGGESTED_DISMISSED: 'Suggestion de nouvelle demande ignorée',
  };
  return labels[type] || (type ? type.replace(/_/g, ' ').toLowerCase() : '');
}

function eventDetail(event) {
  const p = event?.payload || {};
  const parts = [];
  if (p.oldStatus && p.newStatus) parts.push(`${p.oldStatus} → ${p.newStatus}`);
  if (p.oldPriority && p.newPriority) parts.push(`${p.oldPriority} → ${p.newPriority}`);
  if (p.action) parts.push(p.action);
  if (p.reason) parts.push(p.reason);
  if (p.error) parts.push(p.error);
  if (p.dueAt) parts.push(`Échéance : ${new Date(p.dueAt).toLocaleString('fr-FR')}`);
  if (p.level) parts.push(`Niveau ${p.level}`);
  if (p.targetTicketId) parts.push(`Ticket #${p.targetTicketId}`);
  return parts.join(' · ');
}

/* ── Gouttière : heure (fort) + jour court (secondaire) ─────────────────── */
function gutterDate(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return ['--:--', ''];
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const day = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).replace(/\.$/, '');
  return [time, day];
}

/* ── Séparateur de jour ───────────────────────────────────────────────── */
function dayKey(input) {
  const d = new Date(input);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(input, now = Date.now()) {
  const d = new Date(input);
  const today = new Date(now);
  const yest = new Date(now - 86400000);
  if (dayKey(d) === dayKey(today)) return "Aujourd'hui";
  if (dayKey(d) === dayKey(yest)) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ── Fusion des 3 sources ─────────────────────────────────────────────── */
export function buildTimeline({ followups = [], messages = [], events = [], messageKind = 'email' } = {}) {
  return [
    ...followups.map((f) => ({ key: `f-${f.id}`, kind: 'comment', date: f.createdAt, data: f })),
    ...messages.map((m) => ({ key: `m-${m.id}`, kind: messageKind, date: m.timestamp || m.createdAt, data: m })),
    ...events.map((e) => ({ key: `e-${e.id}`, kind: 'system', date: e.createdAt, data: e })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
}

const FILTERS = [
  { id: 'all', label: 'Tout' },
  { id: 'comment', label: 'Commentaires' },
  { id: 'email', label: 'Emails' },
  { id: 'system', label: 'Système' },
];

/* ════════════════════════════════════════════════════════════════════════ */

export default function ActivityStream({
  items = [],
  containerRef,
  showFilters = false,
  defaultFilter = 'all',
  empty = 'Aucune activité pour le moment.',
  stickyDates = true,
  editingId = null,
  expandedIds = null,
  onToggleExpand,
  commentBadges,
  commentBody,
  commentEditor,
  commentActions,
  emailPreview,
  emailBody,
  scrollToEnd = false,
}) {
  const [filter, setFilter] = useState(defaultFilter);
  // Horloge de référence pour le calcul des regroupements/jours.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (scrollToEnd && containerRef?.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [items.length, scrollToEnd, containerRef]);

  const counts = useMemo(() => {
    const c = { all: items.length, comment: 0, email: 0, system: 0 };
    items.forEach((i) => { if (c[i.kind] !== undefined) c[i.kind] += 1; });
    return c;
  }, [items]);

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter]
  );

  const decorated = useMemo(() => visible.map((i) => ({ ...i, now })), [visible, now]);

  const days = useMemo(() => {
    const out = [];
    decorated.forEach((item) => {
      const k = dayKey(item.date);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(item);
      else out.push({ key: k, label: dayLabel(item.date, item.now), items: [item], date: item.date });
    });
    return out;
  }, [decorated]);

  const hasItems = decorated.length > 0;

  return (
    <div className="min-w-0">
      {/* ── Barre de filtres ─────────────────────────────────────────── */}
      {showFilters && hasItems && (
        <div className="flex flex-wrap items-center gap-1.5 pb-3 mb-1" role="tablist" aria-label="Filtrer l'historique">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const n = counts[f.id] ?? 0;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.id)}
                disabled={n === 0 && !active}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold
                  transition-colors duration-150 cursor-pointer border
                  ${active
                    ? 'bg-primary text-on-primary border-primary'
                    : 'bg-surface-container-low text-on-surface-variant border-outline-variant hover:bg-surface-container hover:text-on-surface'}
                  ${n === 0 && !active ? 'opacity-40 cursor-not-allowed hover:bg-surface-container-low hover:text-on-surface-variant' : ''}`}
              >
                {f.label}
                <span className={`text-[9px] font-mono tabular-nums ${active ? 'opacity-75' : 'act-faint'}`}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Flux ─────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="min-w-0">
        {!hasItems && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <span className="w-11 h-11 rounded-2xl bg-surface-container-high text-on-surface-variant flex items-center justify-center mb-3">
              <MessageSquare className="w-5 h-5" />
            </span>
            <p className="text-xs act-muted italic">{empty}</p>
          </div>
        )}

        {days.map((day) => (
          <section key={day.key}>
            {/* En-tête de jour — collant, en couleur d'accent */}
            <div
              className={`${stickyDates ? 'sticky top-0 z-20' : ''} act-head backdrop-blur-md px-1 py-2`}
            >
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-bold text-primary whitespace-nowrap">{day.label}</span>
                <span className="act-rule h-px flex-1" />
                <span className="act-faint text-[10px] font-mono tabular-nums">{day.items.length}</span>
              </div>
            </div>

            {/* Rail + entrées */}
            <div className="relative">
              {/* Le rail réutilise les mêmes colonnes (en rem) que les lignes,
                  pour rester parfaitement aligné sur les nœuds quelle que soit
                  la taille de police racine (--user-font-size: 14px). */}
              <div className="pointer-events-none absolute inset-0 flex" aria-hidden="true">
                <div className="w-16 shrink-0" />
                <div className="relative w-6 shrink-0">
                  <span className="absolute left-1/2 top-[17px] bottom-4 act-rail w-px -translate-x-1/2" />
                </div>
                <div className="flex-1" />
              </div>

              {day.items.map((item) => {
                const [time, dayShort] = gutterDate(item.date);
                const common = { item, time, dayShort };
                if (item.kind === 'system') return <SystemRow key={item.key} {...common} />;
                if (item.kind === 'email') {
                  return (
                    <EmailRow
                      key={item.key}
                      {...common}
                      expanded={!!expandedIds?.has(item.data.id)}
                      onToggle={onToggleExpand}
                      preview={emailPreview?.(item.data)}
                      body={emailBody?.(item.data)}
                    />
                  );
                }
                const editing = editingId === item.data.id;
                return (
                  <CommentRow
                    key={item.key}
                    {...common}
                    editing={editing}
                    badges={commentBadges?.(item.data)}
                    body={commentEditor && editing
                      ? commentEditor(item.data)
                      : (commentBody ? commentBody(item.data) : defaultCommentBody(item.data?.content))}
                    actions={commentActions?.(item.data)}
                  />
                );
              })}

              {/* Terminal du rail */}
              <div className="relative h-4" aria-hidden="true">
                <div className="absolute inset-0 flex">
                  <div className="w-16 shrink-0" />
                  <div className="relative w-6 shrink-0">
                    <span className="absolute act-rail inset-y-0 left-1/2 w-px -translate-x-1/2" />
                    <span className="absolute left-1/2 act-rule top-2.5 h-px w-3 -translate-x-1/2 rounded-full" />
                    <span className="absolute left-1/2 act-rule top-[11px] h-px w-3 -translate-x-1/2 rounded-full" />
                  </div>
                  <div className="flex-1" />
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ── Ligne générique : gouttière · nœud · contenu · action ─────────────── */
function RailRow({ time, dayShort, nodeClass, children, right }) {
  return (
    <article className="group relative flex items-start act-row border-b border-dashed act-dots transition-colors duration-150">
      {/* Gouttière date */}
      <div className="w-16 shrink-0 pr-3 pt-2.5 text-right">
        <div className="text-[11px] font-bold text-on-surface leading-tight tabular-nums">{time}</div>
        <div className="act-muted text-[10px] leading-tight">{dayShort}</div>
      </div>

      {/* Nœud sur le rail */}
      <div className="w-6 shrink-0 flex justify-center pt-[11px]">
        <span
          className={`relative z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-container-lowest
            ring-2 ring-surface-container-lowest transition-transform duration-150 group-hover:scale-110 ${nodeClass}`}
        >
          <span className="h-2 w-2 rounded-full bg-current" />
        </span>
      </div>

      {/* Contenu */}
      <div className="min-w-0 flex-1 py-2.5 pl-4 pr-1">{children}</div>

      {/* Slot droite (pilule / actions) */}
      {right && <div className="shrink-0 pt-2.5 pl-2">{right}</div>}
    </article>
  );
}

/* ── Événement système ─────────────────────────────────────────────────── */
function SystemRow({ item, time, dayShort }) {
  const type = item.data.type || '';
  const tone = TONES[toneOf(type)];
  const label = eventLabel(type);
  const detail = eventDetail(item.data);
  const actor = item.data.actor && item.data.actor !== 'SYSTEM' ? item.data.actor : null;
  const absolute = new Date(item.date).toLocaleString('fr-FR');

  return (
    <RailRow
      time={time}
      dayShort={dayShort}
      nodeClass={NODE[toneOf(type)]}
      right={(
        <span
          title={absolute}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${tone}`}
        >
          {eventIcon(type)}
        </span>
      )}
    >
      <div title={absolute}>
        <h4 className="text-[13px] font-semibold leading-tight text-on-surface">{label}</h4>
        {(actor || detail) && (
          <p className="act-muted mt-1 text-[11px] leading-snug">
            {actor && <span className="font-semibold text-on-surface-variant">{actor}</span>}
            {actor && detail && ' · '}
            {detail && <span>{detail}</span>}
          </p>
        )}
      </div>
    </RailRow>
  );
}

/* ── Commentaire ───────────────────────────────────────────────────────── */
function CommentRow({ item, time, dayShort, editing, badges, body, actions }) {
  const f = item.data;
  const name = f.source === 'glpi' ? 'GLPI' : (f.author?.fullName || f.authorName || 'Système');
  const absolute = new Date(item.date).toLocaleString('fr-FR');

  return (
    <RailRow
      time={time}
      dayShort={dayShort}
      nodeClass="text-primary"
      right={actions && (
        <span className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </span>
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="text-[13px] font-bold leading-tight text-on-surface" title={absolute}>{name}</h4>
        {badges}
        {f.updatedAt && (
          <span className="act-faint text-[10px]" title={`Modifié le ${new Date(f.updatedAt).toLocaleString('fr-FR')}`}>
            (modifié)
          </span>
        )}
      </div>
      <div className="mt-1">{body}</div>
    </RailRow>
  );
}

/* ── Email : pilule « Voir / Replier » à droite ────────────────────────── */
function EmailRow({ item, time, dayShort, expanded, onToggle, preview, body }) {
  const m = item.data;
  const inbound = m.direction === 'INBOUND';
  const absolute = new Date(item.date).toLocaleString('fr-FR');

  return (
    <RailRow
      time={time}
      dayShort={dayShort}
      nodeClass={inbound ? 'text-blue-500 dark:text-blue-400' : 'text-emerald-500 dark:text-emerald-400'}
      right={(
        <button
          type="button"
          onClick={() => onToggle?.(m.id)}
          aria-expanded={expanded}
          title={absolute}
          className={`act-pill inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold
            text-primary transition-colors duration-150 cursor-pointer
            ${expanded ? 'is-open' : ''}`}
        >
          {expanded ? 'Replier' : 'Voir'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`inline-block rounded px-1.5 py-px text-[8px] font-black uppercase tracking-wider ${
            inbound
              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          }`}
        >
          {inbound ? 'Reçu' : 'Envoyé'}
        </span>
        <h4 className="min-w-0 flex-1 truncate text-[13px] font-bold leading-tight text-on-surface" title={m.subject}>
          {m.subject || 'Sans objet'}
        </h4>
      </div>
      <p className="act-muted mt-1 text-[11px] leading-snug">
        <span className="font-semibold text-on-surface-variant">{inbound ? 'De' : 'À'}</span>
        {' '}
        {inbound ? m.sender : (m.recipients?.join(', ') || '—')}
        {!inbound && m.sender && <span className="act-faint"> · {m.sender}</span>}
      </p>
      {preview && !expanded && (
        <p className="act-muted mt-1 line-clamp-1 text-[12px] italic leading-snug">{preview}</p>
      )}
      {expanded && body && <div className="mt-2">{body}</div>}
    </RailRow>
  );
}

/* ── Corps de commentaire par défaut (HTML ou texte brut) ──────────────── */
function defaultCommentBody(content) {
  if (!content) return null;
  if (content.includes('<') || content.includes('&#') || content.includes('&lt;')) {
    return (
      <div
        className="text-[13px] leading-relaxed text-on-surface [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg
          [&_img]:border [&_img]:border-outline-variant [&_a]:text-blue-600 [&_a]:underline
          [&_p]:mb-1.5 [&_p]:last:mb-0 [&_b]:font-semibold [&_div]:mb-1"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    );
  }
  return <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-on-surface">{content}</div>;
}
