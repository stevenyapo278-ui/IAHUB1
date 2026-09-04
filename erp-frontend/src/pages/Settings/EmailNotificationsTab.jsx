import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../../api/client';
import Toggle from '../../components/Toggle';
import { Mail, Bot, UserCheck, AlertTriangle, Clock, RefreshCw, CheckCircle2, TrendingUp, Shield, Send } from 'lucide-react';

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

function SettingRow({ title, description, icon: Icon, checked, onChange, disabled }) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
      className="bento-card flex items-center gap-4 p-lg"
    >
      <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{title}</div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 break-words">{description}</p>
      </div>
      <div className="shrink-0">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </motion.div>
  );
}

const EMAIL_TOGGLES = [
  { key: 'emailAcknowledgementEnabled', label: 'Accusé de réception', description: 'Email automatique envoyé au demandeur lors de la création d\'un ticket par email.', icon: Mail, category: 'Automatiques (pipeline email)' },
  { key: 'emailKnownIncidentEnabled', label: 'Incident déjà connu', description: 'Notification quand un email correspond à un incident existant (le demandeur est rattaché au ticket existant).', icon: AlertTriangle, category: 'Automatiques (pipeline email)' },
  { key: 'emailAssignmentEnabled', label: 'Assignation technicien', description: 'Email envoyé au technicien quand l\'IA lui attribue automatiquement un ticket.', icon: UserCheck, category: 'Automatiques (pipeline email)' },
  { key: 'emailSlaBreachEnabled', label: 'Dépassement SLA', description: 'Alerte envoyée au technicien assigné quand le SLA de réponse est dépassé.', icon: Clock, category: 'Automatiques (schedulers)' },
  { key: 'emailDueDateBreachEnabled', label: 'Dépassement d\'échéance', description: 'Alerte envoyée au technicien assigné quand la date d\'échéance manuelle est dépassée.', icon: Clock, category: 'Automatiques (schedulers)' },
  { key: 'emailStatusChangeEnabled', label: 'Changement de statut', description: 'Notification envoyée au demandeur à chaque changement de statut du ticket.', icon: RefreshCw, category: 'Manuelles (actions utilisateur)' },
  { key: 'emailResolvedEnabled', label: 'Résolution (différé 10 min)', description: 'Email de résolution envoyé au demandeur 10 minutes après le passage en "Résolu" (laisse un délai de correction).', icon: CheckCircle2, category: 'Manuelles (actions utilisateur)' },
  { key: 'emailEscalationEnabled', label: 'Escalade', description: 'Notification envoyée aux admins/techniciens et au demandeur lors d\'une escalade de ticket.', icon: TrendingUp, category: 'Manuelles (actions utilisateur)' },
  { key: 'emailMajorIncidentResolvedEnabled', label: 'Résolution incident majeur', description: 'Notification envoyée aux emails des sites impactés quand un incident majeur est résolu.', icon: Shield, category: 'Manuelles (actions utilisateur)' },
  { key: 'emailApprovalEnabled', label: 'Approbation ticket', description: 'Notification envoyée au demandeur quand son ticket est approuvé par la Hotline.', icon: Send, category: 'Manuelles (actions utilisateur)' },
];

export default function EmailNotificationsTab() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/system-settings').then(({ data }) => setSettings(data)).catch(() => {});
  }, []);

  async function updateSetting(key, value) {
    setSaving(true);
    try {
      const { data } = await api.patch('/system-settings', { [key]: value });
      setSettings(data);
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const categories = [...new Set(EMAIL_TOGGLES.map((t) => t.category))];

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
      className="space-y-6"
    >
      {categories.map((category) => (
        <div key={category} className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 px-1">
            {category}
          </h3>
          <div className="space-y-2">
            {EMAIL_TOGGLES.filter((t) => t.category === category).map((toggle) => (
              <SettingRow
                key={toggle.key}
                title={toggle.label}
                description={toggle.description}
                icon={toggle.icon}
                checked={settings[toggle.key] ?? true}
                onChange={(v) => updateSetting(toggle.key, v)}
                disabled={saving}
              />
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
