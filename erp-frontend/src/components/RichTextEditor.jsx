import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  Quote, Link2, Unlink, Undo2, Redo2, Baseline, Eraser,
} from 'lucide-react';
import { richTextIsEmpty } from '../utils/sanitize';

// Tabulation du clavier : 4 espaces insécables (le focus reste dans l'éditeur)
const TAB_SPACES = '\u00a0\u00a0\u00a0\u00a0';

const TEXT_COLORS = [
  { color: '#0f172a', label: 'Encre' },
  { color: '#dc2626', label: 'Rouge' },
  { color: '#2563eb', label: 'Bleu' },
  { color: '#059669', label: 'Vert' },
  { color: '#7c3aed', label: 'Violet' },
  { color: '#d97706', label: 'Orange' },
];

// Extensions mémoisées hors composant (évite les doublons à chaque rendu).
// Image ne gère ni le collage ni le glisser-déposer de fichiers (ces cas restent
// portés par ImageAttachmentsEditor) : elle sert uniquement à restituer les
// <img> déjà présents lors de l'édition d'un suivi existant.
const EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: false, horizontalRule: false }),
  Image.configure({ allowBase64: false, inline: false }),
  TextStyle,
  Color.configure({ types: ['textStyle'] }),
];

function ToolBtn({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      aria-label={title}
      className={`flex items-center justify-center w-7 h-7 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors cursor-pointer ${
        active ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : ''
      }`}
    >
      {children}
    </button>
  );
}

// Éditeur riche compact (TipTap) — suivi des tickets, édition de commentaires.
// Contenu en HTML : retours à la ligne, tabulations, gras/italique/couleur conservés.
export default function RichTextEditor({
  value = '',
  onChange,
  onSubmit,
  onEscape,
  onKeyDown,
  onPasteFiles,
  onActivity,
  onEditorReady,
  placeholder = '',
  minHeight = 160,
  autoFocus = false,
  className = '',
}) {
  // Handlers toujours à jour sans recréer editorProps (closures stables).
  // Écrit dans un effet : une écriture de ref pendant le rendu est interdite.
  const handlersRef = useRef({ onChange, onSubmit, onEscape, onKeyDown, onPasteFiles, onActivity });
  useEffect(() => {
    handlersRef.current = { onChange, onSubmit, onEscape, onKeyDown, onPasteFiles, onActivity };
  });

  const lastExternalValue = useRef(null);
  const containerRef = useRef(null);
  const [, setTick] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: value || '<p></p>',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'rte-content' },
      handleKeyDown: (view, event) => {
        const h = handlersRef.current;
        if (h.onKeyDown && h.onKeyDown(event)) return true;
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          if (h.onSubmit) h.onSubmit();
          return true;
        }
        if (event.key === 'Escape') {
          if (h.onEscape) h.onEscape();
          return false;
        }
        if (event.key === 'Tab' && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          view.dispatch(view.state.tr.insertText(TAB_SPACES).scrollIntoView());
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        paste: (view, event) => {
          const h = handlersRef.current;
          return !!(h.onPasteFiles && h.onPasteFiles(event));
        },
      },
    },
    onCreate: ({ editor: ed }) => { if (onEditorReady) onEditorReady(ed); },
    onUpdate: ({ editor: ed }) => {
      const h = handlersRef.current;
      if (h.onChange) h.onChange(ed.getHTML());
      if (h.onActivity) h.onActivity(ed);
      setTick((t) => t + 1);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const h = handlersRef.current;
      if (h.onActivity) h.onActivity(ed);
      setTick((t) => t + 1);
    },
    onTransaction: () => setTick((t) => t + 1),
  });

  // Resynchronisation quand la valeur change de l'extérieur (reset après envoi,
  // pré-remplissage pour l'édition, retrait d'une mention depuis les chips)
  useEffect(() => {
    if (!editor) return undefined;
    const next = value || '<p></p>';
    if (lastExternalValue.current === next) return undefined;
    const current = editor.getHTML();
    if (current === next) {
      lastExternalValue.current = next;
      return undefined;
    }
    const timeout = setTimeout(() => {
      if (editor.getHTML() !== next) editor.commands.setContent(next, { emitUpdate: false });
      lastExternalValue.current = next;
    }, 0);
    return () => clearTimeout(timeout);
  }, [value, editor]);

  // Fermer la palette de couleurs au clic extérieur
  useEffect(() => {
    if (!colorOpen) return undefined;
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setColorOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [colorOpen]);

  if (!editor) return <div className={`rounded-xl border border-outline-variant/40 bg-surface ${className}`} style={{ minHeight }} />;

  const run = (fn) => { editor.chain().focus()[fn]().run(); setTick((t) => t + 1); };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col rounded-xl border border-outline-variant/40 bg-surface overflow-visible focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all ${className}`}
      style={{ '--rte-min': `${minHeight}px` }}
    >
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1.5 border-b border-outline-variant/30 bg-surface-container-low/60 rounded-t-xl">
        <ToolBtn title="Gras (Ctrl+B)" active={editor.isActive('bold')} onClick={() => run('toggleBold')}>
          <Bold className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Italique (Ctrl+I)" active={editor.isActive('italic')} onClick={() => run('toggleItalic')}>
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Souligné (Ctrl+U)" active={editor.isActive('underline')} onClick={() => run('toggleUnderline')}>
          <UnderlineIcon className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Barré" active={editor.isActive('strike')} onClick={() => run('toggleStrike')}>
          <Strikethrough className="w-3.5 h-3.5" />
        </ToolBtn>

        <span className="w-px h-4 bg-outline-variant/40 mx-1" aria-hidden />

        {/* Couleur du texte */}
        <div className="relative">
          <ToolBtn title="Couleur du texte" active={colorOpen || editor.isActive('textStyle')} onClick={() => setColorOpen((o) => !o)}>
            <Baseline className="w-3.5 h-3.5" />
          </ToolBtn>
          {colorOpen && (
            <div className="absolute left-0 top-full mt-1 z-30 w-48 rounded-xl border border-outline-variant/40 bg-surface shadow-lg p-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant px-1 mb-1.5">Couleur du texte</p>
              <div className="grid grid-cols-6 gap-1.5 mb-2">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.color}
                    type="button"
                    title={c.label}
                    aria-label={c.label}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c.color).run(); setColorOpen(false); setTick((t) => t + 1); }}
                    className="w-6 h-6 rounded-md border border-outline-variant/50 hover:scale-110 transition-transform cursor-pointer"
                    style={{ backgroundColor: c.color }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 px-1">
                <input
                  type="color"
                  defaultValue="#e11d48"
                  aria-label="Couleur personnalisée"
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => { editor.chain().focus().setColor(e.target.value).run(); }}
                  className="w-7 h-6 rounded cursor-pointer border border-outline-variant/40 bg-surface p-0"
                />
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setColorOpen(false); setTick((t) => t + 1); }}
                  className="text-[11px] font-semibold text-on-surface-variant hover:text-on-surface cursor-pointer"
                >
                  Couleur par défaut
                </button>
              </div>
            </div>
          )}
        </div>

        <span className="w-px h-4 bg-outline-variant/40 mx-1" aria-hidden />

        <ToolBtn title="Liste à puces" active={editor.isActive('bulletList')} onClick={() => run('toggleBulletList')}>
          <List className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Liste numérotée" active={editor.isActive('orderedList')} onClick={() => run('toggleOrderedList')}>
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Citation" active={editor.isActive('blockquote')} onClick={() => run('toggleBlockquote')}>
          <Quote className="w-3.5 h-3.5" />
        </ToolBtn>

        <span className="w-px h-4 bg-outline-variant/40 mx-1" aria-hidden />

        <ToolBtn
          title="Lien"
          active={editor.isActive('link')}
          onClick={() => {
            if (editor.isActive('link')) { run('unsetLink'); return; }
            const url = window.prompt('Adresse du lien', 'https://');
            if (url && url.trim() && url !== 'https://') {
              editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
              setTick((t) => t + 1);
            }
          }}
        >
          <Link2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Retirer le lien" onClick={() => run('unsetLink')}>
          <Unlink className="w-3.5 h-3.5" />
        </ToolBtn>

        <span className="w-px h-4 bg-outline-variant/40 mx-1" aria-hidden />

        <ToolBtn title="Annuler (Ctrl+Z)" onClick={() => run('undo')}>
          <Undo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Rétablir (Ctrl+Y)" onClick={() => run('redo')}>
          <Redo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Effacer la mise en forme" onClick={() => { editor.chain().focus().clearNodes().unsetAllMarks().run(); setTick((t) => t + 1); }}>
          <Eraser className="w-3.5 h-3.5" />
        </ToolBtn>

        <span className="ml-auto pr-1 text-[9px] font-semibold text-on-surface-variant/60 hidden sm:inline">
          Ctrl+Entrée pour envoyer
        </span>
      </div>

      {/* Zone de saisie */}
      <div className="relative flex-1">
        <EditorContent editor={editor} />
        {richTextIsEmpty(value) && (
          <div className="pointer-events-none absolute left-4 top-3 text-sm text-on-surface-variant/40 select-none">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}
