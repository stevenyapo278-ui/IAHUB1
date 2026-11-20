import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { inputClass, itemVariants } from './SettingsComponents';

// ── Applications citées hors catalogue ──────────────────────────────────────
// L'IA ne crée jamais une application : quand un ticket mentionne un logiciel
// absent du référentiel, le nom est mis en file d'attente ici. Le SUPERADMIN
// décide ensuite de l'ajouter (avec alias/profils), de le fusionner avec une
// application existante, ou de l'ignorer définitivement.
//
// Objectif : faire grandir le catalogue avec la réalité du terrain sans jamais
// laisser une extraction libre polluer les données.

const STATUS_TABS = [
  { value: 'PENDING', label: 'À traiter' },
  { value: 'IGNORED', label: 'Ignorées' },
  { value: 'PROMOTED', label: 'Ajoutées' },
];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function splitList(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

// Prévient la carte du catalogue qu'elle doit se recharger (même page).
function notifyCatalogChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('account-provisioning:catalog-changed'));
  }
}

export default function AccountProvisioningCandidatesCard() {
  const [status, setStatus] = useState('PENDING');
  const [candidates, setCandidates] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', aliases: '', profiles: '', mergeIntoId: '' });

  const load = useCallback(async (nextStatus) => {
    setLoading(true);
    try {
      const { data } = await api.get('/account-provisioning/candidates', {
        params: { status: nextStatus, limit: 100 },
      });
      setCandidates(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger les applications candidates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(status); }, [load, status]);

  useEffect(() => {
    // Catalogue actif : sert au choix « fusionner avec une application existante ».
    api.get('/account-provisioning/catalog')
      .then(({ data }) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]));
  }, []);

  const pendingCount = useMemo(
    () => (status === 'PENDING' ? candidates.length : null),
    [candidates, status]
  );

  function startPromote(candidate) {
    setEditingId(candidate.id);
    setForm({
      name: candidate.name,
      aliases: candidate.name,
      profiles: '',
      mergeIntoId: '',
    });
    setError('');
    setInfo('');
  }

  async function handlePromote(e) {
    e.preventDefault();
    if (!editingId) return;
    const name = form.name.trim();
    if (!name) return setError('Le nom de l’application est obligatoire.');

    setBusyId(editingId);
    setError('');
    setInfo('');
    try {
      const { data } = await api.post(`/account-provisioning/candidates/${editingId}/promote`, {
        name,
        aliases: splitList(form.aliases),
        profiles: splitList(form.profiles),
        mergeIntoId: form.mergeIntoId ? Number(form.mergeIntoId) : null,
      });
      setInfo(
        data?.merged
          ? `« ${data.catalog?.name || name} » : le nom a été ajouté comme alias de l’application existante.`
          : `Application « ${data?.catalog?.name || name} » ajoutée au catalogue.`
      );
      setEditingId(null);
      notifyCatalogChanged();
      await load(status);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible d’ajouter l’application au catalogue.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleIgnore(candidate) {
    setBusyId(candidate.id);
    setError('');
    setInfo('');
    try {
      await api.post(`/account-provisioning/candidates/${candidate.id}/ignore`);
      setInfo(`« ${candidate.name} » ne sera plus proposé.`);
      if (editingId === candidate.id) setEditingId(null);
      await load(status);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible d’ignorer l’application candidate.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <motion.div variants={itemVariants} className="bento-card p-lg space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-amber-500">travel_explore</span>
            Applications citées hors catalogue
            {pendingCount > 0 && (
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25">
                {pendingCount}
              </span>
            )}
          </div>
          <p className="text-xs text-on-surface-variant mt-1 max-w-2xl">
            Noms de logiciels rencontrés dans les tickets mais absents du référentiel. L’IA ne les crée jamais
            elle-même : ajoutez-les au catalogue (avec leurs alias) ou ignorez-les.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => { setStatus(tab.value); setEditingId(null); }}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
                status === tab.value
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            key="cand-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 px-3 py-2 rounded-xl text-xs overflow-hidden"
          >
            {error}
          </motion.div>
        )}
        {info && (
          <motion.div
            key="cand-info"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 px-3 py-2 rounded-xl text-xs overflow-hidden"
          >
            {info}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <p className="text-xs text-on-surface-variant italic">Chargement des candidats…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-on-surface-variant italic">
          {status === 'PENDING'
            ? 'Aucune application hors catalogue en attente. Le catalogue couvre ce qui est cité dans les tickets.'
            : status === 'IGNORED'
              ? 'Aucune application ignorée.'
              : 'Aucune application ajoutée depuis cette file.'}
        </p>
      ) : (
        <div className="divide-y divide-outline-variant/30 rounded-xl border border-outline-variant/40 overflow-hidden">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="bg-surface">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-on-surface">{candidate.name}</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border bg-surface-container-high text-on-surface-variant border-outline-variant/40">
                      {candidate.occurrences}×
                    </span>
                    {candidate.status === 'PROMOTED' && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        Ajoutée
                      </span>
                    )}
                    {candidate.status === 'IGNORED' && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border bg-surface-container-high text-on-surface-variant border-outline-variant/40">
                        Ignorée
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">
                    Dernière détection : {formatDate(candidate.lastSeenAt)}
                    {candidate.lastTicketId ? (
                      <>
                        {' · '}
                        <Link to={`/tickets/${candidate.lastTicketId}`} className="text-primary hover:underline font-semibold">
                          ticket #{candidate.lastTicketId}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                {candidate.status === 'PENDING' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => (editingId === candidate.id ? setEditingId(null) : startPromote(candidate))}
                      disabled={busyId === candidate.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary/30 bg-primary/10 text-[10px] font-bold text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      {editingId === candidate.id ? 'Fermer' : 'Ajouter au catalogue'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleIgnore(candidate)}
                      disabled={busyId === candidate.id}
                      className="px-2.5 py-1 rounded-lg border border-outline-variant/60 text-[10px] font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-40"
                    >
                      {busyId === candidate.id ? '…' : 'Ignorer'}
                    </button>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {editingId === candidate.id && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    onSubmit={handlePromote}
                    className="grid grid-cols-1 md:grid-cols-3 gap-3 px-3.5 pb-3.5 overflow-hidden"
                  >
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Nom *</span>
                      <input
                        className={inputClass}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                      />
                    </label>
                    <label className="flex flex-col gap-1 md:col-span-2">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Alias (séparés par des virgules)</span>
                      <input
                        className={inputClass}
                        value={form.aliases}
                        onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                        placeholder="x3, sage x3"
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
                        placeholder="Comptable, Acheteur"
                      />
                    </label>
                    <label className="flex flex-col gap-1 md:col-span-3">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">
                        Fusionner avec une application existante
                      </span>
                      <select
                        className={inputClass}
                        value={form.mergeIntoId}
                        onChange={(e) => setForm({ ...form, mergeIntoId: e.target.value })}
                      >
                        <option value="">Créer une nouvelle application</option>
                        {catalog.map((app) => (
                          <option key={app.id} value={app.id}>{app.name}</option>
                        ))}
                      </select>
                      <span className="text-[10px] text-on-surface-variant/80">
                        En cas de fusion, le nom détecté devient un alias de l’application choisie.
                      </span>
                    </label>
                    <div className="flex items-end gap-2 md:col-span-3">
                      <button
                        type="submit"
                        disabled={busyId === candidate.id}
                        className="btn-gradient px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50"
                      >
                        {busyId === candidate.id ? 'Ajout…' : form.mergeIntoId ? 'Fusionner' : 'Ajouter au catalogue'}
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
  );
}
