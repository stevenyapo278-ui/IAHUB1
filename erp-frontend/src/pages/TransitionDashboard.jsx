import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

/* ── Helper : décoder les entités HTML (sécurité frontend) ──────────── */
function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

/* ── Phases de la transition ──────────────────────────────────────────── */
const TRANSITION_PHASES = [
  { id: 'AUDIT', label: 'Audit', icon: 'visibility', color: '#f59e0b', targetDays: 7, description: 'Analyse lecture seule' },
  { id: 'SIMULATION', label: 'Simulation', icon: 'science', color: '#3b82f6', targetDays: 7, description: 'Tests en DEV' },
  { id: 'HYBRID', label: 'Hybride', icon: 'account_tree', color: '#8b5cf6', targetDays: 7, description: 'Shadow deployment' },
  { id: 'PRODUCTION', label: 'Production', icon: 'rocket_launch', color: '#16a34a', targetDays: 0, description: 'Go Live' },
];

function getPhaseStatus(currentModeId, phaseId) {
  const idx = TRANSITION_PHASES.findIndex(p => p.id === phaseId);
  const curIdx = TRANSITION_PHASES.findIndex(p => p.id === currentModeId);
  if (idx < curIdx) return 'done';
  if (idx === curIdx) return 'current';
  return 'pending';
}

/* ── Constantes des modes ─────────────────────────────────────────────── */
const MODES = [
  {
    id: 'AUDIT',
    label: 'Audit',
    icon: 'visibility',
    color: '#f59e0b',
    bgLight: 'rgba(245,158,11,0.08)',
    borderLight: 'rgba(245,158,11,0.2)',
    description: 'Analyse des emails en lecture seule. Aucune écriture dans GLPI.',
    config: { dryRunMode: true, activeGlpiInstance: 'glpi', enableGlpiTicketCreation: true },
  },
  {
    id: 'SIMULATION',
    label: 'Simulation',
    icon: 'science',
    color: '#3b82f6',
    bgLight: 'rgba(59,130,246,0.08)',
    borderLight: 'rgba(59,130,246,0.2)',
    description: 'Tests en conditions réelles dans GLPI DEV. Aucun impact sur la production.',
    config: { dryRunMode: false, activeGlpiInstance: 'glpi_dev', enableGlpiTicketCreation: true },
  },
  {
    id: 'HYBRID',
    label: 'Hybride',
    icon: 'account_tree',
    color: '#8b5cf6',
    bgLight: 'rgba(139,92,246,0.08)',
    borderLight: 'rgba(139,92,246,0.2)',
    description: 'Surveillance de la production + écriture dans GLPI DEV. Shadow deployment.',
    config: { dryRunMode: true, activeGlpiInstance: 'glpi_dev', enableGlpiTicketCreation: false },
  },
  {
    id: 'PRODUCTION',
    label: 'Production',
    icon: 'rocket_launch',
    color: '#16a34a',
    bgLight: 'rgba(22,163,74,0.08)',
    borderLight: 'rgba(22,163,74,0.2)',
    description: 'La plateforme écrit directement dans GLPI production.',
    config: { dryRunMode: false, activeGlpiInstance: 'glpi', enableGlpiTicketCreation: true },
  },
];

const EVENT_LABELS = {
  CREATED: 'Ticket créé',
  REOPENED: 'Ticket rouvert',
  EMAIL_RECEIVED: 'Email reçu',
  EMAIL_SENT: 'Email envoyé',
  AI_ANALYZED: 'Analyse IA',
  AI_DRAFT_GENERATED: 'Brouillon IA généré',
  AI_FOLLOWUP_DRAFT_GENERATED: 'Réponse IA générée',
  AI_CONVERSATION_ESCALATED: 'Escalade humaine',
  FOLLOWUP_ADDED: 'Suivi ajouté',
  GLPI_SYNC_FAILED: 'Échec synchro GLPI',
  NEEDS_HUMAN_REVIEW: 'Revue humaine requise',
  REMINDER_SENT: 'Relance envoyée',
  CLOSED_AUTO: 'Fermeture automatique',
};

const EVENT_ICONS = {
  CREATED: 'add_circle',
  REOPENED: 'undo',
  EMAIL_RECEIVED: 'mail',
  AI_ANALYZED: 'smart_toy',
  AI_DRAFT_GENERATED: 'drafts',
  AI_CONVERSATION_ESCALATED: 'warning',
  GLPI_SYNC_FAILED: 'error',
  NEEDS_HUMAN_REVIEW: 'rate_review',
  FOLLOWUP_ADDED: 'comment',
  REMINDER_SENT: 'notifications',
  CLOSED_AUTO: 'check_circle',
};

/* ── Helpers ──────────────────────────────────────────────────────────── */
function formatRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'À l\'instant';
  if (mins < 60) return `Il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/* ── Composants ─────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, disabled, size = 'md' }) {
  const w = size === 'lg' ? 'w-16' : 'w-12';
  const h = size === 'lg' ? 'h-8' : 'h-6';
  const ballW = size === 'lg' ? 'w-6' : 'w-[18px]';
  const ballH = size === 'lg' ? 'h-6' : 'h-[18px]';
  const ballX = size === 'lg' ? 28 : 24;

  return (
    <motion.button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      whileTap={{ scale: 0.92 }}
      className={`${w} ${h} rounded-full border transition-all duration-300 outline-none shrink-0 ${
        checked
          ? 'bg-primary border-primary/60 shadow-sm shadow-primary/20'
          : 'bg-surface-container-high border-outline-variant/60'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <motion.span
        animate={{ x: checked ? ballX : 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className={`${ballW} ${ballH} rounded-full shadow-sm block ${
          checked ? 'bg-white' : 'bg-on-surface-variant/80'
        }`}
      />
    </motion.button>
  );
}

function StatCard({ label, value, icon, color, subtitle }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bento-card p-4 flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined text-sm"
          style={{ color: color || 'var(--color-on-surface-variant)' }}
        >
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-on-surface-variant)' }}>
          {label}
        </span>
      </div>
      <span className="text-[26px] font-bold leading-tight" style={{ color: 'var(--color-on-surface)' }}>
        {value}
      </span>
      {subtitle && (
        <span className="text-[11px]" style={{ color: 'var(--color-on-surface-variant)' }}>{subtitle}</span>
      )}
    </motion.div>
  );
}

/* ── Mode Card ─────────────────────────────────────────────────────────── */
function ModeCard({ mode, isActive, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      className={`bento-card p-4 flex flex-col gap-2 text-left cursor-pointer transition-all duration-300 relative overflow-hidden ${
        isActive ? 'ring-2 shadow-lg' : 'opacity-60 hover:opacity-90'
      }`}
      style={{
        borderColor: isActive ? mode.borderLight : 'var(--color-outline-variant)',
        boxShadow: isActive ? `0 0 20px ${mode.color}15` : undefined,
      }}
    >
      {isActive && (
        <motion.div
          layoutId="mode-indicator"
          className="absolute top-0 left-0 w-full h-[3px]"
          style={{ backgroundColor: mode.color }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />
      )}
      <div className="flex items-center gap-2">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: mode.bgLight }}
        >
          <span className="material-symbols-outlined text-lg" style={{ color: mode.color }}>
            {mode.icon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold block" style={{ color: 'var(--color-on-surface)' }}>
            {mode.label}
          </span>
          {isActive && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: `${mode.color}20`, color: mode.color }}
            >
              Actif
            </motion.span>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-on-surface-variant)' }}>
        {mode.description}
      </p>
    </motion.button>
  );
}

/* ── Progression de la transition ────────────────────────────────────── */
function TransitionProgressTracker({ currentModeId, goLiveDate }) {
  const daysSinceGoLive = goLiveDate
    ? Math.floor((Date.now() - new Date(goLiveDate).getTime()) / 86400000)
    : null;
  const curIdx = Math.max(0, TRANSITION_PHASES.findIndex(p => p.id === currentModeId));
  const progress = Math.round((curIdx / (TRANSITION_PHASES.length - 1)) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="bento-card p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: 'var(--color-on-surface)' }}>
          <span className="material-symbols-outlined text-sm" style={{ color: '#8b5cf6' }}>flag</span>
          Progression de la transition
        </h3>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>
          <span className="font-semibold" style={{ color: '#8b5cf6' }}>{progress}%</span>
          {daysSinceGoLive !== null && (
            <span>· {daysSinceGoLive >= 0 ? `J+${daysSinceGoLive}` : `J${daysSinceGoLive}`}</span>
          )}
        </div>
      </div>

      {/* Barre de progression */}
      <div className="h-2 rounded-full mb-3 overflow-hidden" style={{ backgroundColor: 'var(--color-outline-variant)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, #f59e0b 0%, #3b82f6 33%, #8b5cf6 66%, #16a34a 100%)',
          }}
        />
      </div>

      {/* Timeline des phases */}
      <div className="flex items-start justify-between">
        {TRANSITION_PHASES.map((phase, i) => {
          const status = getPhaseStatus(currentModeId, phase.id);
          const isLast = i === TRANSITION_PHASES.length - 1;

          return (
            <div key={phase.id} className="flex-1 relative">
              {/* Ligne de connexion entre les phases */}
              {!isLast && (
                <div
                  className="absolute top-3 left-[calc(50%+12px)] right-[calc(50%-12px)] h-px"
                  style={{
                    backgroundColor: status === 'pending' ? 'var(--color-outline-variant)' : phase.color,
                  }}
                />
              )}

              <div className="flex flex-col items-center gap-1.5">
                {/* Cercle */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] transition-all duration-500"
                  style={{
                    backgroundColor: status === 'done' ? `${phase.color}20` : status === 'current' ? `${phase.color}20` : 'var(--color-surface-container-high)',
                    border: `2px solid ${status === 'pending' ? 'var(--color-outline-variant)' : phase.color}`,
                    color: status === 'pending' ? 'var(--color-on-surface-variant)' : phase.color,
                  }}
                >
                  {status === 'done' ? (
                    <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                  ) : (
                    <span className="material-symbols-outlined text-[12px]">{phase.icon}</span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={`text-[9px] font-semibold text-center leading-tight ${
                    status === 'pending' ? 'opacity-40' : ''
                  }`}
                  style={{ color: status === 'current' ? phase.color : 'var(--color-on-surface-variant)' }}
                >
                  {phase.label}
                </span>

                {/* Mini description */}
                <span className="text-[8px] text-center leading-none" style={{ color: 'var(--color-on-surface-variant)' }}>
                  {phase.targetDays > 0 ? `~${phase.targetDays}j` : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Prochaine étape */}
      {curIdx >= 0 && curIdx < TRANSITION_PHASES.length - 1 && (
        <div className="mt-3 pt-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--color-outline-variant)' }}>
          <span className="material-symbols-outlined text-[14px]" style={{ color: '#8b5cf6' }}>trending_flat</span>
          <span className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>
            Prochaine étape : <strong style={{ color: TRANSITION_PHASES[curIdx + 1].color }}>{TRANSITION_PHASES[curIdx + 1].label}</strong> — {TRANSITION_PHASES[curIdx + 1].description}
          </span>
        </div>
      )}
    </motion.div>
  );
}

/* ── Qualité des décisions ───────────────────────────────────────────── */
function DecisionQualityCard({ stats }) {
  const rawTotal = stats.emailsProcessed || 0;
  const newTickets = stats.emailsNewTicket || 0;
  const followups = stats.emailsFollowup || 0;
  const spam = stats.emailsSpam || 0;
  const errors = stats.emailsError || 0;
  const hasData = rawTotal > 0;
  const total = hasData ? rawTotal : 1;
  const success = total - errors;
  const accuracy = hasData ? Math.round((success / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bento-card p-4"
    >
      <h3 className="text-[12px] font-bold flex items-center gap-1.5 mb-3" style={{ color: 'var(--color-on-surface)' }}>
        <span className="material-symbols-outlined text-sm" style={{ color: '#16a34a' }}>speed</span>
        Traitement des emails
      </h3>

      {/* Anneau de répartition */}
      <div className="flex items-center gap-4 mb-3">
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="var(--color-outline-variant)" strokeWidth="5" />
            {hasData && (
              <motion.circle
                cx="32" cy="32" r="28" fill="none"
                stroke={accuracy >= 90 ? '#16a34a' : accuracy >= 75 ? '#f59e0b' : '#ef4444'}
                strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 28}`}
                initial={{ strokeDashoffset: 2 * Math.PI * 28 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 28 * (1 - accuracy / 100) }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {hasData ? (
              <span className="text-sm font-bold" style={{ color: accuracy >= 90 ? '#16a34a' : accuracy >= 75 ? '#f59e0b' : '#ef4444' }}>
                {accuracy}%
              </span>
            ) : (
              <span className="text-[9px] font-semibold" style={{ color: 'var(--color-on-surface-variant)' }}>N/A</span>
            )}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#16a34a' }} />
            <span style={{ color: 'var(--color-on-surface-variant)' }}>Nouveaux tickets: <strong style={{ color: 'var(--color-on-surface)' }}>{newTickets}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
            <span style={{ color: 'var(--color-on-surface-variant)' }}>Suivis: <strong style={{ color: 'var(--color-on-surface)' }}>{followups}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
            <span style={{ color: 'var(--color-on-surface-variant)' }}>Spams filtrés: <strong style={{ color: 'var(--color-on-surface)' }}>{spam}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <span style={{ color: 'var(--color-on-surface-variant)' }}>Erreurs: <strong style={{ color: errors > 0 ? '#ef4444' : 'var(--color-on-surface)' }}>{errors}</strong></span>
          </div>
        </div>
      </div>

      {/* Mini barre de répartition */}
      <div className="h-2 rounded-full overflow-hidden flex">
        {[
          { value: newTickets, color: '#16a34a' },
          { value: followups, color: '#3b82f6' },
          { value: spam, color: '#f59e0b' },
          { value: errors, color: '#ef4444' },
        ].map((item, i) => {
          const pct = Math.round((item.value / total) * 100);
          return pct > 0 ? (
            <motion.div
              key={i}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ backgroundColor: item.color, width: `${pct}%` }}
            />
          ) : null;
        })}
      </div>
      {hasData && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-on-surface-variant)' }}>
          {errors === 0
            ? 'Aucune erreur technique detectee'
            : `${errors} erreur${errors > 1 ? 's' : ''} technique${errors > 1 ? 's' : ''} sur ${total} email${total > 1 ? 's' : ''}`
          }
        </p>
      )}
    </motion.div>
  );
}

/* ── Actions recommandées ─────────────────────────────────────────────── */
function TransitionActions({ currentModeId, onRunAnalysis, analyzing }) {
  const curIdx = TRANSITION_PHASES.findIndex(p => p.id === currentModeId);

  const recommendations = {
    AUDIT: [
      { icon: 'visibility', text: 'Observez les décisions de la plateforme sans risque', done: false },
      { icon: 'compare', text: 'Comparez avec le travail réel des techniciens', done: false },
      { icon: 'psychology', text: 'Lancez une analyse IA pour valider la qualité des données', done: true, action: 'Lancer', onClick: onRunAnalysis },
      { icon: 'checklist', text: 'Validez le mapping des conversations', done: false },
    ],
    SIMULATION: [
      { icon: 'science', text: 'Testez toute la chaîne de création dans GLPI DEV', done: false },
      { icon: 'bug_report', text: 'Corrigez les anomalies détectées', done: false },
      { icon: 'compare_arrows', text: 'Comparez PROD vs DEV via l\'analyse IA', done: true, action: 'Analyser', onClick: onRunAnalysis },
      { icon: 'check_circle', text: 'Validez les règles métier et le mapping', done: false },
    ],
    HYBRID: [
      { icon: 'account_tree', text: 'Mode shadow actif : la plateforme observe mais écrit en DEV', done: false },
      { icon: 'compare_arrows', text: 'Comparez ticket par ticket les décisions PROD vs DEV', done: true, action: 'Analyser', onClick: onRunAnalysis },
      { icon: 'speed', text: 'Mesurez le taux de précision', done: false },
      { icon: 'rocket_launch', text: 'Préparez le passage en production', done: false },
    ],
    PRODUCTION: [
      { icon: 'rocket_launch', text: 'La plateforme écrit en production', done: true },
      { icon: 'monitoring', text: 'Surveillez les métriques en temps réel', done: false },
      { icon: 'psychology', text: 'Analysez la qualité des données créées', done: true, action: 'Analyser', onClick: onRunAnalysis },
      { icon: 'sync', text: 'Assurez-vous que la synchro GLPI est active', done: false },
    ],
  };

  const items = recommendations[currentModeId] || recommendations.AUDIT;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="bento-card p-4"
    >
      <h3 className="text-[12px] font-bold flex items-center gap-1.5 mb-3" style={{ color: 'var(--color-on-surface)' }}>
        <span className="material-symbols-outlined text-sm" style={{ color: '#8b5cf6' }}>checklist</span>
        Actions recommandées
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{
          backgroundColor: 'rgba(139,92,246,0.1)',
          color: '#8b5cf6',
        }}>
          {items.filter(i => i.done).length}/{items.length}
        </span>
      </h3>

      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors"
            style={{
              backgroundColor: item.done ? 'rgba(22,163,74,0.04)' : 'transparent',
              opacity: curIdx === 3 && currentModeId === 'PRODUCTION' && item.done ? 0.5 : 1,
            }}
          >
            <span
              className={`material-symbols-outlined text-sm ${item.done ? '' : ''}`}
              style={{ color: item.done ? '#16a34a' : 'var(--color-on-surface-variant)' }}
            >
              {item.done ? 'check_circle' : item.icon}
            </span>
            <span className="text-[10px] flex-1" style={{ color: 'var(--color-on-surface-variant)' }}>
              {item.text}
            </span>
            {item.action && (
              <button
                onClick={item.onClick}
                disabled={analyzing}
                className="text-[9px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap transition-all"
                style={{
                  backgroundColor: 'rgba(139,92,246,0.1)',
                  color: '#8b5cf6',
                }}
              >
                {analyzing ? '...' : item.action}
              </button>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ── Composant : Liste des attributs de tickets ──────────────────────── */
const TICKET_ATTRS = [
  { key: 'id', label: 'ID', icon: 'tag', width: 'w-12' },
  { key: 'name', label: 'Titre', icon: 'badge', width: 'min-w-[120px] flex-1', truncate: true },
  { key: 'status', label: 'Statut', icon: 'task_alt', width: 'w-20' },
  { key: 'priority', label: 'Priorité', icon: 'signal_cellular_alt', width: 'w-16' },
  { key: 'category', label: 'Catégorie', icon: 'category', width: 'min-w-[140px] flex-1' },
  { key: 'location', label: 'Lieu', icon: 'pin_drop', width: 'min-w-[160px] flex-1' },
  { key: 'type', label: 'Type', icon: 'sell', width: 'w-20' },
  { key: 'requester', label: 'Demandeur', icon: 'person_pin', width: 'w-28' },
  { key: 'assignedTo', label: 'Assigné à', icon: 'person', width: 'w-28' },
  { key: 'observer', label: 'Observateur', icon: 'visibility', width: 'w-28' },
  { key: 'followupCount', label: 'Suivis', icon: 'comment', width: 'w-14' },
  { key: 'date', label: 'Date', icon: 'calendar_month', width: 'w-28' },
];

// GLPI codes : 1=Nouveau, 2=Ouvert, 3=En cours, 4=En attente, 5=Résolu, 6=Fermé
const STATUS_LABELS = { 1: 'Nouveau', 2: 'Ouvert', 3: 'En cours', 4: 'En attente', 5: 'Résolu', 6: 'Fermé' };
const PRIORITY_LABELS = { 1: 'Faible', 2: 'Moyen', 3: 'Haut', 4: 'Urgent', 5: 'Critique' };
const TYPE_LABELS = { 1: 'Incident', 2: 'Demande', 3: 'Projet' };

function TicketAttributesPanel({ tickets, label, color, error }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-outline-variant)' }}>
      {/* Entête */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-surface-container-low/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
            <span className="material-symbols-outlined text-sm" style={{ color }}>dns</span>
          </div>
          <span className="text-[13px] font-bold" style={{ color: 'var(--color-on-surface)' }}>{label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{
            backgroundColor: `${color}10`,
            color,
          }}>
            {tickets.length} tickets · {TICKET_ATTRS.length} attributs
          </span>
          {error && (
            <span className="text-[10px] text-red-500 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">error</span>
              {error}
            </span>
          )}
        </div>
        <span className={`material-symbols-outlined text-sm transition-transform ${expanded ? 'rotate-180' : ''}`}
          style={{ color: 'var(--color-on-surface-variant)' }}>expand_more</span>
      </button>

      {/* Légende des attributs */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Badges des champs */}
          <div className="flex flex-wrap gap-1.5 pb-2 border-b" style={{ borderColor: 'var(--color-outline-variant)' }}>
            {TICKET_ATTRS.map(attr => (
              <span
                key={attr.key}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
                style={{ backgroundColor: `${color}08`, color: 'var(--color-on-surface-variant)' }}
              >
                <span className="material-symbols-outlined text-[10px]" style={{ color }}>{attr.icon}</span>
                {attr.label}
              </span>
            ))}
          </div>

          {/* Tableau des tickets */}
          {tickets.length === 0 ? (
            <p className="text-[11px] py-4 text-center" style={{ color: 'var(--color-on-surface-variant)' }}>
              {error || 'Aucun ticket récupéré'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-outline-variant)' }}>
                    {TICKET_ATTRS.map(attr => (
                      <th key={attr.key} className={`${attr.width} py-1.5 px-1 font-semibold uppercase tracking-wider`}
                        style={{ color: 'var(--color-on-surface-variant)' }}>
                        {attr.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t, i) => (
                    <tr key={t.id || i} className="border-b hover:bg-surface-container-low/30 transition-colors"
                      style={{ borderColor: 'var(--color-outline-variant)' }}>
                      {TICKET_ATTRS.map(attr => {
                        const val = t[attr.key];
                        let display = val != null ? String(val) : '-';
                        let badgeColor = null;

                        // Formater selon le champ
                        if (attr.key === 'status') {
                          display = STATUS_LABELS[val] || val || '-';
                          badgeColor = val >= 5 ? '#16a34a' : val >= 2 ? '#f59e0b' : '#3b82f6';
                        } else if (attr.key === 'priority') {
                          display = PRIORITY_LABELS[val] || val || '-';
                          badgeColor = val >= 4 ? '#ef4444' : val >= 3 ? '#f59e0b' : '#3b82f6';
                        } else if (attr.key === 'type') {
                          display = TYPE_LABELS[val] || val || '-';
                        } else if (attr.key === 'date') {
                          display = val ? formatDate(val) : '-';
                        } else if (attr.key === 'category') {
                          // Hiérarchie affichée dans le <td> via categoryHierarchy si multi-niveaux
                          // Sécurité : décoder les entités HTML résiduelles
                          display = decodeHtmlEntities(val) || '-';
                        } else if (attr.key === 'location') {
                          // Hiérarchie affichée dans le <td> via locationHierarchy si multi-niveaux
                          // Sécurité : décoder les entités HTML résiduelles
                          display = decodeHtmlEntities(val) || '-';
                        } else if (attr.key === 'requester') {
                          display = val || 'Non renseigné';
                        } else if (attr.key === 'assignedTo') {
                          display = val || 'Non assigné';
                        } else if (attr.key === 'observer') {
                          display = val || 'Aucun';
                        } else if (attr.key === 'followupCount') {
                          display = val != null ? String(val) : '0';
                        } else if (attr.key === 'name') {
                          display = val || '(Sans titre)';
                        }

                        return (
                          <td key={attr.key} className={`${attr.width} py-2 px-1`} style={{ color: 'var(--color-on-surface)' }}>
                            {attr.key === 'category' && t.categoryHierarchy?.length > 1 ? (
                              <div className="flex flex-wrap gap-1 items-center">
                                {t.categoryHierarchy.map((level, li) => (
                                  <span key={li} className="inline-flex items-center">
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                                      style={{
                                        backgroundColor: li === t.categoryHierarchy.length - 1
                                          ? 'rgba(59,130,246,0.12)'
                                          : 'var(--color-surface-container-high)',
                                        color: li === t.categoryHierarchy.length - 1
                                          ? '#3b82f6'
                                          : 'var(--color-on-surface-variant)',
                                      }}
                                    >
                                      {level}
                                    </span>
                                    {li < t.categoryHierarchy.length - 1 && (
                                      <span className="text-[8px] px-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                                        <span className="material-symbols-outlined text-[10px]">chevron_right</span>
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            ) : attr.key === 'location' && t.locationHierarchy?.length > 1 ? (
                              <div className="flex flex-wrap gap-1 items-center">
                                {t.locationHierarchy.map((level, li) => (
                                  <span key={li} className="inline-flex items-center">
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                                      style={{
                                        backgroundColor: li === t.locationHierarchy.length - 1
                                          ? 'rgba(139,92,246,0.12)'
                                          : 'var(--color-surface-container-high)',
                                        color: li === t.locationHierarchy.length - 1
                                          ? '#8b5cf6'
                                          : 'var(--color-on-surface-variant)',
                                      }}
                                    >
                                      {level}
                                    </span>
                                    {li < t.locationHierarchy.length - 1 && (
                                      <span className="text-[8px] px-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                                        <span className="material-symbols-outlined text-[10px]">chevron_right</span>
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            ) : badgeColor ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold"
                                style={{ backgroundColor: `${badgeColor}12`, color: badgeColor }}>
                                {display}
                              </span>
                            ) : attr.truncate ? (
                              <span className="block truncate max-w-[150px]" title={display}>{display}</span>
                            ) : (
                              <span>{display}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Chat sur l'analyse IA ──────────────────────────────── */
const SUGGESTED_QUESTIONS = [
  'Quels sont les principaux problèmes détectés ?',
  'Que dois-je corriger en priorité ?',
  'Résume les écarts entre PROD et DEV',
  'Donne moi un plan d\'action par ordre de priorité',
  'Y a-t-il des anomalies dans les assignations ?',
  'Explique la note de qualité des noms',
  'Quels fichiers dois-je modifier en priorité ?',
  'Compare les statistiques PROD et DEV',
];

function TransitionAnalysisChat({ analysis }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Posez-moi des questions sur l analyse ci-dessus : les ecarts PROD/DEV, les notes, les recommandations de code, ou tout autre point.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const messagesEndRef = useRef(null);

  // Construire le contexte de l analyse pour l envoyer au backend
  const analysisContext = useMemo(() => {
    if (!analysis?.analysis) return null;
    const a = analysis.analysis;
    return {
      synthese: a.synthese,
      notes: {
        qualiteNoms: a.qualiteNoms,
        assignations: a.assignations,
        categoriesPriorites: a.categoriesPriorites,
        ecartsProdDev: a.ecartsProdDev,
      },
      ameliorationsCode: a.ameliorationsCode,
      stats: {
        prodCount: analysis.prodTickets?.length || 0,
        devCount: analysis.devTickets?.length || 0,
        erpTotal: analysis.erp?.total || 0,
      },
    };
  }, [analysis]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text) {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    const userMsg = { role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const history = [...messages, userMsg].slice(-10).map(m => ({ role: m.role, content: m.content }));
      const { data } = await api.post('/transition/chat', {
        message: msg,
        history,
        analysisContext,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Desole, erreur de communication avec l IA. Reesayez.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function copyMessage(content, index) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {}
  }

  function clearChat() {
    setMessages([
      { role: 'assistant', content: 'Posez-moi des questions sur l analyse ci-dessus : les ecarts PROD/DEV, les notes, les recommandations de code, ou tout autre point.' },
    ]);
  }

  const showSuggestions = messages.length <= 1;

  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--color-outline-variant)' }}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: 'var(--color-on-surface)' }}>
          <span className="material-symbols-outlined text-sm" style={{ color: '#8b5cf6' }}>chat</span>
          Discuter de l'analyse
        </h4>
        {messages.length > 1 && (
          <button onClick={clearChat}
            className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-surface-container-low transition-colors"
            style={{ color: 'var(--color-on-surface-variant)' }}>
            <span className="material-symbols-outlined text-[12px]">delete</span>
            Effacer
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="max-h-[350px] overflow-y-auto space-y-2 mb-3 pr-1">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="group relative max-w-[85%]">
              <div
                className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-white rounded-br-sm'
                    : 'bg-surface-container-low border border-outline-variant/40 text-on-surface rounded-bl-sm'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
              {msg.role === 'assistant' && msg.content.length > 20 && (
                <button
                  onClick={() => copyMessage(msg.content, i)}
                  className="absolute -bottom-4 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] px-1.5 py-0.5 rounded-lg bg-surface-container-high border border-outline-variant/40 hover:bg-surface-container transition-colors"
                  style={{ color: 'var(--color-on-surface-variant)' }}
                  title="Copier la réponse"
                >
                  <span className="material-symbols-outlined text-[10px]">{copiedIndex === i ? 'check' : 'content_copy'}</span>
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-container-low border border-outline-variant/40 rounded-xl rounded-bl-sm px-3 py-2 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Questions suggérées */}
      {showSuggestions && (
        <div className="mb-3">
          <p className="text-[10px] font-medium mb-1.5" style={{ color: 'var(--color-on-surface-variant)' }}>
            Suggestions de questions :
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                disabled={loading}
                className="text-[10px] px-2 py-1 rounded-lg border transition-colors hover:bg-surface-container-low disabled:opacity-40"
                style={{ borderColor: 'var(--color-outline-variant)', color: 'var(--color-on-surface-variant)' }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Posez une question sur l analyse..."
          disabled={loading}
          className="flex-1 bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-[12px] text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-sm">send</span>
        </button>
      </div>
    </div>
  );
}

/* ── Section Analyse IA ──────────────────────────────────── */
function AiAnalysisSection() {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedCode, setExpandedCode] = useState(null);
  const scrollRef = useRef(null);

  async function runAnalysis() {
    setLoading(true);
    setError('');
    setAnalysis(null);
    try {
      const { data } = await api.post('/transition/analyze', { limit: 20 });
      setAnalysis(data);
      // Scroll vers la section après le chargement
      setTimeout(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l\'analyse IA');
    } finally {
      setLoading(false);
    }
  }

  function ScoreGauge({ note, size = 'sm' }) {
    const color = note >= 8 ? '#16a34a' : note >= 5 ? '#f59e0b' : '#ef4444';
    const pct = Math.min(100, Math.max(0, note * 10));
    const isLarge = size === 'lg';
    const dim = isLarge ? 64 : 36;
    const stroke = isLarge ? 5 : 3;
    const r = (dim - stroke) / 2;
    const circ = 2 * Math.PI * r;

    return (
      <div className={`relative inline-flex items-center justify-center ${isLarge ? 'flex-col' : ''}`}>
        <svg width={dim} height={dim} className="-rotate-90">
          <circle cx={dim / 2} cy={dim / 2} r={r} fill="none"
            stroke="var(--color-outline-variant)" strokeWidth={stroke} />
          <motion.circle cx={dim / 2} cy={dim / 2} r={r} fill="none"
            stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ * (1 - pct / 100) }}
            transition={{ duration: 1, ease: 'easeOut' }} />
        </svg>
        <span className={`absolute font-bold ${isLarge ? 'text-lg' : 'text-[10px]'}`} style={{ color }}>
          {isLarge ? `${note}/10` : note}
        </span>
      </div>
    );
  }

  return (
    <motion.div
      ref={scrollRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.22 }}
      className="bento-card p-4"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-on-surface)' }}>
          <span className="material-symbols-outlined text-lg" style={{ color: '#8b5cf6' }}>psychology</span>
          Analyse IA des tickets
        </h3>
        <button
          data-run-analysis
          onClick={runAnalysis}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border font-semibold text-[12px] transition-all duration-300"
          style={{
            borderColor: loading ? 'var(--color-outline-variant)' : '#8b5cf6',
            backgroundColor: loading ? 'transparent' : 'rgba(139,92,246,0.1)',
            color: loading ? 'var(--color-on-surface-variant)' : '#8b5cf6',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? (
            <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span> Analyse en cours...</>
          ) : (
            <><span className="material-symbols-outlined text-sm">psychology</span> Lancer l'analyse IA</>
          )}
        </button>
      </div>

      {error && (
        <div className="p-3 mb-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 text-[12px] font-medium">
          {error}
        </div>
      )}

      {loading && !analysis && (
        <div className="space-y-3">
          <div className="h-16 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-container-high)' }} />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-container-high)' }} />
            <div className="h-24 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-container-high)' }} />
          </div>
        </div>
      )}

      {analysis && !analysis.success && (
        <div>
          <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-600 text-[12px] font-medium mb-3">
            L'analyse IA n'a pas pu aboutir complètement
          </div>
          {analysis.error && <p className="text-[12px] text-red-500 mb-2">{analysis.error}</p>}
          {analysis.raw && (
            <pre className="text-[10px] overflow-auto max-h-32 bg-surface-container-high rounded-xl p-3">
              {analysis.raw}
            </pre>
          )}
        </div>
      )}

      {analysis?.success && analysis?.analysis && (
        <div className="space-y-4">
          {/* Score de santé global */}
          {(() => {
            const notes = ['qualiteNoms', 'assignations', 'categoriesPriorites', 'ecartsProdDev'];
            const vals = notes.map(k => analysis.analysis[k]?.note).filter(v => v != null);
            const avg = vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
            const healthColor = avg >= 8 ? '#16a34a' : avg >= 6 ? '#f59e0b' : avg >= 4 ? '#f97316' : '#ef4444';
            const healthLabel = avg >= 8 ? 'Excellent' : avg >= 6 ? 'Bon' : avg >= 4 ? 'Moyen' : 'Critique';
            return (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="p-4 rounded-xl border flex items-center gap-4"
                style={{ borderColor: `${healthColor}25`, backgroundColor: `${healthColor}05` }}>
                <ScoreGauge note={avg} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: 'var(--color-on-surface)' }}>Santé globale</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
                      style={{ backgroundColor: `${healthColor}15`, color: healthColor }}>
                      {healthLabel}
                    </span>
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                    Moyenne sur {vals.length} critères · {avg}/10
                  </p>
                </div>
              </motion.div>
            );
          })()}

          {/* Cartes de notes */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { key: 'qualiteNoms', label: 'Qualité des noms', icon: 'badge' },
              { key: 'assignations', label: 'Assignations', icon: 'group' },
              { key: 'categoriesPriorites', label: 'Catégories & Priorités', icon: 'category' },
              { key: 'ecartsProdDev', label: 'Écarts PROD/DEV', icon: 'compare_arrows' },
            ].map(item => {
              const data = analysis.analysis[item.key];
              const note = data?.note ?? 5;
              return (
                <div key={item.key} className="p-3 rounded-xl border" style={{ borderColor: 'var(--color-outline-variant)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-sm" style={{ color: 'var(--color-on-surface-variant)' }}>{item.icon}</span>
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <ScoreGauge note={note} />
                    <span className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>{data?.analyse?.substring(0, 80) || ''}</span>
                  </div>
                  {data?.problemes?.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {data.problemes.slice(0, 3).map((p, i) => {
                        const sev = typeof p === 'string' ? (p.toLowerCase().includes('critique') || p.toLowerCase().includes('bloqu') ? 'HAUT' : p.toLowerCase().includes('manquant') || p.toLowerCase().includes('manque') ? 'MOYEN' : 'INFO') : 'INFO';
                        const sevColor = sev === 'HAUT' ? '#ef4444' : sev === 'MOYEN' ? '#f59e0b' : '#3b82f6';
                        const sevBg = sev === 'HAUT' ? 'rgba(239,68,68,0.1)' : sev === 'MOYEN' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)';
                        const displayText = typeof p === 'string' ? p : p.message || p.text || String(p);
                        return (
                          <p key={i} className="text-[10px] flex items-start gap-1.5">
                            <span className="text-[8px] font-bold px-1 rounded shrink-0 mt-0.5" style={{ backgroundColor: sevBg, color: sevColor }}>{sev}</span>
                            <span style={{ color: 'var(--color-on-surface-variant)' }}>{displayText}</span>
                          </p>
                        );
                      })}
                      {data.problemes.length > 3 && (
                        <p className="text-[9px] font-medium" style={{ color: 'var(--color-on-surface-variant)' }}>
                          +{data.problemes.length - 3} autres problèmes
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Améliorations code */}
          {analysis.analysis.ameliorationsCode?.length > 0 && (
            <div>
              <h4 className="text-[12px] font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-on-surface)' }}>
                <span className="material-symbols-outlined text-sm">code</span>
                Améliorations du code proposées
              </h4>
              <div className="space-y-2">
                {analysis.analysis.ameliorationsCode.map((am, i) => (
                  <div key={i} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-outline-variant)' }}>
                    <button
                      onClick={() => setExpandedCode(expandedCode === i ? null : i)}
                      className="w-full flex items-center justify-between p-3 text-left hover:bg-surface-container-low/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-semibold uppercase" style={{
                          backgroundColor: am.impact === 'HAUT' ? 'rgba(239,68,68,0.1)' : am.impact === 'MOYEN' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)',
                          color: am.impact === 'HAUT' ? '#ef4444' : am.impact === 'MOYEN' ? '#f59e0b' : '#3b82f6',
                        }}>{am.impact}</span>
                        <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-on-surface)' }}>
                          {am.description}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                          backgroundColor: am.effort === 'FAIBLE' ? 'rgba(22,163,74,0.1)' : am.effort === 'MOYEN' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                          color: am.effort === 'FAIBLE' ? '#16a34a' : am.effort === 'MOYEN' ? '#f59e0b' : '#ef4444',
                        }}>{am.effort}</span>
                        <span className={`material-symbols-outlined text-sm transition-transform ${expandedCode === i ? 'rotate-180' : ''}`}
                          style={{ color: 'var(--color-on-surface-variant)' }}>expand_more</span>
                      </div>
                    </button>
                    {expandedCode === i && (
                      <div className="px-3 pb-3 space-y-2 border-t pt-2" style={{ borderColor: 'var(--color-outline-variant)' }}>
                        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-on-surface-variant)' }}>
                          {am.details}
                        </p>
                        {am.fichiers?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {am.fichiers.map((f, fi) => (
                              <span key={fi} className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{
                                backgroundColor: 'rgba(139,92,246,0.08)',
                                color: '#8b5cf6',
                              }}>
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Synthèse */}
          {analysis.analysis.synthese && (
            <div className="p-3 rounded-xl border" style={{
              borderColor: 'rgba(139,92,246,0.2)',
              backgroundColor: 'rgba(139,92,246,0.03)',
            }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined text-sm" style={{ color: '#8b5cf6' }}>summarize</span>
                <span className="text-[11px] font-bold" style={{ color: 'var(--color-on-surface)' }}>Synthèse</span>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-on-surface-variant)' }}>{analysis.analysis.synthese}</p>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* ATTRIBUTS DES TICKETS RÉCUPÉRÉS */}
          {/* ═══════════════════════════════════════════════════ */}
          <div>
            <h4 className="text-[12px] font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-on-surface)' }}>
              <span className="material-symbols-outlined text-sm" style={{ color: '#8b5cf6' }}>database</span>
              Données récupérées depuis GLPI
            </h4>
            <div className="space-y-2">
              <TicketAttributesPanel
                tickets={analysis.prodTickets || []}
                label="GLPI Production"
                color="#16a34a"
                error={analysis.prodTickets?.length === 0 ? 'Aucun ticket (instance non configurée ?)' : null}
              />
              <TicketAttributesPanel
                tickets={analysis.devTickets || []}
                label="GLPI Développement"
                color="#f59e0b"
                error={analysis.devTickets?.length === 0 ? 'Aucun ticket (instance non configurée ?)' : null}
              />
            </div>
          </div>

          {/* Métadonnées */}
          <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>
            <span>Tickets PROD: {analysis.prodTickets?.length || 0} · DEV: {analysis.devTickets?.length || 0}</span>
            <span>ERP: {analysis.erp?.total || 0} tickets (dont {analysis.erp?.last30 || 0} récents)</span>
          </div>
        </div>
      )}

      {!analysis && !loading && !error && (
        <p className="text-[12px] py-4 text-center" style={{ color: 'var(--color-on-surface-variant)' }}>
          Lancez une analyse IA pour comparer les tickets PROD et DEV, détecter les anomalies et obtenir des recommandations d'amélioration du code.
        </p>
      )}

      {/* ── Chat sur l'analyse ──────────────────────────────────── */}
      {analysis?.success && analysis?.analysis && (
        <TransitionAnalysisChat analysis={analysis} />
      )}
    </motion.div>
  );
}

/* ── Analyse des écarts (composant interne) ──────────────────────────── */
function renderDivergenceAnalysis(compareData) {
  if (!compareData?.instances?.glpi?.configured || !compareData?.instances?.glpi_dev?.configured) return null;

  const prod = compareData.instances.glpi;
  const dev = compareData.instances.glpi_dev;
  const diff = prod.ticketCount - dev.ticketCount;

  return (
    <div
      className="p-3 rounded-xl border"
      style={{
        borderColor: 'rgba(139,92,246,0.2)',
        backgroundColor: 'rgba(139,92,246,0.03)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-sm" style={{ color: '#8b5cf6' }}>analytics</span>
        <span className="text-[12px] font-bold" style={{ color: 'var(--color-on-surface)' }}>
          Analyse des écarts
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
        <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(139,92,246,0.06)' }}>
          <div className="font-semibold" style={{ color: 'var(--color-on-surface)' }}>
            {diff > 0 ? `+${diff.toLocaleString()}` : diff < 0 ? diff.toLocaleString() : '0'}
          </div>
          <div style={{ color: 'var(--color-on-surface-variant)' }}>Écart de tickets</div>
        </div>
        <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(139,92,246,0.06)' }}>
          <div className="font-semibold" style={{ color: 'var(--color-on-surface)' }}>
            {prod.ticketCount > 0
              ? Math.round((dev.ticketCount / prod.ticketCount) * 100) + '%'
              : 'N/A'}
          </div>
          <div style={{ color: 'var(--color-on-surface-variant)' }}>DEV vs PROD</div>
        </div>
        <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(139,92,246,0.06)' }}>
          <div className="font-semibold" style={{ color: 'var(--color-on-surface)' }}>
            {compareData.erp.glpiSynced} / {compareData.erp.erpOnly}
          </div>
          <div style={{ color: 'var(--color-on-surface-variant)' }}>Tickets ERP (synchro/only)</div>
        </div>
      </div>
    </div>
  );
}

/* ── Élément de la timeline ───────────────────────────────────────────── */
function TimelineItem({ event }) {
  const icon = EVENT_ICONS[event.type] || 'info';
  const label = EVENT_LABELS[event.type] || event.type;
  const isError = event.type === 'GLPI_SYNC_FAILED' || event.type === 'ERROR';

  return (
    <div className="flex gap-3 py-2.5">
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isError
              ? 'bg-red-500/10 text-red-500'
              : 'bg-surface-container-high text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-sm">{icon}</span>
        </div>
        <div className="w-px flex-1 mt-1" style={{ backgroundColor: 'var(--color-outline-variant)' }} />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>
            {label}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>
            {formatRelativeTime(event.createdAt)}
          </span>
        </div>
        {event.ticketId && (
          <Link
            to={`/tickets/${event.ticketId}`}
            className="text-[11px] hover:underline inline-flex items-center gap-1 mt-0.5"
            style={{ color: 'var(--color-primary)' }}
          >
            #{event.ticketId}{event.ticketTitle ? ` - ${event.ticketTitle.substring(0, 60)}` : ''}
            {event.glpiTicketId && <span className="text-[10px] opacity-60">(GLPI #{event.glpiTicketId})</span>}
          </Link>
        )}
        {event.actor && event.actor !== 'AI' && event.actor !== 'SYSTEM' && (
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>
            Par : {event.actor}
          </p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/* PAGE PRINCIPALE                                                         */
/* ═══════════════════════════════════════════════════════════════════════ */
export default function TransitionDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeSettings, setActiveSettings] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(() => Number(searchParams.get('days')) || 7);
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [confirmMode, setConfirmMode] = useState(null);

  const scrollToAnalysis = useCallback(() => {
    // Déclencher l'analyse IA en cliquant sur le bouton
    // Le composant AiAnalysisSection scroll automatiquement vers lui-même à la fin
    const btn = document.querySelector('[data-run-analysis]');
    if (btn) btn.click();
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/transition?days=${selectedPeriod}`)
      .then(({ data: result }) => {
        setData(result);
        setActiveSettings(result.settings);
      })
      .catch((err) => setError(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [selectedPeriod]);

  // Fonction partagée pour charger les données de comparaison
  const loadCompare = useCallback(() => {
    setCompareLoading(true);
    setCompareError('');
    api.get('/transition/compare')
      .then(({ data }) => setCompareData(data))
      .catch((err) => setCompareError(err.response?.data?.error || 'Erreur chargement comparaison'))
      .finally(() => setCompareLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Charger les données de comparaison PROD vs DEV
  useEffect(() => { loadCompare(); }, [loadCompare]);

  // Rafraîchissement auto toutes les 15s
  useEffect(() => {
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  // Basculer un réglage individuel
  async function toggleSetting(key, value) {
    setSaving(true);
    setError('');
    try {
      // Déterminer si c'est un réglage avancé (SUPERADMIN) ou système
      const isAdvanced = ['activeGlpiInstance', 'dryRunMode', 'enableGlpiTicketCreation',
        'enableGlpiFollowupCreation', 'enableGlpiTicketClosure',
        'closedTicketBehavior', 'reopenThresholdDays', 'glpiSourceMarker', 'goLiveDate'
      ].includes(key);

      const endpoint = isAdvanced ? '/advanced-settings' : '/system-settings';
      const { data: result } = await api.patch(endpoint, { [key]: value });
      // Recharger les données après modification
      await load();
      setActiveSettings(result);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  }

  // Appliquer un mode prédéfini
  async function applyMode(mode) {
    setSaving(true);
    setError('');
    try {
      const config = mode.config;
      // Envoyer tous les changements en une seule requête (advanced-settings accepte bulk)
      await api.patch('/advanced-settings', config);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du changement de mode');
    } finally {
      setSaving(false);
    }
  }

  // Calculer le mode actif à partir des réglages
  function getCurrentMode(settings) {
    if (!settings) return MODES[0];
    const { dryRunMode, activeGlpiInstance, enableGlpiTicketCreation } = settings;

    if (dryRunMode && activeGlpiInstance === 'glpi') return MODES[0]; // AUDIT
    if (!dryRunMode && activeGlpiInstance === 'glpi_dev') return MODES[1]; // SIMULATION
    if (dryRunMode && activeGlpiInstance === 'glpi_dev') return MODES[2]; // HYBRID
    // PROD + création OFF = Audit partiel (même visuel que Audit)
    if (!dryRunMode && activeGlpiInstance === 'glpi' && !enableGlpiTicketCreation) return MODES[0]; // Audit
    return MODES[3]; // PRODUCTION
  }

  if (loading && !data) {
    return (
      <div className="p-lg space-y-lg">
        <div className="h-8 w-48 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--color-surface-container-high)' }} />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-container-high)' }} />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-lg">
        <div className="bento-card p-lg text-center">
          <p className="font-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            {error || 'Chargement...'}
          </p>
          {error && <button onClick={load} className="mt-3 px-4 py-2 rounded-xl border border-outline-variant text-sm font-semibold">Réessayer</button>}
        </div>
      </div>
    );
  }

  const currentMode = getCurrentMode(activeSettings || data.settings);
  const { stats, recentEvents } = data;

  return (
    <div className="p-lg space-y-lg min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* HEADER */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-primary/10">
            <span className="material-symbols-outlined text-primary text-2xl">swap_horiz</span>
          </div>
          <div>
            <h2 className="font-display-lg text-display-lg font-bold" style={{ color: 'var(--color-on-background)' }}>
              Transition vers la plateforme
            </h2>
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              Pilotage progressif du déploiement — {stats.periodDays} derniers jours
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sélecteur de période */}
          <div className="flex items-center gap-1 p-1 rounded-lg border" style={{ borderColor: 'var(--color-outline-variant)' }}>
            {[7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => { setSelectedPeriod(d); setSearchParams({ days: d }, { replace: true }); }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                  selectedPeriod === d
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {d}j
              </button>
            ))}
          </div>

          {/* Bouton rafraîchir */}
          <button
            onClick={load}
            disabled={loading}
            className="w-9 h-9 rounded-xl border flex items-center justify-center transition-colors hover:bg-surface-container-high"
            style={{ borderColor: 'var(--color-outline-variant)' }}
            title="Rafraîchir"
          >
            <span className={`material-symbols-outlined text-lg ${loading ? 'animate-spin' : ''}`}
              style={{ color: 'var(--color-on-surface-variant)' }}>
              refresh
            </span>
          </button>
        </div>
      </motion.div>

      {/* Message d'erreur */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-red-500/20 bg-red-500/5 text-red-500 p-3 rounded-xl text-[13px] font-medium"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* MODE ACTUEL — Bannière principale */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
        className="bento-card p-6 relative overflow-hidden"
        style={{ borderColor: currentMode.borderLight }}
      >
        {/* Fond décoratif */}
        <div
          className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-5 pointer-events-none"
          style={{
            backgroundColor: currentMode.color,
            transform: 'translate(30%, -30%)',
          }}
        />

        <div className="flex flex-col lg:flex-row lg:items-center gap-6 relative z-10">
          {/* Mode actuel */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: `${currentMode.color}15` }}
            >
              <span className="material-symbols-outlined text-3xl" style={{ color: currentMode.color }}>
                {currentMode.icon}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold" style={{ color: 'var(--color-on-surface)' }}>
                  Mode {currentMode.label}
                </span>
                <span
                  className="w-2.5 h-2.5 rounded-full animate-pulse"
                  style={{ backgroundColor: currentMode.color }}
                />
              </div>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>
                {currentMode.description}
              </p>
              {/* Indicateurs de réglages */}
              <div className="flex flex-wrap gap-2 mt-3">
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: activeSettings?.dryRunMode ? 'rgba(245,158,11,0.1)' : 'rgba(22,163,74,0.1)',
                    color: activeSettings?.dryRunMode ? '#f59e0b' : '#16a34a',
                  }}
                >
                  <span className="material-symbols-outlined text-[12px]">
                    {activeSettings?.dryRunMode ? 'visibility' : 'edit'}
                  </span>
                  {activeSettings?.dryRunMode ? 'Lecture seule' : 'Écriture active'}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: activeSettings?.activeGlpiInstance === 'glpi_dev'
                      ? 'rgba(59,130,246,0.1)' : 'rgba(22,163,74,0.1)',
                    color: activeSettings?.activeGlpiInstance === 'glpi_dev' ? '#3b82f6' : '#16a34a',
                  }}
                >
                  <span className="material-symbols-outlined text-[12px]">dns</span>
                  {activeSettings?.activeGlpiInstance === 'glpi_dev' ? 'GLPI DEV' : 'GLPI PROD'}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: activeSettings?.enableGlpiTicketCreation
                      ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)',
                    color: activeSettings?.enableGlpiTicketCreation ? '#16a34a' : '#ef4444',
                  }}
                >
                  <span className="material-symbols-outlined text-[12px]">add_task</span>
                  Création {activeSettings?.enableGlpiTicketCreation ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
          </div>

          {/* Kill switch — dryRun */}
          <div className="lg:ml-auto flex items-center gap-4 p-4 rounded-2xl border"
            style={{
              borderColor: activeSettings?.dryRunMode ? 'rgba(245,158,11,0.2)' : 'rgba(22,163,74,0.2)',
              backgroundColor: activeSettings?.dryRunMode ? 'rgba(245,158,11,0.04)' : 'rgba(22,163,74,0.04)',
            }}
          >
            <div className="text-right">
              <div className="text-sm font-bold" style={{ color: 'var(--color-on-surface)' }}>
                Kill Switch
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>
                {activeSettings?.dryRunMode
                  ? '🔴 Écriture GLPI désactivée — mode analyse uniquement'
                  : '🟢 Écriture GLPI active'
                }
              </p>
            </div>
            <Toggle
              checked={!activeSettings?.dryRunMode}
              onChange={(v) => toggleSetting('dryRunMode', !v)}
              disabled={saving}
              size="lg"
            />
          </div>
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SÉLECTEUR DE MODE */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div>
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--color-on-surface)' }}>
          Changer de mode en un clic
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {MODES.map(mode => (
            <ModeCard
              key={mode.id}
              mode={mode}
              isActive={currentMode.id === mode.id}
              onClick={() => {
                if (currentMode.id !== mode.id && !saving) {
                  if (mode.id === 'PRODUCTION') {
                    setConfirmMode(mode);
                  } else {
                    applyMode(mode);
                  }
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* PROGRESSION + QUALITÉ + ACTIONS */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <TransitionProgressTracker
        currentModeId={currentMode.id}
        goLiveDate={activeSettings?.goLiveDate}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <DecisionQualityCard stats={stats} />
        <TransitionActions
          currentModeId={currentMode.id}
          onRunAnalysis={scrollToAnalysis}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* CONTRÔLES GRANULAIRES + STATS */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">

        {/* Panneau de contrôle */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bento-card p-4 space-y-4"
        >
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-on-surface)' }}>
            <span className="material-symbols-outlined text-lg">tune</span>
            Contrôles granulaires
          </h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-1.5">
              <div>
                <div className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>Création de tickets</div>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>Nouveaux tickets dans GLPI</p>
              </div>
              <Toggle
                checked={activeSettings?.enableGlpiTicketCreation !== false}
                onChange={(v) => toggleSetting('enableGlpiTicketCreation', v)}
                disabled={saving}
              />
            </div>

            <div className="h-px" style={{ backgroundColor: 'var(--color-outline-variant)' }} />

            <div className="flex items-center justify-between py-1.5">
              <div>
                <div className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>Ajout de suivis</div>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>Réponses email → suivi GLPI</p>
              </div>
              <Toggle
                checked={activeSettings?.enableGlpiFollowupCreation !== false}
                onChange={(v) => toggleSetting('enableGlpiFollowupCreation', v)}
                disabled={saving}
              />
            </div>

            <div className="h-px" style={{ backgroundColor: 'var(--color-outline-variant)' }} />

            <div className="flex items-center justify-between py-1.5">
              <div>
                <div className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>Fermeture de tickets</div>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>Résolution/fermeture dans GLPI</p>
              </div>
              <Toggle
                checked={activeSettings?.enableGlpiTicketClosure !== false}
                onChange={(v) => toggleSetting('enableGlpiTicketClosure', v)}
                disabled={saving}
              />
            </div>

            <div className="h-px" style={{ backgroundColor: 'var(--color-outline-variant)' }} />

            {/* Instance GLPI */}
            <div className="flex flex-col gap-1.5 py-1.5">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>Instance GLPI cible</div>
                <span
                  className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                    (activeSettings?.activeGlpiInstance || 'glpi') === 'glpi'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-amber-500/10 text-amber-600'
                  }`}
                >
                  {(activeSettings?.activeGlpiInstance || 'glpi') === 'glpi' ? 'PROD' : 'DEV'}
                </span>
              </div>
              <select
                value={activeSettings?.activeGlpiInstance || 'glpi'}
                onChange={(e) => toggleSetting('activeGlpiInstance', e.target.value)}
                disabled={saving}
                className="bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                style={{ color: 'var(--color-on-surface)' }}
              >
                <option value="glpi">GLPI Production</option>
                <option value="glpi_dev">GLPI Développement</option>
              </select>
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-on-surface-variant)' }}>
                {(activeSettings?.activeGlpiInstance || 'glpi') === 'glpi'
                  ? 'Les tickets sont envoyés vers la base réelle des techniciens.'
                  : 'Les tickets sont envoyés vers l\'instance de test isolée. Aucun impact sur la production.'}
              </p>
            </div>

            <div className="h-px" style={{ backgroundColor: 'var(--color-outline-variant)' }} />

            {/* Comportement ticket fermé */}
            <div className="flex flex-col gap-1.5 py-1.5">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>Réponse à ticket fermé</div>
              <select
                value={activeSettings?.closedTicketBehavior || 'create_new'}
                onChange={(e) => toggleSetting('closedTicketBehavior', e.target.value)}
                disabled={saving}
                className="bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                style={{ color: 'var(--color-on-surface)' }}
              >
                <option value="create_new">Créer un nouveau ticket</option>
                <option value="reopen">Rouvrir le ticket</option>
              </select>
            </div>

            <div className="h-px" style={{ backgroundColor: 'var(--color-outline-variant)' }} />

            {/* Marquage source */}
            <div className="flex flex-col gap-1.5 py-1.5">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>Marquage GLPI</div>
              <select
                value={activeSettings?.glpiSourceMarker || 'internal_note'}
                onChange={(e) => toggleSetting('glpiSourceMarker', e.target.value)}
                disabled={saving}
                className="bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                style={{ color: 'var(--color-on-surface)' }}
              >
                <option value="internal_note">Note interne SOS Platform</option>
                <option value="none">Aucun marquage</option>
              </select>
            </div>
          </div>

          {saving && (
            <div className="flex items-center gap-2 text-[11px] italic" style={{ color: 'var(--color-on-surface-variant)' }}>
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              Mise à jour...
            </div>
          )}
        </motion.div>

        {/* Stats colonne centrale */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="space-y-3"
        >
          <h3 className="text-sm font-bold" style={{ color: 'var(--color-on-surface)' }}>
            Statistiques ({stats.periodDays} jours)
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Emails traités"
              value={stats.emailsProcessed}
              icon="mail"
              subtitle={`${stats.emailsNewTicket} nouveaux tickets · ${stats.emailsFollowup} suivis`}
            />
            <StatCard
              label="Tickets créés"
              value={stats.ticketsCreated}
              icon="confirmation_number"
              subtitle={`${stats.glpiTicketsCreated} dans GLPI · ${stats.erpOnlyTickets} ERP seul`}
            />
            <StatCard
              label="Brouillons IA"
              value={stats.events.aiDrafts}
              icon="drafts"
            />
            <StatCard
              label="Erreurs"
              value={stats.events.errors + stats.emailsError}
              icon="error"
              color="#ef4444"
              subtitle={`${stats.emailsSpam} spams filtrés`}
            />
          </div>

          {/* Nuage de points sur les événements */}
          <div className="bento-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>
                Activité
              </span>
              <Link
                to="/supervision"
                className="text-[11px] font-medium hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                Supervision IA →
              </Link>
            </div>

            {/* Barres de progression des événements */}
            <div className="space-y-2">
              {[
                { label: 'Tickets créés', value: stats.events.created, max: stats.ticketsCreated || 1, color: '#16a34a' },
                { label: 'Réouvertures', value: stats.events.reopened, max: stats.ticketsCreated || 1, color: '#f59e0b' },
                { label: 'Suivis ajoutés', value: stats.events.followups, max: stats.emailsProcessed || 1, color: '#3b82f6' },
                { label: 'Escalades humaines', value: stats.events.escalated, max: stats.ticketsCreated || 1, color: '#ef4444' },
              ].map(item => {
                const pct = Math.min(100, Math.round((item.value / Math.max(item.max, 1)) * 100));
                return (
                  <div key={item.label}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[11px]" style={{ color: 'var(--color-on-surface-variant)' }}>{item.label}</span>
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>{item.value}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-outline-variant)' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        {/* Instances GLPI */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bento-card p-4 space-y-3"
        >
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-on-surface)' }}>
            <span className="material-symbols-outlined text-lg">dns</span>
            Instances GLPI
          </h3>

          <div className="space-y-3">
            {data.instances.map(inst => (
              <div
                key={inst.id}
                className="p-3 rounded-xl border"
                style={{ borderColor: 'var(--color-outline-variant)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${inst.isConfigured ? (inst.isActive ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-red-500'}`}
                    />
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>
                      {inst.label}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      activeSettings?.activeGlpiInstance === inst.id
                        ? 'bg-primary/10 text-primary'
                        : 'bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    {activeSettings?.activeGlpiInstance === inst.id ? 'Actif' : 'Inactif'}
                  </span>
                </div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                  {inst.isConfigured ? inst.baseUrl : 'Non configuré'}
                </p>
              </div>
            ))}
          </div>

          {/* Date de mise en production */}
          <div className="pt-3 border-t" style={{ borderColor: 'var(--color-outline-variant)' }}>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-on-surface)' }}>
              Date de mise en production
            </div>
            <input
              type="date"
              value={activeSettings?.goLiveDate ? activeSettings.goLiveDate.slice(0, 10) : ''}
              onChange={(e) => toggleSetting('goLiveDate', e.target.value ? `${e.target.value}T00:00:00Z` : null)}
              disabled={saving}
              className="bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-[12px] w-full focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              style={{ color: 'var(--color-on-surface)' }}
            />
          </div>

          {/* Seuil de réouverture */}
          <div className="pt-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>
                  Seuil de réouverture
                </div>
                <p className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>
                  Au-delà, nouveau ticket créé
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={730}
                  value={activeSettings?.reopenThresholdDays ?? 90}
                  onChange={(e) => toggleSetting('reopenThresholdDays', Math.max(1, Math.min(730, Number(e.target.value) || 90)))}
                  disabled={saving}
                  className="bg-surface border border-outline-variant/60 rounded-xl px-2 py-1.5 text-[12px] w-16 text-center focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                  style={{ color: 'var(--color-on-surface)' }}
                />
                <span className="text-[11px]" style={{ color: 'var(--color-on-surface-variant)' }}>jours</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* COMPARAISON PROD vs DEV */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bento-card p-4"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-on-surface)' }}>
            <span className="material-symbols-outlined text-lg">compare_arrows</span>
            Comparaison PROD vs DEV
          </h3>
          <button
            onClick={loadCompare}
            disabled={compareLoading}
            className="w-8 h-8 rounded-lg border flex items-center justify-center transition-colors hover:bg-surface-container-high"
            style={{ borderColor: 'var(--color-outline-variant)' }}
          >
            <span className={`material-symbols-outlined text-sm ${compareLoading ? 'animate-spin' : ''}`}
              style={{ color: 'var(--color-on-surface-variant)' }}>refresh</span>
          </button>
        </div>

        {/* Erreur de comparaison */}
        {compareError && (
          <div className="p-3 mb-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 text-[12px] font-medium">
            {compareError}
          </div>
        )}

        {compareLoading && !compareData && (
          <div className="grid grid-cols-2 gap-4">
            <div className="h-32 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-container-high)' }} />
            <div className="h-32 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-container-high)' }} />
          </div>
        )}

        {compareData && (
          <div className="space-y-4">
            {/* Cartes côte à côte */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(compareData.instances).map(([key, inst]) => {
                const isProd = key === 'glpi';
                const isActive = compareData.instanceActive === key;
                return (
                  <div
                    key={key}
                    className="rounded-xl border p-4 relative overflow-hidden"
                    style={{
                      borderColor: inst.configured
                        ? (isActive ? 'rgba(22,163,74,0.2)' : 'var(--color-outline-variant)')
                        : 'rgba(239,68,68,0.2)',
                      backgroundColor: inst.configured
                        ? 'var(--color-surface)'
                        : 'rgba(239,68,68,0.03)',
                    }}
                  >
                    {/* Badge actif */}
                    {isActive && (
                      <span
                        className="absolute top-2 right-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'rgba(22,163,74,0.1)', color: '#16a34a' }}
                      >
                        Actif
                      </span>
                    )}

                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          inst.configured ? (isActive ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-red-500'
                        }`}
                      />
                      <span className="text-[13px] font-bold" style={{ color: 'var(--color-on-surface)' }}>
                        {inst.label}
                      </span>
                      {isProd && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-semibold">
                          PROD
                        </span>
                      )}
                    </div>

                    {inst.error ? (
                      <p className="text-[12px] text-red-500">{inst.error}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--color-surface-container-low)' }}>
                            <div className="text-[18px] font-bold" style={{ color: 'var(--color-on-surface)' }}>
                              {inst.ticketCount.toLocaleString()}
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>Total tickets</div>
                          </div>
                          <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--color-surface-container-low)' }}>
                            <div className="text-[18px] font-bold" style={{ color: 'var(--color-on-surface)' }}>
                              {inst.recentTickets?.length || 0}
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--color-on-surface-variant)' }}>Récents (10)</div>
                          </div>
                        </div>

                        {/* Derniers tickets */}
                        {inst.recentTickets?.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                              style={{ color: 'var(--color-on-surface-variant)' }}>
                              Derniers tickets
                            </div>
                            <div className="max-h-[180px] overflow-y-auto space-y-1 pr-1">
                              {inst.recentTickets.map(t => (
                                <div
                                  key={t.id}
                                  className="flex items-center justify-between py-1 px-2 rounded-lg text-[11px]"
                                  style={{ backgroundColor: 'var(--color-surface-container-low)' }}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <span className="font-semibold shrink-0" style={{ color: 'var(--color-on-surface)' }}>
                                      #{t.id}
                                    </span>
                                    <span className="truncate" style={{ color: 'var(--color-on-surface-variant)' }}>
                                      {t.name || '(Sans titre)'}
                                    </span>
                                  </div>
                                  <span
                                    className="shrink-0 ml-2 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                                    style={{
                                      backgroundColor: t.status === 5 || t.status === 6
                                        ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)',
                                      color: t.status === 5 || t.status === 6 ? '#16a34a' : '#f59e0b',
                                    }}
                                  >
                                    {['Nouveau', 'Ouvert', 'En cours', 'En attente', 'Résolu', 'Fermé'][t.status] || t.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Analyse de divergence */}
            {renderDivergenceAnalysis(compareData)}

            {/* Statut de synchronisation ERP */}
            <div
              className="p-3 rounded-xl border flex items-center justify-between"
              style={{ borderColor: 'var(--color-outline-variant)' }}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                  sync
                </span>
                <span className="text-[12px] font-semibold" style={{ color: 'var(--color-on-surface)' }}>
                  Tickets ERP sur 30 jours
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span style={{ color: 'var(--color-on-surface-variant)' }}>
                  <strong style={{ color: '#16a34a' }}>{compareData.erp.glpiSynced}</strong> synchronisés GLPI
                </span>
                <span className="w-px h-4" style={{ backgroundColor: 'var(--color-outline-variant)' }} />
                <span style={{ color: 'var(--color-on-surface-variant)' }}>
                  <strong style={{ color: '#f59e0b' }}>{compareData.erp.erpOnly}</strong> ERP uniquement
                </span>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DONNÉES HISTORIQUES IMPORTÉES */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {data.importData && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bento-card p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-on-surface)' }}>
              <span className="material-symbols-outlined text-lg" style={{ color: '#8b5cf6' }}>database</span>
              Données historiques importées
            </h3>
            <span className="text-[10px] px-2 py-1 rounded-full font-semibold"
              style={{ backgroundColor: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>
              {data.importData.ticketsTotal} tickets · {data.importData.locationsImported} lieux
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-surface-container-low)' }}>
              <div className="text-[22px] font-bold" style={{ color: 'var(--color-on-surface)' }}>
                {data.importData.ticketsImported.toLocaleString()}
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                Tickets importés (CSV)
              </div>
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-surface-container-low)' }}>
              <div className="text-[22px] font-bold" style={{ color: 'var(--color-on-surface)' }}>
                {data.importData.ticketsWithLocation.toLocaleString()}
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                Avec lieu renseigné
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>
                {Math.round((data.importData.ticketsWithLocation / data.importData.ticketsTotal) * 100)}% de couverture
              </div>
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-surface-container-low)' }}>
              <div className="text-[22px] font-bold" style={{ color: 'var(--color-on-surface)' }}>
                {data.importData.locationsImported}
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                Lieux de référence
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-on-surface-variant)' }}>
                Pour la détection IA
              </div>
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-surface-container-low)' }}>
              <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                Utilité
              </div>
              <ul className="text-[10px] space-y-1" style={{ color: 'var(--color-on-surface-variant)' }}>
                <li className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[10px]" style={{ color: '#8b5cf6' }}>check_circle</span>
                  Few-shot learning (titres + lieux)
                </li>
                <li className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[10px]" style={{ color: '#8b5cf6' }}>check_circle</span>
                  Détection du lieu par l'IA
                </li>
                <li className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[10px]" style={{ color: '#8b5cf6' }}>check_circle</span>
                  Format de titre standardisé
                </li>
              </ul>
            </div>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ANALYSE IA DES TICKETS */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <AiAnalysisSection />

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TIMELINE DES ÉVÉNEMENTS RÉCENTS */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="bento-card p-4"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-on-surface)' }}>
            <span className="material-symbols-outlined text-lg">timeline</span>
            Événements récents
          </h3>
          <span className="text-[11px]" style={{ color: 'var(--color-on-surface-variant)' }}>
            {recentEvents.length} événements
          </span>
        </div>

        <div className="max-h-[400px] overflow-y-auto pr-2">
          {recentEvents.length === 0 ? (
            <p className="text-[13px] py-8 text-center" style={{ color: 'var(--color-on-surface-variant)' }}>
              Aucun événement sur cette période
            </p>
          ) : (
            recentEvents.map((ev, i) => (
              <TimelineItem key={ev.id || i} event={ev} />
            ))
          )}
        </div>
      </motion.div>

      <ConfirmDialog
        open={!!confirmMode}
        title="Passer en mode Production"
        message="Passer en mode Production va activer l'écriture dans GLPI production. Les emails seront transformés en tickets réels. Confirmer ?"
        confirmLabel="Activer"
        danger
        loading={saving}
        onConfirm={() => { if (confirmMode) applyMode(confirmMode); setConfirmMode(null); }}
        onCancel={() => setConfirmMode(null)}
      />

    </div>
  );
}
