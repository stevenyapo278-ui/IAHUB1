import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { UserCheck, CheckCircle2, XCircle, AlertCircle, Send, Loader2 } from 'lucide-react';
import { sanitizeHtml } from '../utils/sanitize';

// Client axios séparé de api/client.js : cette page est publique (lien e-mail
// envoyé au supérieur hiérarchique, sans compte) — ne jamais envoyer le JWT de
// session ni être redirigée vers /login par l'intercepteur 401 global.
const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

const STATUS_LABELS = {
  APPROVED: 'Approuvée',
  REJECTED: 'Refusée',
  PENDING: 'En attente de décision',
  NOT_REQUIRED: 'Non requise',
  SUPERSEDED: 'Remplacée',
};

// Décision de la validation hiérarchique : récapitulatif du ticket + réponse
// Approuver / Refuser (motif obligatoire au refus) via le token opaque.
export default function ApprovalDecision() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null); // 'approved' | 'rejected'
  const [comment, setComment] = useState('');

  useEffect(() => {
    publicApi.get(`/approvals/${token}`)
      .then(({ data: payload }) => setData(payload))
      .catch((err) => setError(err.response?.data?.error || 'Lien invalide ou expiré.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function decide(decision) {
    if (decision === 'REJECTED' && !comment.trim()) {
      setError('Une raison de refus est obligatoire.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await publicApi.post(`/approvals/${token}/${decision === 'APPROVED' ? 'approve' : 'reject'}`, { comment: comment.trim() });
      setDone(decision === 'APPROVED' ? 'approved' : 'rejected');
    } catch (err) {
      const payload = err.response?.data;
      if (err.response?.status === 409 && payload?.status) {
        // Lien déjà utilisé : basculer sur l'état réel de la décision.
        setData((d) => (d ? { ...d, status: payload.status, decidedAt: payload.decidedAt, decisionComment: payload.decisionComment } : d));
        setError('');
      } else {
        setError(payload?.error || 'Erreur lors de la décision.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const ticket = data?.ticket;
  const alreadyDecided = data && data.status !== 'PENDING';

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-md">
      <div className="w-full max-w-2xl bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md transition-all duration-300">
        <div className="flex items-center gap-sm border-b border-outline-variant/40 pb-md">
          <span className="text-primary"><UserCheck className="w-7 h-7" /></span>
          <div>
            <h1 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">Validation hiérarchique</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Demande de reporting à approuver ou refuser</p>
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-lg gap-sm">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <p className="font-body-sm text-body-sm text-on-surface-variant font-medium">Chargement de la demande…</p>
          </div>
        )}

        {!loading && error && !done && !alreadyDecided && (
          <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {!loading && alreadyDecided && (
          <div className={`p-md rounded-xl font-body-md font-semibold flex items-center gap-2 border
            ${data.status === 'APPROVED' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600' : 'border-red-500/20 bg-red-500/5 text-red-500'}`}>
            {data.status === 'APPROVED' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span>
              Demande {STATUS_LABELS[data.status] || data.status.toLowerCase()}
              {data.decidedAt ? ` le ${new Date(data.decidedAt).toLocaleString('fr-FR')}` : ''}.
              {data.decisionComment ? ` « ${data.decisionComment} »` : ''}
            </span>
          </div>
        )}

        {!loading && done && (
          <div className={`p-md rounded-xl font-body-md font-semibold flex items-center gap-2 border
            ${done === 'approved' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600' : 'border-red-500/20 bg-red-500/5 text-red-500'}`}>
            {done === 'approved' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            {done === 'approved'
              ? 'Demande approuvée : le traitement peut démarrer.'
              : 'Demande refusée : le demandeur a été informé du motif.'}
          </div>
        )}

        {!loading && !done && data && ticket && !alreadyDecided && (
          <>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Ticket #{ticket.id}</p>
                <p className="text-on-surface font-bold text-body-md leading-snug">{ticket.title}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">{ticket.priority}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/25">{ticket.approvalStatus}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Demandeur</span>
                <p className="text-on-surface font-body-sm text-body-sm bg-surface-container-low/40 px-3.5 py-2 border border-outline-variant/60 rounded-xl font-medium">
                  {ticket.requesterName || '—'}
                </p>
              </div>
              <div className="flex flex-col gap-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Soumis le</span>
                <p className="text-on-surface font-body-sm text-body-sm bg-surface-container-low/40 px-3.5 py-2 border border-outline-variant/60 rounded-xl font-medium">
                  {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('fr-FR') : '—'}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Demande</span>
              <div className="bg-surface border border-outline-variant/60 rounded-2xl p-md text-body-sm text-on-surface min-h-[120px] max-h-[360px] overflow-y-auto shadow-sm"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(ticket.content || '<p style="color:#888">Aucun détail.</p>') }} />
            </div>

            <div className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                Commentaire {<span className="normal-case font-normal">(obligatoire en cas de refus)</span>}
              </span>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                placeholder="Ex. : accordé sous réserve du budget…"
                className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 resize-none" />
            </div>

            {error && (
              <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <div className="flex gap-sm pt-sm border-t border-outline-variant/40 justify-end">
              <button onClick={() => decide('REJECTED')} disabled={submitting}
                className="px-5 py-2.5 border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-sm">
                <XCircle className="w-4 h-4" /> Refuser
              </button>
              <button onClick={() => decide('APPROVED')} disabled={submitting}
                className="px-5 py-2.5 btn-gradient text-white font-semibold rounded-xl shadow-md shadow-emerald-500/20 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50 flex items-center gap-1.5">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Approuver
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
