import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUS_LABELS = {
  PROCESSING: 'Traitement...',
  READY: 'Prêt',
  ERROR: 'Erreur',
};

const SOURCE_ICONS = {
  pdf: 'picture_as_pdf',
  docx: 'description',
  markdown: 'article',
  article: 'lightbulb',
};

export default function KnowledgeBase() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'knowledge.manage');
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

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

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setError('');
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);

    try {
      await api.post('/knowledge/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setTitle('');
      setFile(null);
      e.target.reset();
      load();
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
    try {
      const { data } = await api.post('/knowledge/search', { query });
      setResults(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la recherche');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-display-lg text-display-lg text-on-background font-bold">Base de connaissances</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
          Documents indexés pour la recherche sémantique (RAG).
        </p>
      </header>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <div className="xl:col-span-2 flex flex-col gap-lg">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                  <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-10"></th>
                  <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Titre</th>
                  <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Type</th>
                  <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-24">Fragments</th>
                  <th className="px-md py-3.5 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Statut</th>
                  {canManage && <th className="px-md py-3.5 w-20"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40 font-body-sm text-body-sm">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="px-md py-3 text-on-surface-variant">
                      <span className="material-symbols-outlined text-[18px]">{SOURCE_ICONS[doc.sourceType] || 'description'}</span>
                    </td>
                    <td className="px-md py-3 text-on-surface font-semibold">
                      {doc.title}
                      {doc.status === 'ERROR' && doc.error && (
                        <p className="font-body-sm text-body-sm text-error mt-xs bg-error/5 border border-error/10 px-2 py-1 rounded-lg w-fit">{doc.error}</p>
                      )}
                    </td>
                    <td className="px-md py-3 text-on-surface-variant font-medium uppercase">{doc.sourceType}</td>
                    <td className="px-md py-3 text-on-surface-variant font-mono">{doc._count?.chunks ?? 0}</td>
                    <td className="px-md py-3">
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
                      <td className="px-md py-3 text-right">
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
                  </tr>
                ))}
                {documents.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 6 : 5} className="px-md py-12 text-center text-on-surface-variant italic font-body-md">
                      Aucun document indexé dans la base de connaissances.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow p-lg">
            <div className="border-b border-outline-variant/40 pb-md mb-md">
              <h3 className="font-headline-md text-headline-md text-on-background font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">search</span>
                Rechercher (test RAG)
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Interrogez sémantiquement la base de connaissances pour valider les fragments pertinents renvoyés par Gemini.
              </p>
            </div>
            <form onSubmit={handleSearch} className="flex gap-3 mb-md">
              <input
                className="flex-1 bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                placeholder="Ex: comment renouveler un certificat VPN ?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="submit"
                disabled={searching}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-body-sm flex items-center gap-1 shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">search</span>
                {searching ? 'Recherche...' : 'Rechercher'}
              </button>
            </form>

            {results && (
              <div className="flex flex-col gap-sm">
                {results.map((r) => (
                  <div key={r.id} className="border border-outline-variant/60 bg-surface-container-low/30 rounded-xl p-md hover:border-outline transition-colors duration-300">
                    <div className="flex items-center justify-between gap-sm mb-2">
                      <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">{r.title}</span>
                      <span className="font-mono-sm text-[10px] text-on-surface-variant bg-surface-container-low border border-outline-variant/40 px-2.5 py-0.5 rounded-full font-medium shadow-sm">
                        Score : {(r.similarity * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">{r.content}</p>
                  </div>
                ))}
                {results.length === 0 && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant italic">Aucun fragment pertinent trouvé.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {canManage && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 card-shadow p-lg flex flex-col gap-md h-fit">
            <div className="border-b border-outline-variant/40 pb-md">
              <h3 className="font-headline-md text-headline-md text-on-background font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">add_circle</span>
                Ajouter un document
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5 leading-relaxed">
                Importez et découpez de nouveaux documents pour enrichir les connaissances de l'IA.
              </p>
            </div>
            <form onSubmit={handleUpload} className="flex flex-col gap-md">
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Titre (optionnel)</span>
                <input
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nom affiché du document"
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Fichier (PDF, DOCX, Markdown, TXT)</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.md,.markdown,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="font-body-sm text-body-sm text-on-surface-variant w-full file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 transition-all cursor-pointer mt-1"
                  required
                />
              </label>
              <button
                type="submit"
                disabled={uploading}
                className="w-full bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold py-2.5 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-body-sm flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
                {uploading ? 'Indexation en cours...' : 'Indexer le document'}
              </button>
            </form>
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
