import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import Footer from './Footer';
import { useAuth } from '../auth/AuthContext';
import logo from '../../logo_tr.png';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { utilisateur, seDeconnecter, notificationsAmis } = useAuth();
  const pseudo = utilisateur?.displayName || utilisateur?.email.split('@')[0].slice(0, 30);
  const dansUneRoom = /^\/room\/[^/]+$/.test(location.pathname);

  function handleLogout() {
    seDeconnecter();
    navigate('/');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 sm:p-8 relative bg-noir-krystal">
        <nav className="font-semibold text-white flex flex-wrap gap-2 sm:gap-4 items-center">
          <img src={logo} alt="FactArena" className="h-10 lg:h-24 w-auto object-contain shrink-0" />
          {dansUneRoom ? (
            <button
              type="button"
              className="text-base sm:text-lg button-red-d px-3 sm:px-5 py-1"
              onClick={() => window.dispatchEvent(new CustomEvent('factarena:leave-room', {
                detail: { terminer: () => navigate('/play') },
              }))}
            >
              Quitter la partie
            </button>
          ) : (
            <Link to="/" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">Accueil</Link>
          )}

          {!dansUneRoom && !utilisateur && (
            <Link to="/login" className="text-base sm:text-lg ml-auto sm:ml-0 sm:absolute sm:right-8 button-blue-d px-3 sm:px-5 py-1">
              Connexion
            </Link>
          )}

          {utilisateur && (
            <>
              {!dansUneRoom && (
                <>
                  <Link to="/play" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">Jouer</Link>
                  <Link to="/profile" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">Profil</Link>
                  <Link to="/friends" className="text-base sm:text-lg button-blue-d px-3 sm:px-5 py-1">
                    Amis{notificationsAmis > 0 && location.pathname !== '/friends' ? ' (!)' : ''}
                  </Link>
                </>
              )}
              <div className="ml-auto sm:ml-0 sm:absolute sm:right-8 flex min-w-0 max-w-[calc(100vw-2rem)] items-center gap-3">
                <span className="hidden lg:block min-w-0 max-w-[40vw] truncate text-sm text-gray-300" title={pseudo}>
                  {pseudo}
                </span>
                <button
                  type="button"
                  className="text-base sm:text-lg shrink-0 button-red-d px-3 sm:px-5 py-1 font-normal"
                  onClick={handleLogout}
                >
                  Déconnexion
                </button>
              </div>
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
