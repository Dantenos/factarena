// Connexion temps réel au salon (Socket.IO), côté client de
// backend/src/realtime/realtime.gateway.ts.
//
// Trois pièges : la gateway coupe la socket sans JWT dans handshake.auth, elle
// a besoin de roomId pour restaurer un joueur qui se reconnecte, et elle
// renvoie serverTime — on s'en sert plutôt que de l'horloge du navigateur,
// sinon la fenêtre de vote n'est pas la même pour tout le monde.
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
  const [erreur, setErreur] = useState<string | null>(null);
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
    socket.on('room:error', (donnees: { message?: string }) => {
      setErreur(donnees?.message ?? 'Impossible de rejoindre la room.');
    });

    const majEtat = (nouvel: EtatSalon) => {
      if (nouvel?.serverTime) {
        decalageRef.current = new Date(nouvel.serverTime).getTime() - Date.now();
      }
      setEtat(nouvel);
    };
    // ⚠️ Écouter « room:state » seul ne suffit PAS. La gateway diffuse les
    // transitions de manche via publishRoundState, qui émet l'événement
    // concerné (round:open, round:locked...) ET « round:state » — mais jamais
    // « room:state ». Une page déjà ouverte quand la manche démarrait restait
    // donc bloquée sur « en attente », clip 0/0, sans la moindre erreur.
    //
    // Tous ces événements transportent le MÊME état complet du salon, on les
    // traite donc identiquement.
    const EVENEMENTS_ETAT = [
      'room:state', 'room:joined', 'room:reconnected',
      'round:state', 'round:open', 'round:locked', 'round:revealed', 'round:finished',
    ];
    EVENEMENTS_ETAT.forEach((evenement) => socket.on(evenement, majEtat));

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

  return { connecte, etat, erreur, emettre, ecouter, maintenantServeur };
}
