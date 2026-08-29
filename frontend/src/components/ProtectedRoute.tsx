// Route protégée : redirige vers /login si l'utilisateur n'est pas connecté.
//
// Avant, /profile était accessible en tapant simplement l'URL — la « connexion »
// n'était qu'un drapeau dans le localStorage. Ici la protection repose sur un
// vrai jeton vérifié auprès du back.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function ProtectedRoute() {
  const { utilisateur, chargement } = useAuth();
  const emplacement = useLocation();

  // Tant que le jeton est en cours de vérification, on n'affiche rien : sans ce
  // garde-fou, un utilisateur déjà connecté verrait la page de connexion
  // clignoter avant d'être redirigé.
  if (chargement) return null;

  // `state` mémorise la page demandée pour y revenir après connexion, et
  // `replace` évite de polluer l'historique du navigateur.
  if (!utilisateur) {
    return <Navigate to="/login" replace state={{ depuis: emplacement.pathname }} />;
  }

  return <Outlet />;
}
