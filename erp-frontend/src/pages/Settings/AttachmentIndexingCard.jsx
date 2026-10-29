import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import api from '../../api/client';
import Toggle from '../../components/Toggle';

// ── Indexation des pièces jointes (Paramètres > Automatisation) ──────────────
// Rend visible ce qui se passe hors écran : le serveur extrait le texte (ou fait
// l'OCR Vision) des PJ reçues par mail ou jointes à la main, les indexe dans le
// RAG du chatbot, et rattrape l'historique toutes les 10 minutes.
// Ici : interrupteur global + compteurs par statut + déclenchement immédiat.
const STAT_TILES = [
  { key: 'DONE', label: 'Indexées', tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  { key: 'PENDING', label: 'En attente', tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { key: 'SKIPPED', label: 'Ignorées', tone: 'text-on-surface-variant bg-surface-container border-outline-variant/40' },
  { key: 'ERROR', label: 'En échec', tone: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20' },
];

export default function AttachmentIndexingCard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    api
      .get('/attachment-indexing')
      .then(({ data }) => { setStats(data); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'Impossible de charger les compteurs'));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleEnabled(value) {
    setSaving(true);
    try {
      const { data } = await api.patch('/attachment-indexing', { enabled: value });
      setStats(data);
      toast.success(value ? 'Indexation des pièces jointes activée' : 'Indexation suspendue');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  }

  async function runBackfill() {
    setRunning(true);
    try {
      const { data } = await api.post('/attachment-indexing/backfill', { batchSize: 10 });
      setStats(data.stats);
      const r = data.result || {};
      if (!r.processed) {
        toast.info(r.waitingProvider > 0 ? 'Aucun fournisseur IA Vision actif : images en attente' : 'Aucune pièce jointe en attente');
      } else {
        toast.success(
          `${r.done} indexée(s) (${r.chunks} extrait(s)), ${r.skipped} ignorée(s), ${r.errors} échec(s)`
        );
      }
      if (r.waitingProvider > 0) toast.warning('Aucun fournisseur IA Vision actif : les images restent en attente');
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors du rattrapage");
    } finally {
      setRunning(false);
    }
  }

  if (!stats) {
    return (
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {error || 'Chargement…'}
      </p>
    );
  }

  const pending = (stats.PENDING || 0) + (stats.PROCESSING || 0);
  const skipped = (stats.SKIPPED || 0) + (stats.EMPTY || 0);

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 pb-sm">
        <span className="material-symbols-outlined text-primary text-2xl">document_scanner</span>
        <h4 className="font-headline-md text-headline-md text-on-surface font-bold">Indexation des pièces jointes</h4>
      </div>

      <motion.div
        whileHover={{ y: -1, borderColor: 'var(--color-outline-variant)' }}
        className="bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-lg p-lg"
      >
        <div className="min-w-0 flex-1 flex items-center gap-4">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
            <span className="material-symbols-outlined text-xl">scanner</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Extraire et indexer le contenu des pièces jointes
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">
              Le texte des PDF/Word/Excel et l'OCR des images jointes aux mails ou aux tickets sont
              indexés pour que le chatbot puisse s'appuyer sur leur contenu. Suspendu, plus aucune
              extraction : les nouvelles pièces jointes restent « En attente ».
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <Toggle checked={stats.enabled} onChange={toggleEnabled} disabled={saving} label="Indexation des pièces jointes" />
        </div>
      </motion.div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-sm">
        {STAT_TILES.map((tile) => (
          <div key={tile.key} className={`rounded-xl border p-3 ${tile.tone}`}>
            <p className="text-[20px] font-extrabold leading-none tabular-nums">
              {tile.key === 'SKIPPED' ? skipped : (stats[tile.key] || 0)}
            </p>
            <p className="text-[11px] font-bold mt-1 opacity-90">{tile.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-[11px] text-on-surface-variant">
          {stats.total} pièce(s) jointe(s) sur disque · {stats.chunks} extrait(s) interrogeable(s) par le chatbot
          {stats.PROCESSING > 0 ? ` · ${stats.PROCESSING} extraction(s) en cours` : ''}
          {!stats.visionAvailable && (
            <span className="block mt-1 text-amber-600 dark:text-amber-400 font-semibold">
              Aucun fournisseur IA Vision actif : les images ne peuvent pas être lues (Paramètres &gt; Intelligence Artificielle).
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={runBackfill}
          disabled={running || !stats.enabled || pending === 0}
          title={pending === 0 ? 'Aucune pièce jointe en attente' : 'Traiter immédiatement un lot de pièces jointes en attente'}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-body-sm hover:bg-surface-container-low transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <span className={`material-symbols-outlined text-[16px] ${running ? 'animate-spin' : ''}`}>
            {running ? 'progress_activity' : 'play_arrow'}
          </span>
          {running ? 'Rattrapage en cours…' : 'Lancer le rattrapage'}
        </button>
      </div>
    </div>
  );
}
