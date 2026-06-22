import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// SUPERADMIN doit avoir accès à tout ce qu'ADMIN peut voir — on l'ajoute automatiquement dès que
// 'ADMIN' est demandé, pour ne pas avoir à lister SUPERADMIN dans chaque <ProtectedRoute roles={...}>.
function effectiveRoles(roles) {
  if (!roles) return roles;
  return roles.includes('ADMIN') && !roles.includes('SUPERADMIN') ? [...roles, 'SUPERADMIN'] : roles;
}

export default function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !effectiveRoles(roles).includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
