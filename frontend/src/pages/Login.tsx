import { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const AUTH_KEY = 'LoggedIn';

export default function Login() {
	const navigate = useNavigate();

function handleSubmit(event: FormEvent<HTMLFormElement>) {
	event.preventDefault();

	//for now on simule la connection: true = login, false = logout
	localStorage.setItem(AUTH_KEY, 'true');

	//redirection apres connexion
	navigate('/profile');
	
}


return (
	<section className="relative bg-noir-krystal w-full flex-1 flex flex-col items-center">
		<h1 className="text-white font-semibold text-lg mb-2">Connexion</h1>

		<div className="p-5 w-[30%] h-[50%] bg-gris-krystal text-white rounded-xl">
			<form onSubmit={handleSubmit} className="text-white gap-1 items-center">

				<div className=" flex mt-6 flex-col">
					<label htmlFor="UserName" className="font-semibold">Nom d'utilisateur</label>
					<input
						type="text"
						id="UserName"
						name="UserName"
						className="bg-grisclair-krystal py-1 rounded-md"
						required
					/>
				</div>

				<div className= "flex mt-6 flex-col">
					<label htmlFor="PassWord" className="font-semibold">Mot de passe</label>
					<input
						type="password"
						id="PassWord"
						name="PassWord"
						className="bg-grisclair-krystal py-1 rounded-md"
						required
					/>
				</div>

				<button type="submit" className="mt-8 button-blue-d px-6 py-2">
					Se connecter
				</button>
			</form>
		</div>

		<div className="flex flex-row items-center gap-4">
			<h1 className="absolute bottom-40 left-160 text-white">Pas de compte ?</h1>
			{/* Pour le moment redirige a login mais devrai redirigier a un formulaire d'inscription*/}
			<Link to="/login" className="absolute bottom-38 right-160 text-bleu-d hover:underline font-semibold px-6 py-2">
				Inscris-toi
			</Link>
		</div>
	</section>
  )
}
