import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Room from './pages/Room';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';

// Déclaration des routes. Le Layout (qui contient le footer) enveloppe TOUTES
// les pages : les liens Privacy Policy / Terms of Service sont donc présents
// partout (contrainte éliminatoire du sujet).
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/room" element={<Room />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Route>
    </Routes>
  );
}
