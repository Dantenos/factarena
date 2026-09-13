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

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/:userId" element={<Profile />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/play" element={<Play />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/room" element={<Play />} />
        </Route>

        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
