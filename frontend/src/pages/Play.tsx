import { Outlet, Link } from 'react-router-dom';

export default function Play() {
  return (
    <section className="bg-noir-krystal w-full min-h-full flex flex-col items-center justify-center">
      <h1 className="text-white text-4xl font-bold">Jouer</h1>

      <Link to="room" className="mt-6 px-4 py-2 rounded bg-grisclair-krystal text-white">
        Entrer dans la salle
      </Link>

      <Outlet />
    </section>
  );
}