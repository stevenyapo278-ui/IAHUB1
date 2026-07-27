import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { Bot, Save, RotateCcw, Sparkles, AlertTriangle, Terminal, FileCode, X } from 'lucide-react';

export default function Prompts() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [prompts, setPrompts] = useState([]);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    api.get('/prompt-templates')
      .then(({ data }) => {
        setPrompts(data);
        if (!selectedKey && data.length > 0) {
          setSelectedKey(data[0].key);
          setDraft(data[0].template);
        }
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
  }

  useEffect(load, []);

  function selectPrompt(p) {
    setSelectedKey(p.key);
    setDraft(p.template);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch(`/prompt-templates/${selectedKey}`, { template: draft });
      toast.success('Prompt enregistré');
      setPrompts((prev) => prev.map((p) => (p.key === selectedKey ? { ...p, template: data.template, isCustomized: true, updatedAt: data.updatedAt } : p)));
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.delete(`/prompt-templates/${selectedKey}`);
      toast.success('Prompt réinitialisé par défaut');
      setDraft(data.template);
      setPrompts((prev) => prev.map((p) => (p.key === selectedKey ? { ...p, template: data.template, isCustomized: false } : p)));
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la réinitialisation');
    } finally {
      setSaving(false);
    }
  }

  const selected = prompts.find((p) => p.key === selectedKey);
  const customizedCount = prompts.filter(p => p.isCustomized).length;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-purple-500/10 rounded-lg">
            <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Prompts IA & System System</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">
              {prompts.length} modèles · {customizedCount} personnalisé{customizedCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        {selected && (
          <div className="flex items-center gap-2 ml-auto">
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={reset}
              disabled={saving || !selected.isCustomized}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container text-xs font-semibold disabled:opacity-40 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Réinitialiser</span>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={save}
              disabled={saving || draft === selected.template}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-purple-500/20 disabled:opacity-50 transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Enregistrement...' : 'Enregistrer'}</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Split View ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Prompts List */}
        <div className="w-80 xl:w-96 shrink-0 flex flex-col border-r border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/20 bg-surface-container-low/40">
            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
              Modèles de Prompts ({prompts.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {prompts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant py-12">
                <Bot className="w-8 h-8 text-outline/30 animate-pulse" />
                <p className="text-xs italic">Chargement des modèles...</p>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/10">
                {prompts.map((p, idx) => {
                  const isSelected = p.key === selectedKey;
                  return (
                    <motion.button
                      key={p.key}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: idx * 0.02 }}
                      onClick={() => selectPrompt(p)}
                      className={`w-full text-left flex items-stretch border-b border-outline-variant/10 transition-all group ${
                        isSelected
                          ? 'bg-purple-500/10 ring-1 ring-inset ring-purple-500/30'
                          : 'hover:bg-surface-container-low/60'
                      }`}
                    >
                      <div className={`w-1 shrink-0 ${isSelected ? 'bg-purple-600 dark:bg-purple-400' : 'bg-transparent'}`} />
                      <div className="flex items-start gap-3 px-4 py-3.5 flex-1 min-w-0">
                        <div className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center mt-0.5 ${
                          p.isCustomized ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-surface-container border border-outline-variant/30'
                        }`}>
                          <FileCode className={`w-3.5 h-3.5 ${p.isCustomized ? 'text-purple-600 dark:text-purple-400' : 'text-on-surface-variant'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <p className={`text-xs font-bold truncate ${isSelected ? 'text-purple-600 dark:text-purple-400' : 'text-on-surface group-hover:text-primary transition-colors'}`}>
                              {p.label || p.key}
                            </p>
                            {p.isCustomized && (
                              <span className="px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[9px] font-bold border border-purple-500/20 shrink-0">
                                Modifié
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-on-surface-variant font-mono truncate">{p.key}</p>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Code / Editor Panel */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-container-lowest">
          {selected ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Header inside Editor */}
              <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-outline-variant/20 bg-surface-container-low/30">
                <div className="flex items-center gap-2 min-w-0">
                  <Terminal className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                  <h2 className="text-xs font-bold font-mono text-on-surface truncate">{selected.key}</h2>
                  {selected.isCustomized && (
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                      Version personnalisée
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-on-surface-variant font-mono font-medium">
                  {draft.length} caractères
                </div>
              </div>

              {/* Textarea Code Editor */}
              <div className="flex-1 p-4 overflow-hidden flex flex-col">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Entrez le prompt système..."
                  className={`w-full flex-1 font-mono text-xs leading-relaxed p-4 rounded-xl border focus:outline-none transition-all resize-none ${
                    isDark
                      ? 'bg-space-900 border-space-700 text-purple-100 focus:ring-2 focus:ring-primary/20 focus:border-primary'
                      : 'bg-slate-900 text-slate-100 border-slate-700 focus:ring-2 focus:ring-primary/20'
                  }`}
                />
              </div>

              {/* Editor Footer Help */}
              <div className="shrink-0 px-6 py-3 border-t border-outline-variant/20 bg-surface-container-low/30 flex items-center justify-between text-[11px] text-on-surface-variant">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  Les modifications sont appliquées immédiatement lors du prochain appel Gemini.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-on-surface-variant">
              <Bot className="w-10 h-10 text-outline/30" />
              <p className="text-sm font-semibold">Sélectionnez un modèle de prompt</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
