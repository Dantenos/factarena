import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// Page de connexion, branchée sur le VRAI back.
//
// Deux changements par rapport à la version d'origine :
// - le champ demandait un « nom d'utilisateur », mais le back attend un EMAIL
//   (cf. LoginDto) : le formulaire aurait été refusé côté serveur ;
// - la connexion ne se contente plus d'écrire un drapeau dans le localStorage,
//   elle récupère un vrai jeton JWT sans lequel aucune requête authentifiée
//   ni aucune connexion WebSocket n'est possible.
//
// Le même formulaire sert à la connexion et à l'inscription : le back impose un
// mot de passe d'au moins 8 caractères, on le signale AVANT l'envoi plutôt que
// de laisser l'utilisateur découvrir l'erreur après coup.
export default function Login() {
  const navigate = useNavigate();
  const { seConnecter, sInscrire } = useAuth();

  const [modeInscription, setModeInscription] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champManquant, setChampManquant] = useState<'displayName' | 'email' | 'password' | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);
    setChampManquant(null);

    const donnees = new FormData(event.currentTarget);
    const email = String(donnees.get('email') ?? '').trim();
    const motDePasse = String(donnees.get('password') ?? '');
    const pseudo = String(donnees.get('displayName') ?? '').trim();

    if (modeInscription && !pseudo) {
      setChampManquant('displayName');
      return;
    }
    if (modeInscription && (pseudo.length < 2 || pseudo.length > 30)) {
      setErreur('Le pseudo doit faire entre 2 et 30 caractères.');
      return;
    }
    if (!email) {
      setChampManquant('email');
      return;
    }
    const champEmail = event.currentTarget.elements.namedItem('email') as HTMLInputElement | null;
    const partieLocale = email.split('@')[0] ?? '';
    const formatEmailValide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!champEmail?.validity.valid || !formatEmailValide || partieLocale.length > 64 || email.length > 254) {
      setErreur('L’adresse e-mail doit être valide.');
      return;
    }
    if (!motDePasse) {
      setChampManquant('password');
      return;
    }
    if (motDePasse.length < 8) {
      setErreur('Le mot de passe doit faire au moins 8 caractères.');
      return;
    }

    setEnvoiEnCours(true);
    try {
      if (modeInscription) await sInscrire(email, motDePasse, pseudo);
      else await seConnecter(email, motDePasse);

      // Après chaque connexion ou inscription, on revient toujours à l'accueil.
      navigate('/', { replace: true });
    } catch (e) {
      // Message du back (identifiants invalides, email déjà pris, mot de passe
      // trop court...). On l'affiche à l'utilisateur au lieu de le passer en
      // console : une erreur console serait éliminatoire, et surtout invisible
      // pour lui.
      setErreur(e instanceof Error ? e.message : 'Connexion impossible');
    } finally {
      setEnvoiEnCours(false);
    }
  }

  return (
    <section className="relative bg-noir-krystal w-full flex-1 flex flex-col items-center px-4">
      <h1 className="text-white font-semibold text-lg mb-2">
        {modeInscription ? 'Inscription' : 'Connexion'}
      </h1>

      <div className="p-5 w-full max-w-sm md:w-[30%] md:max-w-none md:min-w-[320px] bg-gris-krystal text-white rounded-xl">
        <form onSubmit={handleSubmit} noValidate className="text-white gap-1 items-center">
          {modeInscription && (
            <div className="flex mt-6 flex-col">
              <label htmlFor="displayName" className="font-semibold">Pseudo</label>
              <input
                type="text"
                id="displayName"
                name="displayName"
                minLength={2}
                maxLength={30}
                autoComplete="username"
                className="bg-grisclair-krystal py-1 rounded-md px-2"
                required
              />
              <span className="text-xs text-gray-400 mt-1">2 à 30 caractères</span>
              {champManquant === 'displayName' && (
                <p role="alert" className="text-red-l text-xs mt-1">Veuillez renseigner ce champ.</p>
              )}
              {erreur === 'Le pseudo doit faire entre 2 et 30 caractères.' && (
                <p role="alert" className="text-red-l text-xs mt-1">{erreur}</p>
              )}
            </div>
          )}

          <div className="flex mt-6 flex-col">
            <label htmlFor="email" className="font-semibold">Adresse e-mail</label>
            <input
              type="email"
              id="email"
              name="email"
              autoComplete="email"
              className="bg-grisclair-krystal py-1 rounded-md px-2"
              required
            />
            {(champManquant === 'email' || erreur === 'L’adresse e-mail doit être valide.') && (
              <p role="alert" className="text-red-l text-xs mt-1">
                {champManquant === 'email' ? 'Veuillez renseigner ce champ.' : erreur}
              </p>
            )}
          </div>

          <div className="flex mt-6 flex-col">
            <label htmlFor="password" className="font-semibold">Mot de passe</label>
            <input
              type="password"
              id="password"
              name="password"
              // Validation côté FRONT en plus du back : le sujet exige les deux.
              minLength={8}
              maxLength={128}
              autoComplete={modeInscription ? 'new-password' : 'current-password'}
              className="bg-grisclair-krystal py-1 rounded-md px-2"
              required
            />
            <span className="text-xs text-gray-400 mt-1">8 caractères minimum</span>
            {(champManquant === 'password' || erreur === 'Le mot de passe doit faire au moins 8 caractères.') && (
              <p role="alert" className="text-red-l text-xs mt-1">
                {champManquant === 'password' ? 'Veuillez renseigner ce champ.' : erreur}
              </p>
            )}
          </div>

          {/* role="alert" : le message est annoncé aux lecteurs d'écran
              (accessibilité demandée par le sujet). */}
          {/* Connexion 42 (module OAuth du sujet). Un lien, pas un fetch : le
              back redirige vers 42, qui redirige à son tour vers le callback.
              Une requête XHR ne peut pas suivre ce parcours. On sort donc du
              routeur React avec une navigation complète. */}
          <a
            href="/api/auth/42"
            className="mt-3 button-blue-l px-4 py-2 text-sm block text-center"
          >
            Se connecter avec 42
          </a>

          {erreur && erreur !== 'L’adresse e-mail doit être valide.' && erreur !== 'Le mot de passe doit faire au moins 8 caractères.' && erreur !== 'Le pseudo doit faire entre 2 et 30 caractères.' && (
            <p role="alert" className="mt-4 text-red-l text-sm">{erreur}</p>
          )}

          <button
            type="submit"
            disabled={envoiEnCours}
            className="mt-8 button-blue-d px-6 py-2 disabled:opacity-50"
          >
            {envoiEnCours ? 'Envoi...' : modeInscription ? "S'inscrire" : 'Se connecter'}
          </button>
        </form>

        <div className="flex flex-row items-center gap-3 mt-6 text-sm">
          <span>{modeInscription ? 'Déjà un compte ?' : 'Pas de compte ?'}</span>
          <button
            type="button"
            onClick={() => { setModeInscription((v) => !v); setErreur(null); setChampManquant(null); }}
            className="text-bleu-l hover:underline font-semibold"
          >
            {modeInscription ? 'Se connecter' : 'Inscris-toi'}
          </button>
        </div>
      </div>
    </section>
  );
}
