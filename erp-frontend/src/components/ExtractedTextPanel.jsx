import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, ScanText, AlertTriangle, Clock } from 'lucide-react';
import api from '../api/client';
import copyText from '../utils/copyText';
import AttachmentIndexBadge, { canReindex } from './AttachmentIndexBadge';

// ── Texte extrait d'une pièce jointe (document ou OCR Vision) ────────────────
// C'est exactement le contenu envoyé au chatbot : il permet de vérifier qu'un
// scan ou une capture d'écran a bien été lu avant de se fier à une réponse.
// Chargé à la demande (le contenu n'est pas inclus dans la réponse du ticket).
export default function ExtractedTextPanel({
  ticketId,
  attachment,
  onReindex,
  reindexing = false,
}) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    api
      .get(`/tickets/${ticketId}/attachments/${attachment.id}/text`)
      .then(({ data }) => { if (!cancelled) setState({ loading: false, data, error: null }); })
      .catch((err) => {
        if (!cancelled) {
          setState({ loading: false, data: null, error: err.response?.data?.error || 'Texte indisponible' });
        }
      });
    return () => { cancelled = true; };
  }, [ticketId, attachment.id, attachment.extractedAt, attachment.extractionStatus]);

  const text = state.data?.extractedText;
  const status = state.data?.extractionStatus || attachment.extractionStatus;

  async function handleCopy() {
    if (!text) return;
    if (await copyText(text)) toast.success('Texte extrait copié');
    else toast.error('Erreur de copie');
  }

  if (state.loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-8 text-on-surface-variant">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-xs font-medium">Chargement du texte extrait…</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-8 text-on-surface-variant">
        <AlertTriangle className="w-6 h-6 text-red-500" />
        <p className="text-xs font-medium">{state.error}</p>
      </div>
    );
  }

  if (!text) {
    const pending = status === 'PENDING' || status === 'PROCESSING';
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        {pending ? <Clock className="w-6 h-6 text-amber-500" /> : <ScanText className="w-6 h-6 text-on-surface-variant" />}
        <p className="text-xs font-semibold text-on-surface">
          {pending ? 'Extraction en cours' : 'Aucun texte extrait'}
        </p>
        <p className="text-[11px] text-on-surface-variant max-w-sm leading-relaxed">
          {pending
            ? 'Le fichier est en file d\'attente : le contenu apparaîtra ici une fois le texte (ou l\'OCR) terminé.'
            : state.data?.extractionError
              || 'Aucun contenu exploitable dans cette pièce jointe : elle n\'alimente pas les réponses du chatbot.'}
        </p>
        {canReindex(status) && onReindex && (
          <button
            type="button"
            onClick={onReindex}
            disabled={reindexing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant/50 bg-surface text-[11px] font-bold text-on-surface hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50 cursor-pointer"
          >
            <ScanText className={`w-3.5 h-3.5 ${reindexing ? 'animate-spin' : ''}`} />
            Relancer l'extraction
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-surface-container-low/40">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-outline-variant/30 bg-surface shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ScanText className="w-4 h-4 text-primary shrink-0" />
          <p className="text-[11px] font-bold text-on-surface truncate">Texte extrait</p>
          <AttachmentIndexBadge status={status} error={state.data?.extractionError} compact />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-medium text-on-surface-variant hidden sm:inline">
            {text.length.toLocaleString('fr-FR')} caractères
          </span>
          <button
            type="button"
            onClick={handleCopy}
            title="Copier le texte extrait"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-outline-variant/40 bg-surface text-[10px] font-bold text-on-surface-variant hover:text-primary hover:border-primary/40 transition-colors cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            Copier
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="text-xs font-mono text-on-surface whitespace-pre-wrap break-words leading-relaxed bg-surface border border-outline-variant/30 rounded-xl p-4 min-h-[180px] shadow-inner">
          {text}
        </pre>
      </div>
    </div>
  );
}
