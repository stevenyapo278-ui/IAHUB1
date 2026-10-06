import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Check, Pencil, ChevronDown, ChevronUp, Trash2, ClipboardList, Save, Copy, UserCog, UserCheck,
} from 'lucide-react';
import api from '../../api/client';
import {
  PRIORITY_OPTIONS, TYPE_OPTIONS, URGENCY_IMPACT_OPTIONS, SOURCE_OPTIONS, SOURCE_LABELS,
} from '../../constants/tickets';

// ── Demandes de reporting : éditeur des champs ──────────────────────────────
// Administration des FormDefinition affichées par /form-request, depuis
// Paramètres > Modèles de tickets. Sections pliables, champs réordonnables
// (l'ordre du tableau = l'ordre affiché côté demande), types limités au
// FieldRenderer de FormRequest.jsx. Le bloc « Affectation » configure le ticket
// créé à la soumission : jamais visible par le demandeur.

const FIELD_TYPES = [
  { value: 'text', label: 'Texte court' },
  { value: 'textarea', label: 'Texte long' },
  { value: 'actor', label: 'Acteur (nom libre)' },
  { value: 'select', label: 'Liste déroulante' },
  { value: 'multiselect', label: 'Liste multiple' },
  { value: 'checkboxes', label: 'Cases à cocher' },
  { value: 'date', label: 'Date' },
];
const OPTION_TYPES = ['select', 'multiselect', 'checkboxes'];

const inputCls = 'w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `u${Date.now()}${Math.random().toString(16).slice(2)}`);

const EMPTY_FORM = {
  name: '', description: '', category: 'Demande reporting', isActive: true,
  sections: [{ name: 'Section 1', order: 1, uuid: uid(), questions: [] }],
  assignment: null,
  approval: null,
};

const EMPTY_ASSIGNMENT = {
  teamId: null, assignedToId: null, priority: null, type: null,
  urgency: null, impact: null, locationId: null, source: null,
};

const sortByRow = (questions) =>
  [...(questions || [])].sort((a, b) => ((a.row || 0) - (b.row || 0)) || ((a.col || 0) - (b.col || 0)));

// values (JSON string GLPI) ↔ une option par ligne dans la textarea
function optionsToLines(values) {
  if (!values) return '';
  if (Array.isArray(values)) return values.join('\n');
  try {
    const parsed = JSON.parse(values);
    return Array.isArray(parsed) ? parsed.join('\n') : String(values);
  } catch { return String(values); }
}
function linesToValues(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? JSON.stringify(lines) : null;
}

export default function ReportingFormsSection() {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null | 'new' | id
  const [draft, setDraft] = useState(null);
  const [openSec, setOpenSec] = useState({}); // index de section ouverte
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [locations, setLocations] = useState([]);

  function applyForms({ data }) { setForms(data); setLoading(false); }
  function failLoad(err) {
    setLoading(false);
    toast.error(err.response?.data?.error || 'Erreur de chargement des formulaires');
  }
  function load() { setLoading(true); api.get('/form-definitions').then(applyForms).catch(failLoad); }
  // chargement initial : setState uniquement en callbacks async
  useEffect(() => {
    api.get('/form-definitions').then(applyForms).catch(failLoad);
  }, []);

  // Référentiels du bloc Affectation : chargés à l'ouverture de l'éditeur
  const editing = editingId !== null;
  useEffect(() => {
    if (!editing) return;
    api.get('/teams').then(({ data }) => setTeams(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/locations').then(({ data }) => setLocations(Array.isArray(data) ? data : [])).catch(() => {});
  }, [editing]);

  // Techniciens = membres non-REQUESTER des équipes, dédupliqués
  const techById = new Map();
  teams.forEach((t) => (t.members || []).forEach((m) => {
    if (m.role === 'REQUESTER') return;
    const existing = techById.get(m.id);
    if (existing) { existing.teamIds.push(t.id); return; }
    techById.set(m.id, { ...m, teamIds: [t.id], teamName: t.name });
  }));
  const technicians = [...techById.values()].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

  function startEdit(f) {
    setDraft({
      name: f.name,
      description: f.description || '',
      category: f.category || '',
      isActive: f.isActive,
      assignment: { ...EMPTY_ASSIGNMENT, ...(f.assignment || {}) },
      approval: f.approval || null,
      // Trier par champ `order` : c'est lui qui pilote l'affichage dans
      // /formRequest (le tableau JSON GLPI n'est pas forcément trié)
      sections: (f.sections || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((s) => ({ ...s, questions: sortByRow(s.questions) })),
    });
    setEditingId(f.id);
    setOpenSec({ 0: (f.sections || []).length <= 3 });
  }
  function startNew() {
    setDraft({
      ...EMPTY_FORM,
      assignment: { ...EMPTY_ASSIGNMENT },
      sections: [{ ...EMPTY_FORM.sections[0], uuid: uid() }],
    });
    setEditingId('new');
    setOpenSec({ 0: true });
  }
  function duplicate(f) {
    setDraft({
      name: `${f.name} (copie)`,
      description: f.description || '',
      category: f.category || '',
      isActive: false,
      assignment: { ...EMPTY_ASSIGNMENT, ...(f.assignment || {}) },
      approval: f.approval || null,
      sections: (f.sections || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((s) => ({
          ...s, uuid: uid(), questions: sortByRow(s.questions).map((q) => ({ ...q, uuid: uid() })),
        })),
    });
    setEditingId('new');
    setOpenSec({ 0: (f.sections || []).length <= 3 });
  }
  function cancel() { setEditingId(null); setDraft(null); }

  async function toggleActive(f) {
    try {
      await api.patch(`/form-definitions/${f.id}`, { isActive: !f.isActive });
      toast.success(f.isActive ? 'Formulaire désactivé (masqué de /form-request)' : 'Formulaire activé');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur lors de la modification'); }
  }

  async function save() {
    if (!draft.name.trim()) return toast.error('Nom du formulaire requis');
    for (let i = 0; i < draft.sections.length; i += 1) {
      const s = draft.sections[i];
      if (!s.name.trim()) return toast.error(`Section ${i + 1} : nom requis`);
      for (const q of s.questions) {
        if (!q.name.trim()) return toast.error(`Champ sans intitulé dans « ${s.name} »`);
      }
    }
    if (draft.approval?.enabled && !String(draft.approval.trigger?.question || '').trim()) {
      return toast.error('Validation supérieure : choisissez le champ déclencheur');
    }
    setSaving(true);
    try {
      // Affectation : clés vides supprimées → null si tout est vide (effacée)
      const a = draft.assignment || {};
      const cleaned = {};
      for (const [k, v] of Object.entries(a)) if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
      // Validation hiérarchique : { enabled, trigger: { question, equals? } } ou null
      const ap = draft.approval;
      const apTriggerQ = String(ap?.trigger?.question || '').trim();
      const apEquals = String(ap?.trigger?.equals || '').trim();
      const approval = ap?.enabled && apTriggerQ
        ? { enabled: true, trigger: { question: apTriggerQ, ...(apEquals ? { equals: apEquals } : {}) } }
        : null;
      const payload = {
        name: draft.name.trim(),
        description: draft.description || null,
        category: draft.category || null,
        isActive: draft.isActive,
        assignment: Object.keys(cleaned).length > 0 ? cleaned : null,
        approval,
        sections: draft.sections.map((s, i) => ({
          ...s,
          order: i + 1,
          questions: sortByRow(s.questions).map((q, j) => ({ ...q, row: j + 1 })),
        })),
      };
      if (editingId === 'new') {
        await api.post('/form-definitions', payload);
        toast.success('Formulaire créé');
      } else {
        await api.patch(`/form-definitions/${editingId}`, payload);
        toast.success('Formulaire mis à jour');
      }
      cancel();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'enregistrement');
    } finally { setSaving(false); }
  }

  // ── Mutations sur le brouillon ───────────────────────────────────────────
  function setSections(updater) { setDraft((d) => ({ ...d, sections: updater(d.sections) })); }
  function patchSection(i, patch) {
    setSections((secs) => secs.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  }
  function removeSection(i) {
    if (draft.sections.length <= 1) return toast.error('Le formulaire doit garder au moins une section');
    if (!window.confirm(`Supprimer la section « ${draft.sections[i].name} » et ses ${draft.sections[i].questions.length} champ(s) ?`)) return;
    setSections((secs) => secs.filter((_, k) => k !== i));
    setOpenSec({});
  }
  function addSection() {
    setSections((secs) => [...secs, { name: `Section ${secs.length + 1}`, order: secs.length + 1, uuid: uid(), questions: [] }]);
    setOpenSec((o) => ({ ...o, [draft.sections.length]: true }));
  }
  function patchQuestion(si, qi, patch) {
    setDraft((d) => {
      const oldName = String(d.sections[si]?.questions?.[qi]?.name || '').trim();
      const newName = patch.name !== undefined ? String(patch.name).trim() : null;
      const renamed = newName !== null && newName !== '' && newName !== oldName;
      const sections = d.sections.map((s, k) => (k !== si ? s : {
        ...s, questions: s.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)),
      }));
      if (!renamed) return { ...d, sections };
      // Les conditions « obligatoire si » et la validation hiérarchique
      // référencent l'intitulé du champ source : suivre le renommage.
      const fixedSections = sections.map((s) => ({ ...s, questions: s.questions.map((q) => (
        q.requiredIf && q.requiredIf.question === oldName
          ? { ...q, requiredIf: { ...q.requiredIf, question: newName } }
          : q
      )) }));
      const approval = (d.approval && d.approval.trigger && d.approval.trigger.question === oldName)
        ? { ...d.approval, trigger: { ...d.approval.trigger, question: newName } }
        : d.approval;
      return { ...d, sections: fixedSections, approval };
    });
  }
  function removeQuestion(si, qi) {
    const q = draft.sections[si].questions[qi];
    if (!window.confirm(`Supprimer le champ « ${q.name} » ?`)) return;
    const removedName = String(q.name || '').trim();
    const hadApprovalTrigger = !!(draft.approval?.enabled && draft.approval.trigger?.question === removedName);
    setDraft((d) => ({
      ...d,
      approval: hadApprovalTrigger ? null : d.approval,
      sections: d.sections.map((s, k) => (k !== si ? s : {
        ...s,
        questions: s.questions
          .filter((_, j) => j !== qi)
          // Les conditions « obligatoire si » qui visaient ce champ sont retirées
          .map((x, j) => ({
            ...x, row: j + 1,
            requiredIf: removedName && x.requiredIf && x.requiredIf.question === removedName ? null : x.requiredIf,
          })),
      })),
    }));
    if (hadApprovalTrigger) toast.info('Validation supérieure désactivée (champ déclencheur supprimé)');
  }
  function addQuestion(si) {
    setSections((secs) => secs.map((s, k) => (k !== si ? s : {
      ...s, questions: [...s.questions, {
        name: '', fieldtype: 'text', required: false, values: null, description: '',
        row: s.questions.length + 1, col: 1, uuid: uid(),
      }],
    })));
    setOpenSec((o) => ({ ...o, [si]: true }));
  }
  function moveQuestion(si, qi, dir) {
    setSections((secs) => secs.map((s, k) => {
      if (k !== si) return s;
      const qs = [...s.questions];
      const to = qi + dir;
      if (to < 0 || to >= qs.length) return s;
      [qs[qi], qs[to]] = [qs[to], qs[qi]];
      return { ...s, questions: qs.map((q, j) => ({ ...q, row: j + 1 })) };
    }));
  }
  function setAssignment(key, value) {
    setDraft((d) => ({ ...d, assignment: { ...EMPTY_ASSIGNMENT, ...d.assignment, [key]: value || null } }));
  }
  // Validation hiérarchique : objet { enabled, trigger: { question, equals? } }
  function patchApproval(patch) {
    setDraft((d) => ({
      ...d,
      approval: { enabled: false, trigger: { question: '', equals: '' }, ...(d.approval || {}), ...patch },
    }));
  }
  function toggleApproval(enabled) {
    if (enabled) patchApproval({ enabled: true, trigger: { question: '', equals: '' } });
    else patchApproval({ enabled: false });
  }
  function assignSelect(label, key, options, defaultLabel) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{label}</span>
        <select className={inputCls} value={(draft.assignment && draft.assignment[key]) || ''}
          onChange={(e) => setAssignment(key, e.target.value)}>
          <option value="">{defaultLabel}</option>
          {options}
        </select>
      </label>
    );
  }

  const nbFields = (f) => f.fieldCount ?? (f.sections || []).reduce((n, s) => n + (s.questions?.length || 0), 0);

  // Autres champs du formulaire (source potentielle d'une condition)
  function otherQuestions(si, qi) {
    const out = [];
    draft.sections.forEach((s, k) => s.questions.forEach((q, j) => {
      if (k === si && j === qi) return;
      const name = String(q.name || '').trim();
      if (!name) return;
      out.push({ value: name, label: `${s.name} › ${name}` });
    }));
    return out;
  }

  // ── Édition ──────────────────────────────────────────────────────────────
  if (editingId !== null && draft) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" />
              {editingId === 'new' ? 'Nouveau formulaire de reporting' : 'Modifier le formulaire'}
            </h3>
            <p className="text-[11px] text-on-surface-variant">
              Sections et champs du formulaire affiché sur « Demande reporting » (/form-request).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={cancel} className="px-4 py-2 rounded-xl text-xs font-semibold border border-outline-variant/40 hover:bg-surface-container text-on-surface transition-all cursor-pointer">
              Annuler
            </button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-on-primary hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4 space-y-3 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Nom du formulaire *</span>
              <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Catégorie</span>
              <input className={inputCls} value={draft.category || ''} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Description</span>
              <input className={inputCls} value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              className="w-4 h-4 rounded accent-primary" />
            <span className="text-xs font-semibold text-on-surface">Formulaire actif (visible sur /form-request)</span>
          </label>
        </div>

        {/* ── Affectation automatique : config admin, jamais visible par le demandeur ── */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary"><UserCog className="w-4 h-4" /></span>
            <div>
              <p className="text-xs font-bold text-on-surface">Affectation automatique du ticket</p>
              <p className="text-[10px] text-on-surface-variant">
                Appliquée à chaque soumission de ce formulaire — le demandeur ne voit ni ne saisit ces champs.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {assignSelect('Équipe assignée', 'teamId',
              teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>), '— Aucune —')}
            {assignSelect('Assigné à', 'assignedToId',
              technicians.map((m) => <option key={m.id} value={m.id}>{m.fullName} — {m.teamName}</option>),
              technicians.length > 0 ? '— Aucun —' : '— Aucun technicien (membres d’équipe requis) —')}
            {assignSelect('Priorité', 'priority',
              PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>), '— Par défaut (P3) —')}
            {assignSelect('Type', 'type',
              TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>), '— Par défaut (Demande) —')}
            {assignSelect('Urgence', 'urgency',
              URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>), '— Par défaut (Moyenne) —')}
            {assignSelect('Impact', 'impact',
              URGENCY_IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>), '— Par défaut (Moyenne) —')}
            {assignSelect('Lieu', 'locationId',
              locations.map((l) => <option key={l.id} value={l.id}>{l.completename || l.name}</option>), '— Aucun —')}
            {assignSelect('Source', 'source',
              SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>), '— Par défaut (Formulaire) —')}
          </div>
        </div>

        {/* ── Validation hiérarchique : déclencheur conditionnel ── */}
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600"><UserCheck className="w-4 h-4" /></span>
            <div>
              <p className="text-xs font-bold text-on-surface">Validation supérieure (conditionnelle)</p>
              <p className="text-[10px] text-on-surface-variant">
                Quand la condition est vraie, le demandeur saisi l’e-mail de son supérieur (et des personnes en copie) ;
                le supérieur reçoit un e-mail avec un lien pour approuver ou refuser avant traitement.
              </p>
            </div>
            <label className="ml-auto flex items-center gap-1.5 cursor-pointer shrink-0">
              <input type="checkbox" checked={!!draft.approval?.enabled}
                onChange={(e) => toggleApproval(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-600" />
              <span className="text-[11px] font-semibold text-on-surface">Active</span>
            </label>
          </div>
          {draft.approval?.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Quand ce champ est vrai… *
                </span>
                <select className={inputCls}
                  value={draft.approval.trigger?.question || ''}
                  onChange={(e) => patchApproval({
                    trigger: { ...(draft.approval.trigger || {}), question: e.target.value },
                  })}>
                  <option value="">— Choisir un champ déclencheur —</option>
                  {otherQuestions(-1, -1).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Valeur attendue (vide = remplie/cochée)
                </span>
                <input className={inputCls} placeholder="ex. OUI"
                  value={draft.approval.trigger?.equals || ''}
                  onChange={(e) => patchApproval({
                    trigger: { ...(draft.approval.trigger || {}), equals: e.target.value },
                  })} />
              </label>
            </div>
          )}
        </div>

        {draft.sections.map((sec, si) => {
          const open = !!openSec[si];
          return (
            <div key={sec.uuid || si} className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm">
              <div className="flex items-center gap-2 p-3">
                <button onClick={() => setOpenSec((o) => ({ ...o, [si]: !o[si] }))}
                  className="p-1 rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer"
                  aria-expanded={open} title={open ? 'Replier' : 'Déplier'}>
                  {open ? <ChevronDown className="w-4 h-4 text-on-surface-variant" /> : <ChevronUp className="w-4 h-4 text-on-surface-variant" />}
                </button>
                <span className="text-xs font-extrabold uppercase tracking-wider text-primary shrink-0">
                  Section {si + 1}
                </span>
                <input value={sec.name}
                  onChange={(e) => patchSection(si, { name: e.target.value })}
                  placeholder="Nom de la section"
                  className={`${inputCls} flex-1 min-w-[10rem] max-w-[22rem]`} />
                <span className="text-[10px] font-semibold text-on-surface-variant shrink-0">{sec.questions.length} champ(s)</span>
                <button onClick={() => addQuestion(si)} title="Ajouter un champ"
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer">
                  <Plus className="w-4 h-4" />
                </button>
                <button onClick={() => removeSection(si)} title="Supprimer la section"
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {open && (
                <div className="px-3 pb-3 space-y-2">
                  {sec.questions.length === 0 && (
                    <p className="text-[11px] text-on-surface-variant italic py-2">Aucun champ — cliquez sur + pour en ajouter un.</p>
                  )}
                  {sec.questions.map((q, qi) => {
                    const hasOptions = OPTION_TYPES.includes(q.fieldtype);
                    return (
                      <div key={q.uuid || qi} className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <div className="flex flex-col">
                            <button onClick={() => moveQuestion(si, qi, -1)} disabled={qi === 0}
                              className="p-0.5 text-on-surface-variant hover:text-primary disabled:opacity-30 cursor-pointer" title="Monter">
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => moveQuestion(si, qi, 1)} disabled={qi === sec.questions.length - 1}
                              className="p-0.5 text-on-surface-variant hover:text-primary disabled:opacity-30 cursor-pointer" title="Descendre">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <input value={q.name} onChange={(e) => patchQuestion(si, qi, { name: e.target.value })}
                            placeholder="Intitulé du champ *"
                            className={`${inputCls} flex-1 min-w-[12rem] font-semibold`} />
                          <select value={q.fieldtype} onChange={(e) => patchQuestion(si, qi, { fieldtype: e.target.value })}
                            className={`${inputCls} w-auto`}>
                            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          <label className="flex items-center gap-1 text-[11px] font-semibold text-on-surface-variant cursor-pointer px-1" title="Champ obligatoire">
                            <input type="checkbox" checked={!!q.required} onChange={(e) => patchQuestion(si, qi, { required: e.target.checked })}
                              className="w-3.5 h-3.5 rounded accent-primary" />
                            Obligatoire
                          </label>
                          <select value={(q.requiredIf && q.requiredIf.question) || ''}
                            onChange={(e) => patchQuestion(si, qi, e.target.value
                              ? { requiredIf: { ...(q.requiredIf || {}), question: e.target.value } }
                              : { requiredIf: null })}
                            title="Rendre ce champ obligatoire uniquement si la condition est vraie (case cochée, champ rempli ou valeur égale)"
                            className={`${inputCls} w-auto max-w-[13rem]`}>
                            <option value="">Obligatoire si…</option>
                            {otherQuestions(si, qi).map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
                          </select>
                          {(q.requiredIf && q.requiredIf.question) ? (
                            <input value={q.requiredIf.equals || ''}
                              placeholder="Valeur attendue (vide = cochée)"
                              title="Laisser vide : la condition est « case cochée / champ rempli ». Sinon : valeur égale (liste déroulante) ou présente dans la liste (liste multiple)."
                              onChange={(e) => patchQuestion(si, qi, { requiredIf: { question: q.requiredIf.question, equals: e.target.value || undefined } })}
                              className={`${inputCls} w-auto max-w-[11rem]`} />
                          ) : null}
                          <button onClick={() => removeQuestion(si, qi)} title="Supprimer le champ"
                            className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer ml-auto">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {hasOptions && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                              Options (une par ligne)
                            </span>
                            <textarea rows={Math.min(4, Math.max(2, optionsToLines(q.values).split('\n').length))}
                              value={optionsToLines(q.values)}
                              onChange={(e) => patchQuestion(si, qi, { values: linesToValues(e.target.value) })}
                              className={`${inputCls} resize-y font-mono`} />
                          </div>
                        )}
                        <input value={q.description || ''} placeholder="Description / aide (optionnel)"
                          onChange={(e) => patchQuestion(si, qi, { description: e.target.value })}
                          className={inputCls} />
                      </div>
                    );
                  })}
                  <button onClick={() => addQuestion(si)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-dashed border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary transition-colors cursor-pointer">
                    <Plus className="w-3.5 h-3.5" /> Ajouter un champ
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <button onClick={addSection}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border border-dashed border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary transition-colors cursor-pointer">
          <Plus className="w-4 h-4" /> Ajouter une section
        </button>
      </div>
    );
  }

  // ── Liste ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Demandes de reporting
          </h3>
          <p className="text-[11px] text-on-surface-variant">
            Sections et champs du formulaire de demande de reporting (menu « Demande reporting »).
          </p>
        </div>
        <button onClick={startNew}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-all cursor-pointer">
          <Plus className="w-4 h-4" />
          Nouveau formulaire
        </button>
      </div>

      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm divide-y divide-outline-variant/20">
        {loading ? (
          <p className="p-6 text-xs text-on-surface-variant text-center">Chargement…</p>
        ) : forms.length === 0 ? (
          <p className="p-6 text-xs text-on-surface-variant italic text-center">Aucun formulaire.</p>
        ) : (
          forms.map((f) => (
            <div key={f.id} className={`p-4 flex items-center gap-3 ${f.isActive ? '' : 'opacity-50'}`}>
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 shrink-0">
                <ClipboardList className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-on-surface">{f.name}</span>
                  {f.category && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">{f.category}</span>
                  )}
                  {f.glpiUuid && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500" title="Importé depuis GLPI FormCreator — les éditions locales sont conservées">
                      GLPI
                    </span>
                  )}
                  {!f.isActive && <span className="text-[9px] font-bold text-on-surface-variant uppercase">Inactif</span>}
                </div>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {f.sectionCount} section(s) · {nbFields(f)} champ(s)
                  {f.description ? ` — ${f.description}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => toggleActive(f)} title={f.isActive ? 'Désactiver' : 'Activer'}
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => startEdit(f)} title="Modifier les champs"
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => duplicate(f)} title="Dupliquer (copie inactif)"
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
