import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import Skeleton from '../components/Skeleton';

const SETTINGS_SECTIONS = [
  { key: 'ai', icon: 'smart_toy', label: 'Intelligence Artificielle', permission: 'settings.ai' },
  { key: 'email', icon: 'mail', label: 'Email (Outlook / IMAP)', permission: 'settings.email' },
  { key: 'integrations', icon: 'cable', label: 'Autres intégrations', permission: 'settings.integrations' },
  { key: 'automation', icon: 'sync', label: 'Automatisation', permission: 'automation.manage' },
  { key: 'general', icon: 'tune', label: 'Général', permission: null },
];

export default function Settings() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState('general');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  // System settings form
  const [form, setForm] = useState({
    signatureLogoUrl: '',
    draftReminderDelayMinutes: 30,
    autoApproveEnabled: false,
    autoApproveThreshold: 0.95,
    glpiSyncEnabled: true,
    glpiSyncIntervalSeconds: 20,
  });

  function load() {
    setLoading(true);
    api.get('/system-settings')
      .then(({ data }) => {
        setSettings(data);
        setForm({
          signatureLogoUrl: data.signatureLogoUrl || '',
          draftReminderDelayMinutes: data.draftReminderDelayMinutes || 30,
          autoApproveEnabled: data.autoApproveEnabled || false,
          autoApproveThreshold: data.autoApproveThreshold || 0.95,
          glpiSyncEnabled: data.glpiSyncEnabled !== false,
          glpiSyncIntervalSeconds: data.glpiSyncIntervalSeconds || 20,
        });
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/system-settings', form);
      toast.success('Paramètres enregistrés', {
        description: 'Les modifications ont été appliquées avec succès.',
      });
      load();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de l\'enregistrement';
      setError(msg);
      toast.error('Erreur', { description: msg });
    } finally {
      setSaving(false);
    }
  }

  const canManage = (perm) => {
    if (perm === null) return true;
    return hasPermission(user, perm, ['ADMIN']);
  };

  const visibleSections = SETTINGS_SECTIONS.filter(s => canManage(s.permission));

  if (loading) {
    return (
      <div className="flex flex-col gap-lg">
        <header>
          <Skeleton variant="title" className="h-10 w-48" />
          <Skeleton variant="text-sm" className="h-4 w-72 mt-2" />
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-lg">
          <Skeleton variant="card" className="h-[300px]" />
          <Skeleton variant="card" className="lg:col-span-3 h-[500px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background font-bold">Paramètres</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            Configuration générale du système et des intégrations.
          </p>
        </div>
      </header>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-lg">
        {/* Navigation des sections */}
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-md h-fit sticky top-4">
          <nav className="flex flex-col gap-1">
            {visibleSections.map((section) => (
              <button
                key={section.key}
                onClick={() => setActiveSection(section.key)}
                className={`flex items-center gap-3 px-md py-2.5 rounded-xl font-body-md text-body-md font-medium transition-all duration-200 text-left ${
                  activeSection === section.key
                    ? 'bg-primary/10 text-primary border border-primary/10'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{section.icon}</span>
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Contenu de la section active */}
        <div className="lg:col-span-3">
          <form onSubmit={handleSave} className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-lg">
            {activeSection === 'general' && (
              <>
                <div className="border-b border-outline-variant/40 pb-md">
                  <h3 className="font-headline-md text-headline-md text-on-surface font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">tune</span>
                    Général
                  </h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                    Configuration de base de l'application.
                  </p>
                </div>

                <div className="flex flex-col gap-md">
                  <label className="flex flex-col gap-1.5">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                      URL du logo de signature email
                    </span>
                    <input
                      type="url"
                      className="w-full h-10 px-sm rounded-xl border border-outline-variant bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 font-body-sm text-body-sm text-on-surface"
                      value={form.signatureLogoUrl}
                      onChange={(e) => setForm({ ...form, signatureLogoUrl: e.target.value })}
                      placeholder="https://example.com/logo.png"
                    />
                    <p className="font-body-sm text-body-sm text-on-surface-variant italic">
                      URL publique du logo utilisé dans les signatures email des réponses IA. Doit être accessible depuis les boîtes mail des destinataires.
                    </p>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                      Délai de relance des brouillons (minutes)
                    </span>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="5"
                        max="120"
                        step="5"
                        className="flex-1 accent-primary h-2 cursor-pointer"
                        value={form.draftReminderDelayMinutes}
                        onChange={(e) => setForm({ ...form, draftReminderDelayMinutes: Number(e.target.value) })}
                      />
                      <span className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container border border-outline-variant/60 px-3 py-1 rounded-xl min-w-[3rem] text-center font-medium">
                        {form.draftReminderDelayMinutes} min
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant italic">
                      Temps d'attente avant qu'un brouillon de réponse IA non validé soit signalé comme "en retard".
                    </p>
                  </label>
                </div>
              </>
            )}

            {activeSection === 'ai' && (
              <>
                <div className="border-b border-outline-variant/40 pb-md">
                  <h3 className="font-headline-md text-headline-md text-on-surface font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">smart_toy</span>
                    Intelligence Artificielle
                  </h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                    Configuration des modèles et de l'auto-approbation.
                  </p>
                </div>

                <div className="flex flex-col gap-md">
                  <div className="flex items-center justify-between p-md bg-surface-bright/50 border border-outline-variant/60 rounded-xl">
                    <div className="flex flex-col gap-1">
                      <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Auto-approbation des réponses IA</span>
                      <span className="font-body-sm text-body-sm text-on-surface-variant">
                        Les réponses avec un score de confiance suffisant sont envoyées automatiquement, sans validation humaine.
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={form.autoApproveEnabled}
                        onChange={(e) => setForm({ ...form, autoApproveEnabled: e.target.checked })}
                      />
                      <div className="w-11 h-6 bg-surface-container-high border border-outline-variant/60 rounded-full peer peer-checked:bg-primary peer-checked:border-primary/20 peer-focus:ring-2 peer-focus:ring-primary/20 transition-all duration-300 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all duration-300 peer-checked:after:translate-x-full"></div>
                    </label>
                  </div>

                  {form.autoApproveEnabled && (
                    <label className="flex flex-col gap-1.5">
                      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                        Seuil de confiance minimum
                      </span>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0.7"
                          max="0.99"
                          step="0.01"
                          className="flex-1 accent-primary h-2 cursor-pointer"
                          value={form.autoApproveThreshold}
                          onChange={(e) => setForm({ ...form, autoApproveThreshold: Number(e.target.value) })}
                        />
                        <span className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container border border-outline-variant/60 px-3 py-1 rounded-xl min-w-[4rem] text-center font-medium">
                          {Math.round(form.autoApproveThreshold * 100)}%
                        </span>
                      </div>
                      <p className="font-body-sm text-body-sm text-on-surface-variant italic">
                        Les réponses avec une confiance supérieure à ce seuil seront envoyées automatiquement.
                      </p>
                    </label>
                  )}
                </div>
              </>
            )}

            {activeSection === 'integrations' && (
              <>
                <div className="border-b border-outline-variant/40 pb-md">
                  <h3 className="font-headline-md text-headline-md text-on-surface font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">cable</span>
                    Autres intégrations
                  </h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                    Synchronisation GLPI et autres connecteurs.
                  </p>
                </div>

                <div className="flex flex-col gap-md">
                  <div className="flex items-center justify-between p-md bg-surface-bright/50 border border-outline-variant/60 rounded-xl">
                    <div className="flex flex-col gap-1">
                      <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Synchronisation GLPI</span>
                      <span className="font-body-sm text-body-sm text-on-surface-variant">
                        Synchronisation bidirectionnelle automatique des tickets, équipes et catégories avec GLPI.
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={form.glpiSyncEnabled}
                        onChange={(e) => setForm({ ...form, glpiSyncEnabled: e.target.checked })}
                      />
                      <div className="w-11 h-6 bg-surface-container-high border border-outline-variant/60 rounded-full peer peer-checked:bg-primary peer-checked:border-primary/20 peer-focus:ring-2 peer-focus:ring-primary/20 transition-all duration-300 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all duration-300 peer-checked:after:translate-x-full"></div>
                    </label>
                  </div>

                  {form.glpiSyncEnabled && (
                    <label className="flex flex-col gap-1.5">
                      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                        Intervalle de synchronisation (secondes)
                      </span>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="10"
                          max="120"
                          step="5"
                          className="flex-1 accent-primary h-2 cursor-pointer"
                          value={form.glpiSyncIntervalSeconds}
                          onChange={(e) => setForm({ ...form, glpiSyncIntervalSeconds: Number(e.target.value) })}
                        />
                        <span className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container border border-outline-variant/60 px-3 py-1 rounded-xl min-w-[3rem] text-center font-medium">
                          {form.glpiSyncIntervalSeconds}s
                        </span>
                      </div>
                    </label>
                  )}
                </div>
              </>
            )}

            {activeSection === 'email' && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-24 h-24 mb-4 text-on-surface-variant/30" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
                    <rect x="15" y="30" width="90" height="60" rx="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
                    <path d="M15 70l30-20 15 15 15-15 30 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.15" />
                    <circle cx="60" cy="50" r="4" fill="currentColor" opacity="0.08" />
                  </svg>
                </div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-2">Configuration email</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm leading-relaxed">
                  La configuration des comptes email se fait dans la section Boîte mail. Les paramètres Outlook sont gérés via OAuth.
                </p>
              </div>
            )}

            {activeSection === 'automation' && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-24 h-24 mb-4 text-on-surface-variant/30" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="w-full h-full">
                    <circle cx="40" cy="40" r="14" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
                    <circle cx="80" cy="40" r="14" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
                    <circle cx="60" cy="80" r="14" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.15" />
                    <line x1="52" y1="50" x2="48" y2="68" stroke="currentColor" strokeWidth="2" opacity="0.1" />
                    <line x1="68" y1="50" x2="72" y2="68" stroke="currentColor" strokeWidth="2" opacity="0.1" />
                    <line x1="52" y1="38" x2="68" y2="38" stroke="currentColor" strokeWidth="1.5" opacity="0.08" />
                  </svg>
                </div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-2 workflows">Workflows d'automatisation</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm leading-relaxed">
                  L'automatisation (auto-envoi, auto-approbation, synchronisation GLPI) se configure dans les sections dédiées. Consultez les workflows n8n pour les automatisations avancées.
                </p>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-outline-variant/40">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 disabled:opacity-60 text-body-sm flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">save</span>
                {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
