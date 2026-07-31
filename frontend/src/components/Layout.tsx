import { Outlet, Link, useNavigate } from 'react-router-dom';
import Footer from './Footer';
import { useEffect, useState } from 'react';

const AUTH_KEY = 'LoggedIn';

export default function Layout() {
	const navigate = useNavigate();
	const [LoggedIn, setLoggedIn] = useState(false);

	useEffect(() => {setLoggedIn(localStorage.getItem(AUTH_KEY) === 'true');}, []);

	function handleLogout() {
		localStorage.removeItem(AUTH_KEY);
		setLoggedIn(false);
		navigate('/');
	}

	return (
		<div className="min-h-screen flex flex-col">
		<header className="p-8 relative bg-noir-krystal p-2">
			<nav className="font-semibold text-white flex gap-4">
			<Link to="/" className= "text-lg button-blue-d px-5 py-1">Accueil</Link>
			{!LoggedIn && (
				<>
					<Link to="/login" className="text-lg absolute right-8 button-blue-d px-5 py-1">Connexion</Link>
				</>
			)}

			{LoggedIn && (
				<>
					<Link to="/profile" className="text-lg button-blue-d px-5 py-1">Profil</Link>
					<button
						type="button" 
						className="text-lg absolute right-8 button-red-d px-5 py-1"
						onClick={handleLogout}>Deconnexion
					</button>
				</>
			)}
			</nav>
		</header>

		<main className="flex-1 flex">
			<Outlet />
		</main>

		<Footer />
		</div>
	);
}
