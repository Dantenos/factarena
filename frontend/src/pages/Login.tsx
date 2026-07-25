// Page Connexion — vide pour l'instant (le formulaire d'auth viendra plus tard).
export default function Login() {

function handleClick() {
	
}


return (
	<section className="bg-noir-krystal w-full flex-1 flex justify-center items-center">
	<div className="p-5 w-[30%] h-[30%] bg-gris-krystal rounded-xl">
		<form className="font-semibold text-white text-[114%]">
			<label htmlFor="UserName" className="font-montserrat">
				Nom d'utilisateur
			</label>
			<input type="text" id="UserName" name="UserName"/>
			<label htmlFor="PassWord" className="font-montserrat">
				Mot de passe
			</label>
			<input type="password" id="PassWord" name="PassWord"/>
		</form>
	</div>
</section>
  )
}
