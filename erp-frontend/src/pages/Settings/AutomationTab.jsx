import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../../api/client';
import { SettingRow, IntervalRow, inputClass, itemVariants } from './SettingsComponents';

// La section « Signatures & Accusé de réception » vit désormais dans AckSignatureCard.jsx,
// affichée depuis l'onglet Notifications (Paramètres > Notifications > Contenu des emails).

export default function AutomationTab() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reminderConfig, setReminderConfig] = useState(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [autoClosing, setAutoClosing] = useState(false);

  function load() {
    api.get('/system-settings').then(({ data }) => {
      setSettings(data);
    }).catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'));
    api.get('/reminders/config').then(({ data }) => setReminderConfig(data)).catch(() => {});
  }

  useEffect(load, []);

  async function updateReminderConfig(patch) {
    setReminderSaving(true);
    setError('');
    try {
      const { data } = await api.put('/reminders/config', { ...reminderConfig, ...patch });
      setReminderConfig(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setReminderSaving(false);
    }
  }

  async function updateSetting(key, value) {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/system-settings', { [key]: value });
      setSettings(data);
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleRunAutoClose() {
    setAutoClosing(true);
    try {
      const { data } = await api.post('/system-settings/solved-auto-close/run-now');
      if (data.closed === 0) {
        toast.info('Aucun ticket à fermer');
      } else {
        toast.success(`${data.closed} ticket(s) fermé(s) automatiquement`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'exécution');
    } finally {
      setAutoClosing(false);
    }
  }

  if (!settings) {
    return (
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="font-body-sm text-body-sm text-on-surface-variant"
      >
        {error || 'Chargement...'}
      </motion.p>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
      className="space-y-xl"
    >
      <AnimatePresence>
        {error && (
          <motion.div
            key="settings-error"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl font-body-md overflow-hidden"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 : INTELLIGENCE & TRIAGE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-md">
        <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
          <span className="material-symbols-outlined text-primary text-2xl">neurology</span>
          <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Intelligence & Triage</h4>
        </div>

        <SettingRow
            title="Apprentissage Few-Shot historique"
            description="Utilise les tickets résolus ou clos par les techniciens comme modèles de référence pour classer les nouveaux tickets (catégorie, priorité, équipe)."
            checked={settings.enableFewShotTriage}
            onChange={(v) => updateSetting('enableFewShotTriage', v)}
            disabled={saving}
          />

        <SettingRow
            title="Auto-création des compétences"
            description="Lors de l'analyse IA d'un email, si la compétence suggérée n'existe pas encore, elle est automatiquement créée dans la base."
            checked={settings.enableAutoCreateSkills}
            onChange={(v) => updateSetting('enableAutoCreateSkills', v)}
            disabled={saving}
          />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 : RELANCES & CLÔTURE */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            <span className="material-symbols-outlined text-primary text-2xl">schedule</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Relances Tickets</h4>
          </div>

          {reminderConfig && (
            <div className="space-y-md">
              <SettingRow
                title="Relance & Clôture automatique"
                description="Crée des brouillons de relance (à valider dans le Centre de Validation) pour les tickets en attente de réponse utilisateur. Clôture automatiquement les tickets restés sans réponse."
                checked={reminderConfig.isActive}
                onChange={(v) => updateReminderConfig({ isActive: v })}
                disabled={reminderSaving}
              />
              <IntervalRow
                title="Première relance"
                description="Délai après la dernière réponse du demandeur avant la 1ère relance (brouillon à valider dans le Centre de Validation)."
                value={reminderConfig.firstReminderDays}
                onChange={(v) => updateReminderConfig({ firstReminderDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={60}
                unit="jours"
              />
              <IntervalRow
                title="Deuxième relance"
                description="Délai avant la 2ème relance si aucune réponse du demandeur."
                value={reminderConfig.secondReminderDays}
                onChange={(v) => updateReminderConfig({ secondReminderDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={60}
                unit="jours"
              />
              <IntervalRow
                title="Avertissement avant clôture"
                description="Délai avant le brouillon d'avertissement « clôture automatique prochaine » (pré-clôture)."
                value={reminderConfig.preCloseDays}
                onChange={(v) => updateReminderConfig({ preCloseDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={90}
                unit="jours"
              />
              <IntervalRow
                title="Clôture automatique"
                description="Délai avant clôture définitive d'un ticket sans réponse."
                value={reminderConfig.autoCloseDays}
                onChange={(v) => updateReminderConfig({ autoCloseDays: v })}
                disabled={reminderSaving || !reminderConfig.isActive}
                max={120}
                unit="jours"
              />
            </div>
          )}

          <div className="space-y-md mt-lg">
            <IntervalRow
              title="Fermeture auto tickets résolus"
              description="Délai avant de passer automatiquement un ticket de Résolu à Fermé. 0 = désactivé."
              value={settings?.solvedAutoCloseDays ?? 3}
              onChange={(v) => updateSetting('solvedAutoCloseDays', v)}
              disabled={saving}
              max={90}
              unit="jours"
            />
            <button
              onClick={handleRunAutoClose}
              disabled={autoClosing || (settings?.solvedAutoCloseDays ?? 3) <= 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span className={`material-symbols-outlined text-[16px] ${autoClosing ? 'animate-spin' : ''}`}>
                {autoClosing ? 'progress_activity' : 'play_arrow'}
              </span>
              {autoClosing ? 'Exécution en cours...' : 'Lancer maintenant'}
            </button>
          </div>
        </div>

        {/* Bloc validation des brouillons */}
        <div className="space-y-md">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
            <span className="material-symbols-outlined text-primary text-2xl">rate_review</span>
            <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Validation des Brouillons</h4>
          </div>

          <div className="space-y-md">
            <SettingRow
              title="Relance email des brouillons en attente"
              description="Avertit les techniciens par email si un brouillon (réponse IA ou relance) reste en attente de validation plus longtemps que le délai ci-dessous."
              checked={settings.draftReminderEnabled}
              onChange={(v) => updateSetting('draftReminderEnabled', v)}
              disabled={saving}
            />

            <IntervalRow
              title="Délai de relance"
              description="Temps d'attente avant de déclencher l'alerte."
              value={settings.draftReminderDelayMinutes}
              onChange={(v) => updateSetting('draftReminderDelayMinutes', v)}
              disabled={saving || !settings.draftReminderEnabled}
              max={1440}
              unit="minutes"
            />

            {/* Exclusion email des relances */}
            <motion.div variants={itemVariants} className="space-y-2">
              <label className="text-sm font-medium text-on-surface">Exclure des relances</label>
              <p className="text-xs text-on-surface-variant">
                Adresses email qui ne recevront jamais de relance pour les brouillons en attente.
              </p>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-surface-container-low border border-outline-variant/30 min-h-[40px]">
                {(settings.draftReminderExcludeEmails || []).map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-medium"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => {
                        const updated = (settings.draftReminderExcludeEmails || []).filter((e) => e !== email);
                        updateSetting('draftReminderExcludeEmails', updated);
                      }}
                      className="hover:text-red-900 dark:hover:text-red-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="email"
                placeholder="Ajouter un email et appuyer Entrée..."
                disabled={saving || !settings.draftReminderEnabled}
                className="w-full px-3 py-2 rounded-xl bg-surface-container text-on-surface text-sm border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all placeholder:text-on-surface-variant/50 disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = e.target.value.trim().toLowerCase();
                    if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                      const current = settings.draftReminderExcludeEmails || [];
                      if (!current.includes(val)) {
                        updateSetting('draftReminderExcludeEmails', [...current, val]);
                      }
                      e.target.value = '';
                    }
                  }
                }}
              />
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="bento-card p-md bg-surface-container-low/30 border border-dashed border-outline-variant/30 text-center"
            >
              <p className="text-xs text-on-surface-variant">
                Les brouillons à valider sont accessibles depuis{' '}
                <strong className="text-primary">Centre de Validation &gt; Réponses Email IA</strong> et{' '}
                <strong className="text-amber-600 dark:text-amber-400">Relances Auto.</strong>
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
