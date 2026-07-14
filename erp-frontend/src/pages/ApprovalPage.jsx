import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

// Client axios séparé de api/client.js : cette page est publique (accessible via un lien
// email sans login), elle ne doit jamais envoyer le token JWT de session ni être redirigée
// vers /login par l'intercepteur 401 global.
const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

export default function ApprovalPage() {
  const { token } = useParams();
  const [draft, setDraft] = useState(null);
  const [editedContent, setEditedContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null); // 'approved' | 'rejected'
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectNote, setShowRejectNote] = useState(false);

  useEffect(() => {
    publicApi.get(`/draft-approval/${token}`)
      .then(({ data }) => {
        setDraft(data);
        setEditedContent(data.proposedContent);
      })
      .catch((err) => setError(err.response?.data?.error || 'Lien invalide ou expiré.'))
      .finally(() => setLoading(false));
  }, [token]);

  // L'aperçu navigateur ne peut pas résoudre cid:logo-signature (réservé aux emails réellement
  // envoyés, où le logo est joint en pièce jointe inline) — on l'échange pour l'URL réelle juste
  // pour l'affichage, puis on revient à cid: avant sauvegarde pour ne pas casser l'envoi.
  function toDisplayHtml(html) {
    return draft?.signatureLogoUrl ? html.replaceAll('cid:logo-signature', draft.signatureLogoUrl) : html;
  }

  function fromDisplayHtml(html) {
    return draft?.signatureLogoUrl ? html.split(draft.signatureLogoUrl).join('cid:logo-signature') : html;
  }

  async function handleApprove() {
    setSubmitting(true);
    setError('');
    try {
      await publicApi.post(`/draft-approval/${token}/approve`, { proposedContent: editedContent });
      setDone('approved');
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'approbation.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    setSubmitting(true);
    setError('');
    try {
      await publicApi.post(`/draft-approval/${token}/reject`, { reviewNote: rejectNote || undefined });
      setDone('rejected');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du rejet.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-md">
      <div className="w-full max-w-2xl bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md transition-all duration-300">
        <div className="flex items-center gap-sm border-b border-outline-variant/40 pb-md">
          <span className="material-symbols-outlined text-primary text-[28px]">mark_email_read</span>
          <h1 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">Validation d'une réponse IA</h1>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-lg gap-sm">
            <span className="material-symbols-outlined animate-spin text-primary text-[32px]">sync</span>
            <p className="font-body-sm text-body-sm text-on-surface-variant font-medium">Chargement des données du brouillon...</p>
          </div>
        )}

        {!loading && error && !done && (
          <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {done === 'approved' && (
          <div className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-md rounded-xl font-body-md font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined">check_circle</span>
            Réponse approuvée et envoyée avec succès.
          </div>
        )}
        {done === 'rejected' && (
          <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined">cancel</span>
            Réponse rejetée. Aucun email n'a été envoyé.
          </div>
        )}

        {!loading && !error && !done && draft && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Destinataire</span>
                <p className="text-on-surface font-body-sm text-body-sm bg-surface-container-low/40 px-3.5 py-2 border border-outline-variant/60 rounded-xl font-medium truncate">{draft.recipientEmail}</p>
              </div>
              <div className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Sujet</span>
                <p className="text-on-surface font-body-sm text-body-sm bg-surface-container-low/40 px-3.5 py-2 border border-outline-variant/60 rounded-xl font-medium truncate">{draft.subject}</p>
              </div>
            </div>

            <div className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Contenu (modifiable avant envoi)</span>
              <div
                className="bg-surface border border-outline-variant/60 rounded-2xl p-md text-body-sm text-on-surface min-h-[260px] max-h-[420px] overflow-y-auto focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 shadow-sm"
                dangerouslySetInnerHTML={{ __html: toDisplayHtml(editedContent) }}
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => setEditedContent(fromDisplayHtml(e.currentTarget.innerHTML))}
              />
            </div>

            {error && (
              <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined">error</span>
                {error}
              </div>
            )}

            {showRejectNote && (
              <input
                type="text"
                placeholder="Motif du rejet (optionnel)"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                className={inputClass}
              />
            )}

            <div className="flex gap-sm pt-sm border-t border-outline-variant/40 justify-end">
              <button
                onClick={() => (showRejectNote ? handleReject() : setShowRejectNote(true))}
                disabled={submitting}
                className="px-5 py-2.5 border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
                {showRejectNote ? 'Confirmer le rejet' : 'Rejeter'}
              </button>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="px-5 py-2.5 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                    Envoi...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">send</span>
                    Approuver et envoyer
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

