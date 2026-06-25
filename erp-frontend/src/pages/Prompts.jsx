import { useEffect, useState } from 'react';
import api from '../api/client';

export default function Prompts() {
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
      setDraft(data.template);
      setPrompts((prev) => prev.map((p) => (p.key === selectedKey ? { ...p, template: data.template, isCustomized: false } : p)));
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la réinitialisation');
    } finally {
      setSaving(false);
    }
  }

  const selected = prompts.find((p) => p.key === selectedKey);

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-display-lg text-display-lg text-on-background font-bold">Prompts IA</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
          Modifiez directement le texte envoyé à l'IA pour chacune des 5 analyses automatiques. Utilisez les variables{' '}
          <code className="bg-surface-container border border-outline-variant/50 px-1.5 py-0.5 rounded font-mono text-xs text-primary font-semibold">{'{{nom}}'}</code> affichées dans le texte — elles seront remplacées dynamiquement par les vraies valeurs.
        </p>
      </header>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      {prompts.length === 0 && !error && (
        <p className="font-body-sm text-body-sm text-on-surface-variant italic">Chargement...</p>
      )}

      {prompts.length > 0 && (
        <div className="flex flex-col md:flex-row gap-lg">
          <div className="w-full md:w-64 flex flex-col gap-2 shrink-0 bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-md h-fit">
            {prompts.map((p) => (
              <button
                key={p.key}
                onClick={() => selectPrompt(p)}
                className={`text-left px-4 py-3 rounded-xl border font-body-sm text-body-sm font-semibold transition-all duration-300 flex flex-col gap-1 ${
                  p.key === selectedKey 
                    ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/5' 
                    : 'border-outline-variant/60 text-on-surface hover:bg-surface-container-low'
                }`}
              >
                <span>{p.label}</span>
                {p.isCustomized && (
                  <span className="text-[9px] bg-primary/15 text-primary border border-primary/20 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold w-fit">
                    modifié
                  </span>
                )}
              </button>
            ))}
          </div>

          {selected && (
            <div className="flex-1 flex flex-col gap-md">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={22}
                className="w-full font-mono text-sm p-md border border-outline-variant/60 rounded-2xl bg-surface-container-lowest text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 shadow-inner resize-y"
              />
              <div className="flex gap-sm">
                <button
                  onClick={save}
                  disabled={saving || draft === selected.template}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-50 text-body-sm flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Enregistrer
                </button>
                <button
                  onClick={reset}
                  disabled={saving || !selected.isCustomized}
                  className="px-5 py-2.5 rounded-xl border border-outline-variant/60 text-on-surface-variant font-semibold hover:bg-surface-container-high transition-all duration-300 disabled:opacity-50 text-body-sm flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                  Réinitialiser au défaut
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
