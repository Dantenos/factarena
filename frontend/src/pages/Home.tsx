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
	<section className="grid w-full grid-cols-1 lg:grid-cols-2 gap-8 p-4 sm:p-8 bg-noir-krystal min-h-full">

		<div className="">
			<h1 className="text-5xl sm:text-7xl lg:text-9xl font-bold text-white mt-2">FactArena</h1>
			<p className="p-2 text-white">
				État de l'API backend : <strong>{apiStatus}</strong>
			</p>
			<div className="mt-6 mb-8">
				<Link to="/play" className="button-blue-d px-10 sm:px-15 py-3 text-2xl sm:text-[30px]">Jouer</Link>
			</div>
		</div>

		<div className="p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-2 gap-4 text-white lg:h-[80%] bg-gris-krystal rounded-xl mb-2">
			<div className="lg:col-start-1 lg:row-start-1 bg-noir-krystal rounded-xl p-5">
				<h2 className="font-semibold mb-1">Regarde, puis tranche</h2>
				<p className="text-white/60 text-sm">
					Dix extraits s'enchaînent. Pour chacun, un seul choix : l'information
					est authentique, ou c'est une intox.
				</p>
			</div>
			<div className="lg:col-start-2 lg:row-start-2 bg-noir-krystal rounded-xl p-5">
				<h2 className="font-semibold mb-1">Ne suis pas le chat</h2>
				<p className="text-white/60 text-sm">
					D'autres joueurs commentent en direct, et certains se trompent avec
					aplomb. L'assistant, lui, cite ses sources — mais il refuse de parler
					des clips en cours.
				</p>
			</div>
			<div className="lg:col-start-1 lg:row-start-3 bg-noir-krystal rounded-xl p-5">
				<h2 className="font-semibold mb-1">Le pot va au plus juste</h2>
				<p className="text-white/60 text-sm">
					À la révélation, chaque verdict est expliqué et sourcé. Celui qui a vu
					juste le plus souvent remporte la mise commune.
				</p>
			</div>
		</div>

    </section>
  );
}