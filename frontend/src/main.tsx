import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

// Point d'entrée React 18 (createRoot). BrowserRouter fournit le routage SPA.
// Les `future` flags activent le comportement v7 de react-router et évitent
// des warnings console (avertissements de dépréciation v6 -> v7).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {/* AuthProvider enveloppe TOUTE l'application : le jeton et l'utilisateur
          doivent être connus aussi bien du routeur (routes protégées) que des
          pages et du hook WebSocket. */}
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
