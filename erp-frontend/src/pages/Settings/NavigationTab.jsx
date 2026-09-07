import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, Monitor, Ticket, AlertTriangle, MailCheck, Inbox, BookOpen, TrendingUp, Users, User, Gauge, BrainCircuit, Tag, MapPin, Boxes, Terminal, ShieldCheck, FileText, History, Shield, Settings, Loader2, Check, X } from 'lucide-react';
import api from '../../api/client';
import { clearSystemSettingsCache } from '../../hooks/useSystemSettings';
import { itemVariants } from './SettingsComponents';

const ROLES = ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'];

const NAV_ITEMS = [
  { section: 'Plateforme', items: [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/portal', label: 'Portail', icon: Monitor },
    { path: '/tickets', label: 'Tickets', icon: Ticket },
    { path: '/problems', label: 'Problèmes', icon: AlertTriangle },
    { path: '/email-drafts', label: 'Centre de Validation', icon: MailCheck },
    { path: '/inbox', label: 'Boîte mail', icon: Inbox },
    { path: '/knowledge-base', label: 'Base de connaissances', icon: BookOpen },
    { path: '/ticket-evolution', label: 'Évolution tickets', icon: TrendingUp },
  ]},
  { section: 'Organisation', items: [
    { path: '/teams', label: 'Équipes', icon: Users },
    { path: '/users', label: 'Utilisateurs', icon: User },
    { path: '/technician-stats', label: 'Perf. techniciens', icon: Gauge },
    { path: '/skills', label: 'Compétences', icon: BrainCircuit },
    { path: '/categories', label: 'Catégories', icon: Tag },
    { path: '/locations', label: 'Lieux', icon: MapPin },
    { path: '/assets', label: 'Inventaire', icon: Boxes },
  ]},
  { section: 'Administration', items: [
    { path: '/ai-weekly-reports', label: 'Apprentissage IA', icon: BrainCircuit },
    { path: '/prompts', label: 'Prompts IA', icon: Terminal },
    { path: '/permission-groups', label: 'Groupes de droits', icon: ShieldCheck },
    { path: '/settings', label: 'Paramètres', icon: Settings },
    { path: '/documentation', label: 'Documentation', icon: FileText },
    { path: '/logs', label: 'Journal activité', icon: History },
    { path: '/audit', label: 'Audit système', icon: Shield },
  ]},
];

// Defaults basés sur les fallbackRoles codés en dur dans MainLayout.jsx
const DEFAULT_VISIBILITY = {
  '/':                   ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/portal':             ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/tickets':            ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/problems':           ['HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/email-drafts':       ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/inbox':              ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/knowledge-base':     ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/ticket-evolution':   ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/teams':              ['ADMIN', 'SUPERADMIN'],
  '/users':              ['ADMIN', 'SUPERADMIN'],
  '/technician-stats':   ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/skills':             ['ADMIN', 'SUPERADMIN'],
  '/categories':         ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/locations':          ['HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/assets':             ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/ai-weekly-reports':  ['HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/prompts':            ['ADMIN', 'SUPERADMIN'],
  '/permission-groups':  ['ADMIN', 'SUPERADMIN'],
  '/settings':           ['ADMIN', 'SUPERADMIN'],
  '/documentation':      ['REQUESTER', 'TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/logs':               ['TECHNICIAN', 'HOTLINE', 'ADMIN', 'SUPERADMIN'],
  '/audit':              ['ADMIN', 'SUPERADMIN'],
};

export default function NavigationTab() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/advanced-settings')
      .then((res) => {
        setConfig(res.data.navigationConfig || null);
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  function getRoles(path) {
    if (config && config[path]) return config[path];
    return DEFAULT_VISIBILITY[path] || ['SUPERADMIN'];
  }

  function toggleRole(path, role) {
    const current = getRoles(path);
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    setConfig((prev) => ({ ...(prev || {}), [path]: next }));
  }

  function setAllRoles(path, roles) {
    setConfig((prev) => ({ ...(prev || {}), [path]: roles }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await api.patch('/advanced-settings', { navigationConfig: config });
      // Invalide le cache navigateur : la sidebar de tous les utilisateurs
      // prendra la nouvelle config au prochain chargement (ou via l'event ci-dessous)
      clearSystemSettingsCache();
      window.dispatchEvent(new CustomEvent('system-settings:updated'));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Erreur sauvegarde navigation config', err);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setConfig(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h3 className="font-headline-sm text-on-surface font-semibold">Visibilité de la barre latérale</h3>
          <p className="text-body-sm text-on-surface-variant mt-1">
            Configurez quels éléments de navigation chaque rôle peut voir. SUPERADMIN voit toujours tout.
          </p>
          <p className="text-[11px] text-on-surface-variant/80 mt-2 flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
            <span>
              Ce réglage personnalise l'affichage par rôle. Pour retirer un <strong>accès réel</strong> à une
              fonctionnalité, retirez le droit correspondant dans{' '}
              <a href="/permission-groups" className="text-primary underline underline-offset-2 hover:opacity-80">
                Groupes de droits
              </a>{' '}
              — le menu disparaît alors automatiquement pour les utilisateurs concernés (liés au droit backend).
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            Réinitialiser
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg btn-primary transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : saved ? <Check className="w-3.5 h-3.5 inline" /> : 'Enregistrer'}
          </button>
        </div>
      </motion.div>

      {NAV_ITEMS.map((section) => (
        <motion.div key={section.section} variants={itemVariants}>
          <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-3">{section.section}</h4>
          <div className="overflow-x-auto rounded-xl border border-outline-variant/30">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-outline-variant/30 bg-surface-container-low">
                  <th className="text-left px-4 py-2.5 font-semibold text-on-surface-variant w-64">Élément</th>
                  {ROLES.map((role) => (
                    <th key={role} className="text-center px-3 py-2.5 font-semibold text-on-surface-variant">{role}</th>
                  ))}
                  <th className="text-center px-3 py-2.5 font-semibold text-on-surface-variant">
                    <button
                      onClick={() => {
                        const allPaths = section.items.map((i) => i.path);
                        const newConfig = { ...(config || {}) };
                        allPaths.forEach((p) => { newConfig[p] = [...ROLES]; });
                        setConfig(newConfig);
                      }}
                      className="text-[10px] text-primary hover:underline"
                      title="Tout activer pour cette section"
                    >Tout</button>
                    {' / '}
                    <button
                      onClick={() => {
                        const allPaths = section.items.map((i) => i.path);
                        const newConfig = { ...(config || {}) };
                        allPaths.forEach((p) => { newConfig[p] = ['SUPERADMIN']; });
                        setConfig(newConfig);
                      }}
                      className="text-[10px] text-error hover:underline"
                      title="Tout désactiver pour cette section"
                    >Aucun</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item, idx) => {
                  const roles = getRoles(item.path);
                  const Icon = item.icon;
                  return (
                    <tr key={item.path} className={`border-b border-outline-variant/20 ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-container-lowest'} hover:bg-primary/5 transition-colors`}>
                      <td className="px-4 py-2.5 flex items-center gap-2.5">
                        <Icon className="w-4 h-4 text-on-surface-variant shrink-0" />
                        <div>
                          <span className="font-medium text-on-surface">{item.label}</span>
                          <span className="ml-2 text-[10px] text-on-surface-variant/60 font-mono">{item.path}</span>
                        </div>
                      </td>
                      {ROLES.map((role) => {
                        const isActive = role === 'SUPERADMIN' || roles.includes(role);
                        const isSuperadmin = role === 'SUPERADMIN';
                        return (
                          <td key={role} className="text-center px-3 py-2.5">
                            <button
                              onClick={() => !isSuperadmin && toggleRole(item.path, role)}
                              disabled={isSuperadmin}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                                isActive
                                  ? isSuperadmin
                                    ? 'bg-primary/20 text-primary cursor-default'
                                    : 'bg-success/15 text-success hover:bg-success/25'
                                  : 'bg-surface-container-high text-on-surface-variant/40 hover:bg-surface-container-high/80'
                              }`}
                            >
                              {isActive ? <Check className="w-3.5 h-3.5" /> : <X className="w-3 h-3" />}
                            </button>
                          </td>
                        );
                      })}
                      <td className="text-center px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setAllRoles(item.path, [...ROLES])}
                            className="text-[10px] text-success hover:underline"
                          >+</button>
                          <button
                            onClick={() => setAllRoles(item.path, ['SUPERADMIN'])}
                            className="text-[10px] text-error hover:underline"
                          >-</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
