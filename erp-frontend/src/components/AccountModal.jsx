import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Trash2, Mail, ShieldCheck, X, Loader2 } from 'lucide-react';
import api from '../api/client';

// Modale « Mon compte » — accessible à TOUS les utilisateurs (aucun droit requis).
// Permet de changer sa photo de profil ; les infos (email, rôle) sont en lecture seule.
export default function AccountModal({ open, onClose, user, onUserUpdated }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!user) return null;

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-sélectionner le même fichier
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Image trop lourde (2 Mo maximum).');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const { data } = await api.post('/auth/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUserUpdated({ ...user, avatarUrl: data.avatarUrl });
      setSuccess('Photo de profil mise à jour.');
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'envoi de l'image.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      await api.delete('/auth/avatar');
      onUserUpdated({ ...user, avatarUrl: null });
      setSuccess('Photo de profil supprimée.');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la suppression.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="account-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.18 }}
            className="bg-surface rounded-2xl border border-outline-variant/40 shadow-2xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* En-tête */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-outline-variant/30">
              <h3 className="text-base font-bold text-on-surface">Mon compte</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Photo de profil */}
              <div className="flex items-center gap-5">
                <div className="relative shrink-0">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.fullName}
                      className="w-20 h-20 rounded-2xl object-cover border border-outline-variant/40"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <span className="text-2xl font-bold text-primary">
                        {user.fullName?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-semibold text-on-surface">Photo de profil</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Changer
                    </button>
                    {user.avatarUrl && (
                      <button
                        onClick={handleRemove}
                        disabled={uploading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant/60 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Supprimer
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-on-surface-variant">PNG, JPG, GIF ou WEBP — 2 Mo maximum.</p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* Messages */}
              <AnimatePresence>
                {error && (
                  <motion.p
                    key="account-error"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-xs text-red-500 bg-red-500/5 border border-red-500/20 rounded-xl px-3 py-2"
                  >
                    {error}
                  </motion.p>
                )}
                {success && (
                  <motion.p
                    key="account-success"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-3 py-2"
                  >
                    {success}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Informations du compte (lecture seule) */}
              <div className="space-y-3 pt-1">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">Informations</p>
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-on-surface-variant shrink-0" />
                  <span className="text-on-surface truncate">{user.email}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <ShieldCheck className="w-4 h-4 text-on-surface-variant shrink-0" />
                  <span className="text-on-surface capitalize">{user.role?.toLowerCase()}</span>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
