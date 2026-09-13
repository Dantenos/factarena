import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function ProtectedRoute() {
  const { utilisateur, chargement } = useAuth();
  const emplacement = useLocation();

  if (chargement) return null;

  if (!utilisateur) {
    return <Navigate to="/login" replace state={{ depuis: emplacement.pathname }} />;
  }

  return <Outlet />;
}
