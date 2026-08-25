import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Play from './pages/Play';
import Room from './pages/Room';
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

        {/* Pages nécessitant un compte. Avant, /profile était accessible en
            tapant l'URL : la « connexion » n'était qu'un drapeau localStorage. */}
        <Route element={<ProtectedRoute />}>
          <Route path="/profile" element={<Profile />} />
          <Route path="/play" element={<Play />} />
          <Route path="/room" element={<Room />} />
        </Route>

        {/* Filet : une URL inconnue affichait une page blanche (aucune route ne
            correspondait). On renvoie vers l'accueil. */}
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
