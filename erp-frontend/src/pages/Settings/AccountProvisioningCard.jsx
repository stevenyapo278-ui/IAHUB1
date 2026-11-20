import { useEffect, useMemo, useState } from 'react';
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

function splitList(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
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
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', aliases: '', profiles: '' });
  const [retryDraft, setRetryDraft] = useState(Number(settings?.accountProvisioningRetrySeconds ?? 300));

  useEffect(() => {
    setRetryDraft(Number(settings?.accountProvisioningRetrySeconds ?? 300));
  }, [settings?.accountProvisioningRetrySeconds]);

  async function loadCatalog({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/account-provisioning/catalog/all');
      setCatalog(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger le catalogue des applications.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog();
    // La carte « Applications hors catalogue » peut promouvoir un candidat :
    // on se resynchronise sans recharger la page ni clignoter.
    const refresh = () => loadCatalog({ silent: true });
    window.addEventListener('account-provisioning:catalog-changed', refresh);
    return () => window.removeEventListener('account-provisioning:catalog-changed', refresh);
  }, []);

  const inactiveCount = useMemo(() => catalog.filter((app) => !app.isActive).length, [catalog]);
  // Par défaut on n'affiche que les applications utilisables : le catalogue reste
  // lisible même après plusieurs années de désactivations.
  const visibleCatalog = useMemo(
    () => (showInactive ? catalog : catalog.filter((app) => app.isActive)),
    [catalog, showInactive]
  );

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    const name = form.name.trim();
    if (!name) return setError('Le nom de l’application est obligatoire.');

    setCreating(true);
    try {
      const profiles = splitList(form.profiles);
      const { data } = await api.post('/account-provisioning/catalog', {
        name,
        aliases: splitList(form.aliases),
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

  function startEdit(app) {
    setEditingId(app.id);
    setEditForm({
      name: app.name,
      aliases: (Array.isArray(app.aliases) ? app.aliases : []).join(', '),
      profiles: profileOptions(app).join(', '),
    });
    setError('');
    setInfo('');
  }

  async function handleUpdate(e) {
    e.preventDefault();
    if (!editingId) return;
    const name = editForm.name.trim();
    if (!name) return setError('Le nom de l’application est obligatoire.');

    setBusyId(editingId);
    setError('');
    setInfo('');
    try {
      const profiles = splitList(editForm.profiles);
      const { data } = await api.patch(`/account-provisioning/catalog/${editingId}`, {
        name,
        aliases: splitList(editForm.aliases),
        fields: profiles.length > 0
          ? [{ key: 'profile', label: 'Profil', type: 'select', options: profiles }]
          : [],
      });
      setCatalog((prev) => prev.map((app) => (app.id === editingId ? { ...app, ...data } : app)));
      setEditingId(null);
      setInfo(`Application « ${name} » mise à jour.`);
      if (Array.isArray(data?.warnings) && data.warnings.length > 0) {
        setError(`Enregistrée, mais à vérifier : ${data.warnings.join(' ')}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de modifier l’application.');
    } finally {
      setBusyId(null);
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

  async function handlePermanentDelete() {
    if (!pendingDelete) return;
    setError('');
    setBusyId(pendingDelete.id);
    try {
      await api.delete(`/account-provisioning/catalog/${pendingDelete.id}/permanent`);
      setCatalog((prev) => prev.filter((app) => app.id !== pendingDelete.id));
      setInfo(`Application « ${pendingDelete.name} » supprimée du catalogue.`);
      if (editingId === pendingDelete.id) setEditingId(null);
      setPendingDelete(null);
    } catch (err) {
      // 409 : l'application est référencée par des déclarations → désactivation.
      setError(err.response?.data?.error || 'Impossible de supprimer définitivement l’application.');
      setPendingDelete(null);
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
          <div className="flex items-center gap-2">
            {inactiveCount > 0 && (
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
                title={showInactive ? 'Masquer les applications désactivées' : 'Afficher les applications désactivées'}
              >
                <span className="material-symbols-outlined text-[18px]">{showInactive ? 'visibility_off' : 'visibility'}</span>
                {showInactive ? 'Masquer les désactivées' : `Afficher les désactivées (${inactiveCount})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">{showAdd ? 'close' : 'add'}</span>
              {showAdd ? 'Annuler' : 'Ajouter une application'}
            </button>
          </div>
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
        ) : visibleCatalog.length === 0 ? (
          <p className="text-xs text-on-surface-variant italic">
            {catalog.length === 0
              ? 'Aucune application. Le formulaire ne pourra pas déclarer de comptes tant que le catalogue est vide.'
              : 'Aucune application active. Réactivez-en une ou ajoutez une application pour que le formulaire propose un choix.'}
          </p>
        ) : (
          <div className="divide-y divide-outline-variant/30 rounded-xl border border-outline-variant/40 overflow-hidden">
            {visibleCatalog.map((app) => (
              <div key={app.id} className="bg-surface">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5">
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
                      onClick={() => (editingId === app.id ? setEditingId(null) : startEdit(app))}
                      disabled={busyId === app.id}
                      className="px-2.5 py-1 rounded-lg border border-outline-variant/60 text-[10px] font-bold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40"
                    >
                      {editingId === app.id ? 'Fermer' : 'Modifier'}
                    </button>
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
                      onClick={() => (app.isActive ? setPendingDisable(app) : setPendingDelete(app))}
                      disabled={busyId === app.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                      title={app.isActive ? 'Désactiver' : 'Supprimer définitivement'}
                      aria-label={app.isActive ? `Désactiver ${app.name}` : `Supprimer définitivement ${app.name}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {editingId === app.id && (
                    <motion.form
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      onSubmit={handleUpdate}
                      className="grid grid-cols-1 md:grid-cols-3 gap-3 px-3.5 pb-3.5 overflow-hidden"
                    >
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Nom *</span>
                        <input
                          className={inputClass}
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          required
                        />
                      </label>
                      <label className="flex flex-col gap-1 md:col-span-2">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Alias (séparés par des virgules)</span>
                        <input
                          className={inputClass}
                          value={editForm.aliases}
                          onChange={(e) => setEditForm({ ...editForm, aliases: e.target.value })}
                          placeholder="x3, sage, sage x3"
                        />
                      </label>
                      <label className="flex flex-col gap-1 md:col-span-2">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">
                          Profils autorisés (séparés par des virgules)
                        </span>
                        <input
                          className={inputClass}
                          value={editForm.profiles}
                          onChange={(e) => setEditForm({ ...editForm, profiles: e.target.value })}
                          placeholder="Comptable, Acheteur, Administrateur"
                        />
                      </label>
                      <div className="flex items-end gap-2 md:col-span-1">
                        <button
                          type="submit"
                          disabled={busyId === app.id}
                          className="btn-gradient px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50 whitespace-nowrap flex-1"
                        >
                          {busyId === app.id ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
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
            ? `« ${pendingDisable.name} » ne sera plus proposée dans le formulaire ni à l’IA. Les déclarations déjà enregistrées restent consultables. Une fois désactivée, elle pourra être supprimée définitivement.`
            : ''
        }
        confirmLabel="Désactiver"
        danger
        loading={busyId === pendingDisable?.id}
        onConfirm={handleDisable}
        onCancel={() => setPendingDisable(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Supprimer définitivement ?"
        message={
          pendingDelete
            ? `« ${pendingDelete.name} » sera retirée du catalogue sans possibilité de restauration. La suppression est refusée si des déclarations y font référence : dans ce cas, gardez-la désactivée.`
            : ''
        }
        confirmLabel="Supprimer"
        danger
        loading={busyId === pendingDelete?.id}
        onConfirm={handlePermanentDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
