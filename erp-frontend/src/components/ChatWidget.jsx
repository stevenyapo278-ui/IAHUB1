import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const QUICK_ACTIONS = [
  { label: 'Créer un ticket', icon: 'add_circle', message: 'Je veux créer un ticket' },
  { label: 'Mes tickets', icon: 'confirmation_number', message: 'Quel est le statut de mes tickets ?' },
  { label: 'Rapport', icon: 'assessment', message: 'Donne-moi un rapport des tickets ouverts' },
  { label: 'Aide', icon: 'help', message: 'Que peux-tu faire ?' },
];

const PRIORITY_OPTIONS = [
  { value: 'P1', label: 'Critique', color: 'text-red-500' },
  { value: 'P2', label: 'Haute', color: 'text-orange-500' },
  { value: 'P3', label: 'Moyenne', color: 'text-blue-500' },
  { value: 'P4', label: 'Basse', color: 'text-emerald-500' },
];

function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      components={{
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="my-1 space-y-0.5">{children}</ul>,
        li: ({ children }) => <li className="ml-4 list-disc text-[13px]">{children}</li>,
        code: ({ children, className }) => {
          if (className) return <code className={`${className} bg-surface-container-high px-1 rounded text-[12px]`}>{children}</code>;
          return <code className="bg-surface-container-high px-1 rounded text-[12px]">{children}</code>;
        },
        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageActions({ msg, onReply, onCopy }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 1500);
  }

  if (msg.role !== 'assistant') return null;

  return (
    <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={handleCopy} className="p-0.5 rounded hover:bg-surface-container-high transition-colors cursor-pointer" title="Copier">
        <span className="material-symbols-outlined text-[12px] text-on-surface-variant">{copied ? 'check' : 'content_copy'}</span>
      </button>
      <button onClick={() => onReply?.(msg.content)} className="p-0.5 rounded hover:bg-surface-container-high transition-colors cursor-pointer" title="Répondre">
        <span className="material-symbols-outlined text-[12px] text-on-surface-variant">reply</span>
      </button>
      {msg.id && (
        <div className="flex items-center gap-0.5 ml-1">
          <button onClick={() => rateMessage(msg.id, 1)} className={`p-0.5 rounded hover:bg-surface-container-high transition-colors cursor-pointer ${msg.rating === 1 ? 'text-emerald-500' : ''}`}>
            <span className="material-symbols-outlined text-[12px]">thumb_up</span>
          </button>
          <button onClick={() => rateMessage(msg.id, -1)} className={`p-0.5 rounded hover:bg-surface-container-high transition-colors cursor-pointer ${msg.rating === -1 ? 'text-red-500' : ''}`}>
            <span className="material-symbols-outlined text-[12px]">thumb_down</span>
          </button>
        </div>
      )}
    </div>
  );
}

async function rateMessage(messageId, rating) {
  try {
    await api.post('/chat/feedback', { messageId, rating });
  } catch {}
}

export default function ChatWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Bonjour ! Je suis l'assistant IA du helpdesk IT. Comment puis-je vous aider ?" },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [messages, loading, scrollToBottom]);
  useEffect(() => { if (isOpen) inputRef.current?.focus(); }, [isOpen]);

  // Charger l'historique au premier ouverture
  useEffect(() => {
    if (isOpen && !historyLoaded && user) {
      api.get('/chat/history').then(({ data }) => {
        if (data.length > 0) {
          setMessages([
            { role: 'assistant', content: "Bonjour ! Je suis l'assistant IA du helpdesk IT. Comment puis-je vous aider ?" },
            ...data.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, rating: m.rating })),
          ]);
        }
        setHistoryLoaded(true);
      }).catch(() => setHistoryLoaded(true));
    }
  }, [isOpen, historyLoaded, user]);

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachment(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachmentPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setAttachmentPreview(null);
    }
  }

  function removeAttachment() {
    setAttachment(null);
    setAttachmentPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function sendMessage(text) {
    const userMessage = text || input.trim();
    if (!userMessage || loading) return;

    const newUserMsg = { role: 'user', content: userMessage };
    setMessages((prev) => [...prev, newUserMsg]);
    setInput('');
    setReplyTo(null);
    setLoading(true);

    try {
      const history = [...messages, newUserMsg].slice(-10).map((m) => ({ role: m.role, content: m.content }));

      if (attachment) {
        const formData = new FormData();
        formData.append('message', userMessage);
        formData.append('history', JSON.stringify(history));
        formData.append('attachment', attachment);
        const { data } = await api.post('/chat', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, sources: data.sources, action: data.action }]);
      } else {
        const { data } = await api.post('/chat', { message: userMessage, history });
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, sources: data.sources, action: data.action }]);
      }
      removeAttachment();
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Désolé, une erreur est survenue. Réessayez." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleReply(content) {
    const preview = content.substring(0, 150) + (content.length > 150 ? '...' : '');
    setReplyTo(preview);
    inputRef.current?.focus();
  }

  return (
    <>
      {/* Bulle flottante */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-primary to-blue-700 text-white shadow-lg shadow-primary/30 flex items-center justify-center hover:shadow-xl hover:shadow-primary/40 transition-shadow cursor-pointer"
            aria-label="Ouvrir l'assistant IA"
          >
            <span className="material-symbols-outlined text-[26px]">smart_toy</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panneau de chat */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary to-blue-700 text-white shrink-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                <div>
                  <h3 className="font-semibold text-sm">Assistant IA</h3>
                  <p className="text-[10px] opacity-80">Helpdesk IT Prosuma</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1 rounded-lg hover:bg-white/20 transition-colors cursor-pointer" aria-label="Fermer">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-white rounded-br-md'
                        : 'bg-surface-container border border-outline-variant/40 text-on-surface rounded-bl-md'
                    }`}
                  >
                    {msg.role === 'assistant' ? <MarkdownContent content={msg.content} /> : msg.content}

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <p className="text-[10px] opacity-60 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[10px]">menu_book</span>
                          Sources : {msg.sources.map((s) => s.title).join(', ')}
                        </p>
                      </div>
                    )}

                    {msg.action?.type === 'ticket_created' && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <a href={`/tickets/${msg.action.ticketId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                          Voir le ticket #{msg.action.ticketId}
                        </a>
                      </div>
                    )}

                    {msg.action?.type === 'escalation' && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <a href={`/tickets/${msg.action.ticketId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-500 hover:underline">
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                          Voir l'escalade #{msg.action.ticketId}
                        </a>
                      </div>
                    )}

                    <MessageActions msg={msg} onReply={handleReply} />
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-surface-container border border-outline-variant/40 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick actions */}
            {messages.length <= 1 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.message)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-primary/30 text-primary text-[11px] font-medium hover:bg-primary/5 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {/* Attachment preview */}
            {attachmentPreview && (
              <div className="px-4 pb-1 shrink-0">
                <div className="relative inline-block">
                  <img src={attachmentPreview} alt="Pièce jointe" className="h-16 rounded-lg border border-outline-variant/40 object-cover" />
                  <button onClick={removeAttachment} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer">
                    <span className="material-symbols-outlined text-[10px]">close</span>
                  </button>
                </div>
              </div>
            )}

            {/* Reply preview */}
            {replyTo && (
              <div className="px-4 pb-1 shrink-0">
                <div className="flex items-center gap-2 bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-1.5 text-[11px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-[12px]">reply</span>
                  <span className="flex-1 truncate">{replyTo}</span>
                  <button onClick={() => setReplyTo(null)} className="cursor-pointer">
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-3 pb-3 pt-1 shrink-0">
              <div className="flex items-center gap-2 bg-surface-container border border-outline-variant/60 rounded-xl px-3 py-2">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} className="p-1 rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer" title="Joindre une image">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">attach_file</span>
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={replyTo ? 'Répondre...' : 'Posez votre question...'}
                  disabled={loading}
                  className="flex-1 bg-transparent text-[13px] text-on-surface placeholder-on-surface-variant/50 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading}
                  className="p-1.5 rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  aria-label="Envoyer"
                >
                  <span className="material-symbols-outlined text-[16px]">send</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
