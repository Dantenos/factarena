import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Friends from './pages/Friends';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Play from './pages/Play';
import Room from './pages/Room';
import AuthCallback from './pages/AuthCallback';
import ProtectedRoute from './components/ProtectedRoute';

// Déclaration des routes. Le Layout (qui contient le footer) enveloppe TOUTES
// les pages : les liens Privacy Policy / Terms of Service sont donc présents
// partout (contrainte éliminatoire du sujet).
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Pages publiques : accessibles sans compte. Privacy et Terms DOIVENT
            le rester, le sujet exige qu'elles soient consultables librement. */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        {/* Retour de 42 : le jeton arrive par l'URL, cette route le recueille.
            Elle doit rester publique — au moment où le navigateur y arrive, le
            jeton n'est pas encore enregistré. */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Pages nécessitant un compte. Avant, /profile était accessible en
            tapant l'URL : la « connexion » n'était qu'un drapeau localStorage. */}
        <Route element={<ProtectedRoute />}>
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/:userId" element={<Profile />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/play" element={<Play />} />
          {/* Le salon a besoin de SON identifiant : sans lui la page ne peut ni
              rejoindre le bon canal WebSocket, ni charger la manche en cours.
              L'ancienne route /room (sans paramètre) renvoie donc au lobby. */}
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/room" element={<Play />} />
        </Route>

        {/* Filet : une URL inconnue affichait une page blanche (aucune route ne
            correspondait). On renvoie vers l'accueil. */}
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
