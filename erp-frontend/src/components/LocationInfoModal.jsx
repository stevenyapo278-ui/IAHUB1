/**
 * LocationInfoModal — fiche d'informations d'un lieu.
 *
 * Ouverte depuis la vue Tickets en cliquant sur le nom du lieu. Les détails
 * (adresse, chemin complet, tag, compteurs tickets/demandeurs/actifs) viennent
 * de GET /api/locations/:id ; l'objet minimal passé en prop ({ id, name })
 * sert de libellé de secours pendant le chargement.
 *
 * Props :
 *   location : { id, name? } — null = fermé
 *   onClose  : function
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MapPin, Map, Home, DoorOpen, Tag, Ticket, Users, Boxes,
  Calendar, Loader2, AlertTriangle, Building2, CheckCircle2, XCircle,
} from 'lucide-react';
import api from '../api/client';

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

function Counter({ icon: Icon, label, value, accent }) {
  return (
    <div className={`rounded-xl border px-3 py-2 min-w-0 ${accent || 'border-outline-variant/40 bg-surface-container-low/50'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        <Icon className="w-3 h-3 shrink-0" /> {label}
      </div>
      <p className="text-lg font-extrabold text-on-surface tabular-nums mt-0.5">{value ?? '—'}</p>
    </div>
  );
}

export default function LocationInfoModal({ location, onClose }) {
  const locationId = location?.id ?? null;
  // Réponse rattachée à l'id résolu : tant que forId !== locationId la fiche est
  // en chargement (aucun setState synchrone dans l'effet — règle React Compiler).
  const [result, setResult] = useState({ forId: null, data: null, error: false });

  useEffect(() => {
    if (!locationId) return undefined;
    let cancelled = false;
    api.get(`/locations/${locationId}`)
      .then(({ data }) => { if (!cancelled) setResult({ forId: locationId, data, error: false }); })
      .catch(() => { if (!cancelled) setResult({ forId: locationId, data: null, error: true }); });
    return () => { cancelled = true; };
  }, [locationId]);

  useEffect(() => {
    if (!location) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [location, onClose]);

  const resolved = !!locationId && result?.forId === locationId;
  const loading = !!locationId && !resolved;
  const details = resolved ? result.data : null;
  const error = resolved && result.error;

  const loc = details || location || {};
  const addressLine = [loc.address, loc.postcode, loc.town].filter(Boolean).join(' ');
  const fullName = loc.completename || loc.name || location?.name || '—';

  return createPortal(
    <AnimatePresence>
      {location && (
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
            aria-label={`Fiche du lieu ${fullName}`}
            className="relative bg-surface-container-lowest border border-outline-variant/60 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-outline-variant/30">
              <h3 className="text-base font-bold text-on-background">Fiche du lieu</h3>
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
              {/* Identité du lieu */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <MapPin className="w-6 h-6 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-base font-bold text-on-surface break-words">{fullName}</p>
                  {loc.name && loc.completename && loc.name !== loc.completename && (
                    <p className="text-xs text-on-surface-variant">Nom simple : {loc.name}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {loading ? (
                      <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
                        <Loader2 className="w-3 h-3 animate-spin" /> Chargement…
                      </span>
                    ) : (
                      <>
                        {loc.isActive !== false ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Lieu actif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                            <XCircle className="w-3.5 h-3.5" /> Lieu inactif
                          </span>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          loc.isCustom
                            ? 'bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-400'
                            : 'bg-outline/10 border-outline/30 text-on-surface-variant'
                        }`}>
                          <Building2 className="w-3 h-3 mr-1" />
                          {loc.isCustom ? 'Lieu local' : 'Référentiel GLPI'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Détails du lieu indisponibles — affichage limité au nom.
                </div>
              )}

              {/* Compteurs */}
              <div className="grid grid-cols-2 gap-2">
                <Counter
                  icon={Ticket}
                  label="Tickets"
                  value={details ? `${details.ticketCount ?? 0}` : undefined}
                  accent={details?.openTicketCount > 0
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-outline-variant/40 bg-surface-container-low/50'}
                />
                <Counter
                  icon={Ticket}
                  label="Dont actifs"
                  value={details ? `${details.openTicketCount ?? 0}` : undefined}
                  accent={details?.openTicketCount > 0
                    ? 'border-orange-500/30 bg-orange-500/5'
                    : 'border-outline-variant/40 bg-surface-container-low/50'}
                />
                <Counter
                  icon={Users}
                  label="Demandeurs"
                  value={details ? `${details.requesterCount ?? 0}` : undefined}
                />
                <Counter
                  icon={Boxes}
                  label="Actifs (parcs)"
                  value={details ? `${details.assetCount ?? 0}` : undefined}
                />
              </div>

              {/* Détails */}
              <div className="space-y-3.5 pt-1 border-t border-outline-variant/30">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60 pt-3">
                  Localisation
                </p>
                <InfoRow icon={Map} label="Adresse">
                  {addressLine || <span className="text-on-surface-variant italic">Non renseignée</span>}
                </InfoRow>
                <InfoRow icon={Home} label="Pays">
                  {loc.country || <span className="text-on-surface-variant italic">—</span>}
                </InfoRow>
                <InfoRow icon={Building2} label="Bâtiment">
                  {loc.building || <span className="text-on-surface-variant italic">—</span>}
                </InfoRow>
                <InfoRow icon={DoorOpen} label="Salle">
                  {loc.room || <span className="text-on-surface-variant italic">—</span>}
                </InfoRow>
                <InfoRow icon={Tag} label="Tag">
                  {loc.tag || <span className="text-on-surface-variant italic">Aucun tag</span>}
                </InfoRow>
                <InfoRow icon={Calendar} label="Enregistré le">
                  {fmtDate(loc.createdAt) || <span className="text-on-surface-variant italic">—</span>}
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
