// État d'authentification partagé par toute l'application.
//
// Remplace le localStorage['LoggedIn'] = 'true' qui simulait la connexion :
// celui-ci ne prouvait rien (il suffisait de l'écrire à la main dans la console
// pour se « connecter »), et surtout il ne fournissait aucun jeton — donc aucun
// appel authentifié au back n'était possible.
//
// Ici on garde le JWT et l'utilisateur. Au chargement de la page, si un jeton
// existe, on le VÉRIFIE auprès du back (/users/me) au lieu de le croire sur
// parole : un jeton expiré ou révoqué doit déconnecter proprement.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  clearToken,
  SESSION_EXPIREE,
  connexion as apiConnexion,
  getToken,
  inscription as apiInscription,
  profil,
  setToken,
  tokenExpire,
  type Utilisateur,
} from '../api/client';

interface ContexteAuth {
  utilisateur: Utilisateur | null;
  /** true tant qu'on vérifie le jeton au démarrage : évite d'afficher la page
   *  de connexion pendant une fraction de seconde à un utilisateur déjà connecté. */
  chargement: boolean;
  seConnecter: (email: string, motDePasse: string) => Promise<void>;
  sInscrire: (email: string, motDePasse: string) => Promise<void>;
  seDeconnecter: () => void;
  /** Relit le profil depuis le back. Après une modification de pseudo ou
   *  d'avatar, l'utilisateur en mémoire est périmé et l'en-tête afficherait
   *  encore l'ancienne valeur. */
  rafraichir: () => Promise<void>;
}

const Contexte = createContext<ContexteAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);

  // Vérification du jeton au premier rendu.
  useEffect(() => {
    const token = getToken();
    // Un JWT expiré est détectable sans réseau. On le supprime avant l'appel
    // à /users/me afin d'éviter un 401 attendu affiché par le navigateur lors
    // de chaque ouverture du site après expiration de la session.
    if (!token || tokenExpire(token)) {
      if (token) clearToken();
      setChargement(false);
      return;
    }
    let annule = false;
    profil()
      .then((u) => {
        if (!annule) setUtilisateur(u);
      })
      .catch(() => {
        // Jeton invalide ou expiré : on nettoie sans bruit. Pas de console.error
        // ici, ce serait une erreur console pour un cas parfaitement normal
        // (le sujet exige une console vierge).
        clearToken();
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Expiration en cours de session : le client HTTP nous prévient dès qu'un
  // appel revient en 401. Sans cet abonnement, l'interface continuait
  // d'afficher le joueur comme connecté alors que plus rien ne passait.
  useEffect(() => {
    const surExpiration = () => setUtilisateur(null);
    window.addEventListener(SESSION_EXPIREE, surExpiration);
    return () => window.removeEventListener(SESSION_EXPIREE, surExpiration);
  }, []);

  const seConnecter = useCallback(async (email: string, motDePasse: string) => {
    const reponse = await apiConnexion(email, motDePasse);
    setToken(reponse.accessToken);
    setUtilisateur(reponse.user);
  }, []);

  const sInscrire = useCallback(async (email: string, motDePasse: string) => {
    const reponse = await apiInscription(email, motDePasse);
    if ('alreadyExists' in reponse && reponse.alreadyExists) {
      throw new Error(reponse.message);
    }
    setToken(reponse.accessToken);
    setUtilisateur(reponse.user);
  }, []);

  const seDeconnecter = useCallback(() => {
    clearToken();
    setUtilisateur(null);
  }, []);

  const rafraichir = useCallback(async () => {
    try {
      setUtilisateur(await profil());
    } catch {
      // Profil indisponible : on garde l'utilisateur en mémoire plutôt que de
      // déconnecter sur un incident réseau passager.
    }
  }, []);

  const valeur = useMemo(
    () => ({ utilisateur, chargement, seConnecter, sInscrire, seDeconnecter, rafraichir }),
    [utilisateur, chargement, seConnecter, sInscrire, seDeconnecter, rafraichir],
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
