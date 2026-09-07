import { useSearchParams } from 'react-router-dom';
import { History, Shield, Activity } from 'lucide-react';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import ActivityLogs from './ActivityLogs';
import AuditLogs from './AuditLogs';

/**
 * LogsHub — vue unifiée « Journal & Audit ».
 *
 * Fusion des anciennes pages /logs (Journal d'activité) et /audit (Audit système)
 * en une seule page à onglets. L'onglet Audit n'est visible que des ADMIN/SUPERADMIN.
 * L'onglet actif est mémorisé dans l'URL (?tab=audit) — partageable et stable au reload.
 */
export default function LogsHub() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const tab = searchParams.get('tab') === 'audit' && isAdmin ? 'audit' : 'activity';

  const setTab = (t) => setSearchParams(t === 'audit' ? { tab: 'audit' } : {});

  const tabs = [
    { key: 'activity', label: "Journal d'activité", icon: Activity, visible: true },
    { key: 'audit', label: 'Audit système', icon: Shield, visible: isAdmin },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <PageShell
        icon={History}
        iconColor="text-rose-400"
        title="Journal & Audit"
        subtitle="Traçabilité complète : événements tickets/emails et actions d'administration"
        fill
        actions={
          <div className="flex items-center p-0.5 rounded-xl border border-outline-variant/30 bg-surface-muted gap-0.5">
            {tabs.filter((t) => t.visible).map(({ key, label, icon: TabIcon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  tab === key
                    ? 'bg-surface text-on-surface shadow-sm border border-outline-variant/30'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <TabIcon className={`w-3.5 h-3.5 ${key === 'audit' ? 'text-amber-500' : 'text-blue-500'}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        }
        noPadding
        className="py-0"
      >
        <div className="flex-1 min-h-0 flex flex-col">
          {tab === 'activity' ? <ActivityLogs embedded /> : <AuditLogs embedded />}
        </div>
      </PageShell>
    </div>
  );
}
