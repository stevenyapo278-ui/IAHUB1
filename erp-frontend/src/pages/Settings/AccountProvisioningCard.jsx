import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SettingRow, inputClass, itemVariants } from './SettingsComponents';

// Profils déclarés dans le schéma de champs de l'application (le cas échéant).
function profileOptions(app) {
  const fields = Array.isArray(app?.fields) ? app.fields : (app?.fields?.fields || []);
  const field = fields.find((entry) => entry && entry.key === 'profile' && Array.isArray(entry.options));
  return field?.options || [];
}

// ── Carte de réglage du module « Création de comptes applicatifs » ──────────
// Section de la page Paramètres > Avancé (SUPERADMIN uniquement, car la route
// /advanced-settings est protégée par requireSuperAdmin côté backend).
//
// Contenu :
//   • activation du module et du pré-remplissage IA ;
//   • fréquence de rejeu des synchronisations Budibase ;
//   • gestion du catalogue fermé des applications (sans lui, l'IA ne peut pas
//     mapper de manière fiable le nom écrit dans le ticket).
export default function AccountProvisioningCard({ settings, updateSetting, saving }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', aliases: '', profiles: '' });
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingDisable, setPendingDisable] = useState(null);
  const [retryDraft, setRetryDraft] = useState(Number(settings?.accountProvisioningRetrySeconds ?? 300));

  useEffect(() => {
    setRetryDraft(Number(settings?.accountProvisioningRetrySeconds ?? 300));
  }, [settings?.accountProvisioningRetrySeconds]);

  async function loadCatalog() {
    setLoading(true);
    try {
      const { data } = await api.get('/account-provisioning/catalog/all');
      setCatalog(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger le catalogue des applications.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCatalog(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    const name = form.name.trim();
    if (!name) return setError('Le nom de l’application est obligatoire.');

    setCreating(true);
    try {
      const profiles = form.profiles.split(',').map((p) => p.trim()).filter(Boolean);
      const { data } = await api.post('/account-provisioning/catalog', {
        name,
        aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean),
        // Liste fermée des profils proposés dans le formulaire : évite les variantes
        // de saisie (« Comptable », « comptable », « Compta »).
        fields: profiles.length > 0
          ? [{ key: 'profile', label: 'Profil', type: 'select', options: profiles }]
          : [],
        isActive: true,
      });
      setForm({ name: '', aliases: '', profiles: '' });
      setShowAdd(false);
      setInfo(`Application « ${name} » ajoutée au catalogue.`);
      if (Array.isArray(data?.warnings) && data.warnings.length > 0) {
        setError(`Ajoutée, mais à vérifier : ${data.warnings.join(' ')}`);
      }
      loadCatalog();
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible d’ajouter l’application.');
    } finally {
      setCreating(false);
    }
  }

  async function toggleCatalog(id, isActive) {
    setError('');
    setBusyId(id);
    try {
      await api.patch(`/account-provisioning/catalog/${id}`, { isActive });
      setCatalog((prev) => prev.map((app) => (app.id === id ? { ...app, isActive } : app)));
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de modifier l’application.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisable() {
    if (!pendingDisable) return;
    setError('');
    setBusyId(pendingDisable.id);
    try {
      await api.delete(`/account-provisioning/catalog/${pendingDisable.id}`);
      setCatalog((prev) => prev.map((app) => (app.id === pendingDisable.id ? { ...app, isActive: false } : app)));
      setInfo(`Application « ${pendingDisable.name} » désactivée. Les déclarations historiques restent lisibles.`);
      setPendingDisable(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de désactiver l’application.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
        <span className="material-symbols-outlined text-primary text-2xl">manage_accounts</span>
        <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Comptes applicatifs</h4>
      </div>

      <p className="text-xs text-on-surface-variant leading-relaxed max-w-2xl">
        Quand le module est actif, un technicien doit déclarer les opérations réalisées sur les comptes
        (application, identifiant, profil, quantité) — <strong>création d’un compte ou mise à jour de droits</strong> —
        <strong> avant de pouvoir résoudre un ticket</strong>.
        Les déclarations sont conservées dans la base puis synchronisées vers Budibase.
        Aucun mot de passe n’est stocké.
      </p>

      <AnimatePresence>
        {error && (
          <motion.div
            key="ap-error"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-md rounded-xl text-sm overflow-hidden"
          >
            {error}
          </motion.div>
        )}
        {info && (
          <motion.div
            key="ap-info"
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 p-md rounded-xl text-sm overflow-hidden"
          >
            {info}
          </motion.div>
        )}
      </AnimatePresence>

      <SettingRow
        title="Activer le module de déclaration"
        description="Oblige les techniciens à déclarer les opérations réalisées sur les comptes applicatifs (création ou mise à jour de droits) avant de passer un ticket à « Résolu ». Les administrateurs et la hotline ne sont pas bloqués. Le backend refuse aussi la résolution via API tant que la déclaration manque."
        checked={settings?.accountProvisioningEnabled === true}
        onChange={(v) => updateSetting('accountProvisioningEnabled', v)}
        disabled={saving}
      />

      <SettingRow
        title="Pré-remplissage par IA"
        description="Analyse le ticket et ses derniers suivis pour proposer l’application et les comptes probables. Toujours éditable et jamais bloquant ; aucun appel IA si le ticket ne mentionne pas de compte."
        checked={settings?.accountProvisioningAiPrefill !== false}
        onChange={(v) => updateSetting('accountProvisioningAiPrefill', v)}
        disabled={saving || settings?.accountProvisioningEnabled !== true}
      />

      {/* Fréquence de rejeu Budibase */}
      <motion.div variants={itemVariants} className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg">
        <div className="min-w-0 flex-1">
          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">
            Rejeu des synchronisations Budibase
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">
            Fréquence de reprise des déclarations non synchronisées (réseau, Budibase indisponible…).
            <code className="mx-1 px-1 rounded bg-surface-container-high font-mono text-[11px]">0</code> désactive le rejeu automatique.
          </p>
        </div>
        <div className="flex items-center gap-sm shrink-0">
          <input
            type="number"
            min={0}
            max={86400}
            value={retryDraft}
            onChange={(e) => setRetryDraft(Math.max(0, Math.min(86400, Number(e.target.value) || 0)))}
            disabled={saving}
            className={`${inputClass} w-24 text-center disabled:opacity-50`}
          />
          <span className="text-xs text-on-surface-variant font-medium">secondes</span>
          <button
            type="button"
            onClick={() => updateSetting('accountProvisioningRetrySeconds', Number(retryDraft) || 0)}
            disabled={saving || Number(retryDraft) === Number(settings?.accountProvisioningRetrySeconds ?? 300)}
            className="px-3 py-2 rounded-xl btn-gradient text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Enregistrer
          </button>
        </div>
      </motion.div>

      {/* Catalogue des applications */}
      <motion.div variants={itemVariants} className="bento-card p-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">apps</span>
              Catalogue des applications
            </div>
            <p className="text-xs text-on-surface-variant mt-1">
              Liste fermée utilisée par le formulaire et par l’IA. Ajoutez les alias réellement employés dans les tickets
              (ex. <em>m365, x3, ad</em>).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">{showAdd ? 'close' : 'add'}</span>
            {showAdd ? 'Annuler' : 'Ajouter une application'}
          </button>
        </div>

        <AnimatePresence>
          {showAdd && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleCreate}
              className="grid grid-cols-1 md:grid-cols-3 gap-3 overflow-hidden"
            >
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Nom *</span>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Sage X3"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Alias (séparés par des virgules)</span>
                <input
                  className={inputClass}
                  value={form.aliases}
                  onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                  placeholder="x3, sage, sage x3"
                />
              </label>
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">
                  Profils autorisés (séparés par des virgules)
                </span>
                <input
                  className={inputClass}
                  value={form.profiles}
                  onChange={(e) => setForm({ ...form, profiles: e.target.value })}
                  placeholder="Comptable, Acheteur, Administrateur"
                />
                <span className="text-[10px] text-on-surface-variant/80">
                  Facultatif. Si renseigné, le champ « Profil » devient une liste fermée dans le formulaire.
                </span>
              </label>
              <div className="flex items-end md:col-span-1">
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-gradient px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50 whitespace-nowrap w-full"
                >
                  {creating ? 'Ajout…' : 'Ajouter'}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {loading ? (
          <p className="text-xs text-on-surface-variant italic">Chargement du catalogue…</p>
        ) : catalog.length === 0 ? (
          <p className="text-xs text-on-surface-variant italic">
            Aucune application. Le formulaire ne pourra pas déclarer de comptes tant que le catalogue est vide.
          </p>
        ) : (
          <div className="divide-y divide-outline-variant/30 rounded-xl border border-outline-variant/40 overflow-hidden">
            {catalog.map((app) => (
              <div key={app.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 bg-surface">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${app.isActive ? 'text-on-surface' : 'text-on-surface-variant/60 line-through'}`}>
                      {app.name}
                    </span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                      app.isActive
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-surface-container-high text-on-surface-variant border-outline-variant/40'
                    }`}>
                      {app.isActive ? 'Active' : 'Désactivée'}
                    </span>
                  </div>
                  {Array.isArray(app.aliases) && app.aliases.length > 0 && (
                    <p className="text-[10px] text-on-surface-variant mt-0.5 truncate">
                      Alias : {app.aliases.join(', ')}
                    </p>
                  )}
                  {profileOptions(app).length > 0 && (
                    <p className="text-[10px] text-on-surface-variant/80 mt-0.5 truncate">
                      Profils : {profileOptions(app).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleCatalog(app.id, !app.isActive)}
                    disabled={busyId === app.id}
                    className="px-2.5 py-1 rounded-lg border border-outline-variant/60 text-[10px] font-bold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40"
                  >
                    {app.isActive ? 'Désactiver' : 'Réactiver'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDisable(app)}
                    disabled={busyId === app.id}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    title="Retirer du catalogue"
                    aria-label={`Retirer ${app.name}`}
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <ConfirmDialog
        open={Boolean(pendingDisable)}
        title="Désactiver cette application ?"
        message={
          pendingDisable
            ? `« ${pendingDisable.name} » ne sera plus proposée dans le formulaire. Les déclarations déjà enregistrées restent consultables.`
            : ''
        }
        confirmLabel="Désactiver"
        danger
        loading={busyId === pendingDisable?.id}
        onConfirm={handleDisable}
        onCancel={() => setPendingDisable(null)}
      />
    </div>
  );
}
