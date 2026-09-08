import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import {
  Send, Paperclip, Plus, MessageSquare, Trash2, BarChart2, Download,
  ThumbsUp, ThumbsDown, Copy, Reply, X, Bot, TrendingUp, AlertTriangle,
  Timer, BarChart3, HelpCircle, Loader2, Pin, PinOff, Archive, ArchiveRestore,
  MoreHorizontal, Search, Users, Edit3, Check, ChevronDown, PlusCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const QUICK_ACTIONS = [
  { label: 'Répartition équipe', icon: Users, message: 'Répartition des tickets ouverts par équipe', color: 'text-emerald-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Top Magasins', icon: TrendingUp, message: 'Quel est le magasin qui a eu le plus de problèmes ?', color: 'text-amber-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Incidents Asten', icon: AlertTriangle, message: 'Montre-moi les statistiques et incidents du magasin Asten', color: 'text-orange-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Temps de résolution', icon: Timer, message: 'Quel est le temps moyen de résolution des tickets ?', color: 'text-cyan-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Rapport ouverts', icon: BarChart3, message: 'Rapport des tickets ouverts', color: 'text-blue-500', roles: ['SUPERADMIN', 'ADMIN', 'HOTLINE', 'TECHNICIAN'] },
  { label: 'Aide & Commandes', icon: HelpCircle, message: 'Que peux-tu faire ?', color: 'text-on-surface-variant', roles: null },
  // Demandeur
  { label: 'Mes tickets', icon: MessageSquare, message: 'Liste de mes tickets', color: 'text-blue-500', roles: ['REQUESTER'] },
  { label: 'Signaler un problème', icon: PlusCircle, message: 'Je veux signaler un problème', color: 'text-emerald-500', roles: ['REQUESTER'] },
];

// ── Widget Recharts ─────────────────────────────────────────────────────

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
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
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
        <button onClick={exportCsv} className="px-2 py-0.5 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer" title="CSV">
          <Download className="w-3 h-3 text-primary" />
          <span>CSV</span>
        </button>
      </div>
      <div className="h-40 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={140}>
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

// ── Markdown ────────────────────────────────────────────────────────────

function preprocessMarkdown(content) {
  if (!content || typeof content !== 'string') return '';
  let formatted = content.replace(/#(\d{2,6})\b/g, '[#$1](/tickets/$1)');
  
  // Corriger les doubles pipes sans saut de ligne (ex: "Urgents || :--- |" ou "| 0 || **Équipe**")
  formatted = formatted.replace(/\|[ \t]*\|/g, '|\n|');
  
  // S'assurer qu'il y a un saut de ligne propre avant et après les tableaux markdown
  formatted = formatted.replace(/([^\n])\n(\|[^\n]+\|)/g, '$1\n\n$2');
  formatted = formatted.replace(/(\|[^\n]+\|)\n([^\n\|])/g, '$1\n\n$2');
  
  return formatted;
}

function MarkdownContent({ content }) {
  const formatted = preprocessMarkdown(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="my-1 space-y-0.5">{children}</ul>,
        li: ({ children }) => <li className="ml-4 list-disc text-[13.5px]">{children}</li>,
        ol: ({ children }) => <ol className="my-1 ml-4 space-y-0.5 list-decimal">{children}</ol>,
        a: ({ href, children }) => (
          <a href={href} target={href?.startsWith('http') ? '_blank' : '_self'} rel="noreferrer" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold hover:underline transition-colors text-[11px]">
            {children}
          </a>
        ),
        code: ({ children, className }) => {
          if (className) return <code className={`${className} bg-surface-container-high px-1 rounded text-[12px]`}>{children}</code>;
          return <code className="bg-surface-container-high px-1 rounded text-[12px]">{children}</code>;
        },
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1.5">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
        blockquote: ({ children }) => <blockquote className="border-l-3 border-primary/40 pl-3 italic text-on-surface-variant">{children}</blockquote>,
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-xl border border-outline-variant/40 bg-surface-container/30 p-1 shadow-sm">
            <table className="w-full text-[12px] text-left border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-surface-container-high text-on-surface font-semibold border-b border-outline-variant/50">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-outline-variant/20">{children}</tbody>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-surface-container-high/40 transition-colors">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 font-bold text-on-surface border-r border-outline-variant/30 last:border-r-0 text-[11.5px] uppercase tracking-wider">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-on-surface border-r border-outline-variant/20 last:border-r-0">{children}</td>
        ),
      }}
    >
      {formatted}
    </ReactMarkdown>
  );
}

// ── Message actions ─────────────────────────────────────────────────────

function MessageActions({ msg, onReply }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (msg.role !== 'assistant') return null;

  return (
    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={handleCopy} className="p-1 rounded hover:bg-surface-container-high transition-colors cursor-pointer" title="Copier">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-on-surface-variant" />}
      </button>
      <button onClick={() => onReply?.(msg.content)} className="p-1 rounded hover:bg-surface-container-high transition-colors cursor-pointer" title="Répondre">
        <Reply className="w-3.5 h-3.5 text-on-surface-variant" />
      </button>
      {msg.id && (
        <>
          <button onClick={() => rateMessage(msg.id, 1)} className={`p-1 rounded hover:bg-surface-container-high transition-colors cursor-pointer ${msg.rating === 1 ? 'text-emerald-500' : ''}`} title="Utile">
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => rateMessage(msg.id, -1)} className={`p-1 rounded hover:bg-surface-container-high transition-colors cursor-pointer ${msg.rating === -1 ? 'text-red-500' : ''}`} title="Pas utile">
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

async function rateMessage(messageId, rating) {
  try { await api.post('/chat/feedback', { messageId, rating }); } catch {}
}

// ── Sidebar conversation item ───────────────────────────────────────────

function ConversationItem({ conv, isActive, onSelect, onPin, onArchive, onDelete, onRename }) {
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conv.title);
  const menuRef = useRef(null);

  const isArchived = conv.archived;

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSaveTitle() {
    if (editTitle.trim()) onRename(conv.id, editTitle.trim());
    setEditing(false);
  }

  return (
    <div
      className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
        isActive
          ? isArchived ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-surface-container-high'
          : isArchived ? 'hover:bg-amber-500/5 opacity-60' : 'hover:bg-surface-container'
      }`}
      onClick={() => onSelect(conv.id)}
    >
      {isArchived ? (
        <Archive className="w-3.5 h-3.5 text-amber-500 shrink-0" />
      ) : conv.pinned ? (
        <Pin className="w-3 h-3 text-amber-500 shrink-0" />
      ) : (
        <MessageSquare className="w-4 h-4 shrink-0 text-on-surface-variant/60" />
      )}

      {editing ? (
        <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setEditing(false); }}
            className="flex-1 bg-transparent text-[13px] text-on-surface focus:outline-none border-b border-primary"
          />
          <button onClick={handleSaveTitle} className="p-0.5 cursor-pointer"><Check className="w-3 h-3 text-emerald-500" /></button>
          <button onClick={() => setEditing(false)} className="p-0.5 cursor-pointer"><X className="w-3 h-3 text-on-surface-variant" /></button>
        </div>
      ) : (
        <span className="flex-1 truncate text-[13px] text-on-surface">{conv.title}</span>
      )}

      {/* Menu dots */}
      <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        <AnimatePresence>
          {showMenu && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              className="absolute right-0 top-full mt-1 z-50 w-48 bg-surface-container-lowest border border-outline-variant/60 rounded-xl shadow-lg py-1 overflow-hidden"
            >
              <button onClick={() => { setEditing(true); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer">
                <Edit3 className="w-3.5 h-3.5" /> Renommer
              </button>
              <button onClick={() => { onPin(conv.id); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer">
                {conv.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                {conv.pinned ? 'Désépingler' : 'Épingler'}
              </button>
              <button onClick={() => { onArchive(conv.id); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer">
                {conv.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                {conv.archived ? 'Désarchiver' : 'Archiver'}
              </button>
              <div className="border-t border-outline-variant/30 my-1" />
              <button onClick={() => { onDelete(conv.id); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-500 hover:bg-red-500/5 transition-colors cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" /> Supprimer
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Welcome screen ──────────────────────────────────────────────────────

function WelcomeScreen({ onAction, userRole }) {
  const filteredActions = QUICK_ACTIONS.filter(a => !a.roles || a.roles.includes(userRole));

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/30">
          <Bot className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-on-surface mb-2">Assistant IA Helpdesk</h1>
        <p className="text-on-surface-variant text-sm">Je peux vous aider avec vos tickets, statistiques, équipements et bien plus.</p>
      </motion.div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
        {filteredActions.map((action, i) => (
          <motion.button
            key={action.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            onClick={() => onAction(action.message)}
            className="flex flex-col items-start gap-2 p-4 rounded-xl border border-outline-variant/40 bg-surface hover:bg-surface-container-high hover:border-primary/30 transition-all cursor-pointer text-left group"
          >
            <action.icon className={`w-5 h-5 ${action.color}`} />
            <span className="text-[13px] font-medium text-on-surface">{action.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ── Main ChatPage ───────────────────────────────────────────────────────

export default function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Déterminer si la conversation active est archivée
  const activeConv = conversations.find(c => c.id === conversationId);
  const isArchived = activeConv?.archived || false;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [messages, loading, scrollToBottom]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Charger les conversations
  const fetchConversations = useCallback(async () => {
    try {
      const params = showArchived ? '?archived=true' : '';
      const { data } = await api.get(`/chat/conversations${params}`);
      setConversations(data);
    } catch {}
  }, [showArchived]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Charger les messages d'une conversation
  async function selectConversation(convId) {
    setConversationId(convId);
    try {
      const { data } = await api.get(`/chat/history?conversationId=${convId}`);
      setMessages(data.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, rating: m.rating })));
    } catch {
      setMessages([]);
    }
  }

  // Nouvelle conversation
  async function handleNewConversation() {
    setConversationId(null);
    setMessages([]);
    setInput('');
    setReplyTo(null);
    removeAttachment();
    inputRef.current?.focus();
  }

  // Conversations CRUD
  async function handlePin(convId) {
    try {
      await api.post(`/chat/conversations/${convId}/pin`);
      fetchConversations();
    } catch {}
  }

  async function handleArchive(convId) {
    try {
      await api.post(`/chat/conversations/${convId}/archive`);
      if (convId === conversationId) { setConversationId(null); setMessages([]); }
      fetchConversations();
    } catch {}
  }

  async function handleDelete(convId) {
    try {
      await api.delete(`/chat/conversations/${convId}`);
      if (convId === conversationId) { setConversationId(null); setMessages([]); }
      fetchConversations();
    } catch {}
  }

  async function handleRename(convId, title) {
    try {
      await api.patch(`/chat/conversations/${convId}`, { title });
      fetchConversations();
    } catch {}
  }

  // Fichiers
  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachment(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachmentPreview(ev.target.result);
      reader.readAsDataURL(file);
    }
  }

  function removeAttachment() {
    setAttachment(null);
    setAttachmentPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Envoyer un message
  async function sendMessage(text) {
    const userMessage = text || input.trim();
    if (!userMessage || loading) return;

    const isFirst = messages.length === 0;
    const newUserMsg = { role: 'user', content: userMessage };
    setMessages((prev) => isFirst ? [newUserMsg] : [...prev, newUserMsg]);
    setInput('');
    setReplyTo(null);
    setLoading(true);

    try {
      const history = [...messages, newUserMsg].slice(-10).map((m) => ({ role: m.role, content: m.content }));

      let data;
      const payload = { message: userMessage, history, conversationId };

      if (attachment) {
        const formData = new FormData();
        formData.append('message', userMessage);
        formData.append('history', JSON.stringify(history));
        if (conversationId) formData.append('conversationId', conversationId);
        formData.append('attachment', attachment);
        const res = await api.post('/chat', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        data = res.data;
      } else {
        const res = await api.post('/chat', payload);
        data = res.data;
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, sources: data.sources, action: data.action, widget: data.widget }]);

      // Si nouvelle conversation, récupérer l'ID et rafraîchir la liste
      if (data.conversationId) {
        setConversationId(data.conversationId);
        fetchConversations();
      }

      removeAttachment();
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Désolé, une erreur est survenue. Réessayez." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleReply(content) {
    setReplyTo(content.substring(0, 150) + (content.length > 150 ? '...' : ''));
    inputRef.current?.focus();
  }

  // Filtrer les conversations
  const filteredConversations = conversations.filter((c) =>
    !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pinnedConvs = filteredConversations.filter((c) => c.pinned);
  const unpinnedConvs = filteredConversations.filter((c) => !c.pinned);

  const showWelcome = messages.length === 0 && !conversationId;

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-surface-container-lowest">
      {/* ═══ SIDEBAR ═══ */}
      <div
        className={`shrink-0 border-r border-outline-variant/40 bg-surface flex flex-col overflow-hidden transition-all duration-200`}
        style={{ width: sidebarOpen ? 280 : 0, minWidth: sidebarOpen ? 280 : 0 }}
      >
        {/* Header sidebar */}
        <div className="p-3 border-b border-outline-variant/30 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Conversations
            </h3>
            <button onClick={() => setSidebarOpen(false)} className="p-1 rounded hover:bg-surface-container-high transition-colors cursor-pointer">
              <X className="w-4 h-4 text-on-surface-variant" />
            </button>
          </div>
          <button
            onClick={handleNewConversation}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-[12px] font-semibold hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nouveau
          </button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-container-high text-[12px] text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>

        {/* Liste conversations */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {/* Épinglées */}
          {pinnedConvs.length > 0 && (
            <>
              <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider px-2 py-1">Épinglées</p>
              {pinnedConvs.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === conversationId}
                  onSelect={selectConversation}
                  onPin={handlePin}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
              ))}
            </>
          )}

          {/* Non épinglées */}
          {unpinnedConvs.length > 0 && (
            <>
              {pinnedConvs.length > 0 && <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider px-2 py-1 mt-2">Récentes</p>}
              {unpinnedConvs.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === conversationId}
                  onSelect={selectConversation}
                  onPin={handlePin}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
              ))}
            </>
          )}

          {filteredConversations.length === 0 && (
            <div className="flex flex-col items-center py-8 px-4 text-center">
              <MessageSquare className="w-10 h-10 text-on-surface-variant/30 mb-3" />
              <p className="text-[13px] text-on-surface-variant font-medium">Aucune conversation</p>
              <p className="text-[11px] text-on-surface-variant/60 mt-1">Envoyez un message pour démarrer</p>
            </div>
          )}
        </div>

        {/* Footer archivées */}
        <div className="p-2 border-t border-outline-variant/30">
          <button
            onClick={() => { setShowArchived(!showArchived); }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-on-surface-variant text-[11px] font-medium hover:bg-surface-container transition-colors cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            {showArchived ? 'Voir les actives' : `Archivées`}
          </button>
        </div>
      </div>

      {/* ═══ ZONE CHAT ═══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/30 bg-surface shrink-0">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer" title="Conversations">
                <MessageSquare className="w-5 h-5 text-on-surface-variant" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-on-surface leading-tight">Assistant IA</h2>
                <p className="text-[10px] text-on-surface-variant leading-tight">Helpdesk IT Prosuma</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleNewConversation}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-[12px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Nouveau
          </button>
        </div>

        {/* Messages / Welcome */}
        <div className="flex-1 overflow-y-auto">
          {showWelcome ? (
            <WelcomeScreen onAction={sendMessage} userRole={user?.role} />
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {/* Bannière conversation archivée */}
              {isArchived && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                  <Archive className="w-3.5 h-3.5" />
                  <span>Cette conversation est archivée. Les réponses du chatbot sont en lecture seule.</span>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group ${isArchived ? 'opacity-75' : ''}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-br-md'
                      : 'bg-surface-container border border-outline-variant/40 text-on-surface rounded-bl-md'
                  }`}>
                    {msg.role === 'assistant' ? <MarkdownContent content={msg.content} /> : <p>{msg.content}</p>}
                    {msg.widget && <WidgetRenderer widget={msg.widget} />}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <p className="text-[10px] opacity-60 flex items-center gap-1">
                          Sources : {msg.sources.map((s) => s.title).join(', ')}
                        </p>
                      </div>
                    )}
                    {msg.action?.type === 'ticket_created' && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <a href={`/tickets/${msg.action.ticketId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                          Voir le ticket #{msg.action.ticketId}
                        </a>
                      </div>
                    )}
                    {msg.action?.type === 'escalation' && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <a href={`/tickets/${msg.action.ticketId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-500 hover:underline">
                          Voir l'escalade #{msg.action.ticketId}
                        </a>
                      </div>
                    )}
                    {(msg.action?.type === 'status_changed' || msg.action?.type === 'ticket_assigned') && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/30">
                        <a href={`/tickets/${msg.action.ticketId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500 hover:underline">
                          Voir le ticket #{msg.action.ticketId}
                        </a>
                      </div>
                    )}
                    <MessageActions msg={msg} onReply={handleReply} />
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-surface-container border border-outline-variant/40 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    <span className="text-[12px] text-on-surface-variant">Réflexion...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2 shrink-0">
          <div className="max-w-3xl mx-auto">
            {attachmentPreview && (
              <div className="mb-2 relative inline-block">
                <img src={attachmentPreview} alt="Pièce jointe" className="h-20 rounded-xl border border-outline-variant/40 object-cover" />
                <button onClick={removeAttachment} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 bg-surface-container border border-outline-variant/40 rounded-xl px-3 py-2 text-[12px] text-on-surface-variant">
                <Reply className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{replyTo}</span>
                <button onClick={() => setReplyTo(null)} className="cursor-pointer p-0.5 hover:bg-surface-container-high rounded">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className={`flex items-end gap-2 bg-surface-container border rounded-2xl px-4 py-3 shadow-sm ${isArchived ? 'border-amber-500/30 opacity-60' : 'border-outline-variant/60'}`}>
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer shrink-0 mb-0.5" title="Joindre une image" disabled={isArchived}>
                <Paperclip className="w-4 h-4 text-on-surface-variant" />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isArchived ? 'Conversation archivée...' : replyTo ? 'Répondre...' : 'Posez votre question...'}
                disabled={loading || isArchived}
                rows={1}
                className="flex-1 bg-transparent text-[14px] text-on-surface placeholder-on-surface-variant/50 focus:outline-none resize-none min-h-[24px] max-h-[120px] disabled:opacity-50"
                style={{ height: 'auto' }}
                onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading || isArchived}
                className="p-2 rounded-xl bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0 mb-0.5"
                aria-label="Envoyer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-on-surface-variant/50 text-center mt-2">
              Assistant IA Prosuma — Peut faire des erreurs. Vérifiez les informations importantes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
