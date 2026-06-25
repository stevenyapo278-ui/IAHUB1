import { useEffect, useState } from 'react';
import api from '../../api/client';

const inputClass =
  'bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-12 h-6 rounded-full border transition-all duration-300 outline-none ${
        checked
          ? 'bg-primary border-primary/60 shadow-sm shadow-primary/20'
          : 'bg-surface-container-high border-outline-variant/60'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full transition-transform duration-300 shadow-sm ${
          checked ? 'translate-x-6 bg-white' : 'translate-x-0 bg-on-surface-variant/80'
        }`}
      />
    </button>
  );
}

function SettingRow({ title, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow transition-all duration-300 hover:border-outline-variant/90">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{description}</p>
      </div>
      <div className="shrink-0">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

function IntervalRow({ title, description, value, onChange, disabled, max, unit }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant/60 bg-surface-container-lowest rounded-2xl card-shadow transition-all duration-300 hover:border-outline-variant/90">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{description}</p>
      </div>
      <div className="flex items-center gap-sm shrink-0">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          disabled={disabled}
          className={`${inputClass} w-24 text-center disabled:opacity-50`}
        />
        <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">{unit}</span>
      </div>
    </div>
  );
}

// Réservé au SUPERADMIN (onglet masqué pour ADMIN — voir Settings/index.jsx) : réglages dont une
// mauvaise valeur a un impact large (envoi d'emails sans validation humaine, casse de la synchro
// GLPI/email, liens/images invalides dans les emails sortants) — séparés d'Automatisation pour ne
// pas les exposer à tout ADMIN.
export default function AdvancedTab() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [backendUrlDraft, setBackendUrlDraft] = useState('');
  const [frontendUrlDraft, setFrontendUrlDraft] = useState('');
  const [effectiveServerUrls, setEffectiveServerUrls] = useState(null);
  const [schedulerHealth, setSchedulerHealth] = useState(null);

  function load() {
    api.get('/advanced-settings').then(({ data }) => {
      setSettings(data);
    }).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/advanced-settings/server-urls/effective').then(({ data }) => setEffectiveServerUrls(data)).catch(() => {});
    api.get('/advanced-settings/scheduler-health').then(({ data }) => setSchedulerHealth(data)).catch(() => {});
  }

  useEffect(load, []);
  // Pré-remplit les champs avec la valeur effectivement active (réglage UI s'il existe, sinon
  // localhost/variable d'environnement) dès que les deux réponses sont arrivées.
  useEffect(() => {
    if (!settings || !effectiveServerUrls) return;
    setBackendUrlDraft(settings.backendUrl || effectiveServerUrls.backendHost || '');
    setFrontendUrlDraft(settings.frontendUrl || effectiveServerUrls.frontendHost || '');
  }, [settings, effectiveServerUrls]);
  // Rafraîchit l'état des tâches automatiques toutes les 30s pour refléter une panne/résolution
  // sans devoir recharger la page.
  useEffect(() => {
    const intervalId = setInterval(() => {
      api.get('/advanced-settings/scheduler-health').then(({ data }) => setSchedulerHealth(data)).catch(() => {});
    }, 30000);
    return () => clearInterval(intervalId);
  }, []);

  async function updateSetting(key, value) {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/advanced-settings', { [key]: value });
      setSettings(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  }

  async function saveServerUrls() {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/advanced-settings', {
        backendUrl: backendUrlDraft.trim() || null,
        frontendUrl: frontendUrlDraft.trim() || null,
      });
      setSettings(data);
      setBackendUrlDraft(data.backendUrl || '');
      setFrontendUrlDraft(data.frontendUrl || '');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <p className="font-body-sm text-body-sm text-on-surface-variant">{error || 'Chargement...'}</p>;
  }

  const isUrlsChanged = backendUrlDraft !== (settings.backendUrl || effectiveServerUrls?.backendHost || '') ||
                        frontendUrlDraft !== (settings.frontendUrl || effectiveServerUrls?.frontendHost || '');

  return (
    <div className="space-y-lg">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Réglages réservés au super-administrateur — config serveur, fréquences de synchronisation, automatisations
        sans validation humaine. Une mauvaise valeur ici peut avoir un impact large sur l'application.
      </p>

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md">
          {error}
        </div>
      )}

      {schedulerHealth && schedulerHealth.some((s) => s.consecutiveFailures >= 3) && (
        <div className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-2xl card-shadow flex items-start gap-sm">
          <span className="material-symbols-outlined shrink-0 mt-0.5">sync_problem</span>
          <div>
            <div className="font-headline-sm text-headline-sm font-semibold">Tâches automatiques en panne</div>
            <ul className="font-body-sm text-body-sm mt-1.5 list-disc pl-md space-y-1">
              {schedulerHealth.filter((s) => s.consecutiveFailures >= 3).map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> — {s.consecutiveFailures} échecs consécutifs depuis {new Date(s.lastFailureAt).toLocaleString('fr-FR')} : {s.lastError}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <SettingRow
        title="Auto-envoi des emails IA"
        description="Quand activé, les emails générés automatiquement (accusé de réception, notification d'incident connu) sont envoyés directement sans passer par la validation humaine dans « Réponses à valider »."
        checked={settings.autoSendAiEmails}
        onChange={(v) => updateSetting('autoSendAiEmails', v)}
        disabled={saving}
      />

      <SettingRow
        title="Auto-approbation des solutions GLPI"
        description="Quand activé, dès qu'un technicien marque un ticket comme résolu dans GLPI, toute demande de validation de la solution en attente est approuvée automatiquement, sans attendre de confirmation du demandeur."
        checked={settings.autoApproveGlpiSolutions}
        onChange={(v) => updateSetting('autoApproveGlpiSolutions', v)}
        disabled={saving}
      />

      {/* Adresse du serveur */}
      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg space-y-md">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Adresse du serveur</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Adresse utilisée pour générer les liens et ressources absolus envoyés par email (logo de signature, lien
            de validation de brouillon, lien de réinitialisation de mot de passe). Indique juste l'IP ou le nom de
            domaine (ex : <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">192.168.1.10</code> ou <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">support.prosuma.ci</code>), sans <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">http://</code> ni
            port — le port par défaut est ajouté automatiquement, sauf si tu en précises un toi-même
            (ex : <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">192.168.1.10:8080</code>). Un nom de domaine doit pointer vers ce serveur (configuration DNS),
            ce qui se fait en dehors de cette page. Les champs ci-dessous affichent déjà la valeur actuellement
            utilisée — remplace-la par l'IP ou le domaine voulu, ou vide le champ pour revenir à <code className="bg-surface-container-high px-1 rounded font-mono text-[11px]">localhost</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Adresse de l'API backend</span>
            <input
              type="text"
              placeholder="192.168.1.10"
              value={backendUrlDraft}
              onChange={(e) => setBackendUrlDraft(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Adresse de l'application (frontend)</span>
            <input
              type="text"
              placeholder="192.168.1.10"
              value={frontendUrlDraft}
              onChange={(e) => setFrontendUrlDraft(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex justify-end pt-sm border-t border-outline-variant/40">
          <button
            onClick={saveServerUrls}
            disabled={saving || !isUrlsChanged}
            className="px-4 py-2 bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white font-semibold rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all duration-300 text-body-sm disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* Fréquences de synchronisation */}
      <div className="space-y-md">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Fréquences de synchronisation</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            À quel rythme chaque source externe est interrogée automatiquement. Mettre à 0 désactive la synchro automatique
            pour cette tâche — le bouton manuel correspondant (s'il existe) reste alors le seul moyen de forcer une mise à jour.
          </p>
        </div>
        <div className="flex flex-col gap-md">
          <IntervalRow
            title="Tickets GLPI (+ pièces jointes, approbations)"
            description="Fréquence d'import/mise à jour des tickets depuis GLPI vers l'ERP."
            value={settings.glpiTicketsSyncIntervalSeconds}
            onChange={(v) => updateSetting('glpiTicketsSyncIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />
          <IntervalRow
            title="Emails entrants"
            description="Fréquence de relevé des boîtes mail connectées (Outlook)."
            value={settings.emailSyncIntervalSeconds}
            onChange={(v) => updateSetting('emailSyncIntervalSeconds', v)}
            disabled={saving}
            max={3600}
            unit="secondes"
          />
          <IntervalRow
            title="Équipes et catégories GLPI"
            description="Fréquence de synchro des groupes (équipes) et catégories de tickets depuis GLPI."
            value={settings.glpiTeamsCategoriesSyncIntervalMinutes}
            onChange={(v) => updateSetting('glpiTeamsCategoriesSyncIntervalMinutes', v)}
            disabled={saving}
            max={1440}
            unit="minutes"
          />
          <IntervalRow
            title="Modèles IA disponibles"
            description="Fréquence de vérification des modèles disponibles auprès de chaque fournisseur IA actif."
            value={settings.aiModelsSyncIntervalHours}
            onChange={(v) => updateSetting('aiModelsSyncIntervalHours', v)}
            disabled={saving}
            max={168}
            unit="heures"
          />
        </div>
      </div>
    </div>
  );
}

