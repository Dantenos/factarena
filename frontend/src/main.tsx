import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Point d'entrée React 18 (createRoot). BrowserRouter fournit le routage SPA.
// Les `future` flags activent le comportement v7 de react-router et évitent
// des warnings console (avertissements de dépréciation v6 -> v7).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </BrowserRouter>
  </StrictMode>,
);
