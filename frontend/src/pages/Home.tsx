import { Link } from 'react-router-dom';

export default function Home() {
  return (
	<section className="grid w-full grid-cols-1 lg:grid-cols-2 gap-8 p-4 sm:p-8 bg-noir-krystal min-h-full">

		<div className="order-1 min-w-0 lg:row-start-1">
			<h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-7xl xl:text-8xl 2xl:text-9xl font-bold text-white mt-2 whitespace-nowrap">FactArena</h1>
			<div className="mt-6 mb-8">
				<Link to="/play" className="button-blue-d px-10 sm:px-15 py-3 text-2xl sm:text-[30px]">Jouer</Link>
			</div>
		</div>

		<div className="order-2 min-w-0 lg:row-start-1 p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-2 gap-4 text-white bg-gris-krystal rounded-xl mb-2">
			<div className="min-w-0 lg:col-start-1 lg:row-start-1 bg-noir-krystal rounded-xl p-5">
				<h2 className="font-semibold mb-1">Le but du jeu</h2>
				<p className="text-white/60 text-sm">
					Regarde 5 vidéos et détermine si, selon toi, l’information est authentique
					ou s’il s’agit d’une fake news ! Mais avant cela, parie sur le nombre de
					bonnes réponses que tu penses obtenir. À toi de jouer !
				</p>
			</div>
			<div className="min-w-0 lg:col-start-2 lg:row-start-2 bg-noir-krystal rounded-xl p-5">
				<h2 className="font-semibold mb-1">Ne suis pas le chat</h2>
				<p className="text-white/60 text-sm">
					La room peut accueillir jusqu’à 5 joueurs, qui peuvent discuter sur le chat
					pendant la partie. Mais attention : ils peuvent essayer de t’induire en
					erreur ! Un assistant IA est également présent. Tu peux lui poser des
					questions, mais il ne te donnera pas la réponse.
				</p>
			</div>
			<div className="min-w-0 lg:col-start-1 lg:row-start-3 bg-noir-krystal rounded-xl p-5">
				<h2 className="font-semibold mb-1">Le pot va au plus juste</h2>
				<p className="text-white/60 text-sm">
					Après la révélation, chaque verdict est expliqué et sourcé. Les joueurs
					ayant le plus souvent vu juste remportent la mise commune !
				</p>
			</div>
		</div>

    </section>
  );
}
