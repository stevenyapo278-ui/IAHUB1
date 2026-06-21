import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUS_OPTIONS = ['PENDING', 'APPROVED', 'REJECTED'];

export default function AiEmailDrafts() {
  const [drafts, setDrafts] = useState([]);
  const [status, setStatus] = useState('PENDING');
  const [error, setError] = useState('');
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
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
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
    setError('');
    try {
      if (confirmAction.type === 'approve') {
        await api.post(`/ai-email-drafts/${confirmAction.id}/approve`, {
          proposedContent: editedContent,
          recipientEmail: editedRecipient,
          ccRecipients: editedCc,
        });
      } else if (confirmAction.type === 'restore') {
        await api.post(`/ai-email-drafts/${confirmAction.id}/restore`);
        setStatus('PENDING');
      } else {
        await api.post(`/ai-email-drafts/${confirmAction.id}/reject`, { reviewNote: reviewNote || undefined });
      }
      setConfirmAction(null);
      setSelected(null);
      setReviewNote('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'action");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-display-lg text-display-lg text-on-background">Réponses à valider</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">
          Brouillons générés automatiquement par le pipeline email, en attente d'approbation avant envoi.
        </p>
      </header>

      {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}

      <div className="flex items-center gap-3 bg-surface-container-lowest p-md rounded-none border border-outline-variant">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setSelected(null); }}
            className={`px-3 py-1.5 rounded-none border font-body-sm text-body-sm transition-colors ${
              status === s ? 'bg-on-surface text-surface border-outline-variant' : 'border-outline-variant text-on-surface hover:bg-surface-container-low'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-none overflow-hidden flex flex-col">
          <div className="p-md border-b border-outline-variant flex justify-between items-center">
            <span className="font-headline-sm text-headline-sm text-on-surface">Brouillons</span>
            <span className="text-on-surface-variant text-xs font-mono-sm">{drafts.length}</span>
          </div>
          <div className="divide-y divide-outline-variant overflow-y-auto max-h-[600px]">
            {drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => openDraft(d)}
                className={`w-full text-left p-md hover:bg-surface-container-low transition-colors ${selected?.id === d.id ? 'bg-surface-container-low' : ''}`}
              >
                <div className="font-headline-sm text-headline-sm text-on-surface truncate">{d.subject}</div>
                <div className="text-body-sm text-on-surface-variant truncate">À : {d.recipientEmail}</div>
                {d.ccRecipients?.length > 0 && (
                  <div className="text-body-sm text-on-surface-variant truncate">Cc : {d.ccRecipients.join(', ')}</div>
                )}
                {d.ticket && (
                  <div className="text-xs text-outline mt-1">Ticket #{d.ticket.id} — {d.ticket.title}</div>
                )}
              </button>
            ))}
            {drafts.length === 0 && (
              <div className="p-md text-center text-on-surface-variant">Aucun brouillon.</div>
            )}
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant rounded-none p-lg flex flex-col gap-md">
          {!selected && (
            <p className="text-on-surface-variant font-body-sm text-body-sm">Sélectionnez un brouillon pour le consulter.</p>
          )}
          {selected && (
            <>
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Destinataire (À)</span>
                <input
                  type="email"
                  value={editedRecipient}
                  onChange={(e) => setEditedRecipient(e.target.value)}
                  disabled={selected.status !== 'PENDING'}
                  className="bg-surface border border-outline-variant rounded-none p-2 text-body-sm text-on-surface focus:outline-none focus:border-on-surface disabled:opacity-60"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Cc</span>
                {selected.status === 'PENDING' && (
                  <div className="flex gap-1">
                    <input
                      type="email"
                      placeholder="Ajouter un email en copie..."
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCc(); } }}
                      className="flex-1 bg-surface border border-outline-variant rounded-none p-2 text-body-sm text-on-surface focus:outline-none focus:border-on-surface"
                    />
                    <button onClick={addCc} className="px-2 border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors">
                      <span className="material-symbols-outlined text-[16px]">add</span>
                    </button>
                  </div>
                )}
                {editedCc.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {editedCc.map((email) => (
                      <span key={email} className="flex items-center gap-1 px-2 py-0.5 border border-outline-variant text-on-surface-variant text-xs">
                        {email}
                        {selected.status === 'PENDING' && (
                          <button onClick={() => removeCc(email)} className="hover:text-error">
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Sujet</span>
                <p className="text-on-surface font-body-sm text-body-sm">{selected.subject}</p>
              </div>
              {selected.ticket && (
                <Link to={`/tickets/${selected.ticket.id}`} className="text-on-surface hover:underline text-body-sm font-body-sm">
                  Voir le ticket #{selected.ticket.id}
                </Link>
              )}
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-on-surface-variant uppercase">Contenu (éditable)</span>
                <div
                  key={selected.id}
                  className="bg-surface border border-outline-variant rounded-none p-md text-body-sm text-on-surface min-h-[260px] max-h-[420px] overflow-y-auto focus:outline-none focus:border-on-surface"
                  dangerouslySetInnerHTML={{ __html: toDisplayHtml(editedContent) }}
                  contentEditable={selected.status === 'PENDING'}
                  suppressContentEditableWarning
                  onBlur={(e) => setEditedContent(fromDisplayHtml(e.currentTarget.innerHTML))}
                />
              </div>

              {selected.status === 'PENDING' ? (
                <div className="flex gap-sm">
                  <button
                    onClick={askApprove}
                    className="px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all"
                  >
                    Approuver et envoyer
                  </button>
                  <button
                    onClick={askReject}
                    className="px-4 py-2 rounded-none border border-error/30 text-error font-body-sm text-body-sm font-semibold hover:bg-error/5 transition-colors"
                  >
                    Rejeter
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-md">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase">
                    Statut : {selected.status}
                  </span>
                  {selected.status === 'REJECTED' && (
                    <button
                      onClick={askRestore}
                      className="px-4 py-2 rounded-none border border-outline-variant text-on-surface font-body-sm text-body-sm font-semibold hover:bg-surface-container-high transition-colors"
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
