import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import {
  Bot, MessageSquare, Users, Zap, AlertTriangle, Clock, TrendingUp,
  ThumbsUp, ThumbsDown, Shield, RefreshCw, Activity, BarChart3, Eye,
} from 'lucide-react';
import api from '../api/client';
import PageShell from '../components/PageShell';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

function StatCard({ icon: Icon, label, value, sub, color = 'text-primary', trend }) {
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
      {trend !== undefined && (
        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${trend >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {trend >= 0 ? '+' : ''}{trend}%
        </span>
      )}
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

export default function ChatMonitor() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function fetchStats() {
    setLoading(true);
    try {
      const { data } = await api.get('/chat/stats');
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStats(); }, []);

  if (loading) {
    return (
      <PageShell title="Monitoring Chatbot" subtitle=" Surveillance et analytics de l'assistant IA">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-6 h-6 text-primary animate-spin" />
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="Monitoring Chatbot" subtitle=" Surveillance et analytics de l'assistant IA">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertTriangle className="w-12 h-12 text-red-500" />
          <p className="text-on-surface-variant">{error}</p>
          <button onClick={fetchStats} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold cursor-pointer">
            Réessayer
          </button>
        </div>
      </PageShell>
    );
  }

  const o = stats?.overview || {};

  return (
    <PageShell
      title="Monitoring Chatbot"
      subtitle=" Surveillance et analytics de l'assistant IA"
      actions={
        <button onClick={fetchStats} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-[12px] font-semibold transition-colors cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" />
          Actualiser
        </button>
      }
    >
      {/* KPIs principaux */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={MessageSquare} label="Messages (total)" value={o.totalMessages?.toLocaleString()} sub={`${o.totalUsers} utilisateurs uniques`} color="text-blue-500" />
        <StatCard icon={TrendingUp} label="Aujourd'hui" value={o.todayMessages} sub={`${o.weekMessages} cette semaine`} color="text-emerald-500" />
        <StatCard icon={Zap} label="Tokens consommés" value={o.totalTokens?.toLocaleString()} sub={`~${o.avgTokensPerResponse} tokens/réponse`} color="text-amber-500" />
        <StatCard icon={Clock} label="Temps moyen" value={`${o.avgResponseMs}ms`} sub="par réponse IA" color="text-cyan-500" />
      </div>

      {/* Alertes flagged */}
      {o.flaggedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-2xl bg-red-500/5 border border-red-500/20 flex items-center gap-3"
        >
          <Shield className="w-5 h-5 text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-700">{o.flaggedCount} tentative(s) de prompt injection détectée(s)</p>
            <p className="text-[11px] text-red-600/70">Consultez la section "Alertes sécurité" ci-dessous</p>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Messages par jour */}
        <ChartCard title="Messages par jour (7 jours)">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.dailyCounts || []} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.split('-').slice(1).join('/')} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Messages" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Usage par heure */}
        <ChartCard title="Distribution par heure (aujourd'hui)">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats?.hourlyCounts || []} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant, #e5e7eb)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(h) => `${h}h`} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} name="Messages" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Sujets qui reviennent le plus souvent */}
      <ChartCard title="Sujets qui reviennent le plus souvent (30 derniers jours)" className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {(stats?.topTopics || []).map((t, i) => (
            <div
              key={t.topic}
              className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-container border border-outline-variant/30"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] + '20', color: COLORS[i % COLORS.length] }}
                >
                  {i + 1}
                </span>
                <span className="text-[12px] font-semibold text-on-surface truncate capitalize">{t.topic}</span>
              </span>
              <span className="text-[11px] font-bold text-on-surface-variant shrink-0">{t.count}</span>
            </div>
          ))}
          {(!stats?.topTopics || stats.topTopics.length === 0) && (
            <p className="text-[12px] text-on-surface-variant text-center py-4 col-span-full">Aucune donnée</p>
          )}
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Top intents */}
        <ChartCard title="Intentions les plus fréquentes">
          <div className="space-y-2">
            {(stats?.topIntents || []).map((item, i) => (
              <div key={item.intent} className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: COLORS[i % COLORS.length] + '20', color: COLORS[i % COLORS.length] }}>
                  {i + 1}
                </span>
                <span className="flex-1 text-[12px] text-on-surface font-medium truncate">{item.intent}</span>
                <span className="text-[11px] text-on-surface-variant font-bold">{item.count}</span>
              </div>
            ))}
            {(!stats?.topIntents || stats.topIntents.length === 0) && (
              <p className="text-[12px] text-on-surface-variant text-center py-4">Aucune donnée</p>
            )}
          </div>
        </ChartCard>

        {/* Top utilisateurs */}
        <ChartCard title="Utilisateurs les plus actifs">
          <div className="space-y-2">
            {(stats?.topUsers || []).map((u, i) => (
              <div key={u.userId} className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: COLORS[i % COLORS.length] + '20', color: COLORS[i % COLORS.length] }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-on-surface font-medium truncate">{u.name}</p>
                  <p className="text-[10px] text-on-surface-variant">{u.role}</p>
                </div>
                <span className="text-[11px] text-on-surface-variant font-bold">{u.count}</span>
              </div>
            ))}
            {(!stats?.topUsers || stats.topUsers.length === 0) && (
              <p className="text-[12px] text-on-surface-variant text-center py-4">Aucune donnée</p>
            )}
          </div>
        </ChartCard>

        {/* Ratings */}
        <ChartCard title="Évaluations des réponses">
          <div className="flex items-center justify-center gap-8 py-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-2">
                <ThumbsUp className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold text-on-surface">{stats?.ratings?.positive || 0}</p>
              <p className="text-[10px] text-on-surface-variant">Utiles</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-2">
                <ThumbsDown className="w-8 h-8 text-red-500" />
              </div>
              <p className="text-2xl font-bold text-on-surface">{stats?.ratings?.negative || 0}</p>
              <p className="text-[10px] text-on-surface-variant">Pas utiles</p>
            </div>
          </div>
          {stats?.ratings?.positive || stats?.ratings?.negative ? (
            <p className="text-center text-[11px] text-on-surface-variant">
              Taux de satisfaction : {Math.round(((stats?.ratings?.positive || 0) / ((stats?.ratings?.positive || 0) + (stats?.ratings?.negative || 1))) * 100)}%
            </p>
          ) : null}
        </ChartCard>
      </div>

      {/* Alertes sécurité — Prompt injection */}
      {stats?.flaggedRecent?.length > 0 && (
        <ChartCard title="Alertes sécurité — Prompt injection détecté" className="mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-outline-variant/30">
                  <th className="text-left py-2 px-2 font-semibold text-on-surface-variant">Utilisateur</th>
                  <th className="text-left py-2 px-2 font-semibold text-on-surface-variant">Message</th>
                  <th className="text-left py-2 px-2 font-semibold text-on-surface-variant">Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.flaggedRecent.map((m) => (
                  <tr key={m.id} className="border-b border-outline-variant/20 hover:bg-red-500/5">
                    <td className="py-2 px-2">
                      <p className="font-medium text-on-surface">{m.userName}</p>
                      <p className="text-[10px] text-on-surface-variant">{m.userEmail}</p>
                    </td>
                    <td className="py-2 px-2 max-w-xs truncate text-on-surface-variant">{m.content}</td>
                    <td className="py-2 px-2 text-on-surface-variant whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleDateString('fr-FR')} {new Date(m.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}

      {/* Résumé quotas */}
      <ChartCard title="Paramètres de protection" className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 rounded-xl bg-surface-container">
            <p className="text-lg font-bold text-primary">30</p>
            <p className="text-[10px] text-on-surface-variant">Messages / 15min</p>
          </div>
          <div className="text-center p-3 rounded-xl bg-surface-container">
            <p className="text-lg font-bold text-primary">100</p>
            <p className="text-[10px] text-on-surface-variant">Messages / jour</p>
          </div>
          <div className="text-center p-3 rounded-xl bg-surface-container">
            <p className="text-lg font-bold text-primary">2000</p>
            <p className="text-[10px] text-on-surface-variant">Caractères / message</p>
          </div>
          <div className="text-center p-3 rounded-xl bg-surface-container">
            <p className="text-lg font-bold text-primary">500</p>
            <p className="text-[10px] text-on-surface-variant">Requêtes / 15min (global)</p>
          </div>
        </div>
      </ChartCard>
    </PageShell>
  );
}
