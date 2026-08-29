import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  const emplacement = useLocation();
  const { seConnecter, sInscrire } = useAuth();

  const [modeInscription, setModeInscription] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);

    const donnees = new FormData(event.currentTarget);
    const email = String(donnees.get('email') ?? '').trim();
    const motDePasse = String(donnees.get('password') ?? '');

    setEnvoiEnCours(true);
    try {
      if (modeInscription) await sInscrire(email, motDePasse);
      else await seConnecter(email, motDePasse);

      // Retour sur la page initialement demandée (posée par ProtectedRoute),
      // ou le profil par défaut.
      const destination = (emplacement.state as { depuis?: string } | null)?.depuis;
      navigate(destination ?? '/profile', { replace: true });
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
    <section className="relative bg-noir-krystal w-full flex-1 flex flex-col items-center">
      <h1 className="text-white font-semibold text-lg mb-2">
        {modeInscription ? 'Inscription' : 'Connexion'}
      </h1>

      <div className="p-5 w-[30%] min-w-[320px] bg-gris-krystal text-white rounded-xl">
        <form onSubmit={handleSubmit} className="text-white gap-1 items-center">
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
          </div>

          {/* role="alert" : le message est annoncé aux lecteurs d'écran
              (accessibilité demandée par le sujet). */}
          {erreur && (
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
            onClick={() => { setModeInscription((v) => !v); setErreur(null); }}
            className="text-bleu-l hover:underline font-semibold"
          >
            {modeInscription ? 'Se connecter' : 'Inscris-toi'}
          </button>
        </div>
      </div>
    </section>
  );
}
