import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'
// Config Vite. En conteneur, on sert le BUILD de production via `vite preview`
// (pas de HMR -> pas de WebSocket de dev -> console propre derrière nginx).
// host:true => écoute 0.0.0.0 pour être joignable par nginx.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: {
    host: true,
    port: 4173,
    // Le service n'est joignable QUE via le proxy nginx interne : on autorise
    // tous les hôtes pour éviter le « Blocked request » de vite preview si
    // l'app est évaluée via une IP / un domaine (VM 42) plutôt que localhost.
    allowedHosts: true,
  },
  // ATTENTION : tout ce bloc « server » ne sert QU'AU MODE DEV (quand on lance vite dev
  // via docker-compose.dev.yml). En prod on tourne avec vite preview, qui
  // ignore complètement ce bloc : rien de ce qui suit n'affecte l'évaluation.
  server: {
    host: true,
    // Je garde le même port qu'en prod (4173) exprès : comme ça nginx proxifie
    // / -> frontend:4173 dans les deux modes et on n'a qu'une seule conf nginx
    // à maintenir au lieu de deux.
    port: 4173,
    // Même raison que pour « preview » plus haut : on passe toujours par nginx,
    // et si l'un de vous bosse via l'IP d'une VM, vite dev lui répondrait
    // « Blocked request » sans cette ligne.
    allowedHosts: true,
    hmr: {
      // Le rechargement à chaud, c'est un WebSocket que le NAVIGATEUR ouvre.
      // Sauf que le navigateur, lui, ne connaît que nginx : il parle en HTTPS
      // sur le port 443. Vite, par défaut, dirait au navigateur de se connecter
      // sur le port 4173 — sauf que 4173 est un port interne à Docker, que le
      // navigateur ne peut pas joindre. Résultat : WebSocket en échec, retry en
      // boucle, console pleine d'erreurs rouges (interdit par le sujet).
      // Ces deux lignes disent juste à Vite : « dis au navigateur de passer par
      // wss://<le site>:443 », donc par nginx, qui sait faire suivre.
      protocol: 'wss',
      clientPort: 8443,
    },
  },
});
