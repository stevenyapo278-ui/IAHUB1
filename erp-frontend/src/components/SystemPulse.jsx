import { useNavigate } from 'react-router-dom';
import { RefreshCw, X, Activity } from 'lucide-react';
import { PULSE_TONE, PULSE_CHIP } from '../config/pulse';

// Panneau de compteurs du « Pouls système » (vue pure : le fetch, les rôles et
// l'ancrage sont gérés par FloatingDock.jsx, qui possède aussi le bouton du rail).
function timeLabel(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function syncAgoLabel(dateString) {
  if (!dateString) return 'jamais';
  const diff = Date.now() - new Date(dateString).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'à l’instant';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'il y a moins d’1 min';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return `il y a ${h} h`;
}

export default function SystemPulse({
  data, failed, sections, style, refreshing = false, onRefresh, onClose,
}) {
  const navigate = useNavigate();
  const integrations = data?.integrations;

  const openRow = (to) => {
    navigate(to);
    onClose();
  };

  return (
    <aside
      id="system-pulse-panel"
      aria-label="Pouls système"
      style={style}
      className="hidden md:flex fixed z-40 w-[336px] max-w-[85vw] flex-col
        rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl overflow-hidden"
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant bg-surface-container-low">
        <Activity className="w-4 h-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold flex-1 truncate">Pouls système</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Rafraîchir"
          className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Replier"
          className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sections.map((section) => (
          <div key={section.id} className="mb-1.5">
            <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              {section.title}
            </p>
            {section.rows.map((row) => {
              const value = Number(data?.[row.key] ?? 0);
              const Icon = row.icon;
              // Rouge/ambre ressortent seulement quand il y a quelque chose à traiter
              const highlighted = value > 0 && (row.tone === 'red' || row.tone === 'amber');
              return (
                <button
                  key={`${section.id}-${row.key}`}
                  type="button"
                  onClick={() => openRow(row.to)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left
                    hover:bg-surface-container-high transition-colors group"
                >
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-surface-container flex items-center justify-center">
                    <Icon className={`w-4 h-4 ${PULSE_TONE[row.tone].text}`} aria-hidden />
                  </span>
                  <span className="flex-1 text-xs text-on-surface-variant group-hover:text-on-surface truncate">
                    {row.label}
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${highlighted ? PULSE_TONE[row.tone].text : 'text-on-surface'}`}>
                    {value}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {integrations && (
          <div className="mx-1 mb-2 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">
              Intégrations
            </p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${integrations.glpi.configured ? PULSE_CHIP.ok : PULSE_CHIP.ko}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> GLPI
              </span>
              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${integrations.email.accounts > 0 ? PULSE_CHIP.ok : PULSE_CHIP.ko}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Emails ({integrations.email.accounts})
              </span>
              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${integrations.ai.enabled && integrations.ai.providers > 0 ? PULSE_CHIP.ok : PULSE_CHIP.warn}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> IA
              </span>
              {integrations.n8n.active > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${integrations.n8n.failing > 0 ? PULSE_CHIP.ko : PULSE_CHIP.ok}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" /> n8n{integrations.n8n.failing > 0 ? ` (${integrations.n8n.failing})` : ''}
                </span>
              )}
            </div>
          </div>
        )}

        {!data && (
          <p className="px-4 py-6 text-xs text-on-surface-variant text-center">
            {failed ? 'Indisponible (erreur réseau)' : 'Chargement…'}
          </p>
        )}
      </div>

      <footer className="px-4 py-3 border-t border-outline-variant text-[11px] text-on-surface-variant space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-info" aria-hidden />
          <span>Emails synchronisés {syncAgoLabel(data?.lastEmailSyncAt)}</span>
        </div>
        <div>Actualisé à {timeLabel(data?.fetchedAt)}</div>
      </footer>
    </aside>
  );
}
