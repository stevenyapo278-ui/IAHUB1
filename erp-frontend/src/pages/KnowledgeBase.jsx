import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import {
  BookOpen, FileText, Search, Trash2, Upload, X,
  Sparkles, Layers, MessageSquare, AlertTriangle, RefreshCw,
  CheckCircle2, SlidersHorizontal, User, Network, Shield,
  Monitor, HardDrive, Phone, Cpu, Tag, Plus, FileUp, Folder
} from 'lucide-react';

const STATUS_LABELS = { PROCESSING: 'Traitement...', READY: 'Prêt', ERROR: 'Erreur' };
const CATEGORIES = ['Réseau', 'Système', 'Sécurité', 'Applicatif', 'Logiciel', 'Matériel', 'Téléphonie'];

const CATEGORY_CONFIG = {
  Réseau:     { color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/25',   icon: Network  },
  Système:    { color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-500/15', border: 'border-purple-500/25', icon: Cpu      },
  Sécurité:   { color: 'text-red-700 dark:text-red-400',    bg: 'bg-red-500/15',    border: 'border-red-500/25',    icon: Shield   },
  Applicatif: { color: 'text-emerald-700 dark:text-emerald-400',bg: 'bg-emerald-500/15',border: 'border-emerald-500/25',icon: Monitor  },
  Logiciel:   { color: 'text-amber-700 dark:text-amber-400',  bg: 'bg-amber-500/15',  border: 'border-amber-500/25',  icon: Sparkles },
  Matériel:   { color: 'text-slate-700 dark:text-slate-400',  bg: 'bg-slate-500/15',  border: 'border-slate-500/25',  icon: HardDrive},
  Téléphonie: { color: 'text-cyan-700 dark:text-cyan-400',   bg: 'bg-cyan-500/15',   border: 'border-cyan-500/25',   icon: Phone    },
};

export default function KnowledgeBase() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const canManage = hasPermission(user, 'knowledge.manage');

  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [author, setAuthor] = useState(user?.fullName || '');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [localFilter, setLocalFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [replacingId, setReplacingId] = useState(null);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const replaceInputRef = useRef(null);
  const replaceTargetRef = useRef(null);

  // Search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchCategory, setSearchCategory] = useState(() => localStorage.getItem('kb_search_category') || '');
  const [searchTags, setSearchTags] = useState(() => { try { return JSON.parse(localStorage.getItem('kb_search_tags')) || []; } catch { return []; } });
  const [searchLimit, setSearchLimit] = useState(() => Number(localStorage.getItem('kb_search_limit')) || 5);
  const [useHybrid, setUseHybrid] = useState(() => { const s = localStorage.getItem('kb_use_hybrid'); return s !== null ? s === 'true' : true; });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { localStorage.setItem('kb_search_category', searchCategory); }, [searchCategory]);
  useEffect(() => { localStorage.setItem('kb_search_tags', JSON.stringify(searchTags)); }, [searchTags]);
  useEffect(() => { localStorage.setItem('kb_search_limit', searchLimit); }, [searchLimit]);
  useEffect(() => { localStorage.setItem('kb_use_hybrid', useHybrid); }, [useHybrid]);

  useEffect(() => {
    let interval;
    if (uploading) {
      setProgress(0);
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev < 20) return prev + Math.floor(Math.random() * 4) + 3;
          if (prev < 45) return prev + Math.floor(Math.random() * 3) + 2;
          if (prev < 85) return prev + Math.floor(Math.random() * 2) + 1;
          if (prev < 96) return prev + (Math.random() > 0.7 ? 1 : 0);
          return prev;
        });
      }, 250);
    } else { setProgress(0); }
    return () => clearInterval(interval);
  }, [uploading]);

  function load() {
    api.get('/knowledge/documents')
      .then(({ data }) => setDocuments(data))
      .catch(err => setError(err.response?.data?.error || 'Erreur de chargement'));
  }
  useEffect(load, []);
  useEffect(() => {
    const hasProcessing = documents.some(d => d.status === 'PROCESSING');
    if (hasProcessing) { const id = setInterval(load, 3000); return () => clearInterval(id); }
  }, [documents]);

  const totalDocs = documents.length;
  const totalChunks = documents.reduce((a, d) => a + (d._count?.chunks ?? 0), 0);
  const totalFeedbacks = documents.reduce((a, d) => a + (d._count?.feedbacks ?? 0), 0);
  const totalErrors = documents.filter(d => d.status === 'ERROR').length;

  function handleDrag(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }
  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      const f = e.dataTransfer.files[0];
      const ext = f.name.split('.').pop().toLowerCase();
      if (['pdf', 'docx', 'md', 'markdown', 'txt'].includes(ext)) {
        setFile(f);
        if (!title) setTitle(f.name.substring(0, f.name.lastIndexOf('.')) || f.name);
      } else setError('Format non supporté. PDF, DOCX, MD ou TXT.');
    }
  }
  function handleAddTag(e) {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const v = tagInput.trim().toLowerCase();
      if (!tags.includes(v)) setTags([...tags, v]);
      setTagInput('');
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setError(''); setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    if (category) fd.append('category', category);
    if (author) fd.append('author', author);
    if (tags.length > 0) fd.append('tags', JSON.stringify(tags));
    try {
      await api.post('/knowledge/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setProgress(100);
      await new Promise(r => setTimeout(r, 500));
      setTitle(''); setCategory(''); setTags([]); setFile(null);
      load();
      setSuccess(true);
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.65 } });
      setTimeout(() => { setSuccess(false); setShowUploadPanel(false); }, 2000);
    } catch (err) { setError(err.response?.data?.error || "Erreur lors de l'upload"); }
    finally { setUploading(false); }
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return; setDeleting(true);
    try { await api.delete(`/knowledge/documents/${confirmDeleteId}`); setConfirmDeleteId(null); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur suppression'); }
    finally { setDeleting(false); }
  }

  function askReplace(doc) { replaceTargetRef.current = doc; replaceInputRef.current?.click(); }
  async function handleReplaceFileChosen(e) {
    const f = e.target.files?.[0]; const doc = replaceTargetRef.current; e.target.value = '';
    if (!f || !doc) return; setError(''); setReplacingId(doc.id);
    const fd = new FormData(); fd.append('file', f);
    try { await api.put(`/knowledge/documents/${doc.id}/replace`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur remplacement'); }
    finally { setReplacingId(null); }
  }

  async function handleSearch(e) {
    e.preventDefault(); if (!query.trim()) return;
    setError(''); setSearching(true); setResults(null);
    try {
      const body = { query, limit: Number(searchLimit), useHybrid };
      if (searchCategory) body.category = searchCategory;
      if (searchTags.length > 0) body.tags = searchTags;
      const { data } = await api.post('/knowledge/search', body);
      setResults(data);
    } catch (err) { setError(err.response?.data?.error || 'Erreur recherche'); }
    finally { setSearching(false); }
  }

  const filteredDocuments = documents.filter(doc => {
    const f = localFilter.toLowerCase();
    const matchText = !f || doc.title.toLowerCase().includes(f) || doc.filename?.toLowerCase().includes(f) || doc.category?.toLowerCase().includes(f) || doc.tags?.some(t => t.toLowerCase().includes(f));
    const matchCat = !categoryFilter || doc.category === categoryFilter;
    return matchText && matchCat;
  });

  const byCategory = CATEGORIES.reduce((acc, cat) => {
    const docs = filteredDocuments.filter(d => d.category === cat);
    if (docs.length > 0) acc[cat] = docs;
    return acc;
  }, {});
  const uncategorized = filteredDocuments.filter(d => !d.category || !CATEGORIES.includes(d.category));

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Base de Connaissances</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">{totalDocs} documents · {totalChunks} fragments vectoriels</p>
          </div>
        </div>

        {/* Global search bar */}
        <form onSubmit={handleSearch} className="relative flex-1 max-w-lg flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
            <input
              type="text"
              placeholder="Interroger la base de connaissances sémantiquement..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full bg-surface border border-outline-variant/60 rounded-xl pl-9 pr-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>
          <motion.button
            type="submit" disabled={searching || !query.trim()}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 shrink-0 cursor-pointer"
          >
            {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{searching ? 'Recherche...' : 'RAG Search'}</span>
          </motion.button>
        </form>

        {/* Right actions */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${showFilters ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container'}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Filtres</span>
          </button>
          {canManage && (
            <motion.button
              onClick={() => { setError(''); setShowUploadPanel(true); }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Indexer</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* ── Search filters strip ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-b border-outline-variant/20 bg-surface-container-low/40"
          >
            <div className="px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie :</span>
                <button
                  onClick={() => setCategoryFilter('')}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${!categoryFilter ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
                >Toutes</button>
                {CATEGORIES.map(cat => {
                  const cfg = CATEGORY_CONFIG[cat];
                  const Icon = cfg.icon;
                  return (
                    <button key={cat} onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${categoryFilter === cat ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
                    >
                      <Icon className="w-2.5 h-2.5" />
                      {cat}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase">Hybride :</span>
                <motion.button
                  type="button"
                  onClick={() => setUseHybrid(!useHybrid)}
                  whileTap={{ scale: 0.92 }}
                  className={`relative w-12 h-6 rounded-full border transition-all duration-300 outline-none ${
                    useHybrid
                      ? 'bg-primary border-primary/60 shadow-sm shadow-primary/20'
                      : 'bg-surface-container-high border-outline-variant/60'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <motion.span
                    animate={{ x: useHybrid ? 24 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                    className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full shadow-sm ${
                      useHybrid ? 'bg-white' : 'bg-on-surface-variant/80'
                    }`}
                  />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 lg:px-8 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-3 border-b border-outline-variant/15 flex items-center gap-6">
        {[
          { label: 'Documents', value: totalDocs, icon: BookOpen, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Fragments',  value: totalChunks, icon: Layers, color: 'text-purple-600 dark:text-purple-400' },
          { label: 'Évaluations',value: totalFeedbacks, icon: MessageSquare, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Erreurs',    value: totalErrors, icon: AlertTriangle, color: totalErrors > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-1.5">
              <Icon className={`w-3.5 h-3.5 ${s.color}`} />
              <span className="text-sm font-bold text-on-surface">{s.value}</span>
              <span className="text-[11px] text-on-surface-variant font-medium hidden sm:block">{s.label}</span>
            </div>
          );
        })}
        {/* Local search */}
        <div className="ml-auto relative hidden md:block">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            type="text"
            placeholder="Filtrer les documents..."
            value={localFilter}
            onChange={e => setLocalFilter(e.target.value)}
            className="bg-surface border border-outline-variant/60 rounded-lg pl-8 pr-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-44 transition-all focus:w-56"
          />
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-8">
        {/* RAG Search Results */}
        <AnimatePresence>
          {results && (
            <motion.section
              key="results"
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Résultats RAG</span>
                </div>
                <span className="text-sm text-on-surface-variant font-medium">
                  {results.length} fragment{results.length !== 1 ? 's' : ''} pertinent{results.length !== 1 ? 's' : ''} pour <em className="text-on-surface font-semibold">"{query}"</em>
                </span>
                <button onClick={() => { setResults(null); setQuery(''); }} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                {results.length === 0 ? (
                  <div className="text-center py-12 text-on-surface-variant">
                    <Search className="w-10 h-10 text-outline/30 mx-auto mb-3" />
                    <p className="text-sm italic">Aucun fragment pertinent trouvé.</p>
                  </div>
                ) : results.map((r, i) => {
                  const catCfg = CATEGORY_CONFIG[r.category];
                  return (
                    <motion.div
                      key={r.id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.04 }}
                      className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest shadow-sm"
                    >
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/20">
                        <div className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant">
                          #{i + 1}
                        </div>
                        <span className="font-semibold text-sm text-on-surface truncate flex-1">{r.title}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.category && catCfg && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${catCfg.bg} ${catCfg.color} ${catCfg.border}`}>
                              {r.category}
                            </span>
                          )}
                          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant/40">
                            <div className="h-1.5 w-16 bg-surface-container-high rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.round(r.combined_score * 100)}%` }}
                                transition={{ duration: 0.6, delay: i * 0.05 }}
                                className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 rounded-full"
                              />
                            </div>
                            <span className="text-[10px] font-bold text-on-surface-variant">
                              {(r.combined_score * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="px-4 py-3">
                        <blockquote className="text-sm leading-relaxed border-l-2 border-blue-500/30 pl-3 text-on-surface font-normal">
                          {r.content}
                        </blockquote>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Documents list by Categories */}
        <div className="space-y-6">
          {Object.entries(byCategory).map(([catName, docs]) => {
            const cfg = CATEGORY_CONFIG[catName] || CATEGORY_CONFIG.Système;
            const Icon = cfg.icon;
            return (
              <div key={catName} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${cfg.bg} ${cfg.border} border`}>
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                  </div>
                  <h2 className="text-sm font-bold text-on-surface">{catName}</h2>
                  <span className="text-xs text-on-surface-variant font-medium">({docs.length})</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {docs.map(doc => (
                    <DocumentCard
                      key={doc.id}
                      doc={doc}
                      canManage={canManage}
                      onDelete={() => setConfirmDeleteId(doc.id)}
                      onReplace={() => askReplace(doc)}
                      replacingId={replacingId}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {uncategorized.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-surface-container border border-outline-variant/30">
                  <Folder className="w-4 h-4 text-on-surface-variant" />
                </div>
                <h2 className="text-sm font-bold text-on-surface">Non classés</h2>
                <span className="text-xs text-on-surface-variant font-medium">({uncategorized.length})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {uncategorized.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    canManage={canManage}
                    onDelete={() => setConfirmDeleteId(doc.id)}
                    onReplace={() => askReplace(doc)}
                    replacingId={replacingId}
                  />
                ))}
              </div>
            </div>
          )}

          {filteredDocuments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
              <BookOpen className="w-10 h-10 text-outline/30" />
              <p className="text-sm italic">Aucun document dans la base de connaissances.</p>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input for replacing document */}
      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown,.txt"
        onChange={handleReplaceFileChosen}
        className="hidden"
      />

      {/* ── Upload Modal / Drawer ────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showUploadPanel && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => { if (!uploading) setShowUploadPanel(false); }}
                className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
                className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/30">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10">
                    <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Indexer un document RAG</h3>
                    <p className="text-[10px] text-on-surface-variant">Vectorisation automatique en fragments de connaissances</p>
                  </div>
                  <motion.button
                    onClick={() => { if (!uploading) setShowUploadPanel(false); }}
                    whileHover={{ scale: 1.1, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                    className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                {/* Form Body */}
                <form onSubmit={handleUpload} className="p-5 space-y-4 overflow-y-auto flex-1">
                  {error && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{error}</span>
                      <button type="button" onClick={() => setError('')} className="p-1 hover:bg-red-500/20 rounded-lg">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Dropzone */}
                  <div
                    onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer ${
                      dragActive
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : file
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-outline-variant/40 hover:border-emerald-500/50 bg-surface-container-low/30'
                    }`}
                    onClick={() => document.getElementById('kb-file-input')?.click()}
                  >
                    <FileUp className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                    {file ? (
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{file.name}</p>
                        <p className="text-[10px] text-on-surface-variant font-mono">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-on-surface">Glissez-déposez votre fichier ici</p>
                        <p className="text-[10px] text-on-surface-variant font-medium">Formats supportés : PDF, DOCX, MD, TXT</p>
                      </>
                    )}
                    <input
                      id="kb-file-input"
                      type="file"
                      accept=".pdf,.docx,.md,.markdown,.txt"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setFile(f);
                          if (!title) setTitle(f.name.substring(0, f.name.lastIndexOf('.')) || f.name);
                        }
                      }}
                      className="hidden"
                    />
                  </div>

                  {/* Form fields */}
                  <div className="space-y-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Titre du document *</span>
                      <input
                        required
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="ex: Guide de configuration VPN SSL"
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                        <select
                          value={category}
                          onChange={e => setCategory(e.target.value)}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-all"
                        >
                          <option value="">Sélectionner une catégorie...</option>
                          {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Auteur</span>
                        <input
                          value={author}
                          onChange={e => setAuthor(e.target.value)}
                          placeholder="Nom de l'auteur"
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mots-clés / Tags (Entrée pour ajouter)</span>
                      <input
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={handleAddTag}
                        placeholder="vpn, reseau, securite..."
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {tags.map(t => (
                            <span key={t} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                              #{t}
                              <button type="button" onClick={() => setTags(tags.filter(x => x !== t))}><X className="w-2.5 h-2.5" /></button>
                            </span>
                          ))}
                        </div>
                      )}
                    </label>
                  </div>

                  {/* Progress bar */}
                  {uploading && (
                    <div className="space-y-1.5 pt-2">
                      <div className="flex justify-between text-[10px] font-bold text-on-surface-variant">
                        <span>Vectorisation & Découpage en cours...</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden bg-surface-container border border-outline-variant/30">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}

                  {success && (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Document indexé et vectorisé avec succès !
                    </div>
                  )}

                  {/* Footer buttons */}
                  <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant/30">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => setShowUploadPanel(false)}
                      className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container disabled:opacity-50 transition-all cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={!file || uploading}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-40 hover:brightness-110 transition-all flex items-center gap-2 cursor-pointer"
                    >
                      {uploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>{uploading ? 'Indexation...' : 'Lancer l\'indexation'}</span>
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Supprimer le document"
        message="Supprimer définitivement ce document et tous ses fragments vectoriels ?"
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

function DocumentCard({ doc, canManage, onDelete, onReplace, replacingId }) {
  const catCfg = CATEGORY_CONFIG[doc.category] || CATEGORY_CONFIG.Système;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest p-4 shadow-sm flex flex-col justify-between group hover:border-emerald-500/40 transition-all"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          {doc.category && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${catCfg.bg} ${catCfg.color} ${catCfg.border}`}>
              {doc.category}
            </span>
          )}
          <span className="text-[10px] font-bold text-on-surface-variant/60 font-mono">
            {doc._count?.chunks || 0} fragment(s)
          </span>
        </div>

        <div>
          <h3 className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors line-clamp-2">
            {doc.title}
          </h3>
          {doc.filename && (
            <p className="text-[10px] text-on-surface-variant font-mono truncate mt-0.5">{doc.filename}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 mt-3 border-t border-outline-variant/15">
        <span className="text-[10px] text-on-surface-variant font-medium">
          {new Date(doc.createdAt).toLocaleDateString('fr-FR')}
        </span>

        {canManage && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={onReplace}
              disabled={replacingId === doc.id}
              className="p-1 rounded-lg text-on-surface-variant hover:text-emerald-600 hover:bg-emerald-500/10 transition-all text-[10px] font-semibold flex items-center gap-1"
              title="Remplacer le fichier"
            >
              <RefreshCw className={`w-3 h-3 ${replacingId === doc.id ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded-lg text-on-surface-variant/50 hover:text-red-500 hover:bg-red-500/10 transition-all"
              title="Supprimer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
