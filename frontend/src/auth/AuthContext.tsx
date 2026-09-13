import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearToken,
  SESSION_EXPIREE,
  connexion as apiConnexion,
  demandesAmis,
  getToken,
  inscription as apiInscription,
  profil,
  setToken,
  tokenExpire,
  type Utilisateur,
} from '../api/client';
import { io } from 'socket.io-client';

interface ContexteAuth {
  utilisateur: Utilisateur | null;
  chargement: boolean;
  seConnecter: (email: string, motDePasse: string) => Promise<void>;
  sInscrire: (email: string, motDePasse: string, pseudo: string) => Promise<void>;
  seDeconnecter: () => void;
  rafraichir: () => Promise<void>;
  notificationsAmis: number;
}

const Contexte = createContext<ContexteAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);
  const [notificationsAmis, setNotificationsAmis] = useState(0);
  const demandesAmisVues = useRef(false);

  useEffect(() => {
    const token = getToken();
    if (!token || tokenExpire(token)) {
      if (token) clearToken();
      setChargement(false);
      return;
    }
    let annule = false;
    profil()
      .then((u) => {
        if (annule) return;
        if (u) {
          setUtilisateur(u);
        } else {
          clearToken();
          setUtilisateur(null);
        }
      })
      .catch(() => {
        clearToken();
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    if (!utilisateur) return;
    demandesAmisVues.current = false;
    demandesAmis().then((demandes) => {
      if (!demandesAmisVues.current) setNotificationsAmis(demandes.received.length);
    }).catch(() => undefined);
    const token = getToken();
    if (!token) return;
    const socket = io({ path: '/socket.io', transports: ['websocket'], auth: { token } });
    const profilMisAJour = (profilUtilisateur: { id?: string; displayName?: string | null; avatarUrl?: string | null; experience?: number; level?: number; achievements?: unknown[] }) => {
      if (!profilUtilisateur?.id) return;
      if (profilUtilisateur.id === utilisateur.id) {
        setUtilisateur((precedent) => precedent ? {
          ...precedent,
          displayName: profilUtilisateur.displayName ?? precedent.displayName,
          avatarUrl: profilUtilisateur.avatarUrl ?? precedent.avatarUrl,
          experience: profilUtilisateur.experience ?? precedent.experience,
          level: profilUtilisateur.level ?? precedent.level,
        } : precedent);
      }
      window.dispatchEvent(new CustomEvent('factarena:profile-update', { detail: profilUtilisateur }));
    };
    const classementMisAJour = (classement: unknown) => {
      window.dispatchEvent(new CustomEvent('factarena:leaderboard-update', { detail: classement }));
    };
    const relayer = (evenement: string, donnees: unknown) => {
      window.dispatchEvent(new CustomEvent(`factarena:${evenement}`, { detail: donnees }));
    };
    socket.on('profile:update', profilMisAJour);
    socket.on('leaderboard:update', classementMisAJour);
    socket.on('presence:update', (donnees: unknown) => relayer('presence-update', donnees));
    socket.on('rooms:update', () => relayer('rooms-update', undefined));
    socket.on('history:update', () => relayer('history-update', undefined));
    socket.on('balance:update', (donnees: unknown) => relayer('balance-update', donnees));
    socket.on('friend:update', (donnees: { type?: string }) => {
      window.dispatchEvent(new CustomEvent('factarena:friend-update', { detail: donnees }));
      if (donnees?.type === 'request_received' || donnees?.type === 'request_accepted') {
        setNotificationsAmis((nombre) => nombre + 1);
      }
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [utilisateur?.id]);

  useEffect(() => {
    const voirAmis = () => {
      demandesAmisVues.current = true;
      setNotificationsAmis(0);
    };
    window.addEventListener('factarena:friends-viewed', voirAmis);
    return () => window.removeEventListener('factarena:friends-viewed', voirAmis);
  }, []);

  useEffect(() => {
    const surExpiration = () => setUtilisateur(null);
    window.addEventListener(SESSION_EXPIREE, surExpiration);
    return () => window.removeEventListener(SESSION_EXPIREE, surExpiration);
  }, []);

  const seConnecter = useCallback(async (email: string, motDePasse: string) => {
    const reponse = await apiConnexion(email, motDePasse);
    if ('loginFailed' in reponse && reponse.loginFailed) {
      throw new Error(reponse.message);
    }
    setToken(reponse.accessToken);
    setUtilisateur(reponse.user);
  }, []);

  const sInscrire = useCallback(async (email: string, motDePasse: string, pseudo: string) => {
    const reponse = await apiInscription(email, motDePasse, pseudo);
    if ('alreadyExists' in reponse && reponse.alreadyExists) {
      throw new Error(reponse.message);
    }
    if ('pseudoAlreadyExists' in reponse && reponse.pseudoAlreadyExists) {
      throw new Error(reponse.message);
    }
    setToken(reponse.accessToken);
    setUtilisateur(reponse.user);
  }, []);

  const seDeconnecter = useCallback(() => {
    window.dispatchEvent(new Event('factarena:logout'));
    clearToken();
    setUtilisateur(null);
  }, []);

  const rafraichir = useCallback(async () => {
    try {
      const profilActuel = await profil();
      if (profilActuel) {
        setUtilisateur(profilActuel);
      } else {
        clearToken();
        setUtilisateur(null);
      }
    } catch {
    }
  }, []);

  const valeur = useMemo(
    () => ({ utilisateur, chargement, seConnecter, sInscrire, seDeconnecter, rafraichir, notificationsAmis }),
    [utilisateur, chargement, seConnecter, sInscrire, seDeconnecter, rafraichir, notificationsAmis],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useAuth(): ContexteAuth {
  const contexte = useContext(Contexte);
  if (!contexte) {
    throw new Error('useAuth doit être utilisé à l\'intérieur d\'un <AuthProvider>');
  }
  return contexte;
}
