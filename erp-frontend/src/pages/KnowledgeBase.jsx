import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUS_LABELS = {
  PROCESSING: 'Traitement...',
  READY: 'Prêt',
  ERROR: 'Erreur',
};

const CATEGORIES = [
  'Réseau',
  'Système',
  'Sécurité',
  'Applicatif',
  'Logiciel',
  'Matériel',
  'Téléphonie',
];

const SOURCE_ICONS = {
  pdf: 'picture_as_pdf',
  docx: 'description',
  markdown: 'article',
  article: 'lightbulb',
};

const CATEGORY_COLORS = {
  Réseau: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400',
  Système: 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400',
  Sécurité: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400',
  Applicatif: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
  Logiciel: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
  Matériel: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400',
  Téléphonie: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20 dark:text-cyan-400',
};

export default function KnowledgeBase() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'knowledge.manage');
  
  // Data states
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');
  
  // Upload states
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

  // Simulated progress logic for document indexing stages
  useEffect(() => {
    let interval;
    if (uploading) {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev < 20) {
            return prev + Math.floor(Math.random() * 4) + 3; // Upload phase
          } else if (prev < 45) {
            return prev + Math.floor(Math.random() * 3) + 2; // Extraction & Analysis
          } else if (prev < 85) {
            return prev + Math.floor(Math.random() * 2) + 1; // Vectorization & Embedding
          } else if (prev < 96) {
            return prev + (Math.random() > 0.7 ? 1 : 0); // Almost done
          }
          return prev;
        });
      }, 250);
    } else {
      setProgress(0);
    }
    return () => clearInterval(interval);
  }, [uploading]);

  // Search/RAG states
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [searchCategory, setSearchCategory] = useState(() => localStorage.getItem('kb_search_category') || '');
  const [searchTags, setSearchTags] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('kb_search_tags')) || [];
    } catch {
      return [];
    }
  });
  const [searchTagInput, setSearchTagInput] = useState('');
  const [searchLimit, setSearchLimit] = useState(() => Number(localStorage.getItem('kb_search_limit')) || 5);
  const [useHybrid, setUseHybrid] = useState(() => {
    const saved = localStorage.getItem('kb_use_hybrid');
    return saved !== null ? saved === 'true' : true;
  });

  // Persist search filters in localStorage
  useEffect(() => {
    localStorage.setItem('kb_search_category', searchCategory);
  }, [searchCategory]);

  useEffect(() => {
    localStorage.setItem('kb_search_tags', JSON.stringify(searchTags));
  }, [searchTags]);

  useEffect(() => {
    localStorage.setItem('kb_search_limit', searchLimit);
  }, [searchLimit]);

  useEffect(() => {
    localStorage.setItem('kb_use_hybrid', useHybrid);
  }, [useHybrid]);

  // Feedback states
  const [feedbackSent, setFeedbackSent] = useState({}); // { [chunkId]: rating }
  const [feedbackComment, setFeedbackComment] = useState({}); // { [chunkId]: comment }
  const [activeCommentId, setActiveCommentId] = useState(null);

  // local list filter state
  const [localFilter, setLocalFilter] = useState('');

  // Delete/Replace states
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [replacingId, setReplacingId] = useState(null);
  const replaceInputRef = useRef(null);
  const replaceTargetRef = useRef(null);

  function load() {
    api
      .get('/knowledge/documents')
      .then(({ data }) => setDocuments(data))
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  // Polling for processing documents
  useEffect(() => {
    const hasProcessing = documents.some((doc) => doc.status === 'PROCESSING');
    if (hasProcessing) {
      const interval = setInterval(load, 3000);
      return () => clearInterval(interval);
    }
  }, [documents]);

  // Stats calculation
  const totalDocs = documents.length;
  const totalChunks = documents.reduce((acc, doc) => acc + (doc._count?.chunks ?? 0), 0);
  const totalFeedbacks = documents.reduce((acc, doc) => acc + (doc._count?.feedbacks ?? 0), 0);
  const totalErrors = documents.filter((doc) => doc.status === 'ERROR').length;

  // Drag and drop handlers
  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      const ext = droppedFile.name.split('.').pop().toLowerCase();
      if (['pdf', 'docx', 'md', 'markdown', 'txt'].includes(ext)) {
        setFile(droppedFile);
        if (!title) {
          setTitle(droppedFile.name.substring(0, droppedFile.name.lastIndexOf('.')) || droppedFile.name);
        }
      } else {
        setError('Format de fichier non supporté. PDF, DOCX, MD ou TXT requis.');
      }
    }
  }

  // Tags input handlers
  function handleAddTag(e) {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const val = tagInput.trim().toLowerCase();
      if (!tags.includes(val)) {
        setTags([...tags, val]);
      }
      setTagInput('');
    }
  }

  function handleRemoveTag(index) {
    setTags(tags.filter((_, i) => i !== index));
  }

  function handleAddSearchTag(e) {
    if (e.key === 'Enter' && searchTagInput.trim()) {
      e.preventDefault();
      const val = searchTagInput.trim().toLowerCase();
      if (!searchTags.includes(val)) {
        setSearchTags([...searchTags, val]);
      }
      setSearchTagInput('');
    }
  }

  function handleRemoveSearchTag(index) {
    setSearchTags(searchTags.filter((_, i) => i !== index));
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setError('');
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    if (category) formData.append('category', category);
    if (author) formData.append('author', author);
    if (tags.length > 0) {
      formData.append('tags', JSON.stringify(tags));
    }

    try {
      await api.post('/knowledge/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Complete progress bar simulation
      setProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 500));

      setTitle('');
      setCategory('');
      setTags([]);
      setFile(null);
      if (e.target.reset) e.target.reset();
      load();

      // Trigger success celebration and screen
      setSuccess(true);
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.65 }
      });

      setTimeout(() => {
        setSuccess(false);
      }, 2500);

    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'upload");
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/knowledge/documents/${confirmDeleteId}`);
      setConfirmDeleteId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  function askReplace(doc) {
    replaceTargetRef.current = doc;
    replaceInputRef.current?.click();
  }

  async function handleReplaceFileChosen(e) {
    const file = e.target.files?.[0];
    const doc = replaceTargetRef.current;
    e.target.value = '';
    if (!file || !doc) return;

    setError('');
    setReplacingId(doc.id);
    const formData = new FormData();
    formData.append('file', file);

    try {
      await api.put(`/knowledge/documents/${doc.id}/replace`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du remplacement');
    } finally {
      setReplacingId(null);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setError('');
    setSearching(true);
    setResults(null);
    setFeedbackSent({});
    setFeedbackComment({});
    setActiveCommentId(null);

    try {
      const searchBody = {
        query,
        limit: Number(searchLimit),
        useHybrid,
      };
      if (searchCategory) searchBody.category = searchCategory;
      if (searchTags.length > 0) searchBody.tags = searchTags;

      const { data } = await api.post('/knowledge/search', searchBody);
      setResults(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la recherche');
    } finally {
      setSearching(false);
    }
  }

  async function handleFeedbackSubmit(result, rating) {
    const comment = feedbackComment[result.id] || '';
    try {
      await api.post('/knowledge/feedback', {
        documentId: result.documentId,
        chunkId: result.id,
        query,
        rating,
        comment,
        userEmail: user?.email,
      });
      setFeedbackSent((prev) => ({ ...prev, [result.id]: rating }));
      setActiveCommentId(null);
      load(); // Refresh to update feedback count in dashboard/table
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'enregistrement du feedback");
    }
  }

  // Local filtering of documents list
  const filteredDocuments = documents.filter((doc) => {
    const filter = localFilter.toLowerCase();
    const titleMatch = doc.title.toLowerCase().includes(filter);
    const filenameMatch = doc.filename?.toLowerCase().includes(filter) || false;
    const catMatch = doc.category?.toLowerCase().includes(filter) || false;
    const tagMatch = doc.tags?.some((t) => t.toLowerCase().includes(filter)) || false;
    return titleMatch || filenameMatch || catMatch || tagMatch;
  });

  return (
    <div className="flex flex-col gap-lg pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-md border-b border-outline-variant/40 pb-lg">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background font-bold tracking-tight">Base de connaissances</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Documents indexés pour la recherche sémantique (RAG).
          </p>
        </div>
      </header>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-500">error</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="hover:opacity-75">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* KPI / Dashboard Panel */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-md">
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-md flex items-center gap-md card-shadow">
          <div className="p-sm bg-blue-500/10 text-blue-500 rounded-xl">
            <span className="material-symbols-outlined text-[30px]">library_books</span>
          </div>
          <div>
            <p className="text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">Documents</p>
            <h4 className="text-headline-lg font-display-lg font-bold text-on-surface">{totalDocs}</h4>
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-md flex items-center gap-md card-shadow">
          <div className="p-sm bg-purple-500/10 text-purple-500 rounded-xl">
            <span className="material-symbols-outlined text-[30px]">analytics</span>
          </div>
          <div>
            <p className="text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">Fragments RAG</p>
            <h4 className="text-headline-lg font-display-lg font-bold text-on-surface">{totalChunks}</h4>
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-md flex items-center gap-md card-shadow">
          <div className="p-sm bg-emerald-500/10 text-emerald-500 rounded-xl">
            <span className="material-symbols-outlined text-[30px]">reviews</span>
          </div>
          <div>
            <p className="text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">Feedbacks</p>
            <h4 className="text-headline-lg font-display-lg font-bold text-on-surface">{totalFeedbacks}</h4>
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-md flex items-center gap-md card-shadow">
          <div className={`p-sm rounded-xl ${totalErrors > 0 ? 'bg-red-500/10 text-red-500' : 'bg-slate-500/10 text-slate-500'}`}>
            <span className="material-symbols-outlined text-[30px]">{totalErrors > 0 ? 'warning' : 'check_circle'}</span>
          </div>
          <div>
            <p className="text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">Erreurs</p>
            <h4 className="text-headline-lg font-display-lg font-bold text-on-surface">{totalErrors}</h4>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        {/* Left column: documents & testing RAG */}
        <div className="xl:col-span-2 flex flex-col gap-lg">
          
          {/* Documents index panel */}
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow overflow-hidden flex flex-col">
            <div className="p-md border-b border-outline-variant/60 flex flex-col md:flex-row md:items-center justify-between gap-sm">
              <h3 className="font-headline-sm text-headline-sm text-on-background font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">menu_book</span>
                Index documentaire
              </h3>
              <div className="relative max-w-xs w-full">
                <input
                  type="text"
                  placeholder="Rechercher localement..."
                  value={localFilter}
                  onChange={(e) => setLocalFilter(e.target.value)}
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl pl-9 pr-3.5 py-1.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                />
                <span className="material-symbols-outlined text-on-surface-variant text-[18px] absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                    <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-10"></th>
                    <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Titre / Métadonnées</th>
                    <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Catégorie</th>
                    <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-24">Fragments</th>
                    <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Statut</th>
                    {canManage && <th className="px-md py-3.5 w-20"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40 font-body-sm text-body-sm">
                  <AnimatePresence initial={false}>
                    {filteredDocuments.map((doc) => (
                      <motion.tr
                        key={doc.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="hover:bg-surface-container-low/40 transition-colors"
                      >
                        <td className="px-md py-4 text-on-surface-variant align-top">
                          <span className="material-symbols-outlined text-[20px] mt-0.5">{SOURCE_ICONS[doc.sourceType] || 'description'}</span>
                        </td>
                        <td className="px-md py-4 text-on-surface align-top">
                          <div className="font-semibold text-on-surface">{doc.title}</div>
                          {doc.filename && <div className="text-[11px] text-on-surface-variant font-mono mt-0.5">{doc.filename}</div>}
                          {doc.author && <div className="text-[11px] text-on-surface-variant mt-0.5 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">person</span> {doc.author}</div>}
                          
                          {/* Tags list */}
                          {doc.tags && doc.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {doc.tags.map((t, idx) => (
                                <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-surface-variant text-on-surface-variant border border-outline-variant/40 rounded">
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}

                          {doc.status === 'ERROR' && doc.error && (
                            <p className="font-body-sm text-body-sm text-error mt-xs bg-error/5 border border-error/10 px-2 py-1 rounded-lg w-fit">{doc.error}</p>
                          )}
                        </td>
                        <td className="px-md py-4 align-top">
                          {doc.category ? (
                            <span className={`badge border text-[10px] font-bold ${CATEGORY_COLORS[doc.category] || 'bg-slate-500/10 text-slate-600'}`}>
                              {doc.category}
                            </span>
                          ) : (
                            <span className="text-on-surface-variant italic text-[11px]">Aucune</span>
                          )}
                        </td>
                        <td className="px-md py-4 text-on-surface-variant font-mono align-top">{doc._count?.chunks ?? 0}</td>
                        <td className="px-md py-4 align-top">
                          <span className={`badge px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                            doc.status === 'READY' 
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' 
                              : doc.status === 'PROCESSING'
                              ? 'bg-primary/10 text-primary border-primary/20 animate-pulse'
                              : 'bg-error/10 text-error border-error/20'
                          }`}>
                            {STATUS_LABELS[doc.status] || doc.status}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-md py-4 text-right align-top">
                            <div className="flex items-center justify-end gap-sm">
                              <button
                                onClick={() => askReplace(doc)}
                                disabled={replacingId === doc.id}
                                title="Remplacer le fichier"
                                className="text-on-surface-variant hover:text-primary disabled:opacity-50 transition-colors p-1"
                              >
                                <span className="material-symbols-outlined text-[18px]">
                                  {replacingId === doc.id ? 'hourglass_empty' : 'upload_file'}
                                </span>
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(doc.id)}
                                title="Supprimer"
                                className="text-on-surface-variant hover:text-error transition-colors p-1"
                              >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            </div>
                          </td>
                        )}
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                  {filteredDocuments.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 6 : 5} className="px-md py-12 text-center text-on-surface-variant italic font-body-md">
                        Aucun document trouvé.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Test RAG Search Box */}
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow p-lg flex flex-col gap-md">
            <div className="border-b border-outline-variant/40 pb-md">
              <div className="flex items-center justify-between">
                <h3 className="font-headline-sm text-headline-sm text-on-background font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">search</span>
                  Recherche test RAG
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSearchFilters(!showSearchFilters)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-xl border text-body-sm font-semibold transition-all ${
                    showSearchFilters 
                      ? 'bg-primary/10 text-primary border-primary/20' 
                      : 'hover:bg-surface-container-low text-on-surface-variant border-outline-variant/60'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">tune</span>
                  Filtres
                </button>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Interrogez sémantiquement la base de connaissances pour valider les fragments pertinents renvoyés par Gemini.
              </p>
            </div>

            {/* Advanced search filters panel */}
            <AnimatePresence>
              {showSearchFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden bg-surface-bright/50 border border-outline-variant/40 rounded-xl p-md flex flex-col gap-md"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    <label className="flex flex-col gap-xs">
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Filtrer par catégorie</span>
                      <select
                        className="bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        value={searchCategory}
                        onChange={(e) => setSearchCategory(e.target.value)}
                      >
                        <option value="">Toutes les catégories</option>
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-xs">
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Résultats maximum (limit: {searchLimit})</span>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        className="accent-primary h-2 w-full mt-3 cursor-pointer"
                        value={searchLimit}
                        onChange={(e) => setSearchLimit(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Filtrer par tags</span>
                    <input
                      type="text"
                      className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-1.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      placeholder="Ajouter un tag de filtre (Entrée)..."
                      value={searchTagInput}
                      onChange={(e) => setSearchTagInput(e.target.value)}
                      onKeyDown={handleAddSearchTag}
                    />
                    {searchTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {searchTags.map((tag, idx) => (
                          <span key={idx} className="badge bg-slate-500/10 text-slate-600 border-slate-500/20 py-0.5 px-2 text-[10px] lowercase flex items-center gap-1">
                            #{tag}
                            <button type="button" onClick={() => handleRemoveSearchTag(idx)} className="hover:opacity-85 text-[12px]"><span className="material-symbols-outlined text-[12px]">close</span></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer mt-1">
                    <input
                      type="checkbox"
                      checked={useHybrid}
                      onChange={(e) => setUseHybrid(e.target.checked)}
                      className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-body-sm text-body-sm text-on-surface font-semibold">Recherche hybride (sémantique + mots-clés)</span>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSearch} className="flex gap-3">
              <input
                className="flex-1 bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                placeholder="Ex: comment renouveler un certificat VPN ?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="submit"
                disabled={searching}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-body-sm flex items-center gap-1.5 shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">search</span>
                {searching ? 'Recherche...' : 'Rechercher'}
              </button>
            </form>

            {/* Results with interactive feedbacks */}
            {results && (
              <div className="flex flex-col gap-md mt-md">
                <AnimatePresence>
                  {results.map((r, index) => (
                    <motion.div
                      key={r.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: index * 0.05 }}
                      className="border border-outline-variant/60 bg-surface-container-low/30 rounded-2xl p-md hover:border-outline transition-colors duration-300 flex flex-col gap-sm"
                    >
                      <div className="flex items-center justify-between gap-sm border-b border-outline-variant/40 pb-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface font-bold">{r.title}</span>
                        <div className="flex items-center gap-2">
                          {r.category && (
                            <span className={`badge border text-[9px] font-bold ${CATEGORY_COLORS[r.category] || 'bg-slate-500/10 text-slate-600'}`}>
                              {r.category}
                            </span>
                          )}
                          <span className="font-mono-sm text-[10px] text-on-surface-variant bg-surface-container-low border border-outline-variant/40 px-2.5 py-0.5 rounded-full font-medium shadow-sm">
                            Score : {(r.combined_score * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      
                      <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed font-mono whitespace-pre-wrap select-all p-xs rounded-xl bg-surface-bright/50 border border-outline-variant/30">{r.content}</p>
                      
                      {/* Evaluation / Feedback Component */}
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-sm border-t border-outline-variant/30 pt-md mt-sm text-body-sm">
                        <span className="text-on-surface-variant font-medium flex items-center gap-1">
                          <span className="material-symbols-outlined text-[18px]">rate_review</span>
                          Évaluer la pertinence de ce fragment :
                        </span>
                        
                        {feedbackSent[r.id] ? (
                          <div className="flex items-center gap-1.5 text-emerald-500 font-semibold text-[13px] bg-emerald-500/5 px-3 py-1 rounded-xl border border-emerald-500/15">
                            <span className="material-symbols-outlined text-[16px]">check_circle</span>
                            Merci pour votre retour ! (
                            {feedbackSent[r.id] === 'VERY_RELEVANT' && 'Utile'}
                            {feedbackSent[r.id] === 'SOMEWHAT_RELEVANT' && 'Moyen'}
                            {feedbackSent[r.id] === 'NOT_RELEVANT' && 'Inutile'}
                            )
                          </div>
                        ) : (
                          <div className="flex items-center gap-md">
                            {/* Smiley buttons */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleFeedbackSubmit(r, 'VERY_RELEVANT')}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-outline-variant/60 hover:bg-emerald-500/10 hover:text-emerald-500 hover:border-emerald-500/20 text-on-surface-variant font-medium transition-all"
                                title="Très pertinent / Utile"
                              >
                                <span>👍</span>
                                <span className="hidden sm:inline">Utile</span>
                              </button>
                              <button
                                onClick={() => handleFeedbackSubmit(r, 'SOMEWHAT_RELEVANT')}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-outline-variant/60 hover:bg-amber-500/10 hover:text-amber-500 hover:border-amber-500/20 text-on-surface-variant font-medium transition-all"
                                title="Moyennement pertinent"
                              >
                                <span>😐</span>
                                <span className="hidden sm:inline">Moyen</span>
                              </button>
                              <button
                                onClick={() => handleFeedbackSubmit(r, 'NOT_RELEVANT')}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-outline-variant/60 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 text-on-surface-variant font-medium transition-all"
                                title="Non pertinent / Inutile"
                              >
                                <span>👎</span>
                                <span className="hidden sm:inline">Inutile</span>
                              </button>
                            </div>

                            {/* Optional comment button toggle */}
                            {activeCommentId !== r.id ? (
                              <button
                                onClick={() => setActiveCommentId(r.id)}
                                className="text-[12px] text-primary hover:underline font-semibold"
                              >
                                Ajouter un commentaire
                              </button>
                            ) : (
                              <div className="flex items-center gap-sm max-w-xs w-full">
                                <input
                                  type="text"
                                  placeholder="Pourquoi ?"
                                  value={feedbackComment[r.id] || ''}
                                  onChange={(e) => setFeedbackComment({ ...feedbackComment, [r.id]: e.target.value })}
                                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-2 py-1 text-xs text-on-surface focus:outline-none"
                                />
                                <button
                                  onClick={() => setActiveCommentId(null)}
                                  className="text-on-surface-variant hover:text-on-surface"
                                >
                                  <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {results.length === 0 && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant italic text-center p-md">Aucun fragment pertinent trouvé.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column: indexing / adding document (canManage) */}
        {canManage && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow p-lg flex flex-col gap-md h-fit relative overflow-hidden min-h-[460px]">
            <AnimatePresence mode="wait">
              {uploading ? (
                <motion.div
                  key="uploading"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col items-center justify-center py-6 text-center gap-6 h-full min-h-[380px]"
                >
                  <div className="relative flex items-center justify-center w-20 h-20">
                    <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <span className="material-symbols-outlined text-[32px] text-primary animate-pulse">
                      sync_saved_locally
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5 w-full">
                    <h4 className="font-headline-sm text-headline-sm text-on-background font-bold">
                      Indexation en cours
                    </h4>
                    <p className="text-body-sm text-on-surface-variant max-w-[280px] mx-auto">
                      Gemini découpe et analyse votre document pour la base vectorielle.
                    </p>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full max-w-[280px] flex flex-col gap-1.5 mt-2">
                    <div className="w-full bg-surface-variant/40 h-2.5 rounded-full overflow-hidden border border-outline-variant/30">
                      <div 
                        className="bg-gradient-to-r from-primary to-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-mono text-on-surface-variant px-0.5">
                      <span>
                        {progress < 20 
                          ? "Téléversement..." 
                          : progress < 45 
                          ? "Analyse & Extraction..." 
                          : progress < 85 
                          ? "Découpage & Vectorisation..." 
                          : "Stockage pgvector..."}
                      </span>
                      <span className="font-bold text-primary">{progress}%</span>
                    </div>
                  </div>

                  {/* Step-by-step Status List */}
                  <div className="flex flex-col gap-3 text-left w-full max-w-[260px] border-t border-outline-variant/30 pt-4 mt-2 font-body-sm text-body-sm">
                    <div className="flex items-center gap-3">
                      {progress >= 20 ? (
                        <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                      ) : (
                        <span className="material-symbols-outlined text-primary text-[18px] animate-spin">sync</span>
                      )}
                      <span className={progress >= 20 ? "text-on-surface-variant line-through opacity-70" : "text-on-surface font-semibold"}>
                        1. Téléversement du fichier
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {progress >= 45 ? (
                        <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                      ) : progress >= 20 ? (
                        <span className="material-symbols-outlined text-primary text-[18px] animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined text-on-surface-variant/40 text-[18px]">circle</span>
                      )}
                      <span className={progress >= 45 ? "text-on-surface-variant line-through opacity-70" : progress >= 20 ? "text-on-surface font-semibold" : "text-on-surface-variant/60"}>
                        2. Extraction & Analyse du texte
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {progress >= 85 ? (
                        <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                      ) : progress >= 45 ? (
                        <span className="material-symbols-outlined text-primary text-[18px] animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined text-on-surface-variant/40 text-[18px]">circle</span>
                      )}
                      <span className={progress >= 85 ? "text-on-surface-variant line-through opacity-70" : progress >= 45 ? "text-on-surface font-semibold" : "text-on-surface-variant/60"}>
                        3. Découpage & Vectorisation
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {progress >= 100 ? (
                        <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                      ) : progress >= 85 ? (
                        <span className="material-symbols-outlined text-primary text-[18px] animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined text-on-surface-variant/40 text-[18px]">circle</span>
                      )}
                      <span className={progress >= 100 ? "text-on-surface-variant line-through opacity-70" : progress >= 85 ? "text-on-surface font-semibold" : "text-on-surface-variant/60"}>
                        4. Indexation pgvector
                      </span>
                    </div>
                  </div>
                </motion.div>
              ) : success ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 100 }}
                  className="flex flex-col items-center justify-center py-6 text-center gap-md h-full min-h-[380px]"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.15, damping: 10 }}
                    className="w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                  >
                    <motion.span 
                      initial={{ scale: 0.5, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 10, delay: 0.25 }}
                      className="material-symbols-outlined text-[48px]"
                    >
                      check_circle
                    </motion.span>
                  </motion.div>

                  <div className="flex flex-col gap-1.5 px-4 mt-2">
                    <h4 className="font-headline-sm text-headline-sm text-on-background font-bold">
                      Document indexé !
                    </h4>
                    <p className="text-body-sm text-on-surface-variant max-w-[280px] mx-auto leading-relaxed">
                      Le document a été découpé et rendu disponible pour la recherche sémantique avec succès.
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col gap-md"
                >
                  <div className="border-b border-outline-variant/40 pb-md">
                    <h3 className="font-headline-sm text-headline-sm text-on-background font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">add_circle</span>
                      Ajouter un document
                    </h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 leading-relaxed">
                      Importez et découpez de nouveaux documents pour enrichir les connaissances de l'IA.
                    </p>
                  </div>
                  
                  <form onSubmit={handleUpload} className="flex flex-col gap-md">
                    
                    {/* Drag and Drop Zone */}
                    <motion.div
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => document.getElementById('kb-file-input').click()}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      animate={dragActive ? { scale: 0.98 } : { scale: 1 }}
                      className={`cursor-pointer border-2 border-dashed rounded-2xl p-md text-center transition-all min-h-[140px] flex flex-col items-center justify-center gap-xs ${
                        dragActive 
                          ? 'border-primary bg-primary/5 text-primary' 
                          : file 
                          ? 'border-emerald-500/40 bg-emerald-500/5 text-on-surface' 
                          : 'border-outline-variant/60 hover:bg-surface-container-low text-on-surface-variant'
                      }`}
                    >
                      <input
                        id="kb-file-input"
                        type="file"
                        accept=".pdf,.docx,.md,.markdown,.txt"
                        onChange={(e) => {
                          const chosen = e.target.files?.[0] || null;
                          setFile(chosen);
                          if (chosen && !title) {
                            setTitle(chosen.name.substring(0, chosen.name.lastIndexOf('.')) || chosen.name);
                          }
                        }}
                        className="hidden"
                      />
                      
                      <span className={`material-symbols-outlined text-[36px] ${file ? 'text-emerald-500' : 'text-primary'}`}>
                        {file ? 'check_circle' : 'cloud_upload'}
                      </span>
                      
                      {file ? (
                        <div className="flex flex-col gap-1 w-full max-w-[200px] overflow-hidden">
                          <p className="text-[12px] font-bold text-emerald-500 truncate" title={file.name}>{file.name}</p>
                          <p className="text-[10px] text-on-surface-variant">{(file.size / 1024).toFixed(1)} KB</p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFile(null);
                              setTitle('');
                            }}
                            className="text-[10px] text-red-500 font-semibold hover:underline mt-1"
                          >
                            Supprimer
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-body-sm font-semibold text-on-surface">Déposez votre fichier ici</p>
                          <p className="text-[10px] text-on-surface-variant mt-0.5">ou cliquez pour parcourir</p>
                          <p className="text-[9px] text-on-surface-variant font-medium uppercase mt-2">PDF, DOCX, Markdown, TXT</p>
                        </>
                      )}
                    </motion.div>

                    <label className="flex flex-col gap-xs">
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Titre de l'index</span>
                      <input
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Nom affiché dans la base"
                        required
                      />
                    </label>

                    <label className="flex flex-col gap-xs">
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Catégorie</span>
                      <select
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="">Aucune catégorie</option>
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </label>

                    <div className="flex flex-col gap-xs">
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Tags (mots-clés RAG)</span>
                      <input
                        type="text"
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                        placeholder="Ajouter un tag (Entrée)..."
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleAddTag}
                      />
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {tags.map((tag, idx) => (
                            <span key={idx} className="badge bg-primary/10 text-primary border-primary/20 py-0.5 px-2 text-[10px] lowercase flex items-center gap-1">
                              #{tag}
                              <button type="button" onClick={() => handleRemoveTag(idx)} className="hover:opacity-85 text-[12px]"><span className="material-symbols-outlined text-[12px]">close</span></button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <label className="flex flex-col gap-xs">
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Auteur</span>
                      <input
                        className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        placeholder="Auteur du document"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={uploading || !file}
                      className="w-full bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-body-sm flex items-center justify-center gap-1.5 mt-2"
                    >
                      <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
                      {uploading ? 'Indexation en cours...' : 'Indexer le document'}
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown,.txt"
        onChange={handleReplaceFileChosen}
        className="hidden"
      />

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Supprimer ce document"
        message="Le document et tous ses fragments indexés seront supprimés définitivement de la base de connaissances. Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
