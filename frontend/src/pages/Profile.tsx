// Page Profil — vide pour l'instant.
import { Outlet, Link } from 'react-router-dom';

export default function Profile() {
  return (
	<section className="grid grid-cols-5 p-8 bg-noir-krystal w-full min-h-full">
		<div className="grid grid-rows-3 col-span-2 col start-1 gap-4 p-8 bg-gris-krystal text-white rounded-xl">
			<p className="row-start-1 bg-noir-krystal rounded-xl">
				pp / pseudo/ modifier profil
			</p>
			<p className="row-start-2 bg-noir-krystal rounded-xl">
				Meilleur score:
			</p>
			<p className="row-start-3 bg-noir-krystal rounded-xl">
				Nombre de partie jouee:
			</p>
		</div>

		<div className="grid grid-rows-3 col-span-1 justify-center items-center">
			<Link to="/play" className=" row-start-2 button-blue-d px-15 py-3 text-[30px]">Jouer</Link>
		</div>

		<div className="col-span-2 col-start-4">
			<h1 className="bg-grisclair-krystal text-[20px] px-8 py-2 w-[46%] text-white font-semibold rounded-xl">
				Top players
			</h1>
			<div className="grid grid-cols-3 grid-rows-5 p-8 gap-2 bg-gris-krystal h-[92%] rounded-xl">
				<p className="col-start-1 col-end-1 row-start-2 row-span-4 bg-noir-krystal rounded-xl text-white">
					pp pseudo : score
				</p>
				<p className="col-start-2 col-end-2 row-start-3 row-span-3 bg-noir-krystal rounded-xl text-white">
					pp pseudo : score
				</p>
				<p className="col-start-3 col-end-3 row-start-4 row-span-2 bg-noir-krystal rounded-xl text-white">
					pp pseudo : score
				</p>
			</div>
		</div>
		{/* <Outlet></Outlet> */}
	</section>
  );
}
