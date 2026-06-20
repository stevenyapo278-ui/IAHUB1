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
        <h2 className="font-display-lg text-display-lg text-on-background">Prompts IA</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-xs">
          Modifie directement le texte envoyé à l'IA pour chacune des 5 analyses automatiques. Utilise les variables{' '}
          <code>{'{{nom}}'}</code> affichées dans le texte — elles sont remplacées par les vraies valeurs à chaque appel.
        </p>
      </header>

      {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}

      {prompts.length === 0 && !error && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">Chargement...</p>
      )}

      {prompts.length > 0 && (
        <div className="flex gap-md">
          <div className="w-64 flex flex-col gap-xs shrink-0">
            {prompts.map((p) => (
              <button
                key={p.key}
                onClick={() => selectPrompt(p)}
                className={`text-left px-md py-sm rounded-none border border-outline-variant font-body-sm text-body-sm transition-colors ${
                  p.key === selectedKey ? 'bg-surface-container-lowest text-on-surface' : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {p.label}
                {p.isCustomized && <span className="ml-xs text-xs text-on-surface-variant">(modifié)</span>}
              </button>
            ))}
          </div>

          {selected && (
            <div className="flex-1 flex flex-col gap-sm">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={22}
                className="w-full font-mono text-sm p-md border border-outline-variant rounded-none bg-surface-container-lowest text-on-surface"
              />
              <div className="flex gap-sm">
                <button
                  onClick={save}
                  disabled={saving || draft === selected.template}
                  className="px-lg py-sm rounded-none border border-outline-variant bg-on-surface text-surface font-headline-sm text-headline-sm disabled:opacity-50"
                >
                  Enregistrer
                </button>
                <button
                  onClick={reset}
                  disabled={saving || !selected.isCustomized}
                  className="px-lg py-sm rounded-none border border-outline-variant text-on-surface-variant font-headline-sm text-headline-sm disabled:opacity-50"
                >
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
