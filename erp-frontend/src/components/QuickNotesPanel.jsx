import { useEffect, useState, useCallback } from 'react';
import { StickyNote, Plus, X, Search, ArrowLeft, Trash2 } from 'lucide-react';
import api from '../api/client';

// ═══════ même grammaire visuelle que SystemPulse.jsx ═══════════════════════════
// « Mes notes » : notes personnelles (GET/POST/PUT/DELETE /api/notes, scopées côté
// serveur sur l'utilisateur connecté). Le fetch, l'ancrage et la fermeture sont
// pilotés par FloatingDock.jsx, qui possède aussi le bouton du rail.
// Vue pure = liste ↔ éditeur, sauvegarde explicite (pas d'autosave).

function dateLabel(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function excerpt(content) {
  const text = (content || '').replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

export default function QuickNotesPanel({ style, onClose }) {
  const [notes, setNotes] = useState(null); // null = chargement en cours
  const [selected, setSelected] = useState(null); // id | 'new' | null (liste)
  const [draft, setDraft] = useState({ title: '', content: '' });
  const [initial, setInitial] = useState({ title: '', content: '' });
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => api
    .get('/notes')
    .then(({ data }) => { setNotes(data); setError(''); })
    .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement')), []);

  useEffect(() => { load(); }, [load]);

  const dirty = draft.title !== initial.title || draft.content !== initial.content;

  // Brouillon non enregistré : confirmation avant de changer de vue.
  function confirmDiscard() {
    if (!dirty) return true;
    return window.confirm('Quitter sans enregistrer les modifications ?');
  }

  function openNote(note) {
    if (!confirmDiscard()) return;
    setSelected(note.id);
    setDraft({ title: note.title || '', content: note.content || '' });
    setInitial({ title: note.title || '', content: note.content || '' });
    setError('');
  }

  function startNew() {
    if (!confirmDiscard()) return;
    setSelected('new');
    setDraft({ title: '', content: '' });
    setInitial({ title: '', content: '' });
    setError('');
  }

  function backToList() {
    if (!confirmDiscard()) return;
    setSelected(null);
    setError('');
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const payload = { title: draft.title, content: draft.content };
      const { data } = selected === 'new'
        ? await api.post('/notes', payload)
        : await api.put(`/notes/${selected}`, payload);
      await load();
      setSelected(data.id);
      setInitial({ title: data.title || '', content: data.content || '' });
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Supprimer cette note ?')) return;
    setSaving(true);
    setError('');
    try {
      await api.delete(`/notes/${selected}`);
      await load();
      setSelected(null);
      setDraft({ title: '', content: '' });
      setInitial({ title: '', content: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setSaving(false);
    }
  }

  const filtered = (notes || []).filter((n) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q);
  });

  const editing = selected !== null;

  return (
    <aside
      id="quick-notes-panel"
      aria-label="Mes notes"
      style={style}
      className="hidden md:flex fixed z-40 w-[336px] max-w-[85vw] flex-col
        rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl overflow-hidden"
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant bg-surface-container-low">
        <StickyNote className="w-4 h-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold flex-1 truncate">
          {editing ? (selected === 'new' ? 'Nouvelle note' : 'Modifier la note') : 'Mes notes'}
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={startNew}
            title="Nouvelle note"
            className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Fermer"
          className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {error && (
        <div className="px-4 py-2 text-xs text-red-500 border-b border-outline-variant bg-red-500/5">
          {error}
        </div>
      )}

      {notes === null ? (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
        </div>
      ) : editing ? (
        /* ── Éditeur ─────────────────────────────────────────────────────── */
        <div className="flex flex-col gap-3 p-4 overflow-auto" style={{ minHeight: 240 }}>
          <button
            type="button"
            onClick={backToList}
            className="self-start flex items-center gap-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour à la liste
          </button>

          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Titre de la note"
            maxLength={120}
            autoFocus={selected === 'new'}
            className="w-full px-3 py-2 rounded-xl bg-surface border border-outline-variant/60
              text-sm font-semibold text-on-surface placeholder:text-on-surface-variant/40
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />

          <textarea
            value={draft.content}
            onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            placeholder="Écrivez votre note…"
            maxLength={10000}
            rows={9}
            className="w-full px-3 py-2 rounded-xl bg-surface border border-outline-variant/60
              text-sm text-on-surface placeholder:text-on-surface-variant/40 resize-y
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="px-3.5 py-1.5 btn-gradient text-xs font-semibold rounded-xl shadow-md shadow-primary/10
                hover:shadow-lg transition-all disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            {selected !== 'new' && (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="p-1.5 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/5
                  transition-colors disabled:opacity-50"
                title="Supprimer la note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {dirty && !saving && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                Modifications non enregistrées
              </span>
            )}
          </div>
        </div>
      ) : (
        /* ── Liste ───────────────────────────────────────────────────────── */
        <>
          {notes.length > 0 && (
            <div className="px-4 pt-3 pb-2 border-b border-outline-variant/50">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher dans mes notes…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-surface border border-outline-variant/60
                    text-xs text-on-surface placeholder:text-on-surface-variant/40
                    focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto" style={{ maxHeight: 340 }}>
            {notes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
                <StickyNote className="w-7 h-7 text-on-surface-variant/40" />
                <p className="text-xs text-on-surface-variant">
                  Aucune note pour le moment.<br />Vos notes sont personnelles et accessibles sur tous vos postes.
                </p>
                <button
                  type="button"
                  onClick={startNew}
                  className="mt-1 px-3.5 py-1.5 btn-gradient text-xs font-semibold rounded-xl shadow-md shadow-primary/10"
                >
                  Créer ma première note
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-on-surface-variant text-center py-6">Aucun résultat pour « {query} ».</p>
            ) : (
              <ul className="divide-y divide-outline-variant/40">
                {filtered.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => openNote(note)}
                      className="w-full text-left px-4 py-3 hover:bg-surface-container-low transition-colors"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-on-surface truncate flex-1">
                          {note.title || '(sans titre)'}
                        </span>
                        <span className="text-[10px] text-on-surface-variant/70 shrink-0">
                          {dateLabel(note.updatedAt)}
                        </span>
                      </div>
                      {note.content && (
                        <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">{excerpt(note.content)}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
