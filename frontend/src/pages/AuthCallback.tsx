// Retour de l'authentification 42.
//
// Le back ne peut pas nous transmettre le jeton autrement que par l'URL : le
// navigateur arrive ici depuis une redirection HTTP, pas depuis un appel de
// notre code. Cette page récupère donc le jeton, l'enregistre, et rend la main.
//
// Sans elle, l'URL tombait sur le filet `path="*"` de App.tsx : le joueur
// revenait sur l'accueil toujours déconnecté, avec son jeton affiché dans la
// barre d'adresse.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export default function AuthCallback() {
  const [parametres] = useSearchParams();
  const navigate = useNavigate();
  const { rafraichir } = useAuth();
  const [erreur, setErreur] = useState<string | null>(null);
  // React monte deux fois les effets en mode strict : sans ce garde, le profil
  // serait demandé en double à chaque retour de 42.
  const dejaTraite = useRef(false);

  useEffect(() => {
    if (dejaTraite.current) return;
    dejaTraite.current = true;

    const jeton = parametres.get('token');
    if (!jeton) {
      setErreur("La connexion 42 n'a pas abouti.");
      return;
    }

    setToken(jeton);
    // On efface le jeton de la barre d'adresse avant toute chose : il resterait
    // sinon dans l'historique du navigateur et dans les favoris.
    window.history.replaceState({}, '', '/auth/callback');

    rafraichir()
      .then(() => navigate('/', { replace: true }))
      .catch(() => setErreur('Impossible de récupérer le profil.'));
  }, [parametres, rafraichir, navigate]);

  return (
    <section className="bg-noir-krystal w-full min-h-full p-8 text-white">
      {erreur ? (
        <div className="flex flex-col gap-3 items-start">
          <p role="alert" className="text-red-l">{erreur}</p>
          <button type="button" onClick={() => navigate('/login')} className="button-blue-d px-5 py-2">
            Retour à la connexion
          </button>
        </div>
      ) : (
        <p className="text-white/50">Connexion en cours…</p>
      )}
    </section>
  );
}
