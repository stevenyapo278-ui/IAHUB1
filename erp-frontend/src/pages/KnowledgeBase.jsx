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
        <h2 className="font-display-lg text-display-lg text-on-background">Base de connaissances</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">
          Documents indexés pour la recherche sémantique (RAG).
        </p>
      </header>

      {error && (
        <div className="border border-outline-variant text-on-surface p-md rounded-none">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg">
        <div className="xl:col-span-2 flex flex-col gap-lg">
          <div className="bg-surface-container-lowest rounded-none border border-outline-variant overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-bright border-b border-outline-variant">
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-10"></th>
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Titre</th>
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Type</th>
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-24">Fragments</th>
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider w-32">Statut</th>
                  {canManage && <th className="px-md py-3 w-12"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant font-body-sm text-body-sm">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-md py-3 text-on-surface-variant">
                      <span className="material-symbols-outlined text-[18px]">{SOURCE_ICONS[doc.sourceType] || 'description'}</span>
                    </td>
                    <td className="px-md py-3 text-on-surface font-medium">
                      {doc.title}
                      {doc.status === 'ERROR' && doc.error && (
                        <p className="font-body-sm text-body-sm text-error mt-xs">{doc.error}</p>
                      )}
                    </td>
                    <td className="px-md py-3 text-on-surface-variant uppercase">{doc.sourceType}</td>
                    <td className="px-md py-3 text-on-surface-variant">{doc._count?.chunks ?? 0}</td>
                    <td className="px-md py-3">
                      <span className="inline-flex items-center px-2.5 py-1 border border-outline-variant text-on-surface text-[11px] font-medium">
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
                            className="text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {replacingId === doc.id ? 'hourglass_empty' : 'upload_file'}
                            </span>
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(doc.id)}
                            title="Supprimer"
                            className="text-on-surface-variant hover:text-on-surface"
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
                    <td colSpan={canManage ? 6 : 5} className="px-md py-8 text-center text-on-surface-variant">
                      Aucun document indexé.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-surface-container-lowest rounded-none border border-outline-variant p-lg">
            <h3 className="font-headline-md text-headline-md text-on-background mb-md">Rechercher (test RAG)</h3>
            <form onSubmit={handleSearch} className="flex gap-sm mb-md">
              <input
                className="flex-1 h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                placeholder="Ex: comment renouveler un certificat VPN ?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="submit"
                disabled={searching}
                className="px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all disabled:opacity-60"
              >
                {searching ? 'Recherche...' : 'Rechercher'}
              </button>
            </form>

            {results && (
              <div className="flex flex-col gap-sm">
                {results.map((r) => (
                  <div key={r.id} className="border border-outline-variant p-sm">
                    <div className="flex items-center justify-between gap-sm mb-xs">
                      <span className="font-label-md text-label-md text-on-surface uppercase">{r.title}</span>
                      <span className="font-body-sm text-body-sm text-on-surface-variant">
                        {(r.similarity * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">{r.content}</p>
                  </div>
                ))}
                {results.length === 0 && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Aucun résultat pertinent.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {canManage && (
          <div className="bg-surface-container-lowest rounded-none border border-outline-variant p-lg flex flex-col gap-md h-fit">
            <h3 className="font-headline-md text-headline-md text-on-background">Ajouter un document</h3>
            <form onSubmit={handleUpload} className="flex flex-col gap-md">
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Titre (optionnel)</span>
                <input
                  className="h-10 px-sm rounded-none border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:outline-none focus:border-on-surface"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nom affiché du document"
                />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface uppercase">Fichier (PDF, DOCX, Markdown)</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.md,.markdown,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="font-body-sm text-body-sm text-on-surface-variant"
                  required
                />
              </label>
              <button
                type="submit"
                disabled={uploading}
                className="px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all disabled:opacity-60"
              >
                {uploading ? 'Indexation en cours...' : 'Indexer'}
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
