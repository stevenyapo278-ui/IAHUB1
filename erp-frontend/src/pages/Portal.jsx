import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Ticket, Plus, X, Send, ChevronDown, ChevronRight, Clock, MapPin,
  Paperclip, MessageSquare, Sparkles, RefreshCw, Loader2, Star
} from 'lucide-react';
import { PRIORITY_CONFIG, STATUS_CONFIG, PRIORITY_OPTIONS, TYPE_OPTIONS } from '../constants/tickets';
import SlaBadge from '../components/SlaBadge';
import EmptyState from '../components/EmptyState';
import { sanitizeHtml } from '../utils/sanitize';

const PRIORITY_ICON_BG = {
  P1: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border border-red-200 dark:border-red-500/25 font-bold',
  P2: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25 font-bold',
  P3: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300 dark:border-amber-500/25 font-bold',
  P4: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25 font-bold',
};

const EMPTY_FORM = {
  title: '',
  content: '',
  category: '',
  priority: 'P3',
  type: 'INCIDENT',
};

export default function Portal() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachment, setAttachment] = useState(null);
  const fileInputRef = useRef(null);
  const [csatComment, setCsatComment] = useState('');
  const [csatHover, setCsatHover] = useState(0);
  const [csatSaving, setCsatSaving] = useState(false);

  const isRequester = user?.role === 'REQUESTER';

  async function submitCsat(score) {
    if (!detail || detail.csatScore || csatSaving) return;
    setCsatSaving(true);
    try {
      await api.post(`/tickets/${detail.id}/csat`, { score, comment: csatComment.trim() || null });
      toast.success('Merci pour votre retour !');
      setCsatComment('');
      openDetail(detail.id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'envoi de la note");
    } finally {
      setCsatSaving(false);
    }
  }

  const loadTickets = useCallback(() => {
    setLoading(true);
    api
      .get('/tickets', { params: { mine: 'true', limit: 100, sortBy: 'createdAt', sortOrder: 'desc' } })
      .then(({ data }) => setTickets(data.items || []))
      .catch(() => toast.error('Impossible de charger vos tickets'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(loadTickets, [loadTickets]);

  const filtered = filter === 'ALL'
    ? tickets
    : tickets.filter((t) => (filter === 'OPEN' ? ['NEW', 'OPEN', 'PLANNED', 'PENDING'].includes(t.status) : t.status === filter));

  async function openDetail(ticketId) {
    const next = expandedId === ticketId ? null : ticketId;
    setExpandedId(next);
    if (!next) return;
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/tickets/${ticketId}`);
      setDetail(data);
    } catch {
      toast.error('Erreur de chargement du ticket');
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Titre et description sont obligatoires');
      return;
    }
    setCreating(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title.trim());
      fd.append('content', form.content.trim());
      fd.append('priority', form.priority);
      fd.append('type', form.type);
      if (form.category.trim()) fd.append('category', form.category.trim());
      if (attachment) fd.append('attachment', attachment);
      await api.post('/tickets', fd);
      toast.success('Votre demande a été envoyée');
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setAttachment(null);
      loadTickets();
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'envoi de la demande");
    } finally {
      setCreating(false);
    }
  }

  async function submitComment(ticketId) {
    if (!comment.trim()) return;
    setSendingComment(true);
    try {
      const fd = new FormData();
      fd.append('content', comment.trim());
      await api.post(`/tickets/${ticketId}/followups`, fd);
      toast.success('Commentaire ajouté');
      setComment('');
      openDetail(ticketId);
    } catch (err) {
      toast.error(err.response?.data?.error || "Échec de l'ajout du commentaire");
    } finally {
      setSendingComment(false);
    }
  }

  const timeline = detail
    ? [...(detail.followups || []).map((f) => ({ kind: 'followup', ...f })), ...(detail.messages || []).map((m) => ({ kind: 'message', ...m }))]
      .sort((a, b) => new Date(a.createdAt || a.timestamp) - new Date(b.createdAt || b.timestamp))
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto flex flex-col gap-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold">
            {isRequester ? 'Mes demandes' : 'Mes tickets'}
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Suivez vos demandes et déposez une nouvelle demande d'assistance.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-body-sm shadow-sm hover:opacity-90 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nouvelle demande
        </button>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: 'ALL', label: 'Toutes' },
          { key: 'OPEN', label: 'Ouvertes' },
          { key: 'SOLVED', label: 'Résolues' },
          { key: 'CLOSED', label: 'Fermées' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
              filter === f.key
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface-container-low text-on-surface-variant border-outline-variant/40 hover:border-primary/50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-on-surface-variant">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="tickets" title="Aucune demande" description="Vous n'avez pas encore de tickets. Créez votre première demande." />
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm overflow-hidden"
              >
                <button
                  onClick={() => openDetail(t.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container-low/60 transition-colors cursor-pointer"
                >
                  <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center ${PRIORITY_ICON_BG[t.priority] || 'bg-slate-50'}`}>
                    <Ticket className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-on-surface-variant">#{t.id}</span>
                      {STATUS_CONFIG[t.status] && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${STATUS_CONFIG[t.status].bg}`}>
                          {STATUS_CONFIG[t.status].label}
                        </span>
                      )}
                      {t.category && <span className="text-[11px] text-on-surface-variant hidden sm:block truncate">{t.category}</span>}
                    </div>
                    <p className="font-bold text-body-sm text-on-surface truncate">{t.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.glpiLocationName && (
                        <span className="text-[11px] text-on-surface-variant flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5" />{t.glpiLocationName}
                        </span>
                      )}
                      <SlaBadge ticket={t} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.assignedTo?.fullName && (
                      <span className="hidden sm:inline text-[11px] text-on-surface-variant">→ {t.assignedTo.fullName}</span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${expandedId === t.id ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                <AnimatePresence>
                  {expandedId === t.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-outline-variant/20 bg-surface-container-low/30"
                    >
                      {detailLoading ? (
                        <div className="p-6 text-center text-on-surface-variant text-body-sm">Chargement...</div>
                      ) : detail && detail.id === t.id ? (
                        <div className="p-4 sm:p-5 flex flex-col gap-4">
                          {/* Description */}
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-1.5">Description</div>
                            <p className="text-body-sm text-on-surface whitespace-pre-wrap leading-relaxed">{detail.content}</p>
                            {detail.contentEmbedding && null}
                          </div>

                          {/* Timeline */}
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-1.5">
                              Échanges ({timeline.length})
                            </div>
                            <div className="flex flex-col gap-2">
                              {timeline.length === 0 && (
                                <p className="text-body-sm text-on-surface-variant italic">Aucun échange pour le moment.</p>
                              )}
                              {timeline.map((item, idx) => (
                                <div key={idx} className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    {item.kind === 'message' ? (
                                      <MessageSquare className="w-3 h-3 text-sky-500" />
                                    ) : (
                                      <MessageSquare className="w-3 h-3 text-primary" />
                                    )}
                                    <span className="text-[11px] font-bold text-on-surface-variant">
                                      {item.kind === 'message' ? (item.sender || 'Support') : (item.author?.fullName || 'Support')}
                                    </span>
                                    <span className="text-[10px] text-outline">
                                      {new Date(item.createdAt || item.timestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                                    </span>
                                    {item.kind === 'message' && item.direction === 'OUTBOUND' && (
                                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">NOTRE ÉQUIPE</span>
                                    )}
                                  </div>
                                  <div
                                    className="text-body-sm text-on-surface leading-relaxed break-words"
                                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.bodyHtml || item.content || '') }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Pièces jointes */}
                          {detail.attachments?.length > 0 && (
                            <div>
                              <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-1.5">
                                Pièces jointes ({detail.attachments.length})
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {detail.attachments.map((att) => (
                                  <a
                                    key={att.id}
                                    href={`${api.defaults.baseURL}/tickets/${t.id}/attachments/${att.id}/file`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-body-sm text-on-surface-variant hover:border-primary/50 hover:text-primary transition-all"
                                  >
                                    <Paperclip className="w-3 h-3" />{att.filename || 'Fichier'}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* CSAT : satisfaction */}
                          {isRequester && ['SOLVED', 'CLOSED'].includes(detail.status) && (
                            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                              <div className="text-[11px] font-black uppercase tracking-widest text-on-surface mb-2">
                                Votre avis compte
                              </div>
                              <div className="flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    onClick={() => submitCsat(star)}
                                    disabled={csatSaving || !!detail.csatScore}
                                    className="p-1 transition-transform hover:scale-125 cursor-pointer disabled:cursor-default disabled:hover:scale-100"
                                    title={`${star} étoile${star > 1 ? 's' : ''}`}
                                  >
                                    <Star
                                      className={`w-6 h-6 ${
                                        (detail.csatScore || csatHover) >= star
                                          ? 'fill-amber-400 text-amber-400'
                                          : 'text-outline'
                                      }`}
                                    />
                                  </button>
                                ))}
                              </div>
                              {detail.csatScore ? (
                                <p className="text-body-sm text-on-surface-variant mt-2">
                                  Merci ! Vous avez noté {detail.csatScore}/5.
                                  {detail.csatComment && <span className="block italic mt-0.5">« {detail.csatComment} »</span>}
                                </p>
                              ) : (
                                <input
                                  type="text"
                                  value={csatComment}
                                  onChange={(e) => setCsatComment(e.target.value)}
                                  placeholder="Un commentaire (optionnel) ?"
                                  className="mt-2 w-full bg-surface border border-outline-variant/60 rounded-lg px-3 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                />
                              )}
                            </div>
                          )}

                          {/* Commentaire */}
                          <div>
                            <textarea
                              value={comment}
                              onChange={(e) => setComment(e.target.value)}
                              placeholder="Ajouter une information à votre demande..."
                              rows={2}
                              className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                            />
                            <div className="flex justify-end mt-2">
                              <button
                                onClick={() => submitComment(t.id)}
                                disabled={sendingComment || !comment.trim()}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-bold text-body-sm hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
                              >
                                {sendingComment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                Envoyer
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Modale de création */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreate(false)}
          >
            <motion.form
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 12, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={submitCreate}
              className="w-full max-w-lg rounded-3xl bg-surface border border-outline-variant/30 shadow-2xl p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-headline-md text-headline-md text-on-surface font-bold">Nouvelle demande</h2>
                <button type="button" onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Titre *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Résumez votre problème en une phrase"
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Priorité</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>{PRIORITY_CONFIG[p]?.label || p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Catégorie</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Ex : Matériel, Réseau, Logiciel..."
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Description *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={5}
                  placeholder="Décrivez le problème : quand est-il apparu, sur quel équipement, qu'avez-vous essayé..."
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                />
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-dashed border-outline-variant/60 text-body-sm text-on-surface-variant hover:border-primary/50 hover:text-primary transition-all cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  {attachment ? attachment.name : 'Joindre un fichier (optionnel)'}
                </button>
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={creating}
                className="w-full py-3 rounded-xl bg-primary text-on-primary font-bold text-body-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {creating ? 'Envoi en cours...' : 'Envoyer la demande'}
              </motion.button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}