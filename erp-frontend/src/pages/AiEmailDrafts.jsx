import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUS_OPTIONS = ['PENDING', 'APPROVED', 'REJECTED'];
const MAX_AI_EXCHANGES_PER_TICKET = 3; // doit rester aligné avec followupEscalation.js (backend)

export default function AiEmailDrafts() {
  const [drafts, setDrafts] = useState([]);
  const [status, setStatus] = useState('PENDING');
  const [selected, setSelected] = useState(null);
  const [editedContent, setEditedContent] = useState('');
  const [editedRecipient, setEditedRecipient] = useState('');
  const [editedCc, setEditedCc] = useState([]);
  const [ccInput, setCcInput] = useState('');
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'approve'|'reject', id }
  const [reviewNote, setReviewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signatureLogoUrl, setSignatureLogoUrl] = useState(null);

  useEffect(() => {
    api.get('/system-settings').then(({ data }) => setSignatureLogoUrl(data.signatureLogoUrl || null)).catch(() => {});
  }, []);

  // L'aperçu navigateur ne peut pas résoudre cid:logo-signature (réservé aux emails réellement
  // envoyés, où le logo est joint en pièce jointe inline) — on l'échange pour l'URL réelle juste
  // pour l'affichage, puis on revient à cid: avant sauvegarde pour ne pas casser l'envoi.
  function toDisplayHtml(html) {
    return signatureLogoUrl ? html.replaceAll('cid:logo-signature', signatureLogoUrl) : html;
  }

  function fromDisplayHtml(html) {
    return signatureLogoUrl ? html.split(signatureLogoUrl).join('cid:logo-signature') : html;
  }

  function addCc() {
    const value = ccInput.trim();
    if (value && !editedCc.includes(value)) setEditedCc([...editedCc, value]);
    setCcInput('');
  }

  function removeCc(email) {
    setEditedCc(editedCc.filter((e) => e !== email));
  }

  function load() {
    api
      .get('/ai-email-drafts', { params: status ? { status } : {} })
      .then(({ data }) => setDrafts(data))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, [status]);

  function openDraft(draft) {
    setSelected(draft);
    setEditedContent(draft.proposedContent);
    setEditedRecipient(draft.recipientEmail);
    setEditedCc(draft.ccRecipients || []);
    setCcInput('');
  }

  function askApprove() {
    if (!selected) return;
    setConfirmAction({ type: 'approve', id: selected.id });
  }

  function askReject() {
    if (!selected) return;
    setConfirmAction({ type: 'reject', id: selected.id });
  }

  function askRestore() {
    if (!selected) return;
    setConfirmAction({ type: 'restore', id: selected.id });
  }

  async function confirmActionRun() {
    if (!confirmAction) return;
    setSubmitting(true);
    try {
      if (confirmAction.type === 'approve') {
        await api.post(`/ai-email-drafts/${confirmAction.id}/approve`, {
          proposedContent: editedContent,
          recipientEmail: editedRecipient,
          ccRecipients: editedCc,
        });
        toast.success('Email envoyé avec succès');
      } else if (confirmAction.type === 'restore') {
        await api.post(`/ai-email-drafts/${confirmAction.id}/restore`);
        setStatus('PENDING');
        toast.success('Brouillon restauré, il repasse en attente de validation');
      } else {
        await api.post(`/ai-email-drafts/${confirmAction.id}/reject`, { reviewNote: reviewNote || undefined });
        toast.success('Brouillon rejeté');
      }
      setConfirmAction(null);
      setSelected(null);
      setReviewNote('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'action");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-lg flex flex-col gap-lg">
      <header>
        <h2 className="font-display-lg text-display-lg text-on-background font-bold">Réponses à valider</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
          Brouillons générés automatiquement par le pipeline email, en attente d'approbation avant envoi.
        </p>
      </header>

      <div className="flex items-center gap-3 bg-surface-container-lowest p-md rounded-2xl border border-outline-variant/60 card-shadow">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setSelected(null); }}
            className={`px-4 py-2 rounded-xl border font-body-sm text-body-sm font-semibold transition-all duration-300 ${
              status === s 
                ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/5' 
                : 'border-outline-variant/60 text-on-surface hover:bg-surface-container-low'
            }`}
          >
            {s === 'PENDING' ? 'En attente' : s === 'APPROVED' ? 'Approuvés' : 'Rejetés'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow overflow-hidden flex flex-col">
          <div className="p-md border-b border-outline-variant/40 bg-surface-container-low/20 flex justify-between items-center">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Brouillons</span>
            <span className="text-on-surface-variant text-xs font-mono-sm bg-surface-container border border-outline-variant/50 px-2.5 py-0.5 rounded-full font-medium">
              {drafts.length}
            </span>
          </div>
          <div className="divide-y divide-outline-variant/40 overflow-y-auto max-h-[600px]">
            {drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => openDraft(d)}
                className={`w-full text-left p-md hover:bg-surface-container-low/40 transition-colors ${selected?.id === d.id ? 'bg-surface-container-low/40' : ''}`}
              >
                <div className="font-headline-sm text-headline-sm text-on-surface truncate flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{d.subject}</span>
                  {d.draftKind === 'CONVERSATION_FOLLOWUP' && (
                    <span className="shrink-0 px-2 py-0.5 border border-outline-variant/60 rounded-full text-on-surface-variant text-[10px] font-mono-sm uppercase">
                      Tour {d.exchangeTurn}/{MAX_AI_EXCHANGES_PER_TICKET}
                    </span>
                  )}
                </div>
                <div className="text-body-sm text-on-surface-variant truncate mt-1">À : {d.recipientEmail}</div>
                {d.ccRecipients?.length > 0 && (
                  <div className="text-body-sm text-on-surface-variant truncate">Cc : {d.ccRecipients.join(', ')}</div>
                )}
                {d.ticket && (
                  <div className="text-xs text-outline font-medium mt-1.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">confirmation_number</span>
                    Ticket #{d.ticket.id} — {d.ticket.title}
                  </div>
                )}
              </button>
            ))}
            {drafts.length === 0 && (
              <div className="p-xl text-center text-on-surface-variant font-body-md text-body-md italic">
                Aucun brouillon dans cette catégorie.
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md">
          {!selected && (
            <div className="flex flex-col items-center justify-center p-xl text-center h-full text-on-surface-variant italic">
              <span className="material-symbols-outlined text-[48px] text-outline/40 mb-2">mark_email_unread</span>
              Sélectionnez un brouillon pour le consulter et le valider.
            </div>
          )}
          {selected && (
            <>
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Destinataire (À)</span>
                <input
                  type="email"
                  value={editedRecipient}
                  onChange={(e) => setEditedRecipient(e.target.value)}
                  disabled={selected.status !== 'PENDING'}
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 disabled:opacity-60"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Cc</span>
                {selected.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <input
                      type="email"
                      placeholder="Ajouter un email en copie..."
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCc(); } }}
                      className="flex-1 bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                    />
                    <button 
                      type="button"
                      onClick={addCc} 
                      className="px-3.5 rounded-xl border border-outline-variant/60 bg-surface hover:bg-surface-container-high transition-all flex items-center justify-center shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>
                  </div>
                )}
                {editedCc.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {editedCc.map((email) => (
                      <span key={email} className="flex items-center gap-1.5 px-3 py-1 border border-outline-variant/60 rounded-full text-on-surface-variant text-xs bg-surface-container-low font-medium">
                        {email}
                        {selected.status === 'PENDING' && (
                          <button onClick={() => removeCc(email)} className="hover:text-error transition-colors">
                            <span className="material-symbols-outlined text-[14px]">close</span>
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-outline-variant/40 pt-md mt-xs">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Sujet</span>
                <p className="text-on-surface font-body-sm text-body-sm font-semibold mt-0.5">{selected.subject}</p>
              </div>

              {selected.draftKind === 'CONVERSATION_FOLLOWUP' && (
                <div className="border border-primary/20 bg-primary/5 rounded-xl px-4 py-3 text-body-sm text-on-surface-variant leading-relaxed flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">info</span>
                  <span>Réponse de suivi générée par l'IA — tour {selected.exchangeTurn}/{MAX_AI_EXCHANGES_PER_TICKET} de la conversation sur ce ticket.</span>
                </div>
              )}

              {selected.ticket && (
                <div className="flex">
                  <Link 
                    to={`/tickets/${selected.ticket.id}`} 
                    className="inline-flex items-center gap-1 text-primary hover:underline text-body-sm font-semibold"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    Voir le ticket #{selected.ticket.id}
                  </Link>
                </div>
              )}

              <div className="flex flex-col gap-1 border-t border-outline-variant/40 pt-md">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Contenu (éditable)</span>
                <div
                  key={selected.id}
                  className="bg-surface border border-outline-variant/60 rounded-xl p-md text-body-sm text-on-surface min-h-[260px] max-h-[420px] overflow-y-auto focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 shadow-inner"
                  dangerouslySetInnerHTML={{ __html: toDisplayHtml(editedContent) }}
                  contentEditable={selected.status === 'PENDING'}
                  suppressContentEditableWarning
                  onBlur={(e) => setEditedContent(fromDisplayHtml(e.currentTarget.innerHTML))}
                />
              </div>

              {selected.status === 'PENDING' ? (
                <div className="flex gap-sm border-t border-outline-variant/40 pt-md mt-xs">
                  <button
                    onClick={askApprove}
                    className="flex-1 btn-gradient font-semibold py-2.5 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm flex items-center justify-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[18px]">check</span>
                    Approuver & envoyer
                  </button>
                  <button
                    onClick={askReject}
                    className="bg-transparent border border-error text-error hover:bg-error-container transition-colors py-2.5 rounded-xl font-semibold text-body-sm px-5"
                  >
                    Rejeter
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between border-t border-outline-variant/40 pt-md mt-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Statut :</span>
                    <span className={`badge px-2.5 py-0.5 rounded-full text-[11px] font-bold border uppercase ${
                      selected.status === 'APPROVED' 
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' 
                        : 'bg-error/10 text-error border-error/20'
                    }`}>
                      {selected.status}
                    </span>
                  </div>
                  {selected.status === 'REJECTED' && (
                    <button
                      onClick={askRestore}
                      className="px-4 py-2 border border-outline-variant/60 text-on-surface font-semibold text-body-sm hover:bg-surface-container-high transition-colors rounded-xl shadow-sm"
                    >
                      Restaurer (renvoyer en attente)
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction?.type === 'approve' ? 'Approuver et envoyer'
            : confirmAction?.type === 'restore' ? 'Restaurer ce brouillon'
            : 'Rejeter ce brouillon'
        }
        message={
          confirmAction?.type === 'approve'
            ? "Cette réponse va être envoyée immédiatement par email au destinataire (et en copie aux CC s'il y en a). Confirmer ?"
            : confirmAction?.type === 'restore'
            ? 'Ce brouillon repasse en attente de validation. Vous pourrez le modifier et l\'envoyer comme un nouveau brouillon.'
            : 'Ce brouillon sera rejeté et ne sera jamais envoyé.'
        }
        confirmLabel={
          confirmAction?.type === 'approve' ? 'Envoyer'
            : confirmAction?.type === 'restore' ? 'Restaurer'
            : 'Rejeter'
        }
        danger={confirmAction?.type === 'reject'}
        loading={submitting}
        onConfirm={confirmActionRun}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
