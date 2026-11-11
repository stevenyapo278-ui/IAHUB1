import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import { ShieldAlert } from 'lucide-react';

// SUPERADMIN doit avoir accès à tout ce qu'ADMIN peut voir — on l'ajoute automatiquement dès que
// 'ADMIN' est demandé, pour ne pas avoir à lister SUPERADMIN dans chaque <ProtectedRoute roles={...}>.
function effectiveRoles(roles) {
  if (!roles) return roles;
  return roles.includes('ADMIN') && !roles.includes('SUPERADMIN') ? [...roles, 'SUPERADMIN'] : roles;
}

// Écran « accès refusé » : une redirection silencieuse vers le dashboard donnait l'impression
// que le clic dans la sidebar « ne faisait rien » (aucun feedback, aucune trace de la cause).
function AccessDenied({ user }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
      <ShieldAlert className="w-12 h-12 text-amber-500" />
      <div>
        <h2 className="text-lg font-semibold text-on-surface">Accès refusé à cette page</h2>
        <p className="text-sm text-on-surface-variant mt-1 max-w-md">
          Ton rôle actif (<strong className="capitalize">{user?.role?.toLowerCase()}</strong>) ne dispose pas des
          droits nécessaires pour cette section, ou tes permissions n'ont pas encore été rechargées.
        </p>
        <p className="text-xs text-on-surface-variant/70 mt-2 max-w-md">
          Essaie de recharger la page (F5). Si le problème persiste, redémarre la session ou demande à un
          administrateur de vérifier ton groupe de droits.
        </p>
      </div>
      <a
        href="/"
        className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Retour au tableau de bord
      </a>
    </div>
  );
}

export default function ProtectedRoute({ children, roles, permission }) {
  const { user, authReady } = useAuth();
  const location = useLocation();

  // Session en cours de restauration depuis le cookie HttpOnly : ne pas rediriger
  // vers /login tant que le refresh initial n'a pas répondu (sinon F5 = déconnexion
  // apparente à chaque rechargement de page).
  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" aria-label="Chargement de la session" />
      </div>
    );
  }

  if (!user) {
    const from = `${location.pathname}${location.search || ''}`;
    const redirect = from ? `?redirect=${encodeURIComponent(from)}` : '';
    return <Navigate to={`/login${redirect}`} replace />;
  }

  if (roles && !effectiveRoles(roles).includes(user.role)) {
    return <AccessDenied user={user} />;
  }

  if (permission && !hasPermission(user, permission)) {
    return <AccessDenied user={user} />;
  }

  return children;
}
