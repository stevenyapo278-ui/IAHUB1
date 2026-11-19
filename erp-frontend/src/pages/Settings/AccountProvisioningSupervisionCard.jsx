import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../../api/client';
import { itemVariants } from './SettingsComponents';

// ── Supervision du module « Comptes applicatifs » ───────────────────────────
// Objectif : mesurer pour corriger. Affiche le taux d'acceptation du pré-remplissage,
// les applications hors catalogue récurrentes (à ajouter au référentiel) et l'état
// des synchronisations Budibase, avec rejeu manuel.

const BUDIBASE_STYLES = {
  SYNCED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  FAILED: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  SKIPPED: 'bg-surface-container-high text-on-surface-variant border-outline-variant/40',
};

const SOURCE_LABELS = {
  MANUAL: 'Saisie manuelle',
  AI_PREFILL: 'Pré-rempli IA',
  NOT_APPLICABLE: 'Aucun compte',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function percent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${Math.round(Number(value) * 100)} %`;
}

function StatTile({ label, value, hint, tone = 'primary' }) {
  const tones = {
    primary: 'text-primary',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    violet: 'text-violet-500',
  };
  return (
    <div className="rounded-xl border border-outline-variant/50 bg-surface px-3.5 py-3">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tones[tone] || tones.primary}`}>{value}</div>
      {hint && <div className="text-[10px] text-on-surface-variant mt-0.5">{hint}</div>}
    </div>
  );
}

export default function AccountProvisioningSupervisionCard() {
  const [stats, setStats] = useState(null);
  const [records, setRecords] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { pageSize: 10 };
      if (statusFilter) params.status = statusFilter;
      const [statsRes, recordsRes] = await Promise.all([
        api.get('/account-provisioning/stats'),
        api.get('/account-provisioning/records', { params }),
      ]);
      setStats(statsRes.data || null);
      setRecords(Array.isArray(recordsRes.data?.records) ? recordsRes.data.records : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger la supervision du module.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function retryOne(id) {
    setBusyId(id);
    setError('');
    setInfo('');
    try {
      await api.post(`/account-provisioning/records/${id}/retry`);
      setInfo('Synchronisation relancée.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de relancer cette synchronisation.');
    } finally {
      setBusyId(null);
    }
  }

  async function retryPending() {
    setRetrying(true);
    setError('');
    setInfo('');
    try {
      const { data } = await api.post('/account-provisioning/records/retry-pending', { limit: 50 });
      setInfo(`Rejeu terminé : ${data.synced} synchronisée(s), ${data.failed} en échec, ${data.scanned} examinée(s).`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de relancer les synchronisations en attente.');
    } finally {
      setRetrying(false);
    }
  }

  const prefill = stats?.prefill || {};

  return (
    <motion.div variants={itemVariants} className="bento-card p-lg space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-500 shrink-0">
            <span className="material-symbols-outlined text-[20px]">monitoring</span>
          </div>
          <div className="min-w-0">
            <h4 className="font-headline-sm text-headline-sm text-on-surface font-bold">Supervision des déclarations</h4>
            <p className="text-[11px] text-on-surface-variant mt-1 leading-relaxed max-w-2xl">
              Qualité du pré-remplissage et état des synchronisations Budibase. Les applications
              « ignorées » sont celles citées dans les tickets mais absentes du catalogue : un signal
              pour l’enrichir.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Actualiser
          </button>
          <button
            type="button"
            onClick={retryPending}
            disabled={retrying}
            className="px-3 py-2 rounded-xl border border-outline-variant/60 text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">{retrying ? 'progress_activity' : 'sync'}</span>
            Rejouer en attente
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          {info}
        </div>
      )}

      {loading && !stats ? (
        <p className="text-xs text-on-surface-variant italic">Chargement des indicateurs…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label="Déclarations"
              value={stats?.total ?? 0}
              hint={`${stats?.byOperation?.CREATION ?? 0} création(s) · ${stats?.rightsUpdates ?? 0} droit(s)`}
            />
            <StatTile
              label="Pré-remplies par IA"
              value={prefill.total ? percent(prefill.total ? prefill.ai / prefill.total : 0) : '—'}
              hint={`${prefill.ai || 0} IA · ${prefill.deterministic || 0} catalogue`}
              tone="violet"
            />
            <StatTile
              label="Applications acceptées"
              value={prefill.acceptanceRate == null ? '—' : percent(prefill.acceptanceRate)}
              hint={`${prefill.applicationsCorrected || 0} corrigée(s)`}
              tone="emerald"
            />
            <StatTile
              label="Budibase en échec"
              value={(stats?.byBudibaseStatus?.FAILED || 0) + (stats?.byBudibaseStatus?.PENDING || 0)}
              hint={`${stats?.byBudibaseStatus?.SYNCED || 0} synchronisée(s)`}
              tone="amber"
            />
          </div>

          {stats?.topIgnoredApplications?.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Applications citées hors catalogue
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {stats.topIgnoredApplications.map((app) => (
                  <span
                    key={app.name}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/25 bg-surface text-amber-700 dark:text-amber-400"
                  >
                    {app.name} · {app.count}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-on-surface-variant mt-2">
                Ajoutez-les au catalogue si les techniciens les utilisent réellement.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">
              Dernières déclarations
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-surface border border-outline-variant/60 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Tous les statuts</option>
              <option value="SYNCED">Synchronisées</option>
              <option value="PENDING">En attente</option>
              <option value="FAILED">En échec</option>
              <option value="SKIPPED">Sans Budibase</option>
            </select>
          </div>

          {records.length === 0 ? (
            <p className="text-xs text-on-surface-variant italic">Aucune déclaration pour ce filtre.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-outline-variant/40">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-bright/50 border-b border-outline-variant/60">
                    <th className="p-2.5 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Ticket</th>
                    <th className="p-2.5 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Applications</th>
                    <th className="p-2.5 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Comptes</th>
                    <th className="p-2.5 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Source</th>
                    <th className="p-2.5 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Budibase</th>
                    <th className="p-2.5 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant">Date</th>
                    <th className="p-2.5 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b border-outline-variant/20 last:border-b-0 hover:bg-surface-container-low/50">
                      <td className="p-2.5 align-middle">
                        <Link to={`/tickets/${record.ticketId}`} className="text-xs font-bold text-primary hover:underline">
                          #{record.ticketId}
                        </Link>
                        <div className="text-[10px] text-on-surface-variant truncate max-w-[220px]" title={record.ticket?.title || ''}>
                          {record.ticket?.title || '—'}
                        </div>
                      </td>
                      <td className="p-2.5 text-[11px] text-on-surface-variant align-middle">
                        {(record.applications || []).map((app) => app.name).join(', ') || '—'}
                      </td>
                      <td className="p-2.5 text-[11px] font-semibold text-on-surface align-middle">{record.accountsCount}</td>
                      <td className="p-2.5 text-[11px] text-on-surface-variant align-middle">
                        {SOURCE_LABELS[record.source] || record.source}
                      </td>
                      <td className="p-2.5 align-middle">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${BUDIBASE_STYLES[record.budibaseStatus] || BUDIBASE_STYLES.SKIPPED}`}>
                          {record.budibaseStatus}
                        </span>
                      </td>
                      <td className="p-2.5 text-[10px] text-on-surface-variant align-middle whitespace-nowrap">
                        {formatDate(record.createdAt)}
                      </td>
                      <td className="p-2.5 text-right align-middle">
                        {['FAILED', 'PENDING'].includes(record.budibaseStatus) && (
                          <button
                            type="button"
                            onClick={() => retryOne(record.id)}
                            disabled={busyId === record.id}
                            className="px-2 py-1 rounded-lg border border-outline-variant/60 text-[10px] font-bold text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40"
                          >
                            {busyId === record.id ? '…' : 'Rejouer'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
