import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MailOpen, Reply, ChevronDown, ChevronRight, XCircle, Info,
  Sparkles, Paperclip,
} from 'lucide-react';
import {
  STATUS_CONFIG, PRIORITY_CONFIG, initialOf, displayAddr,
  formatDate, formatDateTime,
} from './inboxShared';
import { sanitizeHtml } from '../../utils/sanitize';

// ── Carte d'un message de la conversation (repliée / dépliée façon Outlook) ──
// Tous les messages sont repliés par défaut ( pile compacte de réduits ) ;
// le message le plus récent est affiché en premier (tri inversé côté liste).
// L'analyse IA s'affiche en barre compacte repliable (1 ligne par défaut).
export default function MessageCard({ msg, isLast, onOpenTicket }) {
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  const isInbound = msg.kind === 'inbound';
  const sCfg = STATUS_CONFIG[msg.status];
  const pCfg = PRIORITY_CONFIG[msg.aiPriority];
  const msgKey = msg.emailId || msg.messageId;
  const sender = msg.fromName || msg.fromEmail || 'Expéditeur inconnu';
  const shortDate = formatDate(msg.receivedAt || msg.timestamp);
  const fullDate = formatDateTime(msg.receivedAt || msg.timestamp);
  const preview = String(msg.aiSummary || msg.bodyPreview || '').trim();
  const aiPreview = String(msg.aiSummary || '').trim();
  const aiPresent = isInbound
    && !!(msg.aiSummary || msg.aiCategory || msg.aiTeam || msg.aiConfidence != null);
  const toList = (msg.recipients || []).filter(Boolean);
  const ccList = (msg.ccRecipients || []).filter(Boolean);
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const confPct = msg.aiConfidence != null ? Math.round(msg.aiConfidence * 100) : null;

  const toggle = () => setOpen((o) => !o);

  return (
    <div className="relative pl-11">
      {/* Ligne de timeline (descend dans le gutter space-y-6 pour rester continue) */}
      {!isLast && (
        <div className="absolute left-[17px] top-9 -bottom-6 w-px bg-outline-variant/25" />
      )}

      {/* Pastille expéditeur sur la timeline */}
      <div
        className={`absolute left-0 top-0 w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-surface-container-lowest ${
          isInbound ? (pCfg ? pCfg.bg : 'bg-zinc-600') : 'bg-primary'
        }`}
      >
        {initialOf(msg.fromName, msg.fromEmail)}
      </div>

      <div
        className={`rounded-2xl border overflow-hidden transition-colors ${
          open
            ? 'border-outline-variant/30 bg-surface-container-lowest shadow-sm'
            : 'border-outline-variant/20 bg-surface-container-low/40 hover:border-primary/30 hover:bg-primary/[0.04]'
        }`}
      >
        {/* En-tête cliquable (repli : une ligne / déplié : date longue + À/Cc) */}
        <div
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
          }}
          className="w-full text-left px-4 py-3 cursor-pointer select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <div className="flex items-center gap-2.5">
            <span className={`text-xs shrink-0 max-w-[38%] truncate ${open ? 'text-on-surface font-bold' : 'text-on-surface font-semibold'}`}>
              {sender}
            </span>

            {!open && preview && (
              <span className="min-w-0 flex-1 truncate text-xs text-on-surface-variant/80 italic">
                {preview}
              </span>
            )}

            <span className={`shrink-0 text-[10px] tabular-nums text-on-surface-variant/70 ${open ? '' : 'ml-auto'}`}>
              {open ? fullDate : shortDate}
            </span>

            <span className="shrink-0 text-on-surface-variant/60">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          </div>

          {/* Destinataires (déplié, façon webmail : À / Cc sous l'expéditeur) */}
          {open && toList.length > 0 && (
            <p className="mt-1 text-[11px] leading-4 text-on-surface-variant/70 truncate" title={toList.join(', ')}>
              <span className="font-semibold text-on-surface-variant">À : </span>
              {toList.map(displayAddr).join(', ')}
            </p>
          )}
          {open && ccList.length > 0 && (
            <p className="text-[11px] leading-4 text-on-surface-variant/70 truncate" title={ccList.join(', ')}>
              <span className="font-semibold text-on-surface-variant">Cc : </span>
              {ccList.map(displayAddr).join(', ')}
            </p>
          )}
        </div>

        {/* Contenu déplié */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 pt-1 space-y-3">
                {/* Badges */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                    isInbound ? 'bg-surface-container text-on-surface-variant border-outline-variant/40' : 'bg-primary/10 text-primary border-primary/25'
                  }`}>
                    {isInbound ? <MailOpen className="w-2.5 h-2.5" /> : <Reply className="w-2.5 h-2.5" />}
                    {isInbound ? 'Reçu' : 'Envoyé'}
                  </span>
                  {sCfg && isInbound && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${sCfg.bg} ${sCfg.color} ${sCfg.border}`}>
                      <sCfg.icon className="w-2.5 h-2.5" />
                      {sCfg.label}
                    </span>
                  )}
                  {pCfg && isInbound && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border"
                      style={{ color: pCfg.stripe, borderColor: pCfg.stripe + '44', backgroundColor: pCfg.stripe + '11' }}
                    >
                      <pCfg.icon className="w-2.5 h-2.5" />
                      {pCfg.label}
                    </span>
                  )}
                  {attachments.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold text-on-surface-variant border border-outline-variant/40 bg-surface-container">
                      <Paperclip className="w-2.5 h-2.5" />
                      {attachments.length} PJ
                    </span>
                  )}
                </div>

                {/* Analyse IA — barre compacte repliable (1 ligne par défaut) */}
                {aiPresent && (
                  <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setAiOpen((v) => !v); }}
                      aria-expanded={aiOpen}
                      title="Analyse IA — Gemini"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-500/10 transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider shrink-0">IA</span>
                      {msg.aiCategory && (
                        <span className="shrink-0 px-1.5 py-px rounded-full bg-purple-500/10 border border-purple-500/25 text-[9px] font-semibold text-purple-300">
                          {msg.aiCategory}
                        </span>
                      )}
                      {msg.aiTeam && (
                        <span className="shrink-0 px-1.5 py-px rounded-full bg-purple-500/10 border border-purple-500/25 text-[9px] font-semibold text-purple-300">
                          {msg.aiTeam}
                        </span>
                      )}
                      {(msg.erpTicketId || msg.glpiTicketId) && (
                        <span className="shrink-0 px-1.5 py-px rounded-full bg-purple-500/10 border border-purple-500/25 text-[9px] font-semibold text-purple-300 tabular-nums">
                          {msg.erpTicketId ? `ERP #${msg.erpTicketId}` : `GLPI #${msg.glpiTicketId}`}
                        </span>
                      )}
                      {aiPreview && (
                        <span className="min-w-0 flex-1 truncate text-[11px] italic text-on-surface-variant/70">
                          {aiPreview}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 flex items-center gap-1.5">
                        {confPct != null && (
                          <span className="text-[10px] font-bold text-purple-300 tabular-nums">{confPct}%</span>
                        )}
                        <ChevronDown className={`w-3.5 h-3.5 text-purple-400/70 transition-transform ${aiOpen ? 'rotate-180' : ''}`} />
                      </span>
                    </button>

                    <AnimatePresence initial={false}>
                      {aiOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 pt-2 space-y-2.5 border-t border-purple-500/15">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Analyse IA — Gemini</span>
                              {confPct != null && (
                                <span className="ml-auto text-[10px] font-bold text-purple-300 tabular-nums">{confPct}% confiance</span>
                              )}
                            </div>
                            {aiPreview && (
                              <p className="text-[13px] text-on-surface leading-relaxed italic">"{aiPreview}"</p>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                              {msg.aiCategory && (
                                <div className="bg-surface-container/40 rounded-lg p-2.5">
                                  <p className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider mb-0.5">Catégorie</p>
                                  <p className="text-[13px] font-semibold text-on-surface">{msg.aiCategory}</p>
                                </div>
                              )}
                              {msg.aiTeam && (
                                <div className="bg-surface-container/40 rounded-lg p-2.5">
                                  <p className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider mb-0.5">Équipe suggérée</p>
                                  <p className="text-[13px] font-semibold text-on-surface">{msg.aiTeam}</p>
                                </div>
                              )}
                              {msg.glpiTicketId && (
                                <div className="bg-surface-container/40 rounded-lg p-2.5">
                                  <p className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider mb-0.5">Ticket Externe</p>
                                  <p className="text-[13px] font-semibold text-on-surface">#{msg.glpiTicketId}</p>
                                </div>
                              )}
                              {msg.erpTicketId && (
                                <div className="bg-surface-container/40 rounded-lg p-2.5">
                                  <p className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider mb-0.5">Ticket ERP</p>
                                  <p
                                    className="text-[13px] font-semibold text-primary cursor-pointer hover:underline"
                                    onClick={(e) => { e.stopPropagation(); onOpenTicket?.(msg); }}
                                  >
                                    #{msg.erpTicketId}
                                  </p>
                                </div>
                              )}
                            </div>
                            {confPct != null && (
                              <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${confPct}%` }}
                                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                                  className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full"
                                />
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Erreur de traitement */}
                {isInbound && msg.error && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-400 flex-1">{msg.error}</p>
                      {msg.errorDetail && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setShowErrorDetail((v) => !v); }}
                          className="shrink-0 flex items-center gap-1 text-[11px] text-red-300/70 hover:text-red-300 transition-colors cursor-pointer"
                        >
                          <Info className="w-3 h-3" />
                          {showErrorDetail ? 'Masquer' : 'Détails'}
                          {showErrorDetail ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                    {msg.errorDetail && showErrorDetail && (
                      <div className="ml-7 rounded-lg border border-red-500/10 bg-red-500/[0.03] p-3">
                        <pre className="text-xs text-red-300/60 whitespace-pre-wrap font-sans leading-relaxed">{msg.errorDetail}</pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Corps du message */}
                {(() => {
                  const html = msg.bodyHtml;
                  const plain = isInbound ? msg.bodyPreview : msg.body;
                  if (html) {
                    return (
                      <div
                        className="text-sm text-on-surface leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
                      />
                    );
                  }
                  if (plain) {
                    return <pre className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap font-sans">{plain}</pre>;
                  }
                  return <p className="text-sm text-on-surface-variant italic">Corps du message non disponible.</p>;
                })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
