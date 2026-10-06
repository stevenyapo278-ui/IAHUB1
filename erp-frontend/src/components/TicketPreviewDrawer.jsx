/**
 * TicketPreviewDrawer — aperçu latéral d'un ticket (double-clic sur une ligne).
 *
 * Volet de droite (même mécanisme que le filtre avancé via FormDrawer) qui
 * montre l'essentiel d'un ticket sans quitter la liste : badges (statut,
 * priorité, SLA, escalade, approbation), infos clés, résumé IA, description et
 * les 3 derniers suivis (GET /tickets/:id/preview, caché en mémoire).
 * Le bouton du pied de volet renvoie vers la fiche complète.
 *
 * Props :
 *   open     : bool
 *   ticket   : objet ticket (ligne de la liste — scalaires + requester/assigné/équipe)
 *   filterQs : string — querystring des filtres (propagée vers la fiche complète)
 *   onClose  : function
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ticket, ExternalLink, User, Users, MapPin, Tag, Clock, Calendar,
  Sparkles, MessageSquare, Building2, ArrowUpCircle, ShieldCheck,
} from 'lucide-react';
import api from '../api/client';
import FormDrawer from './FormDrawer';
import SlaBadge from './SlaBadge';
import { STATUS_CONFIG } from '../constants/tickets';
import { sanitizeHtml } from '../utils/sanitize';

// Cache mémoire partagé entre les réouvertures du volet (1 appel par ticket)
const _previewCache = new Map();

const PRIORITY_CHIP = {
  P1: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
  P2: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
  P3: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  P4: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
};

const APPROVAL_CHIP = {
  PENDING: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  APPROVED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  REJECTED: 'bg-red-500/10 text-red-600 border-red-500/30',
};

function fmtDateTime(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return null; }
}

function InfoTile({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/50 px-3 py-2 min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        <Icon className="w-3 h-3 shrink-0" /> {label}
      </div>
      <p className="text-[13px] font-semibold text-on-surface truncate mt-0.5" title={String(value)}>{value}</p>
    </div>
  );
}

export default function TicketPreviewDrawer({ open, ticket, filterQs = '', onClose }) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState({ id: null, data: null, error: false });

  const ticketId = ticket?.id ?? null;

  // Suivis + SLA de résolution : lazy GET /preview (les scalaires viennent de la ligne).
  // Le cache est lu au rendu (pas de setState synchrone dans l'effet).
  useEffect(() => {
    if (!open || !ticketId || _previewCache.has(ticketId)) return;
    let cancelled = false;
    api.get(`/tickets/${ticketId}/preview`)
      .then(({ data }) => {
        if (cancelled) return;
        _previewCache.set(ticketId, data);
        setLoaded({ id: ticketId, data, error: false });
      })
      .catch(() => { if (!cancelled) setLoaded({ id: ticketId, data: null, error: true }); });
    return () => { cancelled = true; };
  }, [open, ticketId]);

  if (!ticket) return null;

  // Ne jamais afficher les suivis d'un autre ticket pendant le changement
  const preview = loaded.id === ticketId
    ? loaded.data
    : (_previewCache.get(ticketId) || null);
  const previewError = loaded.id === ticketId && loaded.error;
  const st = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.NEW;
  const prCls = PRIORITY_CHIP[ticket.priority] || PRIORITY_CHIP.P4;
  const approvalCls = APPROVAL_CHIP[ticket.approvalStatus];
  const assignees = (ticket.assignees || []).map((a) => a.fullName).join(', ');
  const assignedName = ticket.assignedTo?.fullName || assignees || null;
  const description = String(ticket.content || '').trim();
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(description);
  const followups = preview?.followups || [];

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={`Ticket #${ticket.id}`}
      subtitle={ticket.title || ''}
      icon={Ticket}
      iconColor="text-primary"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Fermer</button>
          <button
            onClick={() => navigate(`/tickets/${ticket.id}${filterQs}`)}
            className="btn-primary"
            title="Ouvrir la fiche complète"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Ouvrir la fiche complète
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ── Badges ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${st.bg}`}>
            <st.Icon className="w-3 h-3 shrink-0" /> {st.label}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${prCls}`}>
            {ticket.priority}
          </span>
          <SlaBadge ticket={ticket} />
          {ticket.escalationLevel > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30">
              <ArrowUpCircle className="w-3 h-3" /> Escalade N{ticket.escalationLevel}
            </span>
          )}
          {approvalCls && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${approvalCls}`}>
              <ShieldCheck className="w-3 h-3 mr-0.5" />
              {ticket.approvalStatus === 'PENDING' ? 'Validation en attente'
                : ticket.approvalStatus === 'APPROVED' ? 'Validée' : 'Refusée'}
            </span>
          )}
          {ticket.category && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-muted text-muted-foreground">
              {ticket.category}
            </span>
          )}
        </div>

        {/* ── Infos clés ── */}
        <div className="grid grid-cols-2 gap-2">
          <InfoTile icon={User} label="Demandeur" value={ticket.requester?.fullName || null} />
          <InfoTile icon={Users} label="Assigné" value={assignedName} />
          <InfoTile icon={Tag} label="Équipe" value={ticket.team?.name || null} />
          <InfoTile icon={MapPin} label="Lieu" value={ticket.locationName || null} />
          <InfoTile icon={Calendar} label="Créé le" value={fmtDateTime(ticket.createdAt)} />
          <InfoTile icon={Clock} label="Modifié le" value={fmtDateTime(ticket.updatedAt)} />
          <InfoTile icon={Building2} label="Source" value={ticket.source || ticket.origin || null} />
          <InfoTile icon={Calendar} label="Résolu le" value={fmtDateTime(ticket.solvedAt)} />
        </div>

        {/* ── Résumé IA ── */}
        {ticket.aiSummary && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary mb-1">
              <Sparkles className="w-3 h-3" /> Résumé IA
            </div>
            <p className="text-[13px] text-on-surface leading-relaxed">{ticket.aiSummary}</p>
          </div>
        )}

        {/* ── Description ── */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Description
          </h3>
          {description ? (
            looksHtml ? (
              <div
                className="text-[13px] text-on-surface leading-relaxed [&_img]:max-w-full [&_a]:text-primary"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }}
              />
            ) : (
              <p className="text-[13px] text-on-surface leading-relaxed whitespace-pre-wrap break-words">{description}</p>
            )
          ) : (
            <p className="text-[13px] text-on-surface-variant italic">Aucune description.</p>
          )}
        </section>

        {/* ── Activité récente (3 derniers suivis) ── */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Activité récente
          </h3>
          {!preview && !previewError && (
            <div className="flex items-center gap-2 text-[12px] text-on-surface-variant py-2">
              <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              Chargement de l'activité…
            </div>
          )}
          {previewError && (
            <p className="text-[12px] text-on-surface-variant italic">Activité indisponible pour le moment.</p>
          )}
          {preview && followups.length === 0 && (
            <p className="text-[12px] text-on-surface-variant italic">Aucun suivi pour l'instant.</p>
          )}
          {preview && followups.length > 0 && (
            <ul className="space-y-2">
              {followups.map((f) => (
                <li key={f.id} className="rounded-xl border border-outline-variant/40 bg-surface-container-low/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[12px] font-bold text-on-surface truncate">{f.author?.fullName || 'Anonyme'}</span>
                    <span className="text-[10px] text-on-surface-variant shrink-0">{fmtDateTime(f.createdAt)}</span>
                  </div>
                  <p className="text-[12px] text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
                    {f.content}
                  </p>
                  {f.isPrivate && (
                    <span className="mt-1 inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">
                      Privé
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {preview && followups.length > 0 && (
            <p className="text-[11px] text-on-surface-variant">
              3 derniers suivis uniquement — l'historique complet est dans la fiche.
            </p>
          )}
        </section>
      </div>
    </FormDrawer>
  );
}
