import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Ticket,
  CheckCircle2,
  BarChart3,
  ArrowRight,
  Plus,
  RefreshCw,
  MessageSquarePlus,
  AlertTriangle,
} from 'lucide-react';
import { STATUS_LABELS } from '../constants/tickets';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts';

// Badges sombres adaptés au fond noir du mode vocal
const DARK_STATUS = {
  NEW: 'bg-blue-500/20 text-blue-300 border-blue-400/30',
  OPEN: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30',
  PLANNED: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
  PENDING: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
  WAITING_FOR_USER: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30',
  SOLVED: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  CLOSED: 'bg-slate-500/20 text-slate-300 border-slate-400/30',
};

const PRIORITY_DOT = {
  P1: 'bg-red-500',
  P2: 'bg-orange-400',
  P3: 'bg-amber-400',
  P4: 'bg-blue-400',
};

function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${
        DARK_STATUS[status] || 'bg-white/10 text-white/70 border-white/20'
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  if (!priority) return null;
  return (
    <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-white/80">
      <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[priority] || 'bg-white/40'}`} />
      {priority}
    </span>
  );
}

// Compteur animé façon count-up (désactivé si prefers-reduced-motion)
function useCountUp(target, animate) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!animate || typeof target !== 'number') return undefined;
    let raf;
    const t0 = performance.now();
    const dur = 700;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  // Sans animation : valeur directe au render (pas de setState dans l'effect)
  return animate && typeof target === 'number' ? value : target;
}

function Metric({ label, value, accent }) {
  const reduceMotion = useReducedMotion();
  const shown = useCountUp(value, !reduceMotion);
  if (typeof value !== 'number') return null;
  return (
    <div className="flex-1 min-w-0 text-center">
      <div className={`text-xl font-semibold leading-tight ${accent || 'text-white/90'}`}>{shown}</div>
      <div className="text-[10px] uppercase tracking-wider text-white/55 truncate">{label}</div>
    </div>
  );
}

// Mini bar chart (recharts) : ventilation par statut ou priorité
function MiniBars({ items, dataKey, labelKey }) {
  if (!items?.length) return null;
  return (
    <MiniBarsInner items={items} dataKey={dataKey} labelKey={labelKey} />
  );
}

const BAR_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#38bdf8', '#f472b6', '#94a3b8'];

function MiniBarsInner({ items, dataKey, labelKey }) {
  const data = items.map((i) => ({ name: i[labelKey], value: i[dataKey] }));
  return (
    <div className="mt-2 h-[86px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: 'rgba(255,255,255,0.65)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            height={26}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={34}>
            {data.map((_, i) => (
              <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function VoiceToolCard({ result, onNavigate }) {
  const navigate = useNavigate();
  const { name, data } = result || {};
  if (!data) return null;

  const go = (path) => {
    if (onNavigate) onNavigate();
    navigate(path);
  };

  const header = (Icon, title) => (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5">
      <Icon className="w-3.5 h-3.5 text-blue-300 shrink-0" />
      <span className="text-[10px] uppercase tracking-[0.2em] text-white/65">{title}</span>
    </div>
  );

  let body = null;

  if (data.kind === 'tickets') {
    body = (
      <>
        {header(Ticket, `${data.tickets.length} ticket${data.tickets.length > 1 ? 's' : ''}${
          typeof data.total === 'number' && data.total > data.tickets.length ? ` sur ${data.total}` : ''
        }`)}
        <div className="max-h-[168px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
          {data.tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(`/tickets/${t.id}`)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60 transition-colors border-b border-white/5 last:border-0"
            >
              <span className="text-[10px] text-white/45 shrink-0">#{t.id}</span>
              <span className="flex-1 min-w-0 text-xs text-white/90 truncate">{t.titre}</span>
              <PriorityBadge priority={t.priorite} />
              <StatusBadge status={t.statut} />
              <ArrowRight className="w-3 h-3 text-white/35 shrink-0" />
            </button>
          ))}
        </div>
      </>
    );
  } else if (data.kind === 'ticket') {
    const t = data.ticket;
    body = (
      <>
        {header(Ticket, `Ticket #${t.id}`)}
        <div className="p-3">
          <div className="flex items-start gap-2 mb-1.5">
            <PriorityBadge priority={t.priorite} />
            <StatusBadge status={t.statut} />
          </div>
          <p className="text-sm text-white/95 leading-snug mb-1">{t.titre}</p>
          {t.description && (
            <p className="text-xs text-white/55 leading-relaxed line-clamp-2 mb-2">{t.description}</p>
          )}
          <div className="flex items-center gap-3 text-[11px] text-white/55">
            {t.categorie && <span>{t.categorie}</span>}
            {t.lieu && <span className="truncate">{t.lieu}</span>}
            {t.technicien && <span className="truncate">Technicien : {t.technicien}</span>}
          </div>
          <button
            type="button"
            onClick={() => go(`/tickets/${t.id}`)}
            className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-400/40 text-xs text-blue-200 hover:bg-blue-500/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60 transition-colors"
          >
            Ouvrir le ticket <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </>
    );
  } else if (data.kind === 'action') {
    const ActionIcon =
      data.action === 'created'
        ? Plus
        : data.action === 'status_changed'
          ? RefreshCw
          : MessageSquarePlus;
    body = (
      <>
        {header(CheckCircle2, 'Action confirmée')}
        <div className="p-3 flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center shrink-0">
            <ActionIcon className="w-4 h-4 text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/90 leading-snug">{data.message}</p>
            {data.ticket && (
              <button
                type="button"
                onClick={() => go(`/tickets/${data.ticket.id}`)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60 rounded px-1 py-0.5"
              >
                Voir #{data.ticket.id} <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </>
    );
  } else if (data.kind === 'stats') {
    const chartItems =
      data.byPriority?.length
        ? { items: data.byPriority, dataKey: 'nombre', labelKey: 'priorite' }
        : data.byStatus?.length
          ? { items: data.byStatus, dataKey: 'nombre', labelKey: 'statut' }
          : null;
    body = (
      <>
        {header(BarChart3, name === 'generate_report' ? 'Rapport' : 'Statistiques')}
        <div className="p-3">
          <div className="flex gap-2">
            <Metric label="Total" value={data.stats?.total} />
            <Metric label="Ouverts" value={data.stats?.ouverts} accent="text-blue-300" />
            <Metric label="Résolus" value={data.stats?.resolus} accent="text-emerald-300" />
            <Metric label="Fermés" value={data.stats?.fermes} accent="text-white/70" />
          </div>
          {chartItems && <MiniBars {...chartItems} />}
          {data.periode && (
            <p className="text-[10px] text-white/45 text-center mt-1.5">
              {typeof data.periode === 'string'
                ? data.periode
                : data.periode.depuis
                  ? `Depuis le ${new Date(data.periode.depuis).toLocaleDateString('fr-FR')}`
                  : JSON.stringify(data.periode)}
            </p>
          )}
        </div>
      </>
    );
  } else if (data.kind === 'confirmation') {
    // Carte « action en attente » : confirmation d'envoi visible en mode vocal.
    // L'utilisateur confirme oralement (« oui » / « non ») — aucun bouton ici.
    body = (
      <>
        {header(AlertTriangle, 'Action en attente de confirmation')}
        <div className="p-3">
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-400/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200">
                {data.tool === 'send_ticket_report' ? 'Rapport par email'
                  : data.tool === 'add_ticket_followup' ? 'Ajout de commentaire'
                  : 'Confirmation requise'}
              </span>
            </div>
            <p className="px-3 py-2 text-[12.5px] leading-relaxed text-white/90 whitespace-pre-line line-clamp-5">
              {data.prompt}
            </p>
          </div>
          <p className="mt-2 text-[11px] text-white/60 text-center">
            Réponds par la voix : <span className="text-amber-200 font-semibold">« oui »</span> pour envoyer,{' '}
            <span className="text-white/80 font-semibold">« non »</span> pour annuler. Rien n'est encore exécuté.
          </p>
        </div>
      </>
    );
  } else {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="w-full max-w-2xl mx-4 mb-4 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm overflow-hidden shadow-lg shadow-black/40"
      aria-live="polite"
    >
      {body}
    </motion.div>
  );
}
