import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';

const QUICK_ACTIONS = [
  { label: 'Créer un ticket', icon: 'add_circle', message: 'Je veux créer un ticket' },
  { label: 'Mes tickets', icon: 'confirmation_number', message: 'Quel est le statut de mes tickets ?' },
  { label: 'Rapport', icon: 'assessment', message: 'Donne-moi un rapport des tickets ouverts' },
  { label: 'Aide', icon: 'help', message: 'Que peux-tu faire ?' },
];

function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="bg-surface-container-high px-1 rounded text-[12px]">$1</code>')
    .replace(/^• (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => `<ul class="my-1">${match}</ul>`)
    .replace(/\n/g, '<br/>');
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Bonjour ! Je suis l'assistant IA du helpdesk IT. Comment puis-je vous aider ?",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  async function sendMessage(text) {
    const userMessage = text || input.trim();
    if (!userMessage || loading) return;

    const newUserMsg = { role: 'user', content: userMessage };
    setMessages((prev) => [...prev, newUserMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, newUserMsg].map((m) => ({ role: m.role, content: m.content }));
      const { data } = await api.post('/chat', { message: userMessage, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, sources: data.sources }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Désolé, une erreur est survenue. Réessayez." },
      ]);
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
            className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-3rem)] bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary to-blue-700 text-white">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                <div>
                  <h3 className="font-semibold text-sm">Assistant IA</h3>
                  <p className="text-[10px] opacity-80">Helpdesk IT Prosuma</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-white/20 transition-colors cursor-pointer"
                aria-label="Fermer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-white rounded-br-md'
                        : 'bg-surface-container border border-outline-variant/40 text-on-surface rounded-bl-md'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
                    ) : (
                      msg.content
                    )}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <p className="text-[10px] opacity-60 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[10px]">menu_book</span>
                          Sources : {msg.sources.map((s) => s.title).join(', ')}
                        </p>
                    </div>
                    )}
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

            {/* Quick actions (affichées au début) */}
            {messages.length <= 1 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5">
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

            {/* Input */}
            <div className="px-3 pb-3 pt-1">
              <div className="flex items-center gap-2 bg-surface-container border border-outline-variant/60 rounded-xl px-3 py-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Posez votre question..."
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
