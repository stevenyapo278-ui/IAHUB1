import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MarkdownContent from './MarkdownContent';
import MarieLoader from './MarieLoader';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import { Download, BarChart2, Send, Paperclip, MessageSquare, Users, TrendingUp, AlertTriangle, Timer, BarChart3, HelpCircle, PlusCircle, X, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import VoiceVisualizer from './VoiceVisualizer';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

const STORAGE_KEY = 'chatwidget_position';

const QUICK_ACTIONS = [
  { label: 'Répartition équipe', icon: Users, message: 'Répartition des tickets ouverts par équipe', color: 'text-emerald-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Top Magasins', icon: TrendingUp, message: 'Quel est le magasin qui a eu le plus de problèmes ?', color: 'text-amber-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Incidents Asten', icon: AlertTriangle, message: 'Montre-moi les statistiques et incidents du magasin Asten', color: 'text-orange-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Temps de résolution', icon: Timer, message: 'Quel est le temps moyen de résolution des tickets ?', color: 'text-cyan-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Rapport ouverts', icon: BarChart3, message: 'Rapport des tickets ouverts', color: 'text-blue-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Aide & Commandes', icon: HelpCircle, message: 'Que peux-tu faire ?', color: 'text-on-surface-variant', roles: null },
  { label: 'Mes tickets', icon: MessageSquare, message: 'Liste de mes tickets', color: 'text-blue-500', roles: ['REQUESTER'] },
  { label: 'Signaler un problème', icon: PlusCircle, message: 'Je veux signaler un problème', color: 'text-emerald-500', roles: ['REQUESTER'] },
];

function WidgetRenderer({ widget }) {
  if (!widget || !widget.data || widget.data.length === 0) return null;

  const normalizedData = widget.data.map((item) => ({
    ...item,
    Tickets: item.Tickets ?? item.Total ?? item.valeur ?? 0,
    Urgents: item.Urgents ?? item.urgent ?? 0,
  }));

  function exportCsv() {
    const headers = Object.keys(widget.data[0]).join(',');
    const rows = widget.data.map((row) => Object.values(row).join(','));
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join(',');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${widget.title || 'stats'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  return (
    <div className="mt-3 p-3 rounded-xl bg-surface border border-outline-variant/40 space-y-2 shadow-sm">
      <div className="flex items-center justify-between border-b border-outline-variant/30 pb-1.5">
        <h4 className="text-[11px] font-bold text-on-surface flex items-center gap-1.5">
          <BarChart2 className="w-3.5 h-3.5 text-primary" />
          {widget.title}
        </h4>
        <button onClick={exportCsv} className="px-2 py-0.5 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer" title="Télécharger CSV">
          <Download className="w-3 h-3 text-primary" />
          <span>CSV</span>
        </button>
      </div>
      <div className="h-36 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={120}>
          <BarChart data={normalizedData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <XAxis dataKey="name" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
            <RechartsTooltip contentStyle={{ fontSize: '11px', borderRadius: '8px', backgroundColor: 'var(--color-surface, #fff)', border: '1px solid rgba(150,150,150,0.2)' }} />
            <Bar dataKey="Tickets" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Tickets" />
            <Bar dataKey="Urgents" fill="#ef4444" radius={[4, 4, 0, 0]} name="Urgents" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}



function MessageActions({ msg, onReply }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  if (msg.role !== 'assistant') return null;
  return (
    <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={handleCopy} className="p-0.5 rounded hover:bg-surface-container-high transition-colors cursor-pointer" title="Copier">
        {copied ? <span className="material-symbols-outlined text-[12px] text-emerald-500">check</span> : <span className="material-symbols-outlined text-[12px] text-on-surface-variant">content_copy</span>}
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
  try { await api.post('/chat/feedback', { messageId, rating }); } catch {}
}

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: "Bonjour ! Je suis MARIE, votre Assistante IA & Analyste Helpdesk IT. Posez-moi des questions sur vos tickets ou des demandes de statistiques sur vos magasins/lieux !",
};

function getDefaultPosition() {
  return { bottom: 24, right: 24 };
}

function loadPosition() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return getDefaultPosition();
}

function savePosition(pos) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
}

export default function ChatWidget() {
  const { user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [position, setPosition] = useState(loadPosition);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const dragStart = useRef({ x: 0, y: 0, pos: { bottom: 0, right: 0 } });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Voice recognition & synthesis
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const { isListening, transcript, error: voiceError, isSupported: voiceSupported, startListening, stopListening, resetTranscript } = useVoiceRecognition({
    onResult: (text) => {
      setInput(text);
      setTimeout(() => sendMessage(text), 100);
    }
  });
  const { isSpeaking, isSupported: ttsSupported, speak, stop: stopSpeaking } = useSpeechSynthesis();

  // Conversation management
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showConversationList, setShowConversationList] = useState(false);

  const isOnChatPage = location.pathname === '/chat';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [messages, loading, scrollToBottom]);
  useEffect(() => { if (isOpen) inputRef.current?.focus(); }, [isOpen]);

  // Ctrl+I
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Écouter les changements de position depuis le CustomizerDrawer
  useEffect(() => {
    function onPositionChanged() {
      setPosition(loadPosition());
    }
    window.addEventListener('chatwidget:position-changed', onPositionChanged);
    return () => window.removeEventListener('chatwidget:position-changed', onPositionChanged);
  }, []);

  // Charger la liste des conversations
  function loadConversations() {
    api.get('/chat/conversations').then(({ data }) => setConversations(data)).catch(() => {});
  }

  // Charger l'historique
  useEffect(() => {
    if (isOpen && !historyLoaded && user) {
      loadConversations();
      api.get('/chat/history').then(({ data }) => {
        if (data.length > 0) {
          setMessages([WELCOME_MESSAGE, ...data.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, rating: m.rating, widget: m.widget, conversationId: m.conversationId }))]);
          // Récupérer la conversationId du dernier message
          const lastConvId = data[data.length - 1]?.conversationId;
          if (lastConvId) setConversationId(lastConvId);
        }
        setHistoryLoaded(true);
      }).catch(() => setHistoryLoaded(true));
    }
  }, [isOpen, historyLoaded, user]);

  // Drag handlers
  function onDragStart(e) {
    e.preventDefault();
    setDragging(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY, pos: { ...position } };
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e) {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = dragStart.current.x - clientX;
      const dy = clientY - dragStart.current.y;
      const newPos = {
        bottom: Math.max(0, Math.min(window.innerHeight - 80, dragStart.current.pos.bottom + dy)),
        right: Math.max(0, Math.min(window.innerWidth - 80, dragStart.current.pos.right + dx)),
      };
      setPosition(newPos);
    }
    function onUp() {
      setDragging(false);
      savePosition(position);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, position]);

  // Sauvegarder position au changement
  useEffect(() => { if (!dragging) savePosition(position); }, [position, dragging]);

  // Auto-read last assistant message with TTS (seulement si le widget est ouvert)
  useEffect(() => {
    if (!isOpen || !ttsEnabled || !ttsSupported || isSpeaking) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant' && lastMessage.content) {
      const cleanText = lastMessage.content
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .replace(/#{1,6}\s+/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/[\[\]]/g, '')
        .trim();
      if (cleanText.length > 0 && cleanText.length < 500) {
        speak(cleanText);
      }
    }
  }, [messages, ttsEnabled, ttsSupported]);

  async function handleNewConversation() {
    if (clearing || loading) return;
    setClearing(true);
    try {
      // Créer une nouvelle conversation vide
      const { data } = await api.post('/chat/conversations', { title: 'Nouvelle conversation' });
      setConversationId(data.id);
      setConversations((prev) => [data, ...prev]);
      setMessages([WELCOME_MESSAGE]);
      setReplyTo(null);
      removeAttachment();
      setInput('');
      setShowConversationList(false);
    } catch {}
    setClearing(false);
    inputRef.current?.focus();
  }

  async function selectConversation(convId) {
    if (loading) return;
    setConversationId(convId);
    setShowConversationList(false);
    setLoading(true);
    setMessages([WELCOME_MESSAGE]);
    try {
      const { data } = await api.get(`/chat/history?conversationId=${convId}`);
      if (data.length > 0) {
        setMessages([WELCOME_MESSAGE, ...data.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, rating: m.rating, widget: m.widget }))]);
      }
    } catch {}
    setLoading(false);
    inputRef.current?.focus();
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachment(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachmentPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else { setAttachmentPreview(null); }
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
      let data;
      if (attachment) {
        const formData = new FormData();
        formData.append('message', userMessage);
        formData.append('history', JSON.stringify(history));
        if (conversationId) formData.append('conversationId', conversationId);
        formData.append('attachment', attachment);
        ({ data } = await api.post('/chat', formData, { headers: { 'Content-Type': 'multipart/form-data' } }));
      } else {
        ({ data } = await api.post('/chat', { message: userMessage, history, conversationId: conversationId || undefined }));
      }
      // Mettre à jour la conversationId si une nouvelle conversation a été créée
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
        loadConversations();
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, sources: data.sources, action: data.action, widget: data.widget }]);
      removeAttachment();
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Désolé, une erreur est survenue. Réessayez." }]);
    } finally { setLoading(false); }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleReply(content) {
    setReplyTo(content.substring(0, 150) + (content.length > 150 ? '...' : ''));
    inputRef.current?.focus();
  }

  // Masquer si sur /chat
  if (isOnChatPage) return null;

  const filteredActions = QUICK_ACTIONS.filter(a => !a.roles || a.roles.includes(user?.role));

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
            style={{ bottom: position.bottom, right: position.right }}
            className="fixed z-50 w-14 h-14 rounded-full bg-gradient-to-br from-primary to-blue-700 text-white shadow-lg shadow-primary/30 flex items-center justify-center hover:shadow-xl hover:shadow-primary/40 transition-shadow cursor-pointer"
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
            style={{ bottom: position.bottom, right: position.right }}
            className="fixed z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header — draggable */}
            <div
              ref={dragRef}
              onMouseDown={onDragStart}
              onTouchStart={onDragStart}
              className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary to-blue-700 text-white shrink-0 select-none"
              style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                <div>
                  <h3 className="font-semibold text-sm">MARIE</h3>
                  <p className="text-[10px] opacity-80">Helpdesk IT Prosuma</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowConversationList(!showConversationList)} className="p-1 px-2.5 rounded-lg hover:bg-white/20 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-semibold bg-white/10" title="Mes conversations">
                  <span className="material-symbols-outlined text-[15px]">forum</span>
                  <span>{conversations.length || 0}</span>
                </button>
                <button onClick={handleNewConversation} disabled={clearing} className="p-1 px-2.5 rounded-lg hover:bg-white/20 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-semibold bg-white/10" title="Nouvelle conversation">
                  <span className="material-symbols-outlined text-[15px]">add_comment</span>
                </button>
                <button onClick={() => setIsOpen(false)} className="p-1 rounded-lg hover:bg-white/20 transition-colors cursor-pointer" aria-label="Fermer">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {/* Liste des conversations */}
            {showConversationList && (
              <div className="border-b border-outline-variant/40 max-h-48 overflow-y-auto bg-surface-container-lowest">
                {conversations.length === 0 ? (
                  <p className="p-3 text-[11px] text-on-surface-variant italic text-center">Aucune conversation</p>
                ) : conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`w-full text-left px-4 py-2.5 hover:bg-surface-container-high transition-colors cursor-pointer border-b border-outline-variant/20 last:border-b-0 ${conversationId === conv.id ? 'bg-primary/10' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      {conv.pinned && <span className="material-symbols-outlined text-[12px] text-amber-500">push_pin</span>}
                      <span className="text-[12px] text-on-surface truncate font-medium">{conv.title || 'Sans titre'}</span>
                    </div>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">{new Date(conv.updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${msg.role === 'user' ? 'bg-primary text-white rounded-br-md' : 'bg-surface-container border border-outline-variant/40 text-on-surface rounded-bl-md'}`}>
                    {msg.role === 'assistant' ? <MarkdownContent content={msg.content} /> : msg.content}
                    {msg.widget && <WidgetRenderer widget={msg.widget} />}
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
                  <div className="bg-surface-container border border-outline-variant/40 rounded-2xl rounded-bl-md px-4 py-3 flex items-center">
                    <MarieLoader />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick actions — filtrées par rôle */}
            {messages.length <= 1 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
                {filteredActions.map((action) => (
                  <button key={action.label} onClick={() => sendMessage(action.message)} className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-primary/30 text-primary text-[11px] font-medium hover:bg-primary/5 transition-colors cursor-pointer">
                    <action.icon className={`w-3 h-3 ${action.color}`} />
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
                <button onClick={() => sendMessage()} disabled={!input.trim() || loading} className="p-1.5 rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors cursor-pointer disabled:cursor-not-allowed" aria-label="Envoyer">
                  <span className="material-symbols-outlined text-[16px]">send</span>
                </button>
                {voiceSupported && (
                  <button
                    onClick={isListening ? stopListening : startListening}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${isListening ? 'bg-red-500 text-white animate-pulse' : 'hover:bg-surface-container-high text-on-surface-variant'}`}
                    title={isListening ? 'Arrêter l\'écoute' : 'Parler'}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                )}
                {ttsSupported && (
                  <button
                    onClick={() => setTtsEnabled(!ttsEnabled)}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${ttsEnabled ? 'text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
                    title={ttsEnabled ? 'Désactiver la lecture vocale' : 'Activer la lecture vocale'}
                  >
                    {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                )}
                {isSpeaking && (
                  <button onClick={stopSpeaking} className="p-1.5 rounded-lg hover:bg-surface-container-high text-red-500 transition-colors cursor-pointer" title="Arrêter la lecture">
                    <span className="material-symbols-outlined text-[16px]">stop</span>
                  </button>
                )}
              </div>
              {isListening && (
                <div className="flex items-center gap-3 mt-2 px-2">
                  <VoiceVisualizer isActive={isListening} />
                  <span className="text-[11px] text-primary font-medium">Écoute en cours...</span>
                  {transcript && <span className="text-[11px] text-on-surface-variant italic truncate">"{transcript}"</span>}
                </div>
              )}
              {voiceError && (
                <div className="mt-2 text-[11px] text-red-500">{voiceError}</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
