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
  const decalageRef = useRef(0);

  useEffect(() => {
    if (!roomId) return;
    const token = getToken();
    if (!token) return;

    const socket = io({
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token, roomId },
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnecte(true));
    socket.on('disconnect', () => setConnecte(false));
    socket.on('room:error', (donnees: { message?: string }) => {
      setErreur(donnees?.message ?? 'Impossible de rejoindre la room.');
    });
    const quitterAvantDeconnexion = () => {
      socket.emit('room:leave', { roomId });
    };
    window.addEventListener('factarena:logout', quitterAvantDeconnexion);
    const quitterLaRoom = (evenement: Event) => {
      const terminer = (evenement as CustomEvent<{ terminer?: () => void }>).detail?.terminer;
      socket.timeout(6000).emit('room:leave', { roomId }, () => terminer?.());
    };
    window.addEventListener('factarena:leave-room', quitterLaRoom);

    const majEtat = (nouvel: EtatSalon) => {
      if (!nouvel?.room) return;
      if (nouvel?.serverTime) {
        decalageRef.current = new Date(nouvel.serverTime).getTime() - Date.now();
      }
      setEtat(nouvel);
    };
    const EVENEMENTS_ETAT = [
      'room:state', 'room:joined', 'room:reconnected',
      'round:state', 'round:prepared', 'round:started', 'round:next', 'round:open', 'round:locked', 'round:revealed', 'round:finished',
    ];
    EVENEMENTS_ETAT.forEach((evenement) => socket.on(evenement, majEtat));
    socket.on('connect_error', () => setConnecte(false));

    return () => {
      window.removeEventListener('factarena:logout', quitterAvantDeconnexion);
      window.removeEventListener('factarena:leave-room', quitterLaRoom);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  const emettre = useCallback((evenement: string, donnees: unknown) => {
    socketRef.current?.emit(evenement, donnees);
  }, []);

  const demander = useCallback(<T,>(evenement: string, donnees: unknown): Promise<T> => {
    const socket = socketRef.current;
    if (!socket) return Promise.reject(new Error('Connexion au salon indisponible'));
    return new Promise<T>((resolve, reject) => {
      socket.timeout(6000).emit(evenement, donnees, (erreur: Error | null, reponse: T) => {
        if (erreur) reject(erreur);
        else {
          const resultat = reponse as T & { ok?: boolean; message?: string };
          if (resultat && resultat.ok === false) reject(new Error(resultat.message ?? 'Action impossible'));
          else resolve(reponse);
        }
      });
    });
  }, []);

  const ecouter = useCallback((evenement: string, rappel: (donnees: never) => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on(evenement, rappel);
    return () => {
      socket.off(evenement, rappel);
    };
  }, []);

  const maintenantServeur = useCallback(() => Date.now() + decalageRef.current, []);

  return { connecte, etat, erreur, emettre, demander, ecouter, maintenantServeur };
}
