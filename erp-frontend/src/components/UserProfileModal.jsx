/**
 * UserProfileModal — fiche complète d'un compte utilisateur.
 *
 * Ouverte depuis la vue Tickets en cliquant sur un nom (demandeur, technicien
 * ou observateur). Les informations détaillées (rôle, équipe, groupes de
 * permissions, statut, photo, date de création) sont résolues via
 * GET /users?ids=… (userSelect côté serveur) ; l'objet passé en prop sert de
 * secours pendant le chargement ou si l'appel échoue.
 *
 * Props :
 *   user    : objet minimal { id, fullName?, email?, avatarUrl? } — null = fermé
 *   onClose : function
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Mail, Users as UsersIcon, Calendar, BellRing,
  CheckCircle2, XCircle, Loader2, KeyRound, AlertTriangle,
} from 'lucide-react';
import api from '../api/client';
import UserAvatar from './UserAvatar';

const ROLE_STYLES = {
  SUPERADMIN: { label: 'Super admin', cls: 'bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300' },
  ADMIN: { label: 'Admin', cls: 'bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300' },
  HOTLINE: { label: 'Hotline', cls: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300' },
  TECHNICIAN: { label: 'Technicien', cls: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300' },
  REQUESTER: { label: 'Demandeur', cls: 'bg-outline/10 border-outline/30 text-on-surface-variant' },
};

function roleChip(role) {
  const conf = ROLE_STYLES[role] || { label: role, cls: 'bg-outline/10 border-outline/30 text-on-surface-variant' };
  return (
    <span key={role} className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${conf.cls}`}>
      {conf.label}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return null; }
}

function InfoRow({ icon: Icon, label, children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/70">{label}</p>
        <div className="text-[13px] text-on-surface break-words mt-0.5">{children}</div>
      </div>
    </div>
  );
}

export default function UserProfileModal({ user, onClose }) {
  const userId = user?.id ?? null;
  // Réponse rattachée à l'id résolu : tant que forId !== userId la fiche est en
  // chargement (aucun setState synchrone dans l'effet — règle React Compiler).
  const [result, setResult] = useState({ forId: null, data: null, error: false });

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    api.get('/users', { params: { ids: userId } })
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.users || []);
        setResult({ forId: userId, data: list[0] || null, error: !list[0] });
      })
      .catch(() => { if (!cancelled) setResult({ forId: userId, data: null, error: true }); });
    return () => { cancelled = true; };
  }, [userId]);

  // Échap pour fermer
  useEffect(() => {
    if (!user) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, onClose]);

  const resolved = !!userId && result?.forId === userId;
  const loading = !!userId && !resolved;
  const profile = resolved ? result.data : null;
  const error = resolved && result.error;

  // Fallback : ligne de la grille (observers n'ont pas d'email, par ex.)
  const u = profile || user || {};
  const primaryRole = profile?.role || user?.role || null;
  const roles = profile?.roles && profile.roles.length > 0 ? profile.roles : (primaryRole ? [primaryRole] : []);
  const extraRoles = roles.filter((r) => r !== primaryRole);

  return createPortal(
    <AnimatePresence>
      {user && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
            role="dialog"
            aria-modal="true"
            aria-label={`Profil de ${u.fullName || ''}`}
            className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
          >
            {/* En-tête */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-outline-variant/30">
              <h3 className="text-base font-bold text-on-background">Profil utilisateur</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Photo + identité */}
              <div className="flex items-start gap-4">
                <UserAvatar user={u} name={u.fullName} size="xl" className="shrink-0" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-lg font-bold text-on-surface truncate">{u.fullName || '—'}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {primaryRole && roleChip(primaryRole)}
                    {extraRoles.map(roleChip)}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {loading ? (
                      <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
                        <Loader2 className="w-3 h-3 animate-spin" /> Chargement…
                      </span>
                    ) : (
                      <>
                        {(profile ?? user)?.isActive !== false ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Compte actif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                            <XCircle className="w-3.5 h-3.5" /> Compte désactivé
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Détails du compte indisponibles — affichage limité aux informations de la liste.
                </div>
              )}

              {/* Détails du compte */}
              <div className="space-y-3.5 pt-1 border-t border-outline-variant/30">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 pt-3">
                  Informations du compte
                </p>
                <InfoRow icon={Mail} label="Email">
                  {u.email || <span className="text-on-surface-variant italic">—</span>}
                </InfoRow>
                <InfoRow icon={UsersIcon} label="Équipe">
                  {profile?.team?.name || <span className="text-on-surface-variant italic">Aucune équipe</span>}
                </InfoRow>
                <InfoRow icon={KeyRound} label="Groupes de permissions">
                  {profile?.permissionGroups?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.permissionGroups.map((g) => (
                        <span
                          key={g.id}
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-surface-container text-on-surface border border-outline-variant/40"
                        >
                          {g.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-on-surface-variant italic">Aucun groupe</span>
                  )}
                </InfoRow>
                <InfoRow icon={BellRing} label="Alertes brouillons IA">
                  {profile?.receiveDraftAlerts
                    ? 'Activées'
                    : <span className="text-on-surface-variant">Désactivées</span>}
                </InfoRow>
                <InfoRow icon={Calendar} label="Compte créé le">
                  {fmtDate(profile?.createdAt) || <span className="text-on-surface-variant italic">—</span>}
                </InfoRow>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
