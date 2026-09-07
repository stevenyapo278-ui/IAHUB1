import { useId } from 'react';

/**
 * Résout une URL d'avatar stockée en chemin relatif (/uploads/avatar/x.jpg)
 * vers une URL absolue pointant vers le backend.
 */
export function resolveAvatarUrl(avatarUrl) {
  if (!avatarUrl) return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  const base = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
  return `${base}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
}

const SIZES = {
  xs: 'w-5 h-5 text-[8px]',
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
  xl: 'w-16 h-16 text-xl',
};

/**
 * Avatar utilisateur : photo de profil si disponible, sinon l'initiale.
 * @param {object}  user    Objet utilisateur (utilise user.avatarUrl / user.fullName / user.name)
 * @param {string}  name    Nom de secours si `user` non fourni
 * @param {string}  size    xs | sm | md | lg | xl
 * @param {string}  colorClass Classes du fallback (fond de l'initiale)
 */
export default function UserAvatar({ user, name, size = 'md', colorClass = 'bg-blue-500/15 text-blue-600 dark:text-blue-400', className = '' }) {
  const displayName = user?.fullName || user?.name || name || '?';
  const photo = resolveAvatarUrl(user?.avatarUrl);
  const initial = (displayName || '?').charAt(0).toUpperCase();
  const imgId = useId();

  const cls = `inline-flex items-center justify-center rounded-full font-bold shrink-0 overflow-hidden select-none ${SIZES[size] || SIZES.md} ${photo ? '' : colorClass} ${className}`;

  if (photo) {
    return (
      <span className={cls} title={displayName}>
        <img
          src={photo}
          alt={displayName}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Photo introuvable → repli sur l'initiale
            e.currentTarget.style.display = 'none';
            const fallback = document.getElementById(imgId);
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        <span id={imgId} className="hidden w-full h-full items-center justify-center" style={{ display: 'none' }}>
          {initial}
        </span>
      </span>
    );
  }

  return (
    <span className={cls} title={displayName}>
      {initial}
    </span>
  );
}
