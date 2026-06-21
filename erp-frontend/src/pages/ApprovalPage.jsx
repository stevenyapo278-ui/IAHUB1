import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

// Client axios séparé de api/client.js : cette page est publique (accessible via un lien
// email sans login), elle ne doit jamais envoyer le token JWT de session ni être redirigée
// vers /login par l'intercepteur 401 global.
const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

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
      <div className="w-full max-w-2xl bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-md">
        <h1 className="font-headline-md text-headline-md text-on-surface">Validation d'une réponse IA</h1>

        {loading && <p className="font-body-sm text-body-sm text-on-surface-variant">Chargement...</p>}

        {!loading && error && !done && (
          <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>
        )}

        {done === 'approved' && (
          <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">
            Réponse approuvée et envoyée avec succès.
          </div>
        )}
        {done === 'rejected' && (
          <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">
            Réponse rejetée. Aucun email n'a été envoyé.
          </div>
        )}

        {!loading && !error && !done && draft && (
          <>
            <div>
              <span className="font-label-md text-label-md text-on-surface-variant uppercase">Destinataire</span>
              <p className="text-on-surface font-body-sm text-body-sm">{draft.recipientEmail}</p>
            </div>
            <div>
              <span className="font-label-md text-label-md text-on-surface-variant uppercase">Sujet</span>
              <p className="text-on-surface font-body-sm text-body-sm">{draft.subject}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase">Contenu (modifiable avant envoi)</span>
              <div
                className="bg-surface border border-outline-variant rounded-none p-md text-body-sm text-on-surface min-h-[260px] max-h-[420px] overflow-y-auto focus:outline-none focus:border-on-surface"
                dangerouslySetInnerHTML={{ __html: toDisplayHtml(editedContent) }}
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => setEditedContent(fromDisplayHtml(e.currentTarget.innerHTML))}
              />
            </div>

            {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}

            {showRejectNote && (
              <input
                type="text"
                placeholder="Motif du rejet (optionnel)"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                className="border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface focus:outline-none focus:border-on-surface"
              />
            )}

            <div className="flex gap-sm">
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all disabled:opacity-50"
              >
                {submitting ? 'Envoi...' : 'Approuver et envoyer'}
              </button>
              <button
                onClick={() => (showRejectNote ? handleReject() : setShowRejectNote(true))}
                disabled={submitting}
                className="px-4 py-2 rounded-none border border-outline-variant text-on-surface-variant font-body-sm text-body-sm hover:bg-surface-container-high transition-colors disabled:opacity-50"
              >
                {showRejectNote ? 'Confirmer le rejet' : 'Rejeter'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
