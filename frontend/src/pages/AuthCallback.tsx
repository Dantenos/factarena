import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export default function AuthCallback() {
  const [parametres] = useSearchParams();
  const navigate = useNavigate();
  const { rafraichir } = useAuth();
  const [erreur, setErreur] = useState<string | null>(null);
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
