import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { FileText, ChevronLeft, ChevronRight, Send, Check, AlertTriangle, Loader2 } from 'lucide-react';
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

function FieldRenderer({ question, value, onChange, allAnswers }) {
  const opts = parseOptions(question.values);
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
        <label className="text-xs font-semibold text-on-surface flex items-center gap-1">
          {question.name} {question.required && <span className="text-error">*</span>}
        </label>
        <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={question.name}
          className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
      </div>
    );
  }
  if (isCheck) {
    return (
      <label className="flex items-center gap-2 cursor-pointer py-1">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? 'OUI' : '')}
          className="w-4 h-4 rounded accent-primary" />
        <span className="text-sm text-on-surface">{question.name}</span>
      </label>
    );
  }
  if (isSelect) {
    const selectOpts = opts.map((o) => ({ value: o.value, label: o.label }));
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-on-surface">{question.name} {question.required && <span className="text-error">*</span>}</label>
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
        <label className="text-xs font-semibold text-on-surface">{question.name} {question.required && <span className="text-error">*</span>}</label>
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
          <label className="text-xs font-semibold text-on-surface">{question.name}</label>
          <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-on-surface">{question.name} {question.required && <span className="text-error">*</span>}</label>
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
      </div>
    );
  }
  // text / textarea
  const isTextarea = question.fieldtype === 'textarea';
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-on-surface">{question.name} {question.required && <span className="text-error">*</span>}</label>
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

  function canGoNext() {
    if (!currentSection) return false;
    for (const q of currentSection.questions) {
      if (!q.required) continue;
      if (q.name.includes('FRÉQUENCE') && answers['NATURE DE REQUETE'] !== 'RÉCURRENTE') continue;
      const val = answers[q.name];
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) return false;
    }
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const { data } = await api.post(`/form-requests/${selectedForm}/submit`, { answers });
      toast.success(`Ticket #${data.ticketId} créé avec succès`);
      navigate(`/tickets/${data.ticketId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la soumission');
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="p-8 text-center text-sm text-on-surface-variant"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Chargement...</div>;

  // Sélection du formulaire (si plusieurs)
  if (!formDef && forms.length > 1) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <h1 className="text-xl font-bold text-on-surface flex items-center gap-2"><FileText className="w-6 h-6 text-primary" />Formulaires de demande</h1>
        <div className="grid gap-4">
          {forms.map((f) => (
            <button key={f.id} onClick={() => setSelectedForm(f.id)}
              className="text-left p-5 rounded-2xl border border-outline-variant/30 bg-surface hover:border-primary/40 hover:bg-primary/5 transition-all">
              <p className="font-semibold text-on-surface">{f.name}</p>
              <p className="text-xs text-on-surface-variant mt-1">{f.category || ''}</p>
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
      <div>
        <h1 className="text-xl font-bold text-on-surface flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm" style={{ background: formDef.bgColor || '#674ea7' }}>📋</span>
          {formDef.name}
        </h1>
        {formDef.category && <p className="text-xs text-on-surface-variant mt-1">{formDef.category}</p>}
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {sections.map((sec, idx) => (
          <button key={sec.uuid} onClick={() => setStep(idx)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${idx === step ? 'bg-primary text-white' : idx < step ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30' : 'bg-surface-container text-on-surface-variant border border-outline-variant/30'}`}>
            {idx < step ? <Check className="w-3 h-3" /> : <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">{idx + 1}</span>}
            <span className="hidden sm:inline truncate max-w-[120px]">{sec.name}</span>
          </button>
        ))}
      </div>

      {/* Current section */}
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
          className="bento-card p-5 sm:p-6 space-y-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary border-b border-outline-variant/20 pb-3">{currentSection?.name}</h2>

          {currentSection?.questions
            .sort((a, b) => a.row - b.row || a.col - b.col)
            .map((q) => (
              <FieldRenderer key={q.uuid} question={q} value={answers[q.name]} onChange={(v) => setAnswers((prev) => ({ ...prev, [q.name]: v }))} allAnswers={answers} />
            ))}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant text-sm font-semibold disabled:opacity-40 hover:bg-surface-container transition-colors">
          <ChevronLeft className="w-4 h-4" /> Précédent
        </button>
        <span className="text-xs text-on-surface-variant">{step + 1} / {sections.length}</span>
        {isLastStep ? (
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer la demande
          </button>
        ) : (
          <button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
            Suivant <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {!canGoNext() && !isLastStep && (
        <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Veuillez remplir les champs obligatoires (*) pour continuer.</p>
      )}
    </div>
  );
}
