import { useEffect, useState } from 'react';
import api from '../../api/client';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-12 h-6 rounded-none border border-outline-variant transition-colors ${
        checked ? 'bg-on-surface' : 'bg-surface-container-low'
      } disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-none transition-transform ${
          checked ? 'translate-x-6 bg-surface' : 'translate-x-0 bg-on-surface-variant'
        }`}
        style={{ width: '18px', height: '18px' }}
      />
    </button>
  );
}

function SettingRow({ title, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant bg-surface-container-lowest">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function IntervalRow({ title, description, value, onChange, disabled, max, unit }) {
  return (
    <div className="flex items-center justify-between gap-lg p-lg border border-outline-variant bg-surface-container-lowest">
      <div>
        <div className="font-headline-sm text-headline-sm text-on-surface">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{description}</p>
      </div>
      <div className="flex items-center gap-sm shrink-0">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          disabled={disabled}
          className="w-20 border border-outline-variant rounded-none px-3 py-2 text-body-sm text-on-surface bg-surface disabled:opacity-50"
        />
        <span className="font-body-sm text-body-sm text-on-surface-variant">{unit}</span>
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

  return (
    <div className="flex flex-col gap-md">
      <p className="font-body-md text-body-md text-on-surface-variant">
        Réglages réservés au super-administrateur — config serveur, fréquences de synchronisation, automatisations
        sans validation humaine. Une mauvaise valeur ici peut avoir un impact large sur l'application.
      </p>

      {error && <div className="border border-outline-variant rounded-none p-md text-on-surface bg-surface-container-low">{error}</div>}

      {schedulerHealth && schedulerHealth.some((s) => s.consecutiveFailures >= 3) && (
        <div className="border border-error text-error bg-error-container/30 rounded-none p-md flex items-start gap-sm">
          <span className="material-symbols-outlined">sync_problem</span>
          <div>
            <div className="font-headline-sm text-headline-sm">Tâches automatiques en panne</div>
            <ul className="font-body-sm text-body-sm mt-1 list-disc pl-md">
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

      <div className="mt-md">
        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">Adresse du serveur</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
          Adresse utilisée pour générer les liens et ressources absolus envoyés par email (logo de signature, lien
          de validation de brouillon, lien de réinitialisation de mot de passe). Indique juste l'IP ou le nom de
          domaine (ex : <code>192.168.1.10</code> ou <code>support.prosuma.ci</code>), sans <code>http://</code> ni
          port — le port par défaut est ajouté automatiquement, sauf si tu en précises un toi-même
          (ex : <code>192.168.1.10:8080</code>). Un nom de domaine doit pointer vers ce serveur (configuration DNS),
          ce qui se fait en dehors de cette page. Les champs ci-dessous affichent déjà la valeur actuellement
          utilisée — remplace-la par l'IP ou le domaine voulu, ou vide le champ pour revenir à <code>localhost</code>.
        </p>
        <div className="flex flex-col gap-sm">
          <div className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase">Adresse de l'API backend</span>
            <input
              type="text"
              placeholder="192.168.1.10"
              value={backendUrlDraft}
              onChange={(e) => setBackendUrlDraft(e.target.value)}
              className="bg-surface border border-outline-variant rounded-none p-2 text-body-sm text-on-surface focus:outline-none focus:border-on-surface"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase">Adresse de l'application (frontend)</span>
            <input
              type="text"
              placeholder="192.168.1.10"
              value={frontendUrlDraft}
              onChange={(e) => setFrontendUrlDraft(e.target.value)}
              className="bg-surface border border-outline-variant rounded-none p-2 text-body-sm text-on-surface focus:outline-none focus:border-on-surface"
            />
          </div>
          <button
            onClick={saveServerUrls}
            disabled={
              saving ||
              (backendUrlDraft === (settings.backendUrl || effectiveServerUrls?.backendHost || '') &&
                frontendUrlDraft === (settings.frontendUrl || effectiveServerUrls?.frontendHost || ''))
            }
            className="self-start px-4 py-2 rounded-none border border-outline-variant bg-on-surface text-surface font-body-sm text-body-sm font-semibold hover:opacity-80 transition-all disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      </div>

      <div className="mt-md">
        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">Fréquences de synchronisation</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
          À quel rythme chaque source externe est interrogée automatiquement. Mettre à 0 désactive la synchro automatique
          pour cette tâche — le bouton manuel correspondant (s'il existe) reste alors le seul moyen de forcer une mise à jour.
        </p>
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
