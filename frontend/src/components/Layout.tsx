import { Outlet, Link } from 'react-router-dom';
import Footer from './Footer';

// Gabarit commun à toutes les pages : une barre de navigation, le contenu de
// la page courante (Outlet), et le footer toujours visible.
export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-noir-krystal p-4 border-b">
        <nav className="flex justify-around font-bold text-[#FFFFFF] flex gap-4">
          <Link to="/">Accueil</Link>
          <Link to="/profile">Profil</Link>
          <Link to="/play">Jouer</Link>
          <Link to="/login">Connexion</Link>
        </nav>
      </header>
      <main className="flex-1 flex">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
