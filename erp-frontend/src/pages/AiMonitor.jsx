import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import {
  Coins, Zap, Activity, Layers, Cpu, User, AlertTriangle, RefreshCw,
  CheckCircle2, Clock,
} from 'lucide-react';
import api from '../api/client';
import PageShell from '../components/PageShell';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

// Libellés français des features trackées (clés = champ `usage` en BDD)
const FEATURE_LABELS = {
  email: 'Pipeline e-mail',
  chatbot: 'Chat IA',
  background: 'Tâches arrière-plan',
  vision: 'Vision (images)',
  voice: 'Vocal',
  embedding: 'Embeddings (RAG)',
  rerank: 'Re-ranking',
  test: 'Tests de modèles',
};

const fmt = (n) => (n ?? 0).toLocaleString('fr-FR');

function StatCard({ icon: Icon, label, value, sub, color = 'text-primary' }) {
  return (
    <div className="bg-surface rounded-2xl border border-outline-variant/40 p-4 flex items-start gap-3">
      <div className={`p-2.5 rounded-xl bg-surface-container-high ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-on-surface-variant font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-on-surface mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-on-surface-variant mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`bg-surface rounded-2xl border border-outline-variant/40 p-4 ${className}`}>
      <h3 className="text-sm font-bold text-on-surface mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl px-3 py-2 shadow-lg">
      {label !== undefined && <p className="text-[11px] font-bold text-on-surface mb-1">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="text-[11px] text-on-surface-variant">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: entry.color || entry.fill }} />
          {entry.name} : <span className="font-bold text-on-surface">{formatter ? formatter(entry.value) : fmt(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

export default function AiMonitor() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);

  const fetchStats = useCallback(async (d = days) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/system/ai-usage?days=${d}`);
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchStats(days); }, [days, fetchStats]);

  const byProvider = (stats?.byProvider || []).map((p) => ({ name: p.provider, tokens: p._sum?.totalTokens || 0, calls: p._count?.id || 0 }));
  const byFeature = (stats?.byFeature || []).map((f) => ({ name: FEATURE_LABELS[f.usage] || f.usage, key: f.usage, tokens: f._sum?.totalTokens || 0, calls: f._count?.id || 0 }));
  const byModel = (stats?.byModel || []).map((m) => ({ name: m.model, tokens: m._sum?.totalTokens || 0, calls: m._count?.id || 0 }));
  const byUser = (stats?.byUser || []).map((u) => ({ name: u.fullName || u.email, tokens: u.totalTokens, calls: u.calls }));
  const byDay = (stats?.byDay || []).map((d) => ({ date: typeof d.date === 'string' ? d.date.slice(0, 10) : new Date(d.date).toISOString().slice(0, 10), tokens: Number(d.totalTokens || 0), calls: Number(d.calls || 0) }));

  const budgetPct = stats?.budgetUsagePercent;
  const overBudget = budgetPct !== null && budgetPct !== undefined && budgetPct >= 100;
  const nearBudget = budgetPct !== null && budgetPct !== undefined && budgetPct >= (stats?.alertThreshold ?? 0.8) * 100;

  return (
    <PageShell
      icon={Coins}
      iconColor="text-amber-500"
      title="Suivi de consommation IA"
      subtitle="Tokens consommés par l'ensemble du système — providers, features, modèles et utilisateurs"
      actions={
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-xs font-medium text-on-surface cursor-pointer"
          >
            {[1, 7, 30, 90].map((d) => (
              <option key={d} value={d}>{d === 1 ? "Aujourd'hui" : `${d} jours`}</option>
            ))}
          </select>
          <button
            onClick={() => fetchStats(days)}
            disabled={loading}
            className="p-2 rounded-xl border border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high cursor-pointer disabled:opacity-50"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-sm text-red-600 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !stats ? (
        <div className="flex items-center justify-center py-24 text-on-surface-variant text-sm">Chargement…</div>
      ) : stats ? (
        <div className="space-y-6">
          {/* ── KPI ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Coins} label="Tokens aujourd'hui" value={fmt(stats.todayTokens)} color="text-amber-500" />
            <StatCard icon={Layers} label={`Tokens sur ${stats.periodDays} j`} value={fmt(stats.totalTokens)} color="text-blue-500" />
            <StatCard icon={Activity} label="Appels IA" value={fmt(stats.totalCalls)} color="text-emerald-500" />
            <StatCard
              icon={stats.dailyBudget > 0 ? Zap : CheckCircle2}
              label="Budget journalier"
              value={stats.dailyBudget > 0 ? `${budgetPct ?? 0}%` : 'Illimité'}
              sub={stats.dailyBudget > 0 ? `${fmt(stats.todayTokens)} / ${fmt(stats.dailyBudget)}` : 'Aucun budget configuré'}
              color={overBudget ? 'text-red-500' : nearBudget ? 'text-amber-500' : 'text-emerald-500'}
            />
          </div>

          {nearBudget && (
            <div className={`p-4 rounded-2xl border flex items-center gap-2 text-sm ${overBudget ? 'bg-red-500/10 border-red-500/30 text-red-600' : 'bg-amber-500/10 border-amber-500/30 text-amber-600'}`}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {overBudget
                ? `Budget journalier dépassé (${budgetPct}%). Les alertes e-mail sont envoyées aux destinataires configurés.`
                : `Proche du budget journalier (${budgetPct}% du seuil d'alerte atteint).`}
            </div>
          )}

          {/* ── Charts ligne : évolution + répartition feature ──────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Évolution journalière" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-outline-variant/30" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="tokens" name="Tokens" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Par feature">
              {byFeature.length === 0 ? (
                <p className="text-xs text-on-surface-variant italic py-8 text-center">Aucune donnée</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={byFeature} dataKey="tokens" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={false}>
                      {byFeature.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* ── Charts barres : provider, modèle, utilisateur ───────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Par provider">
              {byProvider.length === 0 ? (
                <p className="text-xs text-on-surface-variant italic py-8 text-center">Aucune donnée</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byProvider} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-outline-variant/30" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                    <RechartsTooltip content={<ChartTooltip />} />
                    <Bar dataKey="tokens" name="Tokens" fill="#3b82f6" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Par modèle">
              {byModel.length === 0 ? (
                <p className="text-xs text-on-surface-variant italic py-8 text-center">Aucune donnée</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byModel} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-outline-variant/30" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                    <RechartsTooltip content={<ChartTooltip />} />
                    <Bar dataKey="tokens" name="Tokens" fill="#10b981" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Par utilisateur">
              {byUser.length === 0 ? (
                <p className="text-xs text-on-surface-variant italic py-8 text-center">Aucune donnée (appels système uniquement)</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byUser} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-outline-variant/30" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                    <RechartsTooltip content={<ChartTooltip />} />
                    <Bar dataKey="tokens" name="Tokens" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* ── Détail feature : tokens + appels ────────────────────── */}
          <ChartCard title="Détail par feature">
            {byFeature.length === 0 ? (
              <p className="text-xs text-on-surface-variant italic py-4 text-center">Aucune donnée</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-on-surface-variant border-b border-outline-variant/40">
                      <th className="text-left py-2 pr-4 font-semibold">Feature</th>
                      <th className="text-right py-2 px-4 font-semibold">Tokens</th>
                      <th className="text-right py-2 px-4 font-semibold">Prompt</th>
                      <th className="text-right py-2 px-4 font-semibold">Complétion</th>
                      <th className="text-right py-2 pl-4 font-semibold">Appels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byFeature.map((f) => {
                      const raw = (stats.byFeature || []).find((x) => x.usage === f.key);
                      return (
                        <tr key={f.key} className="border-b border-outline-variant/20 hover:bg-surface-container-high/50">
                          <td className="py-2 pr-4 font-medium text-on-surface">{f.name}</td>
                          <td className="py-2 px-4 text-right font-bold text-on-surface">{fmt(f.tokens)}</td>
                          <td className="py-2 px-4 text-right text-on-surface-variant">{fmt(raw?._sum?.promptTokens)}</td>
                          <td className="py-2 px-4 text-right text-on-surface-variant">{fmt(raw?._sum?.completionTokens)}</td>
                          <td className="py-2 pl-4 text-right text-on-surface-variant">{fmt(f.calls)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </div>
      ) : null}
    </PageShell>
  );
}
