import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../../api/client';
import { sanitizeHtml } from '../../utils/sanitize';
import { inputClass, itemVariants } from './SettingsComponents';

// ═══════════════════════════════════════════════════════════════════════════════
// Contenu des emails — liste des gabarits de notification éditables
// (GET/PUT/DELETE /api/email-templates). Chaque ligne s'expand pour éditer le sujet
// et le message (placeholders {var}), afficher un aperçu rendu par le backend et
// envoyer un email de test réel. Sans surcharge, l'email part du gabarit par défaut.
// ═══════════════════════════════════════════════════════════════════════════════

function TemplateRow({ item, settings, expanded, onToggle, testEmailInput, reloadTemplates, setError }) {
  const [subjectDraft, setSubjectDraft] = useState(item.subject);
  const [messageDraft, setMessageDraft] = useState(item.message);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Resynchronise les brouillons quand la ligne enregistrée change (reload après
  // save/reset) — ajustement pendant le render, pas dans un effet.
  const syncKey = item.subject + '\u0000' + item.message;
  const [syncedKey, setSyncedKey] = useState(syncKey);
  if (syncedKey !== syncKey) {
    setSyncedKey(syncKey);
    setSubjectDraft(item.subject);
    setMessageDraft(item.message);
  }

  const dirty = subjectDraft !== item.subject || messageDraft !== item.message;
  const toggleActive = settings ? (settings[item.toggleKey] ?? true) : true;

  const placeholderExamples = item.defaultSubject
    ? [item.defaultSubject]
    : (item.subjectExamples || []);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/email-templates/${item.key}`, { subject: subjectDraft, message: messageDraft });
      toast.success(`${item.label} enregistré`);
      await reloadTemplates();
    } catch (err) {
      const msg = err.response?.data?.error || "Erreur lors de l'enregistrement";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await api.delete(`/email-templates/${item.key}`);
      toast.success(`${item.label} réinitialisé au gabarit par défaut`);
      await reloadTemplates();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la réinitialisation';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const email = testEmailInput.trim();
    if (!email) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Le test enregistre d'abord le brouillon courant : l'email de test reflète
      // exactement ce qui est à l'écran.
      if (dirty) {
        await api.put(`/email-templates/${item.key}`, { subject: subjectDraft, message: messageDraft });
        await reloadTemplates();
      }
      await api.post('/system-settings/test-email', { type: item.key, recipientEmail: email });
      setTestResult({ ok: true, text: `Envoyé à ${email}` });
    } catch (err) {
      setTestResult({ ok: false, text: err.response?.data?.error || "Échec de l'envoi" });
    } finally {
      setTesting(false);
    }
  }

  function insertPlaceholder(placeholder) {
    setMessageDraft((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${placeholder}`);
  }

  return (
    <motion.div
      variants={itemVariants}
      className="bento-card overflow-hidden"
      style={{ borderColor: expanded ? 'var(--color-primary, #2563eb)' : undefined }}
    >
      {/* Ligne résumée (cliquable) */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-lg text-left hover:bg-surface-container-low/50 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">{item.label}</span>
            {item.isCustom && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-primary/10 border border-primary/30 text-primary">
                Personnalisé
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${toggleActive ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'bg-surface-container-high border border-outline-variant/50 text-on-surface-variant'}`}>
              {toggleActive ? 'Envoyé' : 'Désactivé'}
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 break-words">{item.description}</p>
          <div className="mt-1.5 flex items-start gap-1.5 text-xs text-on-surface-variant/70 font-mono">
            <span className="shrink-0 mt-0.5">✉</span>
            <span className="break-all">{item.previewSubject}</span>
          </div>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant transition-transform shrink-0" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}>
          expand_more
        </span>
      </button>

      {/* Éditeur dépliable */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-lg pb-lg pt-0 border-t border-outline-variant/40 space-y-md">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
                {/* Champs d'édition */}
                <div className="space-y-md">
                  <div className="flex flex-col gap-sm">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Objet de l'email</span>
                    <input
                      type="text"
                      value={subjectDraft}
                      onChange={(e) => setSubjectDraft(e.target.value)}
                      disabled={saving}
                      maxLength={300}
                      placeholder={placeholderExamples[0] || ''}
                      className={`${inputClass} font-mono text-sm`}
                    />
                    <p className="text-[11px] text-on-surface-variant/70">
                      {item.defaultSubject
                        ? <>Défaut : <code className="bg-surface-container-high px-1 rounded">{item.defaultSubject}</code></>
                        : <>Sujet par défaut calculé automatiquement — défauts possibles : <code className="bg-surface-container-high px-1 rounded">{(item.subjectExamples || [])[0]}</code></>}
                      {' '}· Laisser vide pour conserver le défaut sur ce champ.
                    </p>
                  </div>

                  <div className="flex flex-col gap-sm">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Contenu (HTML)</span>
                    <textarea
                      value={messageDraft}
                      onChange={(e) => setMessageDraft(e.target.value)}
                      disabled={saving}
                      rows={6}
                      maxLength={20000}
                      placeholder={item.defaultMessage || '<p>…</p>'}
                      className={`${inputClass} resize-none w-full font-mono text-xs min-h-[130px]`}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-on-surface-variant/70 mr-1">Insérer :</span>
                      {item.placeholders.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => insertPlaceholder(p)}
                          disabled={saving}
                          className="px-2 py-0.5 rounded-lg bg-surface-container-high border border-outline-variant/50 font-mono text-[11px] text-on-surface hover:border-primary/50 hover:text-primary transition-colors"
                          title={`Insérer ${p} dans le contenu`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-on-surface-variant/70">
                      Défaut affiché dans l'aperçu · Laisser vide pour conserver le gabarit par défaut.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-sm pt-1">
                    <motion.button
                      type="button"
                      onClick={save}
                      disabled={saving || !dirty}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      className="px-4 py-2 btn-gradient font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50"
                    >
                      {saving ? 'Enregistrement...' : 'Enregistrer'}
                    </motion.button>
                    <motion.button
                      type="button"
                      onClick={() => { setSubjectDraft(item.subject); setMessageDraft(item.message); }}
                      disabled={saving || !dirty}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      className="px-4 py-2 border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high rounded-xl transition-colors disabled:opacity-50 text-body-sm font-semibold"
                    >
                      Annuler
                    </motion.button>
                    {item.isCustom && (
                      <motion.button
                        type="button"
                        onClick={reset}
                        disabled={saving}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.96 }}
                        className="px-4 py-2 border border-red-500/30 text-red-500 hover:bg-red-500/5 rounded-xl transition-colors disabled:opacity-50 text-body-sm font-semibold"
                        title="Supprimer la surcharge et repartir du gabarit par défaut"
                      >
                        Réinitialiser
                      </motion.button>
                    )}
                    <motion.button
                      type="button"
                      onClick={sendTest}
                      disabled={testing || !testEmailInput.trim() || saving}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      className="px-4 py-2 border border-outline-variant/60 text-on-surface hover:bg-surface-container-high rounded-xl font-semibold text-body-sm transition-all disabled:opacity-50 shrink-0 shadow-sm flex items-center gap-1.5"
                      title={testEmailInput.trim() ? 'Envoyer cet email de test (avec le brouillon en cours)' : 'Renseignez d\'abord une adresse dans « Tester un template »'}
                    >
                      <span className={`material-symbols-outlined text-[15px] ${testing ? 'animate-spin' : ''}`}>{testing ? 'progress_activity' : 'send'}</span>
                      {testing ? 'Envoi...' : 'Tester'}
                    </motion.button>
                  </div>

                  <AnimatePresence>
                    {testResult && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className={`text-xs p-2.5 rounded-xl border overflow-hidden ${testResult.ok ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400' : 'border-red-500/20 bg-red-500/5 text-red-500'}`}
                      >
                        {testResult.text}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Aperçu */}
                <div className="flex flex-col gap-sm">
                  <div className="flex items-center justify-between gap-sm">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Aperçu du rendu</span>
                    <button
                      type="button"
                      onClick={() => setPreviewOpen((v) => !v)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      {previewOpen ? 'Masquer' : 'Afficher'}
                    </button>
                  </div>
                  <p className="text-[11px] text-on-surface-variant/70">
                    Rendu réel du backend sur des données de test (ticket #999) — reflète la dernière version enregistrée.
                  </p>
                  {previewOpen && (
                    <div className="border border-outline-variant/60 rounded-xl overflow-hidden bg-white">
                      <div className="px-3 py-2 bg-surface-container-high/60 border-b border-outline-variant/40 text-xs font-mono break-all text-on-surface">
                        ✉ {item.previewSubject}
                      </div>
                      <div className="p-3 max-h-[360px] overflow-auto">
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.previewHtml) }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function EmailTemplatesSection({ templates, settings, testEmailInput, reloadTemplates, setError }) {
  const [expandedKey, setExpandedKey] = useState(null);

  if (!templates) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const categories = [...new Set(templates.map((t) => t.category))];

  return (
    <div className="space-y-4">
      {categories.map((category) => (
        <div key={category} className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 px-1">
            {category}
          </h3>
          <div className="space-y-2">
            {templates.filter((t) => t.category === category).map((item) => (
              <TemplateRow
                key={item.key}
                item={item}
                settings={settings}
                expanded={expandedKey === item.key}
                onToggle={() => setExpandedKey((k) => (k === item.key ? null : item.key))}
                testEmailInput={testEmailInput}
                reloadTemplates={reloadTemplates}
                setError={setError}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
