import { memo } from 'react';
import {
  Paperclip, MailOpen, Mail, ArrowRight, Trash2, ArrowUpRight, Send,
} from 'lucide-react';
import {
  PRIORITY_CONFIG, STATUS_CONFIG, initialOf, displayAddr,
  participantsLabel, formatDate,
} from './inboxShared';

// ── Conversation de la liste (façon Outlook moderne) ─────────────────────────
// Memoïsé : ne re-render que si ses props changent.
const ThreadItem = memo(function ThreadItem({
  thread, isSelected, isUnread, isCompact,
  onSelect, onContextMenu, onToggleSelect, onToggleRead, onMove, onDelete,
}) {
  const latest = thread.latest || {};
  const pCfg = PRIORITY_CONFIG[latest.aiPriority];
  const sCfg = STATUS_CONFIG[latest.status];
  const SIcon = sCfg?.icon;
  const sender = latest.fromName || latest.fromEmail || participantsLabel(thread.participants);
  const snippet = latest.aiSummary || latest.bodyPreview || '';
  const hasMeta = thread.ccRecipients?.length > 0 || latest.erpTicketId || sCfg;

  return (
    <button
      type="button"
      onClick={() => onSelect(thread)}
      onContextMenu={(e) => onContextMenu(e, thread)}
      className={`w-full text-left flex items-stretch relative border-b border-outline-variant/10 transition-colors group ${
        isSelected
          ? 'bg-primary/[0.10]'
          : isUnread
            ? 'bg-surface-container-low/50 hover:bg-primary/[0.04]'
            : 'hover:bg-primary/[0.035]'
      }`}
    >
      {/* Liseré : priorité si présente, sinon marqueur de non-lu */}
      <div
        className={`w-[3px] shrink-0 ${!pCfg && isUnread ? 'bg-primary' : ''}`}
        style={pCfg ? { background: pCfg.stripe } : undefined}
      />

      <div className={`flex items-start gap-2.5 flex-1 min-w-0 px-3 ${isCompact ? 'py-2' : 'py-2.5'}`}>
        {/* Sélection */}
        <div className="shrink-0 flex items-center pt-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(thread.id)}
            className="cursor-pointer accent-primary w-3.5 h-3.5 rounded"
          />
        </div>

        {/* Avatar */}
        <div
          className={`shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold text-white ${
            pCfg ? pCfg.bg : isUnread ? 'bg-primary' : 'bg-zinc-500'
          }`}
          style={{ width: isCompact ? 32 : 38, height: isCompact ? 32 : 38 }}
        >
          {initialOf(latest.fromName, latest.fromEmail)}
        </div>

        {/* Contenu : 3 lignes principales */}
        <div className="flex-1 min-w-0">
          {/* Ligne 1 : expéditeur + date */}
          <div className="flex items-center gap-1.5">
            {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
            <span
              className={`truncate ${isUnread ? 'text-on-surface font-bold' : 'text-on-surface font-semibold'}`}
              style={{ fontSize: isCompact ? 11.5 : 12.5 }}
            >
              {sender}
            </span>
            <span
              className="ml-auto shrink-0 text-[10px] tabular-nums text-on-surface-variant/70 whitespace-nowrap transition-opacity group-hover:opacity-0"
              style={{ minWidth: 54, textAlign: 'right' }}
            >
              {formatDate(latest.date)}
            </span>
          </div>

          {/* Ligne 2 : sujet + compteurs + badges */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`truncate ${isUnread ? 'text-on-surface font-bold' : 'text-on-surface'}`}
              style={{ fontSize: isCompact ? 11.5 : 12.5 }}
            >
              {latest.subject || '(sans objet)'}
            </span>
            {thread.count > 1 && (
              <span className="shrink-0 inline-flex items-center justify-center min-w-4 h-4 px-1.5 rounded-full bg-primary/12 text-primary text-[9px] font-bold border border-primary/25">
                {thread.count}
              </span>
            )}
            {thread.hasAttachments && <Paperclip className="w-3 h-3 text-on-surface-variant/70 shrink-0" />}
            {pCfg && <pCfg.icon className="w-3 h-3 shrink-0" style={{ color: pCfg.stripe }} />}
          </div>

          {/* Ligne 3 : extrait */}
          {snippet && (
            <p
              className={`truncate mt-0.5 ${latest.aiSummary ? 'text-on-surface-variant italic' : 'text-on-surface-variant/70'}`}
              style={{ fontSize: isCompact ? 10.5 : 11 }}
            >
              {snippet}
            </p>
          )}

          {/* Ligne 4 : métadonnées (Cc, ticket, statut) — discrète */}
          {hasMeta && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {thread.ccRecipients?.length > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-container border border-outline-variant/30 text-[9px] font-semibold text-on-surface-variant">
                  <Send className="w-2.5 h-2.5 shrink-0" />
                  Cc : {thread.ccRecipients.slice(0, 2).map(displayAddr).join(', ')}
                  {thread.ccRecipients.length > 2 ? ` +${thread.ccRecipients.length - 2}` : ''}
                </span>
              )}
              {latest.erpTicketId && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-[9px] font-bold hover:bg-primary/15 transition-all cursor-pointer">
                  <ArrowUpRight className="w-2.5 h-2.5" /> Ticket #{latest.erpTicketId}
                </span>
              )}
              {sCfg && (
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${sCfg.bg} ${sCfg.color} ${sCfg.border}`}>
                  {SIcon && <SIcon className="w-2 h-2" />}
                  {sCfg.label}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions rapides au survol (overlay sur la date) */}
      <div
        className="hidden group-hover:flex items-center gap-0.5 absolute right-1 top-1/2 -translate-y-1/2 rounded-xl bg-surface-container/95 ring-1 ring-outline-variant/25 px-0.5 py-0.5 shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onToggleRead(thread)}
          className="p-1.5 rounded-lg text-on-surface-variant/70 hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          title={isUnread ? 'Marquer lu' : 'Marquer non lu'}
        >
          {isUnread ? <MailOpen className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onMove(thread)}
          className="p-1.5 rounded-lg text-on-surface-variant/70 hover:text-violet-400 hover:bg-violet-500/10 transition-colors cursor-pointer"
          title="Déplacer"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(thread)}
            className="p-1.5 rounded-lg text-on-surface-variant/70 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
            title="Supprimer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </button>
  );
});

export default ThreadItem;
