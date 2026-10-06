import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { FileText, ChevronLeft, ChevronRight, Send, Check, AlertTriangle, Loader2, UserCheck } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import SearchableSelect from '../components/SearchableSelect';
import SearchableMultiSelect from '../components/SearchableMultiSelect';

function parseOptions(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map((v) => ({ value: v, label: v }));
  } catch {}
  return [];
}

// Règle conditionnelle { question, equals? } : vraie si la source est remplie/
// cochée ; sinon égalité (sélecteur) ou présence dans le tableau (liste multiple).
// Même logique que evaluateCondition() côté serveur (utils/conditions.js).
function conditionMet(rule, answers) {
  if (!rule || !rule.question) return false;
  const val = answers[rule.question];
  const isEmpty = val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
  if (isEmpty) return false;
  if (rule.equals === undefined || rule.equals === null || rule.equals === '') return true;
  if (Array.isArray(val)) return val.map(String).includes(String(rule.equals));
  return String(val) === String(rule.equals);
}

// Conditionnel « obligatoire si » : règle posée dans l'éditeur (Paramètres).
function requiredIfMet(question, answers) {
  return conditionMet(question.requiredIf, answers);
}

// Clés réservées de la validation hiérarchique — mêmes libellés que le serveur
// (services/hierarchicalApproval.js → MANAGER_KEY / CC_KEY).
const MANAGER_KEY = 'VALIDATION - E-MAIL DU SUPERIEUR HIERARCHIQUE';
const CC_KEY = 'VALIDATION - COPIE (CC)';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailList = (raw) => String(raw || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);

function FieldRenderer({ question, value, onChange, allAnswers }) {
  const opts = parseOptions(question.values);
  const required = question.required || requiredIfMet(question, allAnswers);
  const isMulti = question.fieldtype === 'multiselect';
  const isCheck = question.fieldtype === 'checkboxes';
  const isSelect = question.fieldtype === 'select';
  const isActor = question.fieldtype === 'actor';
  const isDate = question.fieldtype === 'date';

  // Conditional: fréquence fields only if RÉCURRENTE
  if (question.name.includes('FRÉQUENCE') || question.name.includes('INTITULE DE LA FREQUENCE')) {
    if (allAnswers['NATURE DE REQUETE'] !== 'RÉCURRENTE') return null;
  }

  if (isActor) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-bold text-on-surface flex items-center gap-1">
          {question.name} {required && <span className="text-error font-bold">*</span>}
        </label>
        <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={question.name}
          className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
      </div>
    );
  }
  if (isCheck) {
    return (
      <label className={`flex items-center gap-2.5 rounded-xl px-3 py-2 -mx-1 w-fit max-w-full cursor-pointer border transition-colors
        ${value ? 'bg-primary/5 border-primary/25' : 'bg-surface border-outline-variant/40 hover:border-primary/40 hover:bg-primary/5'}`}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? 'OUI' : '')}
          className="w-4 h-4 rounded accent-primary shrink-0" />
        <span className="text-sm font-medium text-on-surface">{question.name}</span>
        {required && <span className="text-error font-bold text-xs -ml-0.5">*</span>}
      </label>
    );
  }
  if (isSelect) {
    const selectOpts = opts.map((o) => ({ value: o.value, label: o.label }));
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-bold text-on-surface">{question.name} {required && <span className="text-error font-bold">*</span>}</label>
        <SearchableSelect options={selectOpts} value={value || ''} onChange={onChange}
          placeholder="Sélectionner..." searchPlaceholder="Rechercher..." ariaLabel={question.name} />
      </div>
    );
  }
  if (isMulti) {
    const multiOpts = opts.map((o) => ({ value: o.value, label: o.label }));
    const arrVal = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-bold text-on-surface">{question.name} {required && <span className="text-error font-bold">*</span>}</label>
        <SearchableMultiSelect options={multiOpts} value={arrVal} onChange={onChange}
          placeholder="Sélectionner..." searchPlaceholder="Rechercher..." />
      </div>
    );
  }
  if (isDate) {
    const isCheckDate = opts.length === 1 && opts[0].label === 'OUI';
    if (isCheckDate) {
      return (
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-bold text-on-surface">{question.name}</label>
          <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-bold text-on-surface">{question.name} {required && <span className="text-error font-bold">*</span>}</label>
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
      </div>
    );
  }
  // text / textarea
  const isTextarea = question.fieldtype === 'textarea';
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-bold text-on-surface">{question.name} {required && <span className="text-error font-bold">*</span>}</label>
      {isTextarea ? (
        <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={question.description || ''}
          className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none" />
      ) : (
        <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={question.description || ''}
          className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
      )}
    </div>
  );
}

export default function FormRequest() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [forms, setForms] = useState([]);
  const [selectedForm, setSelectedForm] = useState(null);
  const [formDef, setFormDef] = useState(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/form-requests').then(({ data }) => {
      setForms(data);
      if (data.length === 1) {
        setSelectedForm(data[0].id);
      }
    }).catch(() => toast.error('Erreur chargement formulaires')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedForm) return;
    api.get(`/form-requests/${selectedForm}`).then(({ data }) => {
      setFormDef(data);
      // Pré-remplir NOM DU DEMANDEUR
      setAnswers((prev) => ({ ...prev, 'NOM DU DEMANDEUR': user?.fullName || '' }));
      setStep(0);
    }).catch(() => toast.error('Erreur chargement formulaire'));
  }, [selectedForm]);

  const sections = formDef?.sections ? [...formDef.sections].sort((a, b) => a.order - b.order) : [];
  const currentSection = sections[step];
  const isLastStep = step === sections.length - 1;
  const nbQuestionCount = (secs) => secs.reduce((n, s) => n + (s.questions?.length || 0), 0);

  function missingRequired() {
    if (!currentSection) return [];
    return currentSection.questions
      .filter((q) => {
        if (!q.required && !requiredIfMet(q, answers)) return false;
        if (q.name.includes('FRÉQUENCE') && answers['NATURE DE REQUETE'] !== 'RÉCURRENTE') return false;
        const val = answers[q.name];
        return val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
      })
      .map((q) => q.name);
  }
  function canGoNext() {
    return !!currentSection && formMissing.length === 0;
  }
  const missing = missingRequired();

  // ── Validation hiérarchique (bloc « Validation supérieure » de l'éditeur) ──
  // Champs e-mail supérieur + copie injectés ici (jamais stockés comme
  // questions) et affichés seulement si la condition déclencheuse est vraie.
  const approvalCfg = (formDef?.approval && typeof formDef.approval === 'object') ? formDef.approval : null;
  const approvalNeeded = !!(approvalCfg?.enabled && approvalCfg.trigger?.question
    && conditionMet(approvalCfg.trigger, answers));
  const managerEmail = String(answers[MANAGER_KEY] || '').trim();
  const ccEmails = emailList(answers[CC_KEY]);
  const approvalMissing = approvalNeeded && !EMAIL_RE.test(managerEmail);
  const ccInvalid = approvalNeeded ? ccEmails.filter((a) => !EMAIL_RE.test(a)) : [];
  const formMissing = [
    ...missing,
    ...(approvalMissing ? ['e-mail du supérieur hiérarchique'] : []),
    ...(ccInvalid.length ? ['copie (CC) invalide'] : []),
  ];

  async function handleSubmit() {
    if (approvalNeeded && !EMAIL_RE.test(managerEmail)) {
      toast.error('Validation supérieure : l’e-mail du supérieur hiérarchique est requis');
      return;
    }
    if (ccInvalid.length > 0) {
      toast.error(`Validation supérieure : adresse(s) en copie invalide(s) : ${ccInvalid.join(', ')}`);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/form-requests/${selectedForm}/submit`, { answers });
      toast.success(`Ticket #${data.ticketId} créé avec succès`);
      navigate(`/tickets/${data.ticketId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la soumission');
    } finally { setSubmitting(false); }
  }

  if (loading) return (
    <div className="p-12 flex flex-col items-center gap-3 text-on-surface-variant text-sm">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
      Chargement du formulaire…
    </div>
  );

  // Sélection du formulaire (si plusieurs)
  if (!formDef && forms.length > 1) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <h1 className="text-xl font-bold text-on-surface flex items-center gap-2"><FileText className="w-6 h-6 text-primary" />Formulaires de demande</h1>
        <div className="grid gap-4">
          {forms.map((f) => (
            <button key={f.id} onClick={() => setSelectedForm(f.id)}
              className="group text-left p-5 rounded-2xl border border-outline-variant/30 bg-surface hover:border-primary/40 hover:bg-primary/5 transition-all">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-on-surface">{f.name}</p>
                  <p className="text-xs text-on-surface-variant mt-1">{f.category || ''}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-on-surface-variant shrink-0 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!formDef) return <div className="p-8 text-center text-sm text-on-surface-variant">Aucun formulaire disponible.</div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-start gap-3.5">
          <span
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white shrink-0 shadow-lg"
            style={{
              background: formDef.bgColor || '#674ea7',
              boxShadow: `0 8px 20px -6px ${formDef.bgColor || '#674ea7'}`,
            }}
          >
            📋
          </span>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-extrabold text-on-surface leading-tight">{formDef.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {formDef.category && (
                <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {formDef.category}
                </span>
              )}
              <span className="text-[11px] font-semibold text-on-surface-variant">
                {sections.length} section{sections.length > 1 ? 's' : ''} · {nbQuestionCount(sections)} champ{nbQuestionCount(sections) > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
        {formDef.description && (
          <p className="text-xs text-on-surface-variant leading-relaxed pl-[58px]">{formDef.description}</p>
        )}
      </header>

      {/* Barre de progression globale */}
      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden" role="progressbar"
        aria-valuemin={1} aria-valuemax={sections.length} aria-valuenow={step + 1}>
        <div className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${((step + 1) / sections.length) * 100}%` }} />
      </div>

      {/* Stepper */}
      <nav className="flex items-start overflow-x-auto pb-1" aria-label="Étapes du formulaire">
        {sections.map((sec, idx) => {
          const isActive = idx === step;
          const isDone = idx < step;
          return (
            <div key={sec.uuid} className="flex items-start shrink-0">
              {idx > 0 && (
                <span className={`mt-[18px] h-0.5 w-4 sm:w-7 rounded-full ${idx <= step ? 'bg-primary' : 'bg-outline-variant/60'}`} />
              )}
              <button type="button" onClick={() => setStep(idx)} aria-current={isActive ? 'step' : undefined}
                title={sec.name}
                className="group flex flex-col items-center gap-1 px-1.5 py-0.5">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                  ${isActive ? 'border-primary bg-primary text-white shadow-md shadow-primary/30 scale-105'
                    : isDone ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-outline-variant/70 bg-surface text-on-surface-variant group-hover:border-primary/50 group-hover:text-primary'}`}>
                  {isDone ? <Check className="w-4 h-4" /> : idx + 1}
                </span>
                <span className={`hidden sm:block text-[10px] font-semibold leading-tight text-center line-clamp-2 max-w-[96px] break-words ${isActive ? 'text-primary' : isDone ? 'text-emerald-600' : 'text-on-surface-variant group-hover:text-primary'}`}>
                  {sec.name}
                </span>
              </button>
            </div>
          );
        })}
      </nav>

      {/* Current section */}
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
          className="bento-card p-5 sm:p-7 space-y-6">
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant/30 pb-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">
                Section {step + 1} sur {sections.length}
              </p>
              <h2 className="text-base font-extrabold uppercase tracking-wide text-primary truncate">{currentSection?.name}</h2>
            </div>
            <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {currentSection?.questions.length || 0} champ{(currentSection?.questions.length || 0) > 1 ? 's' : ''}
            </span>
          </div>

          {!currentSection?.questions.length ? (
            <p className="text-sm text-on-surface-variant italic text-center py-8">
              Aucun champ dans cette section — passez à la suivante.
            </p>
          ) : (
            <div className="space-y-5">
              {[...currentSection.questions]
                .sort((a, b) => a.row - b.row || a.col - b.col)
                .map((q) => (
                  <FieldRenderer key={q.uuid} question={q} value={answers[q.name]}
                    onChange={(v) => setAnswers((prev) => ({ ...prev, [q.name]: v }))} allAnswers={answers} />
                ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Validation hiérarchique : e-mail du supérieur + copie (champs injectés) */}
      {approvalNeeded && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 sm:p-5 space-y-4 shadow-sm" data-testid="approval-block">
          <div className="flex items-start gap-2.5">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 shrink-0"><UserCheck className="w-4 h-4" /></span>
            <div>
              <p className="text-xs font-bold text-on-surface">Validation supérieure requise</p>
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Indiquez l’e-mail de votre supérieur hiérarchique : il recevra un e-mail avec un lien pour
                approuver ou refuser cette demande avant traitement.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold text-on-surface">
                {MANAGER_KEY} <span className="text-error font-bold">*</span>
              </span>
              <input type="email" value={answers[MANAGER_KEY] || ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [MANAGER_KEY]: e.target.value }))}
                placeholder="prenom.nom@entreprise.ci"
                className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold text-on-surface">{CC_KEY} — optionnel</span>
              <input type="text" value={answers[CC_KEY] || ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [CC_KEY]: e.target.value }))}
                placeholder="a@x.ci, b@x.ci"
                className={`w-full px-3 py-2 rounded-xl border bg-surface text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 ${ccInvalid.length ? 'border-error' : 'border-outline-variant focus:border-emerald-500'}`} />
            </label>
          </div>
        </div>
      )}

      {/* Navigation (collée en bas) */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-4 bg-surface/85 backdrop-blur-xl border-t border-outline-variant/40 z-10">
        {formMissing.length > 0 && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Champs obligatoires à compléter : <span className="font-bold">{formMissing.join(', ')}</span></span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl border border-outline-variant text-sm font-semibold disabled:opacity-40 hover:bg-surface-container transition-colors">
            <ChevronLeft className="w-4 h-4" /> Précédent
          </button>
          {isLastStep ? (
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:bg-primary/90 disabled:opacity-50 disabled:shadow-none transition-all">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer la demande
            </button>
          ) : (
            <button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext()}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-primary text-white text-sm font-semibold shadow-md shadow-primary/25 hover:bg-primary/90 disabled:opacity-40 disabled:shadow-none transition-all">
              Suivant <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
