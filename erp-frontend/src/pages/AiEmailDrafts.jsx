import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import { sanitizeHtml } from '../utils/sanitize';
import {
  Sparkles, Mail, CheckCircle2, XCircle, Send, Edit3, Trash2,
  RotateCcw, X, ChevronRight, Info, ArrowUpRight, Clock,
  MessageSquare, RefreshCw, AlertTriangle, Bot
} from 'lucide-react';

const STATUS_OPTIONS = ['PENDING', 'APPROVED', 'REJECTED'];
const MAX_AI_EXCHANGES_PER_TICKET = 3;

const STATUS_CONFIG = {
  PENDING:  { label: 'En attente', color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20'  },
  APPROVED: { label: 'Approuvé',   color: 'text-emerald-400',bg: 'bg-emerald-500/10',border: 'border-emerald-500/20'},
  REJECTED: { label: 'Rejeté',     color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20'   },
};

export default function AiEmailDrafts() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [drafts, setDrafts] = useState([]);
  const [status, setStatus] = useState('PENDING');
  const [selected, setSelected] = useState(null);
  const [editedContent, setEditedContent] = useState('');
  const [editedRecipient, setEditedRecipient] = useState('');
  const [editedCc, setEditedCc] = useState([]);
  const [ccInput, setCcInput] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signatureLogoUrl, setSignatureLogoUrl] = useState(null);
  const editorRef = useRef(null);
  const [toolbarState, setToolbarState] = useState({
    bold: false, italic: false, underline: false,
    h2: false, h3: false, ul: false, ol: false,
  });

  const updateToolbarState = useCallback(() => {
    try {
      setToolbarState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        h2: document.queryCommandValue('formatBlock')?.toLowerCase() === 'h2',
        h3: document.queryCommandValue('formatBlock')?.toLowerCase() === 'h3',
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      });
    } catch {}
  }, []);

  function execCmd(cmd, arg) {
    document.execCommand(cmd, false, arg);
    editorRef.current?.focus();
    updateToolbarState();
  }

  function handleEditorKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
    }
  }

  useEffect(() => {
    api.get('/system-settings')
      .then(({ data }) => setSignatureLogoUrl(data.signatureLogoUrl || null))
      .catch(() => {});
  }, []);

  function toDisplayHtml(html) {
    return signatureLogoUrl ? html.replaceAll('cid:logo-signature', signatureLogoUrl) : html;
  }
  function fromDisplayHtml(html) {
    return signatureLogoUrl ? html.split(signatureLogoUrl).join('cid:logo-signature') : html;
  }

  function addCc() {
    const v = ccInput.trim();
    if (v && !editedCc.includes(v)) setEditedCc([...editedCc, v]);
    setCcInput('');
  }
  function removeCc(email) { setEditedCc(editedCc.filter(e => e !== email)); }

  function load() {
    api.get('/ai-email-drafts', { params: status ? { status } : {} })
      .then(({ data }) => setDrafts(data))
      .catch(err => toast.error(err.response?.data?.error || 'Erreur de chargement'));
  }
  useEffect(load, [status]);

  function openDraft(draft) {
    setSelected(draft);
    setEditedContent(draft.proposedContent);
    setEditedRecipient(draft.recipientEmail);
    setEditedCc(draft.ccRecipients || []);
    setCcInput('');
  }

  async function confirmActionRun() {
    if (!confirmAction) return;
    setSubmitting(true);
    try {
      if (confirmAction.type === 'approve') {
        await api.post(`/ai-email-drafts/${confirmAction.id}/approve`, {
          proposedContent: editedContent,
          recipientEmail: editedRecipient,
          ccRecipients: editedCc,
        });
        toast.success('Email envoyé avec succès');
      } else if (confirmAction.type === 'restore') {
        await api.post(`/ai-email-drafts/${confirmAction.id}/restore`);
        setStatus('PENDING');
        toast.success('Brouillon restauré en attente');
      } else {
        await api.post(`/ai-email-drafts/${confirmAction.id}/reject`, { reviewNote: reviewNote || undefined });
        toast.success('Brouillon rejeté');
      }
      setConfirmAction(null);
      setSelected(null);
      setReviewNote('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'action");
    } finally {
      setSubmitting(false);
    }
  }

  const pendingCount = drafts.filter(d => d.status === 'PENDING').length;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] overflow-hidden">

      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-purple-500/10 rounded-lg">
            <Bot className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface flex items-center gap-2">
              Brouillons IA
              {pendingCount > 0 && status === 'PENDING' && (
                <motion.span
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[9px] font-black"
                >
                  {pendingCount}
                </motion.span>
              )}
            </h1>
            <p className="text-[11px] text-on-surface-variant">Validation des réponses générées par Gemini</p>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container border border-outline-variant/30 ml-auto sm:ml-0">
          {STATUS_OPTIONS.map(s => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => { setStatus(s); setSelected(null); }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  status === s
                    ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 text-slate-950 shadow-md'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Split View ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Draft list */}
        <div className={`flex flex-col border-r border-outline-variant/30 bg-surface-container-lowest overflow-hidden transition-all duration-300 ${
          selected ? 'w-80 xl:w-96 shrink-0' : 'flex-1'
        }`}>
          {/* List header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/20 bg-surface-bright/20">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              {drafts.length} brouillon{drafts.length !== 1 ? 's' : ''}
            </span>
            {status === 'PENDING' && drafts.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold border border-amber-500/20">
                <Clock className="w-2.5 h-2.5" />
                à valider
              </span>
            )}
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            {drafts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant py-16">
                <div className="p-4 rounded-full bg-surface-container">
                  <Mail className="w-8 h-8 text-outline/30" />
                </div>
                <p className="text-sm italic">Aucun brouillon {STATUS_CONFIG[status]?.label.toLowerCase()}.</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {drafts.map((d, idx) => {
                  const isSelected = selected?.id === d.id;
                  const isFollowup = d.draftKind === 'CONVERSATION_FOLLOWUP';
                  const sCfg = STATUS_CONFIG[d.status];

                  return (
                    <motion.button
                      key={d.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.15, delay: idx * 0.01 }}
                      onClick={() => openDraft(d)}
                      className={`w-full text-left flex items-stretch border-b border-outline-variant/10 transition-all group ${
                        isSelected
                          ? 'bg-purple-500/5 ring-1 ring-inset ring-purple-500/20'
                          : 'hover:bg-surface-container-low/60'
                      }`}
                    >
                      {/* Accent stripe — amber for PENDING, emerald for APPROVED, red for REJECTED */}
                      <div className={`w-0.5 shrink-0 ${
                        d.status === 'PENDING' ? 'bg-amber-500' :
                        d.status === 'APPROVED' ? 'bg-emerald-500' : 'bg-red-500'
                      }`} />

                      <div className="flex items-start gap-3 px-4 py-3.5 flex-1 min-w-0">
                        {/* AI badge */}
                        <div className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center mt-0.5 ${
                          isFollowup ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-purple-500/10 border border-purple-500/20'
                        }`}>
                          {isFollowup
                            ? <MessageSquare className="w-4 h-4 text-blue-400" />
                            : <Sparkles className="w-4 h-4 text-purple-400" />
                          }
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-0.5">
                            <p className={`text-xs font-bold truncate ${isSelected ? 'text-purple-400' : 'text-on-surface group-hover:text-primary transition-colors'}`}>
                              {d.subject}
                            </p>
                            {isFollowup && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[9px] font-bold border border-blue-500/20 whitespace-nowrap">
                                Tour {d.exchangeTurn}/{MAX_AI_EXCHANGES_PER_TICKET}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-on-surface-variant truncate">À : {d.recipientEmail}</p>
                          {d.ccRecipients?.length > 0 && (
                            <p className="text-[10px] text-on-surface-variant/60 truncate">Cc : {d.ccRecipients.join(', ')}</p>
                          )}
                          {d.ticket && (
                            <p className="text-[10px] text-on-surface-variant/50 truncate mt-0.5 flex items-center gap-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                              Ticket #{d.ticket.id} — {d.ticket.title}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* Right: Draft editor / reader */}
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-container-lowest"
            >
              {/* Reader top bar */}
              <div className="shrink-0 flex items-center gap-3 px-6 py-3.5 border-b border-outline-variant/20">
                <motion.button
                  onClick={() => setSelected(null)}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                >
                  <X className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-bold text-on-surface truncate">{selected.subject}</h2>
                  <p className="text-[11px] text-on-surface-variant">
                    À : {selected.recipientEmail}
                    {selected.ccRecipients?.length > 0 && ` · Cc : ${selected.ccRecipients.join(', ')}`}
                  </p>
                </div>
                {/* Status badge */}
                {(() => {
                  const cfg = STATUS_CONFIG[selected.status];
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                      {selected.status === 'APPROVED' ? <CheckCircle2 className="w-3 h-3" /> :
                       selected.status === 'REJECTED' ? <XCircle className="w-3 h-3" /> :
                       <Clock className="w-3 h-3" />}
                      {cfg.label}
                    </span>
                  );
                })()}
                {selected.ticket && (
                  <Link
                    to={`/tickets/${selected.ticket.id}`}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-bold hover:bg-primary/15 transition-all"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Ticket #{selected.ticket.id}</span>
                  </Link>
                )}
              </div>

              {/* Scrollable editor area */}
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">

                  {/* IA info banner */}
                  {selected.draftKind === 'CONVERSATION_FOLLOWUP' && (
                    <div className="flex items-center gap-3 p-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
                      <MessageSquare className="w-4 h-4 text-blue-400 shrink-0" />
                      <p className="text-xs text-blue-300">
                        Réponse de suivi IA — tour <strong>{selected.exchangeTurn}/{MAX_AI_EXCHANGES_PER_TICKET}</strong> de la conversation sur ce ticket.
                      </p>
                    </div>
                  )}

                  {/* Recipient + CC row */}
                  <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-space-700/50 bg-space-800/40' : 'border-gray-200 bg-gray-50'}`}>
                    {/* To field */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/15">
                      <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant w-6 shrink-0">À</span>
                      <input
                        type="email"
                        value={editedRecipient}
                        onChange={e => setEditedRecipient(e.target.value)}
                        disabled={selected.status !== 'PENDING'}
                        className="flex-1 bg-transparent text-sm text-on-surface focus:outline-none disabled:opacity-60 placeholder-on-surface-variant/40"
                      />
                    </div>
                    {/* CC field */}
                    <div className="flex items-start gap-3 px-4 py-3">
                      <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant w-6 shrink-0 mt-1">Cc</span>
                      <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                        {editedCc.map(email => (
                          <span key={email} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-outline-variant/40 bg-surface-container text-xs text-on-surface-variant font-medium">
                            {email}
                            {selected.status === 'PENDING' && (
                              <button onClick={() => removeCc(email)} className="hover:text-red-400 transition-colors ml-0.5">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        ))}
                        {selected.status === 'PENDING' && (
                          <input
                            type="email"
                            placeholder="Ajouter un email en copie..."
                            value={ccInput}
                            onChange={e => setCcInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCc(); } if (e.key === ' ') { e.preventDefault(); addCc(); } }}
                            className="bg-transparent text-xs text-on-surface focus:outline-none placeholder-on-surface-variant/40 min-w-[160px] flex-1"
                          />
                        )}
                        {editedCc.length === 0 && selected.status !== 'PENDING' && (
                          <span className="text-xs text-on-surface-variant/40 italic">Aucune copie</span>
                        )}
                      </div>
                    </div>
                    {/* Subject row */}
                    <div className="flex items-center gap-3 px-4 py-3 border-t border-outline-variant/15">
                      <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant w-6 shrink-0">Objet</span>
                      <p className="flex-1 text-sm font-semibold text-on-surface truncate">{selected.subject}</p>
                    </div>
                  </div>

                  {/* Email editor / viewer */}
                  <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-space-700/50' : 'border-gray-200'}`}>
                    {/* Formatting toolbar */}
                    {selected.status === 'PENDING' && (
                      <div className={`flex items-center gap-0.5 px-2 py-1.5 border-b border-outline-variant/20 flex-wrap ${isDark ? 'bg-space-800/60' : 'bg-gray-50'}`}>
                        {[
                          { cmd: 'bold',      icon: 'format_bold',      key: 'bold',      title: 'Gras' },
                          { cmd: 'italic',    icon: 'format_italic',    key: 'italic',    title: 'Italique' },
                          { cmd: 'underline', icon: 'format_underline', key: 'underline', title: 'Souligné' },
                        ].map(t => (
                          <button key={t.cmd} type="button"
                            onMouseDown={e => { e.preventDefault(); execCmd(t.cmd); }}
                            title={t.title}
                            className={`p-1.5 rounded-lg transition-colors ${toolbarState[t.key] ? 'bg-purple-500/10 text-purple-400' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
                          >
                            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                          </button>
                        ))}
                        <span className="w-px h-4 bg-outline-variant/40 mx-1" />
                        {[
                          { label: 'H2', key: 'h2', arg: '<h2>' },
                          { label: 'H3', key: 'h3', arg: '<h3>' },
                        ].map(t => (
                          <button key={t.label} type="button"
                            onMouseDown={e => { e.preventDefault(); execCmd('formatBlock', toolbarState[t.key] ? '<p>' : t.arg); }}
                            className={`px-2 py-1 rounded-lg text-[10px] font-black transition-colors ${toolbarState[t.key] ? 'bg-purple-500/10 text-purple-400' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
                          >
                            {t.label}
                          </button>
                        ))}
                        <span className="w-px h-4 bg-outline-variant/40 mx-1" />
                        {[
                          { cmd: 'insertUnorderedList', icon: 'format_list_bulleted', key: 'ul', title: 'Liste à puces' },
                          { cmd: 'insertOrderedList',   icon: 'format_list_numbered', key: 'ol', title: 'Liste numérotée' },
                        ].map(t => (
                          <button key={t.cmd} type="button"
                            onMouseDown={e => { e.preventDefault(); execCmd(t.cmd); }}
                            title={t.title}
                            className={`p-1.5 rounded-lg transition-colors ${toolbarState[t.key] ? 'bg-purple-500/10 text-purple-400' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
                          >
                            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                          </button>
                        ))}
                        <span className="w-px h-4 bg-outline-variant/40 mx-1" />
                        <button type="button"
                          onMouseDown={e => { e.preventDefault(); const url = window.prompt('URL du lien :'); if (url) execCmd('createLink', url); }}
                          title="Ajouter un lien"
                          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">link</span>
                        </button>
                        <button type="button"
                          onMouseDown={e => { e.preventDefault(); execCmd('removeFormat'); }}
                          title="Effacer le formatage"
                          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">format_clear</span>
                        </button>
                      </div>
                    )}

                    {/* Content editable area */}
                    <div
                      key={selected.id}
                      ref={editorRef}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(toDisplayHtml(editedContent)) }}
                      contentEditable={selected.status === 'PENDING'}
                      suppressContentEditableWarning
                      onBlur={e => setEditedContent(fromDisplayHtml(sanitizeHtml(e.currentTarget.innerHTML)))}
                      onMouseUp={updateToolbarState}
                      onKeyUp={updateToolbarState}
                      onKeyDown={handleEditorKeyDown}
                      className={`text-sm text-on-surface leading-relaxed min-h-[320px] max-h-[520px] overflow-y-auto focus:outline-none p-5 ${
                        isDark ? 'bg-space-800/30' : 'bg-white'
                      } [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_a]:text-primary [&_a]:underline`}
                    />
                  </div>

                  {/* Action bar for PENDING */}
                  {selected.status === 'PENDING' && (
                    <div className="flex gap-3">
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => setConfirmAction({ type: 'approve', id: selected.id })}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-bold shadow-md shadow-emerald-500/20 hover:brightness-110 transition-all"
                      >
                        <Send className="w-4 h-4" />
                        Approuver & envoyer
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => setConfirmAction({ type: 'reject', id: selected.id })}
                        className="px-6 py-3 rounded-xl border border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/10 text-sm font-bold transition-all"
                      >
                        <XCircle className="w-4 h-4 inline mr-1.5" />
                        Rejeter
                      </motion.button>
                    </div>
                  )}

                  {/* Action bar for REJECTED */}
                  {selected.status === 'REJECTED' && (
                    <div className="flex items-center justify-between p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low/30">
                      <div className="flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-red-400" />
                        <span className="text-sm text-on-surface-variant">Ce brouillon a été rejeté.</span>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                        onClick={() => setConfirmAction({ type: 'restore', id: selected.id })}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-bold hover:bg-surface-container transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restaurer en attente
                      </motion.button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-4 text-on-surface-variant bg-surface-container-lowest"
            >
              <div className="p-6 rounded-full bg-surface-container">
                <Bot className="w-10 h-10 text-outline/30" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Sélectionnez un brouillon</p>
                <p className="text-xs text-on-surface-variant/60 mt-1">pour le lire, éditer et valider</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Confirm Dialog ────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction?.type === 'approve' ? 'Approuver et envoyer' :
          confirmAction?.type === 'restore' ? 'Restaurer ce brouillon' :
          'Rejeter ce brouillon'
        }
        message={
          confirmAction?.type === 'approve'
            ? "Cette réponse va être envoyée immédiatement par email au destinataire. Confirmer ?"
            : confirmAction?.type === 'restore'
            ? 'Ce brouillon repasse en attente de validation. Vous pourrez le modifier et l\'envoyer.'
            : 'Ce brouillon sera rejeté et ne sera jamais envoyé.'
        }
        confirmLabel={
          confirmAction?.type === 'approve' ? 'Envoyer' :
          confirmAction?.type === 'restore' ? 'Restaurer' : 'Rejeter'
        }
        danger={confirmAction?.type === 'reject'}
        loading={submitting}
        onConfirm={confirmActionRun}
        onCancel={() => setConfirmAction(null)}
      >
        {confirmAction?.type === 'reject' && (
          <textarea
            rows={3}
            placeholder="Note de refus (optionnel)..."
            value={reviewNote}
            onChange={e => setReviewNote(e.target.value)}
            className="w-full mt-3 bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
