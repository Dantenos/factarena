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
	<section className="grid w-full grid-cols-2 gap-8 p-8 bg-noir-krystal min-h-full">

		<div className="">
			<h1 className="text-9xl font-bold text-white mt-2">FactArena</h1>
			<p className="p-2 text-white">
				État de l'API backend : <strong>{apiStatus}</strong>
			</p>
			<div className="mt-6 mb-8">
				<Link to="/play" className=" button-blue-d px-15 py-3 text-[30px]">Jouer</Link>
			</div>
		</div>

		<div className="p-8 grid grid-cols-2 grid-row-3 gap-4 text-white h-[80%] bg-gris-krystal rounded-xl mb-2">
			<p className="col-start-1 row-start-1 text-white bg-noir-krystal rounded-xl">
				regle 1
			</p>
			<p className="col-start-2 row-start-2 text-white bg-noir-krystal rounded-xl">
				regle 2
			</p>
			<p className="col-start-1 row-start-3 text-white bg-noir-krystal rounded-xl">
				regle 3
			</p>
		</div>

    </section>
  );
}