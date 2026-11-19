import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import api from '../api/client';

// ── Modale de déclaration des opérations sur comptes applicatifs ────────────
// Affichée avant qu'un technicien ne passe un ticket à SOLVED (module activé par
// le SUPERADMIN). Le pré-remplissage IA est une aide : tout reste éditable.
//
// Règle de sécurité : aucun mot de passe n'est demandé ni envoyé. On trace
// uniquement le canal de transmission du secret (« remis en main propre », etc.).

const ACCOUNT_TYPES = [
  { value: 'NOMINAL', label: 'Nominal' },
  { value: 'ADMIN', label: 'Administrateur' },
  { value: 'SERVICE', label: 'Compte de service' },
  { value: 'PARTAGE', label: 'Compte partagé' },
  { value: 'AUTRE', label: 'Autre' },
];

const EMPTY_ROW = {
  applicationId: '',
  operation: 'CREATION',
  type: 'NOMINAL',
  login: '',
  email: '',
  profile: '',
  rights: '',
  quantity: 1,
  passwordDeliveryChannel: '',
  note: '',
};

// Libellés des deux natures d'opération déclarables.
const OPERATION_OPTIONS = [
  { value: 'CREATION', label: 'Création de compte' },
  { value: 'DROITS', label: 'Mise à jour de droits' },
];

const inputClass =
  'w-full bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-xs font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

const labelClass =
  'block text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1';

function rowFromAccount(account = {}) {
  return {
    applicationId: account.applicationId ? String(account.applicationId) : '',
    operation: account.operation === 'DROITS' ? 'DROITS' : 'CREATION',
    type: account.type || 'NOMINAL',
    login: account.login || '',
    email: account.email || '',
    profile: account.profile || '',
    rights: account.rights || '',
    quantity: Number(account.quantity) || 1,
    passwordDeliveryChannel: account.passwordDeliveryChannel || '',
    note: account.note || '',
  };
}

function confidenceLabel(confidence) {
  if (!Number.isFinite(Number(confidence))) return null;
  return `${Math.round(Math.max(0, Math.min(1, Number(confidence))) * 100)} %`;
}

// Le catalogue peut définir un schéma de champs par application (ex. profils Sage X3).
// On l'utilise pour proposer une liste fermée au lieu d'un champ libre.
function resolveFields(app) {
  if (!app) return [];
  if (Array.isArray(app.fields)) return app.fields;
  if (app.fields && Array.isArray(app.fields.fields)) return app.fields.fields;
  return [];
}

function profileOptionsFor(catalog, applicationId) {
  const app = catalog.find((candidate) => String(candidate.id) === String(applicationId));
  const field = resolveFields(app).find((entry) => entry && entry.key === 'profile' && entry.type === 'select');
  return Array.isArray(field?.options) ? field.options : [];
}

export default function AccountProvisioningModal({ open, ticketId, ticketTitle, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [existingRecord, setExistingRecord] = useState(null);
  const [prefill, setPrefill] = useState(null);
  const [rows, setRows] = useState([{ ...EMPTY_ROW }]);
  const [noAccountCreated, setNoAccountCreated] = useState(false);
  const [error, setError] = useState('');
  // Erreurs par ligne et par champ : affichées sous le champ concerné, pour que
  // le technicien voie immédiatement ce qui manque (et non un message global).
  const [fieldErrors, setFieldErrors] = useState({});

  const aiConfidence = useMemo(() => confidenceLabel(prefill?.confidence), [prefill]);

  // Détection immédiate des doublons (même application + même identifiant) :
  // on prévient avant l'envoi, le backend refusant de toute façon.
  const duplicateRowIndexes = useMemo(() => {
    const seen = new Map();
    const duplicates = new Set();
    rows.forEach((row, index) => {
      // Même identifiant que le backend : login, sinon email.
      const identifier = String(row.login || '').trim() || String(row.email || '').trim();
      if (!row.applicationId || !identifier) return;
      const key = `${row.applicationId}|${row.operation || 'CREATION'}|${identifier.toLowerCase()}`;
      if (seen.has(key)) {
        duplicates.add(index);
        duplicates.add(seen.get(key));
      } else {
        seen.set(key, index);
      }
    });
    return duplicates;
  }, [rows]);

  useEffect(() => {
    if (!open || !ticketId) return undefined;
    let cancelled = false;

    setLoading(true);
    setError('');
    setFieldErrors({});
    setPrefill(null);
    setExistingRecord(null);
    setRows([{ ...EMPTY_ROW }]);
    setNoAccountCreated(false);

    (async () => {
      try {
        const [stateRes, catalogRes] = await Promise.all([
          api.get(`/account-provisioning/ticket/${ticketId}`),
          api.get('/account-provisioning/catalog'),
        ]);
        if (cancelled) return;

        setCatalog(Array.isArray(catalogRes.data) ? catalogRes.data : []);
        const record = stateRes.data?.record || null;
        setExistingRecord(record);

        if (record) {
          const recordAccounts = Array.isArray(record.accounts) ? record.accounts : [];
          setRows(recordAccounts.length > 0 ? recordAccounts.map(rowFromAccount) : [{ ...EMPTY_ROW }]);
          setNoAccountCreated(recordAccounts.length === 0);
          setLoading(false);
          return;
        }

        // Pas encore de déclaration : on demande le pré-remplissage IA (non bloquant).
        try {
          const { data } = await api.get(`/account-provisioning/ticket/${ticketId}/prefill`);
          if (cancelled) return;
          setPrefill(data);
          const suggested = Array.isArray(data?.accounts) ? data.accounts : [];
          const suggestedApps = Array.isArray(data?.applications) ? data.applications : [];
          if (suggested.length > 0) {
            setRows(suggested.map(rowFromAccount));
          } else if (suggestedApps.length > 0) {
            setRows(suggestedApps.map((app) => ({ ...EMPTY_ROW, applicationId: String(app.id) })));
          } else {
            setRows([{ ...EMPTY_ROW }]);
          }
        } catch {
          // Le pré-remplissage est optionnel : le formulaire reste utilisable à la main.
        } finally {
          if (!cancelled) setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Impossible de charger le formulaire.');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, ticketId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  function updateRow(index, field, value) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    // L'erreur « identifiant ou email » couvre les deux champs : on les efface ensemble.
    const clearedFields = field === 'login' || field === 'email' ? ['login', 'email'] : [field];
    setFieldErrors((prev) => {
      if (!prev[index] || clearedFields.every((key) => !prev[index][key])) return prev;
      const nextRow = { ...prev[index] };
      clearedFields.forEach((key) => { delete nextRow[key]; });
      const next = { ...prev };
      if (Object.keys(nextRow).length === 0) delete next[index];
      else next[index] = nextRow;
      return next;
    });
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  }

  // Bascule création ↔ droits : la quantité n'a de sens que pour une création,
  // on la remet à 1 pour ne pas déclarer « 5 mises à jour de droits » anonymes.
  function setRowOperation(index, operation) {
    setRows((prev) => prev.map((row, i) => (
      i === index
        ? { ...row, operation, quantity: operation === 'DROITS' ? 1 : row.quantity }
        : row
    )));
    setFieldErrors((prev) => {
      if (!prev[index]) return prev;
      const nextRow = { ...prev[index] };
      delete nextRow.quantity;
      const next = { ...prev };
      if (Object.keys(nextRow).length === 0) delete next[index];
      else next[index] = nextRow;
      return next;
    });
  }

  function removeRow(index) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!noAccountCreated) {
      if (catalog.length === 0) {
        setError('Aucune application active dans le catalogue. Demandez au SUPERADMIN d’en configurer une.');
        return;
      }
      if (rows.length === 0) {
        setError('Ajoutez au moins une application ou cochez « aucun compte créé ».');
        return;
      }
      const missingApp = rows.findIndex((row) => !row.applicationId);
      if (missingApp !== -1) {
        setError(`Ligne ${missingApp + 1} : sélectionnez une application.`);
        return;
      }
      const invalidQuantity = rows.findIndex((row) => {
        const q = Number(row.quantity);
        return !Number.isInteger(q) || q < 1 || q > 500;
      });
      if (invalidQuantity !== -1) {
        setError(`Ligne ${invalidQuantity + 1} : la quantité doit être un entier entre 1 et 500.`);
        return;
      }

      // Champs obligatoires par ligne : un identifiant (login ou email), un email
      // valide s'il est renseigné, et le profil dès que le catalogue impose une
      // liste fermée pour l'application.
      const nextFieldErrors = {};
      rows.forEach((row, index) => {
        const rowErrors = {};
        const isRightsUpdate = row.operation === 'DROITS';
        const login = String(row.login || '').trim();
        const email = String(row.email || '').trim();
        if (!login && !email) {
          rowErrors.login = isRightsUpdate
            ? 'Renseignez le compte cible (identifiant ou email).'
            : 'Renseignez l’identifiant ou l’email du compte.';
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          rowErrors.email = 'Adresse email invalide.';
        }
        // Liste fermée de profils : en création le profil est obligatoire ; en mise
        // à jour de droits, le droit en texte libre peut le remplacer.
        const hasClosedProfileList = profileOptionsFor(catalog, row.applicationId).length > 0;
        const hasProfile = Boolean(String(row.profile || '').trim());
        const hasRights = Boolean(String(row.rights || '').trim());
        if (hasClosedProfileList && !hasProfile && !(isRightsUpdate && hasRights)) {
          rowErrors.profile = isRightsUpdate
            ? 'Choisissez un profil ou précisez le droit accordé.'
            : 'Choisissez un profil dans la liste.';
        }
        if (isRightsUpdate && Number(row.quantity) !== 1) {
          rowErrors.quantity = 'Une mise à jour de droits concerne un seul compte.';
        }
        if (Object.keys(rowErrors).length > 0) nextFieldErrors[index] = rowErrors;
      });
      if (Object.keys(nextFieldErrors).length > 0) {
        setFieldErrors(nextFieldErrors);
        const firstRow = Math.min(...Object.keys(nextFieldErrors).map(Number));
        setError(`Ligne ${firstRow + 1} : ${Object.values(nextFieldErrors[firstRow])[0]}`);
        return;
      }
      setFieldErrors({});

      if (duplicateRowIndexes.size > 0) {
        const first = Math.min(...duplicateRowIndexes) + 1;
        setError(`Ligne ${first} : ce compte est déclaré plusieurs fois (même application + même identifiant).`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const prefillMeta = prefill
        ? {
            aiUsed: Boolean(prefill.aiUsed),
            classifier: prefill.classifier || (prefill.aiUsed ? 'AI' : 'DETERMINISTIC'),
            confidence: prefill.confidence ?? null,
            evidence: prefill.evidence || '',
            accounts: Array.isArray(prefill.accounts) ? prefill.accounts : [],
            applications: Array.isArray(prefill.applications) ? prefill.applications : [],
            ignoredApplications: Array.isArray(prefill.ignoredApplications) ? prefill.ignoredApplications : [],
          }
        : null;

      const payload = noAccountCreated
        ? { noAccountCreated: true, source: 'MANUAL', prefillMeta }
        : {
            accounts: rows.map((row) => ({
              applicationId: Number(row.applicationId),
              operation: row.operation === 'DROITS' ? 'DROITS' : 'CREATION',
              type: row.type,
              login: row.login,
              email: row.email,
              profile: row.profile,
              rights: row.rights,
              quantity: Number(row.quantity) || 1,
              passwordDeliveryChannel: row.passwordDeliveryChannel,
              note: row.note,
            })),
            source: prefill?.aiUsed ? 'AI_PREFILL' : 'MANUAL',
            aiConfidence: prefill?.aiUsed ? prefill?.confidence : null,
            prefillMeta,
          };

      const { data } = await api.post(`/account-provisioning/ticket/${ticketId}`, payload);
      const hasRightsRow = !noAccountCreated && rows.some((row) => row.operation === 'DROITS');
      const hasCreationRow = !noAccountCreated && rows.some((row) => row.operation !== 'DROITS');
      toast.success(
        noAccountCreated
          ? 'Déclaration enregistrée : aucun compte applicatif.'
          : hasRightsRow && hasCreationRow
            ? 'Créations et mises à jour de droits déclarées.'
            : hasRightsRow
              ? 'Mises à jour de droits déclarées.'
              : 'Comptes applicatifs déclarés.'
      );
      // Avertissements non bloquants (ex. identifiant déjà déclaré sur un autre ticket).
      const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
      warnings.slice(0, 3).forEach((warning) => toast.warning(warning.message || String(warning)));
      if (data?.record?.budibaseStatus === 'FAILED') {
        toast.warning('Enregistré localement — la synchronisation Budibase sera retentée automatiquement.');
      } else if (data?.record?.budibaseStatus === 'SKIPPED') {
        toast.info('Enregistré localement — Budibase n’est pas configuré.');
      }
      onSaved?.(data?.record || null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l’enregistrement de la déclaration.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 md:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => { if (!submitting) onClose(); }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            role="dialog"
            aria-modal="true"
            aria-label="Déclaration des opérations sur comptes applicatifs"
            className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* En-tête */}
            <div className="flex items-start justify-between gap-3 px-5 md:px-6 py-4 border-b border-outline-variant/40 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-primary text-xl">manage_accounts</span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-on-surface">
                    {existingRecord ? 'Opérations sur comptes déclarées' : 'Comptes créés / droits modifiés'}
                  </h2>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">
                    Ticket #{ticketId}{ticketTitle ? ` — ${ticketTitle}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { if (!submitting) onClose(); }}
                aria-label="Fermer"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Corps */}
            <div className="px-5 md:px-6 py-4 overflow-y-auto flex-1 space-y-4">
              {/* Bandeau IA / existant */}
              {existingRecord && (
                <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
                  <span className="material-symbols-outlined text-[18px] text-primary shrink-0">edit_note</span>
                  <div className="text-[11px] leading-relaxed text-on-surface-variant">
                    Une déclaration existe déjà pour ce ticket. Modifiez-la si nécessaire, puis validez.
                    {existingRecord.budibaseStatus && (
                      <span className="ml-1 font-semibold text-on-surface">
                        Statut Budibase : {existingRecord.budibaseStatus === 'SYNCED' ? 'synchronisé' : existingRecord.budibaseStatus === 'SKIPPED' ? 'non configuré' : existingRecord.budibaseStatus === 'FAILED' ? 'en échec (rejeu auto)' : 'en attente'}.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!existingRecord && prefill && (
                <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${
                  prefill.aiUsed
                    ? 'border-violet-500/25 bg-violet-500/5'
                    : 'border-outline-variant/50 bg-surface-container-low'
                }`}>
                  {prefill.aiUsed ? (
                    <Sparkles className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                  ) : (
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">info</span>
                  )}
                  <div className="text-[11px] leading-relaxed text-on-surface-variant">
                    {prefill.aiUsed ? (
                      <>
                        <strong className="text-on-surface">Pré-rempli par IA</strong>
                        {aiConfidence ? ` (confiance ${aiConfidence})` : ''} — vérifiez et corrigez avant de valider.
                        {prefill.reason ? ` ${prefill.reason}` : ''}
                        {prefill.evidence && (
                          <span className="block mt-1 italic border-l-2 border-violet-500/40 pl-2 text-on-surface-variant/90">
                            « {prefill.evidence} »
                          </span>
                        )}
                        {prefill.lowConfidence && (
                          <span className="block mt-1 text-amber-600 dark:text-amber-400">
                            Confiance faible : les comptes ne sont pas pré-remplis, seules les applications sont proposées.
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {prefill.isAccountProvisioning
                          ? 'Pré-remplissage automatique à partir du ticket.'
                          : 'Aucune opération sur compte détectée dans le ticket — complétez ou cochez « aucune opération ».'}
                        {prefill.reason ? ` ${prefill.reason}` : ''}
                        {prefill.aiError && (
                          <span className="block mt-1 text-on-surface-variant/80">
                            Analyse IA indisponible — pré-remplissage basé sur le catalogue.
                          </span>
                        )}
                      </>
                    )}
                    {Array.isArray(prefill.ignoredApplications) && prefill.ignoredApplications.length > 0 && (
                      <span className="block mt-1 text-amber-600 dark:text-amber-400">
                        Applications ignorées (hors catalogue) : {prefill.ignoredApplications.join(', ')}.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/5 px-3.5 py-3 text-red-600 dark:text-red-400">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <p className="text-xs font-semibold leading-relaxed">{error}</p>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-on-surface-variant text-sm">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Chargement du formulaire…
                </div>
              ) : (
                <>
                  {/* Aucun compte : échappatoire obligatoire pour les tickets sans création */}
                  <label className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors ${
                    noAccountCreated ? 'border-primary/40 bg-primary/5' : 'border-outline-variant/50 hover:bg-surface-container-low'
                  }`}>
                    <input
                      type="checkbox"
                      className="mt-0.5 w-4 h-4 accent-primary cursor-pointer"
                      checked={noAccountCreated}
                      onChange={(e) => setNoAccountCreated(e.target.checked)}
                    />
                    <span>
                      <span className="block text-xs font-bold text-on-surface">Aucune création de compte ni mise à jour de droits</span>
                      <span className="block text-[11px] text-on-surface-variant mt-0.5">
                        Cochez cette case si la résolution n’implique aucune opération sur un compte applicatif. Cela sera tracé dans le ticket.
                      </span>
                    </span>
                  </label>

                  {!noAccountCreated && (
                    <>
                      {catalog.length === 0 && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          Le catalogue d’applications est vide. Un SUPERADMIN doit ajouter au moins une application dans
                          Paramètres → Avancé → Comptes applicatifs.
                        </div>
                      )}

                      <div className="space-y-3">
                        {rows.map((row, index) => (
                          <div key={index} className={`rounded-2xl border bg-surface-container-lowest p-3.5 ${
                            duplicateRowIndexes.has(index) ? 'border-red-500/50' : 'border-outline-variant/50'
                          }`}>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant">
                                <span className="w-5 h-5 rounded-md bg-primary/10 text-primary flex items-center justify-center text-[10px] font-black">
                                  {index + 1}
                                </span>
                                {row.operation === 'DROITS' ? 'Droits du compte' : 'Compte / application'}
                              </span>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-0.5 rounded-xl bg-surface-container-high p-0.5">
                                  {OPERATION_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() => setRowOperation(index, option.value)}
                                      aria-pressed={row.operation === option.value}
                                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${
                                        row.operation === option.value
                                          ? 'bg-primary text-on-primary shadow-sm'
                                          : 'text-on-surface-variant hover:text-on-surface'
                                      }`}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeRow(index)}
                                  disabled={rows.length <= 1}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                  aria-label={`Supprimer la ligne ${index + 1}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            {duplicateRowIndexes.has(index) && (
                              <p className="text-[10px] font-semibold text-red-500 mb-2 -mt-1">
                                Ce compte est déjà saisi sur une autre ligne (même application + même identifiant ou email).
                              </p>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                              <label className="sm:col-span-2 lg:col-span-1">
                                <span className={labelClass}>Application *</span>
                                <select
                                  className={inputClass}
                                  value={row.applicationId}
                                  onChange={(e) => updateRow(index, 'applicationId', e.target.value)}
                                >
                                  <option value="">— Choisir —</option>
                                  {catalog.map((app) => (
                                    <option key={app.id} value={String(app.id)}>{app.name}</option>
                                  ))}
                                </select>
                              </label>

                              {row.operation !== 'DROITS' && (
                                <>
                                  <label>
                                    <span className={labelClass}>Type de compte</span>
                                    <select
                                      className={inputClass}
                                      value={row.type}
                                      onChange={(e) => updateRow(index, 'type', e.target.value)}
                                    >
                                      {ACCOUNT_TYPES.map((type) => (
                                        <option key={type.value} value={type.value}>{type.label}</option>
                                      ))}
                                    </select>
                                  </label>

                                  <label>
                                    <span className={labelClass}>Quantité</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={500}
                                      className={inputClass}
                                      value={row.quantity}
                                      onChange={(e) => updateRow(index, 'quantity', e.target.value)}
                                    />
                                  </label>
                                </>
                              )}

                              <label>
                                <span className={labelClass}>
                                  {row.operation === 'DROITS' ? 'Profil / rôle mis à jour' : 'Profil / rôle'}
                                  {profileOptionsFor(catalog, row.applicationId).length > 0 ? ' *' : ''}
                                </span>
                                {profileOptionsFor(catalog, row.applicationId).length > 0 ? (
                                  <select
                                    className={inputClass}
                                    style={fieldErrors[index]?.profile ? { borderColor: 'rgb(239 68 68 / 0.6)' } : undefined}
                                    value={row.profile}
                                    aria-invalid={Boolean(fieldErrors[index]?.profile)}
                                    onChange={(e) => updateRow(index, 'profile', e.target.value)}
                                  >
                                    <option value="">— Choisir —</option>
                                    {profileOptionsFor(catalog, row.applicationId).map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                    {row.profile && !profileOptionsFor(catalog, row.applicationId).includes(row.profile) && (
                                      <option value={row.profile}>{row.profile} (hors liste)</option>
                                    )}
                                  </select>
                                ) : (
                                  <input
                                    className={inputClass}
                                    value={row.profile}
                                    onChange={(e) => updateRow(index, 'profile', e.target.value)}
                                    placeholder="Comptable, E3…"
                                  />
                                )}
                                {fieldErrors[index]?.profile && (
                                  <p className="text-[10px] font-semibold text-red-500 mt-1">{fieldErrors[index].profile}</p>
                                )}
                              </label>

                              <label>
                                <span className={labelClass}>
                                  {row.operation === 'DROITS' ? 'Compte cible *' : 'Identifiant *'}
                                </span>
                                <input
                                  className={inputClass}
                                  style={fieldErrors[index]?.login ? { borderColor: 'rgb(239 68 68 / 0.6)' } : undefined}
                                  value={row.login}
                                  aria-invalid={Boolean(fieldErrors[index]?.login)}
                                  onChange={(e) => updateRow(index, 'login', e.target.value)}
                                  placeholder="j.doe"
                                  autoComplete="off"
                                />
                                {fieldErrors[index]?.login ? (
                                  <p className="text-[10px] font-semibold text-red-500 mt-1">{fieldErrors[index].login}</p>
                                ) : (
                                  <span className="block text-[10px] text-on-surface-variant/80 mt-1">
                                    Obligatoire, sauf si l’email ci-dessous est renseigné.
                                  </span>
                                )}
                              </label>

                              <label>
                                <span className={labelClass}>Email</span>
                                <input
                                  type="email"
                                  className={inputClass}
                                  style={fieldErrors[index]?.email ? { borderColor: 'rgb(239 68 68 / 0.6)' } : undefined}
                                  value={row.email}
                                  aria-invalid={Boolean(fieldErrors[index]?.email)}
                                  onChange={(e) => updateRow(index, 'email', e.target.value)}
                                  placeholder="j.doe@prosuma.ci"
                                />
                                {fieldErrors[index]?.email && (
                                  <p className="text-[10px] font-semibold text-red-500 mt-1">{fieldErrors[index].email}</p>
                                )}
                              </label>

                              {row.operation === 'DROITS' && (
                                <label className="sm:col-span-2">
                                  <span className={labelClass}>Droit accordé</span>
                                  <input
                                    className={inputClass}
                                    value={row.rights}
                                    onChange={(e) => updateRow(index, 'rights', e.target.value)}
                                    placeholder="ex. accès module Paie, validation des factures…"
                                  />
                                  <span className="block text-[10px] text-on-surface-variant/80 mt-1">
                                    Texte libre. Remplace le profil si l’application n’en propose pas la valeur.
                                  </span>
                                </label>
                              )}

                              {row.operation !== 'DROITS' && (
                                <label className="sm:col-span-2">
                                  <span className={labelClass}>Transmission du mot de passe</span>
                                  <input
                                    className={inputClass}
                                    value={row.passwordDeliveryChannel}
                                    onChange={(e) => updateRow(index, 'passwordDeliveryChannel', e.target.value)}
                                    placeholder="Remis en main propre, téléphone…"
                                  />
                                  <span className="block text-[10px] text-on-surface-variant/80 mt-1">
                                    Ne saisissez jamais le mot de passe lui-même.
                                  </span>
                                </label>
                              )}

                              <label className="sm:col-span-2 lg:col-span-4">
                                <span className={labelClass}>Note</span>
                                <input
                                  className={inputClass}
                                  value={row.note}
                                  onChange={(e) => updateRow(index, 'note', e.target.value)}
                                  placeholder="Précision utile (société, dossier, licence…)"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={addRow}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant/70 py-2.5 text-xs font-bold text-on-surface-variant hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Ajouter une application / un compte
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Pied */}
            <div className="px-5 md:px-6 py-3.5 border-t border-outline-variant/40 bg-surface-container-lowest flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <p className="text-[10px] text-on-surface-variant flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                Enregistrement local sécurisé, puis synchronisation Budibase.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { if (!submitting) onClose(); }}
                  className="px-4 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting || loading || (!noAccountCreated && catalog.length === 0)}
                  className="btn-gradient px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-primary/10 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {existingRecord ? 'Mettre à jour la déclaration' : 'Valider et enregistrer'}
                </button>
              </div>
            </div>
          </motion.form>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
