import { Outlet, Link, useNavigate } from 'react-router-dom';
import Footer from './Footer';
import { useAuth } from '../auth/AuthContext';

// Ossature commune : en-tête de navigation, contenu, footer.
//
// La navigation lisait auparavant localStorage['LoggedIn'] dans un useEffect,
// ce qui posait deux problèmes : l'état n'était lu qu'au montage (se connecter
// ne mettait donc pas le menu à jour sans rechargement), et surtout ce drapeau
// ne prouvait rien. On s'appuie maintenant sur le contexte d'authentification,
// qui reflète un vrai jeton vérifié auprès du back.
export default function Layout() {
  const navigate = useNavigate();
  const { utilisateur, seDeconnecter } = useAuth();

  function handleLogout() {
    seDeconnecter();
    navigate('/');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 sm:p-8 relative bg-noir-krystal">
        <nav className="font-semibold text-white flex flex-wrap gap-2 sm:gap-4 items-center">
          <Link to="/" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">Accueil</Link>

          {!utilisateur && (
            <Link to="/login" className="text-base sm:text-lg ml-auto sm:ml-0 sm:absolute sm:right-8 button-blue-d px-3 sm:px-5 py-1">
              Connexion
            </Link>
          )}

          {utilisateur && (
            <>
              <Link to="/play" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">Jouer</Link>
              <Link to="/profile" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">Profil</Link>
              <Link to="/friends" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">Amis</Link>
              {/* On affiche qui est connecté : utile en soutenance pour
                  démontrer plusieurs comptes simultanés dans deux navigateurs. */}
              <span className="hidden lg:block lg:absolute lg:right-48 text-sm text-gray-300">
                {utilisateur.displayName || utilisateur.email}
              </span>
              <button
                type="button"
                className="text-base sm:text-lg ml-auto sm:ml-0 sm:absolute sm:right-8 button-red-d px-3 sm:px-5 py-1"
                onClick={handleLogout}
              >
                Déconnexion
              </button>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1 flex">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
