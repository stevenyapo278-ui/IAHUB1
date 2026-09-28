import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { revokeImageItem } from '../utils/imageAttachments';

// ─── Éditeur d'images jointes partagé ────────────────────────────────────────
// Un seul composant pour tous les champs « texte + image » : création de suivi,
// édition d'un suivi existant, édition de la description du ticket, création de
// ticket et commentaire de l'espace demandeur.
//
// Props :
//   items    [{ id, url, file?, filename? }] — voir utils/imageAttachments.js
//   onChange (items)  appelé à la suppression d'une vignette
//   onFiles  (files)  appelé à l'ajout (bouton, glisser-déposer) — le parent
//            décide : garder en local ou téléverser tout de suite
//   disabled lecture seule (aucun ajout ni suppression)
//
// Ajout : bouton « Image », glisser-déposer, ou Ctrl+V (le collage se fait sur
// le textarea parent → clipboardImageFiles + onFiles).
export default function ImageAttachmentsEditor({ items = [], onChange, onFiles, disabled = false }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f?.type?.startsWith('image/'));
    if (files.length === 0) return;
    onFiles?.(files);
  }

  function removeItem(id) {
    const target = items.find((i) => i.id === id);
    revokeImageItem(target);
    onChange?.(items.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div key={item.id} className="relative group/img">
              <img
                src={item.url}
                alt={item.filename || 'image jointe'}
                title={item.filename || 'image jointe'}
                data-editor-thumb="true"
                className="h-16 w-16 object-cover rounded-lg border border-outline-variant/40 bg-surface shadow-sm"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  title="Retirer l'image"
                  aria-label="Retirer l'image"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md opacity-0 group-hover/img:opacity-100 hover:scale-110 transition-all cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer?.files);
          }}
          className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-dashed transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-outline-variant/40 bg-surface-container/40'
          }`}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-outline-variant/40 bg-surface text-[11px] font-semibold text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            Image
          </button>
          <span className="text-[10px] text-on-surface-variant">
            glisser-déposer, ou <kbd className="px-1 py-0.5 bg-surface border border-outline-variant/40 rounded text-[9px] font-mono">Ctrl+V</kbd>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}
    </div>
  );
}
