import { Outlet, Link } from 'react-router-dom';

export default function Play() {
  return (
    <section className="grid gap-4 grid-col-2 p-8 bg-noir-krystal w-full min-h-full">

		<div className="col-span-1 col-start-1">
			<h1 className="bg-grisclair-krystal text-[20px] px-8 py-2 w-[46%] text-white font-semibold rounded-xl">
				Rejoindre une room
			</h1>
			<div className="p-8 gap-2 bg-gris-krystal h-[92%] rounded-xl">
				<p className="bg-noir-krystal rounded-xl text-white">
					room1, 2, 3...
				</p>
			</div>
		</div>

		<div className="flex flex-col gap-4 justify-center col-start-2 p-8">
			<p className=" text-white text-xl flex justify-center">
				guest ou pseudo
			</p>
			<Link 
				to="/room"
				className=" flex items-center px-10 py-10 button-blue-d text-xl">
				Créer une room
			</Link>
		</div>

		{/* <Outlet></Outlet> */}
    </section>
  );
}