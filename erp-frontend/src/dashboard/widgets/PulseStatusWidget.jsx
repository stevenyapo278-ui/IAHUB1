import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../utils/permissions';
import { visiblePulseSections, pulseAlerts, PULSE_TONE, PULSE_CHIP } from '../../config/pulse';

// Widget « Pouls système » du tableau de bord : mêmes lignes, mêmes compteurs et mêmes
// règles de rôle/permission que le bouton flottant (config/pulse.js + GET /dashboard/pulse).
export default function PulseStatusWidget() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  // .then() plutôt que await : react-hooks/set-state-in-effect refuse les setState
  // appelés synchrone­ment depuis le corps d'un effet.
  const load = useCallback(() => api
    .get('/dashboard/pulse')
    .then(({ data: payload }) => {
      setData(payload);
      setFailed(false);
    })
    .catch(() => setFailed(true)), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const sections = visiblePulseSections(user, hasPermission);
  const { critical, warning } = pulseAlerts(data, sections);

  if (!data && failed) {
    return <p className="text-xs text-on-surface-variant text-center py-6">Indisponible (erreur réseau)</p>;
  }
  if (!data) {
    return <div className="animate-pulse space-y-2 py-2">{[...Array(5)].map((_, i) => (<div key={i} className="h-7 rounded-lg bg-surface-container-high" />))}</div>;
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
        {sections.map((section) => (
          <div key={section.id}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.rows.map((row) => {
                const value = Number(data[row.key] ?? 0);
                const highlighted = value > 0 && (row.tone === 'red' || row.tone === 'amber');
                const Icon = row.icon;
                return (
                  <button
                    key={`${section.id}-${row.key}`}
                    type="button"
                    onClick={() => navigate(row.to)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left
                      hover:bg-surface-container-high transition-colors group"
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${PULSE_TONE[row.tone].text}`} aria-hidden />
                    <span className="flex-1 text-[11px] text-on-surface-variant group-hover:text-on-surface truncate">
                      {row.label}
                    </span>
                    <span className={`text-xs font-bold tabular-nums ${highlighted ? PULSE_TONE[row.tone].text : 'text-on-surface'}`}>
                      {value}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {data.integrations && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              Intégrations
            </p>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <span className={`rounded px-1 py-0.5 ${data.integrations.glpi.configured ? PULSE_CHIP.ok : PULSE_CHIP.ko}`}>GLPI</span>
              <span className={`rounded px-1 py-0.5 ${data.integrations.email.accounts > 0 ? PULSE_CHIP.ok : PULSE_CHIP.ko}`}>
                Emails ({data.integrations.email.accounts})
              </span>
              <span className={`rounded px-1 py-0.5 ${data.integrations.ai.enabled && data.integrations.ai.providers > 0 ? PULSE_CHIP.ok : PULSE_CHIP.warn}`}>IA</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-outline-variant text-[10px] text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${critical > 0 ? 'bg-danger animate-pulse' : warning > 0 ? 'bg-warning' : 'bg-success'}`} />
          {critical > 0 ? `${critical} alerte${critical > 1 ? 's' : ''}` : warning > 0 ? `${warning} à surveiller` : 'RAS'}
        </span>
        <button
          type="button"
          onClick={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }}
          disabled={refreshing}
          title="Rafraîchir"
          className="p-1 rounded hover:bg-surface-container-high transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
