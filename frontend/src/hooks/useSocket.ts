// Connexion temps réel au salon (Socket.IO).
//
// Côté back, la gateway (backend/src/realtime/realtime.gateway.ts) écoute
// room:join, room:leave, bet:place, clip-vote:submit, chat:send... et diffuse
// room:state, chat:message, bet:updated, round:locked, round:revealed, etc.
//
// Trois points méritent l'attention, et ce sont eux qui coûtent du temps si on
// les découvre tard :
//
// 1. AUTHENTIFICATION — la gateway lit le JWT dans handshake.auth.token et
//    déconnecte immédiatement si absent ou invalide. Sans jeton, la socket se
//    ferme en boucle et la console se remplit d'erreurs (rédhibitoire).
//
// 2. RECONNEXION — la gateway sait restaurer un joueur grâce à
//    handshake.auth.roomId (voir restoreRoom côté back). On le transmet donc,
//    sinon un joueur qui perd le réseau dix secondes revient hors du salon.
//    Le sujet exige explicitement une gestion propre des déconnexions.
//
// 3. DÉCALAGE D'HORLOGE — le back renvoie serverTime dans chaque état. Si on
//    faisait confiance à l'horloge du navigateur, un joueur dont la machine
//    avance de dix secondes voterait dans une fenêtre décalée : le PvP ne
//    serait plus équitable. On mesure donc l'écart et on l'applique.
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from '../api/client';

export interface EtatSalon {
  room: { id: string; name: string; status: string; createdBy: string };
  members: unknown[];
  round: Record<string, unknown> | null;
  pot: number;
  betCount: number;
  serverTime: string;
}

export function useSocket(roomId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const [connecte, setConnecte] = useState(false);
  const [etat, setEtat] = useState<EtatSalon | null>(null);
  // Écart (ms) entre l'horloge du serveur et celle du navigateur.
  const decalageRef = useRef(0);

  useEffect(() => {
    if (!roomId) return;
    const token = getToken();
    // Pas de jeton : inutile de tenter, la gateway nous déconnecterait aussitôt.
    if (!token) return;

    // Chemin relatif : on passe par nginx, qui proxifie /socket.io vers NestJS
    // en WSS. Aucune URL en dur, donc ça marche aussi bien en local que derrière
    // un nom de domaine.
    const socket = io({
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token, roomId },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnecte(true);
      socket.emit('room:join', { roomId });
    });
    socket.on('disconnect', () => setConnecte(false));

    const majEtat = (nouvel: EtatSalon) => {
      if (nouvel?.serverTime) {
        decalageRef.current = new Date(nouvel.serverTime).getTime() - Date.now();
      }
      setEtat(nouvel);
    };
    socket.on('room:state', majEtat);
    socket.on('room:joined', majEtat);
    socket.on('room:reconnected', majEtat);

    // On NE met PAS de console.error sur l'événement d'erreur : une coupure
    // réseau est un cas normal, et le sujet interdit toute erreur en console.
    socket.on('connect_error', () => setConnecte(false));

    return () => {
      socket.emit('room:leave', { roomId });
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  /** Émet un événement vers la gateway (no-op si la socket n'est pas prête). */
  const emettre = useCallback((evenement: string, donnees: unknown) => {
    socketRef.current?.emit(evenement, donnees);
  }, []);

  /** Abonnement ponctuel à un événement, nettoyé automatiquement. */
  const ecouter = useCallback((evenement: string, rappel: (donnees: never) => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on(evenement, rappel);
    return () => {
      socket.off(evenement, rappel);
    };
  }, []);

  /** Heure du SERVEUR estimée : à utiliser pour la fenêtre de vote. */
  const maintenantServeur = useCallback(() => Date.now() + decalageRef.current, []);

  return { connecte, etat, emettre, ecouter, maintenantServeur };
}
