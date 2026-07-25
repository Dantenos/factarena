import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// Page d'accueil. Elle appelle /api/health (le backend, via nginx, même origine)
// pour vérifier que la chaîne front -> nginx -> back fonctionne. L'erreur est
// gérée proprement (aucune exception non catchée -> aucune erreur console).
export default function Home() {
  const [apiStatus, setApiStatus] = useState<string>('...');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { status: string }) => setApiStatus(data.status))
      .catch(() => setApiStatus('indisponible'));
  }, []);

  return (
    <section className="p-5 bg-noir-krystal w-full min-h-full">
      <h1 className="text-9xl font-bold text-white font-montserrat">FactArena</h1>
      <p className="p-2 text-white">
        État de l'API backend : <strong>{apiStatus}</strong>
      </p>
	  <div className="mt-6 mb-8">
		<Link to="/play" className=" button-krystal px-10 py-4 text-[25px]">Jouer</Link>
	  </div>

	  <div className="p-5 w-[30%] h-[30%] bg-gris-krystal rounded-xl">
		<p className="text-white">
			Description du jeu
		</p>
	  </div>

    </section>
  );
}