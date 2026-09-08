// Page Amis — le troisième pilier du module « User interaction » du sujet,
// avec le chat et le profil : ajouter, retirer, et voir sa liste d'amis.
//
// Le back exposait déjà tout (backend/src/friends), mais rien ne l'appelait :
// sans écran, le module n'était pas démontrable.
//
// On interroge /friends/presence plutôt que /friends : même liste, plus le
// statut en ligne et le salon en cours de chacun. C'est ce qui rend la page
// vivante plutôt qu'un simple annuaire.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  accepterDemande,
  ajouterAmi,
  chercherJoueurs,
  demandesAmis,
  listeAmis,
  refuserDemande,
  retirerAmi,
  type Ami,
} from '../api/client';

/** Pastille de présence. Le back renvoie ONLINE, OFFLINE ou IN_GAME. */
function Presence({ statut }: { statut: string }) {
  const couleur =
    statut === 'ONLINE' ? 'bg-emerald-400'
    : statut === 'IN_GAME' ? 'bg-bleu-l'
    : 'bg-white/25';
  const libelle =
    statut === 'ONLINE' ? 'en ligne'
    : statut === 'IN_GAME' ? 'en partie'
    : 'hors ligne';
  return (
    <span className="flex items-center gap-2 text-xs text-white/50">
      <span className={`w-2 h-2 rounded-full ${couleur}`} aria-hidden="true" />
      {libelle}
    </span>
  );
}

const nomDe = (j: Ami) => j.displayName || j.email.split('@')[0];

export default function Friends() {
  const [amis, setAmis] = useState<Ami[]>([]);
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<Ami[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [demandesRecues, setDemandesRecues] = useState<(Ami & { id: string })[]>([]);
  const [demandesEnvoyees, setDemandesEnvoyees] = useState<(Ami & { id: string })[]>([]);

  const rafraichir = useCallback(() => {
    // Pas de console.error : une liste vide n'est pas une anomalie, et le
    // sujet exige une console vierge.
    listeAmis().then(setAmis).catch(() => setAmis([]));
  }, []);

  useEffect(rafraichir, [rafraichir]);

  const rafraichirDemandes = useCallback(() => {
    demandesAmis().then((demandes) => {
      setDemandesRecues(demandes.received);
      setDemandesEnvoyees(demandes.sent);
    }).catch(() => { setDemandesRecues([]); setDemandesEnvoyees([]); });
  }, []);

  useEffect(() => {
    rafraichirDemandes();
    window.dispatchEvent(new Event('factarena:friends-viewed'));
    const mettreAJourDemandes = (event: Event) => {
      // La demande est déjà visible sur cette page : elle ne doit pas laisser
      // une notification « ! » apparaître après navigation vers une autre page.
      window.dispatchEvent(new Event('factarena:friends-viewed'));
      const detail = (event as CustomEvent<{ type?: string; requestId?: string }>).detail;
      if (detail?.requestId && (detail.type === 'request_accepted' || detail.type === 'request_declined')) {
        setDemandesEnvoyees((precedentes) => precedentes.filter((demande) => demande.id !== detail.requestId));
        setMessage(null);
      }
      rafraichir();
      rafraichirDemandes();
    };
    window.addEventListener('factarena:friend-update', mettreAJourDemandes);
    return () => window.removeEventListener('factarena:friend-update', mettreAJourDemandes);
  }, [rafraichirDemandes]);

  useEffect(() => {
    const mettreAJourProfil = (event: Event) => {
      const profilMisAJour = (event as CustomEvent<{ id?: string; displayName?: string | null; avatarUrl?: string | null }>).detail;
      if (!profilMisAJour?.id) return;
      const mettreAJour = (joueurs: Ami[]) => joueurs.map((joueur) => joueur.id === profilMisAJour.id
        ? { ...joueur, displayName: profilMisAJour.displayName ?? joueur.displayName, avatarUrl: profilMisAJour.avatarUrl ?? joueur.avatarUrl }
        : joueur);
      setAmis(mettreAJour);
      setResultats(mettreAJour);
    };
    window.addEventListener('factarena:profile-update', mettreAJourProfil);
    return () => window.removeEventListener('factarena:profile-update', mettreAJourProfil);
  }, []);

  useEffect(() => {
    const mettreAJourPresence = (event: Event) => {
      const presence = (event as CustomEvent<{ userId?: string; status?: string; currentRoomId?: string | null }>).detail;
      if (!presence?.userId || !presence.status) return;
      setAmis((precedent) => precedent.map((ami) => ami.id === presence.userId
        ? { ...ami, status: presence.status as string, currentRoomId: presence.currentRoomId }
        : ami));
    };
    window.addEventListener('factarena:presence-update', mettreAJourPresence);
    return () => window.removeEventListener('factarena:presence-update', mettreAJourPresence);
  }, []);

  // Le back refuse une recherche de moins de deux caractères. On applique la
  // même règle ici pour ne pas provoquer un 400 à chaque frappe : la
  // validation est double, côté formulaire et côté serveur.
  async function chercher(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (recherche.trim().length < 2) {
      setMessage('Tape au moins deux caractères.');
      return;
    }
    try {
      const trouves = await chercherJoueurs(recherche.trim());
      setResultats(trouves);
      if (trouves.length === 0) setMessage('Aucun joueur trouvé.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Recherche impossible');
    }
  }

  async function ajouter(joueur: Ami) {
    setMessage(null);
    try {
      const resultat = await ajouterAmi(joueur.id);
      if (resultat.alreadyFriends) {
        setMessage('Déjà dans ta liste d\'amis.');
        return;
      }
      if (resultat.requestPending) {
        setMessage('Invitation envoyée, en attente de réponse.');
        setResultats((r) => r.filter((x) => x.id !== joueur.id));
        rafraichirDemandes();
        return;
      }
      setResultats((r) => r.filter((x) => x.id !== joueur.id));
      rafraichir();
    } catch (e) {
      // Cas courant : « Already friends ». On l'affiche plutôt que de laisser
      // le bouton sans effet apparent.
      setMessage(e instanceof Error ? e.message : 'Ajout impossible');
    }
  }

  async function accepter(request: Ami & { id: string }) {
    try {
      await accepterDemande(request.id);
      rafraichir();
      rafraichirDemandes();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Acceptation impossible'); }
  }

  async function refuser(request: Ami & { id: string }) {
    try {
      await refuserDemande(request.id);
      rafraichirDemandes();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Refus impossible'); }
  }

  async function retirer(joueur: Ami) {
    setMessage(null);
    try {
      await retirerAmi(joueur.id);
      rafraichir();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Suppression impossible');
    }
  }

  return (
    <section className="p-4 sm:p-8 bg-noir-krystal w-full min-h-full text-white">
      <h1 className="bg-grisclair-krystal text-[20px] px-8 py-2 inline-block font-semibold rounded-xl mb-6">
        Mes amis
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
        <div className="bg-gris-krystal rounded-xl p-6">
          <h2 className="font-semibold mb-4">
            Liste <span className="text-white/40 font-normal">({amis.length})</span>
          </h2>
          {demandesEnvoyees.length > 0 && (
            <div className="mb-4">
              <p className="text-white/50 text-sm mb-2">Invitations en attente</p>
              <ul className="flex flex-col gap-2">
                {demandesEnvoyees.map((demande) => (
                  <li key={demande.id} className="bg-noir-krystal rounded-xl p-3 flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">{nomDe(demande)}</span>
                    <span className="text-xs text-white/40 shrink-0">en attente...</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {amis.length === 0 ? (
            <p className="text-white/30 text-sm">
              Personne pour l'instant. Cherche un joueur par son e-mail à droite.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {amis.map((ami) => (
                <li
                  key={ami.id}
                  className="bg-noir-krystal rounded-xl p-3 flex items-center gap-3"
                >
                  {ami.avatarUrl ? (
                    <img src={ami.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-grisclair-krystal flex items-center justify-center text-sm font-semibold shrink-0">
                      {nomDe(ami).charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/profile/${ami.id}`}
                      className="block truncate text-sm font-semibold hover:text-bleu-l hover:underline"
                    >
                      {nomDe(ami)}
                    </Link>
                    <Presence statut={ami.status} />
                  </div>
                  {/* Un ami en partie est rejoignable d'un clic : c'est tout
                      l'intérêt d'afficher la présence. */}
                  {ami.currentRoomId && (
                    <Link
                      to={`/room/${ami.currentRoomId}`}
                      className="text-xs text-bleu-l hover:underline shrink-0"
                    >
                      rejoindre
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => retirer(ami)}
                    className="text-xs text-white/30 hover:text-red-l shrink-0"
                    aria-label={`Retirer ${nomDe(ami)} de mes amis`}
                  >
                    retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-gris-krystal rounded-xl p-6">
          {demandesRecues.length > 0 && (
            <div className="mb-6">
              <h2 className="font-semibold mb-3">Invitations reçues</h2>
              <ul className="flex flex-col gap-2">
                {demandesRecues.map((demande) => (
                  <li key={demande.id} className="bg-noir-krystal rounded-xl p-3 flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{nomDe(demande)}</span>
                    <button type="button" onClick={() => accepter(demande)} className="text-xs text-bleu-l hover:underline shrink-0">accepter</button>
                    <button type="button" onClick={() => refuser(demande)} className="text-xs text-white/40 hover:text-red-l shrink-0">refuser</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h2 className="font-semibold mb-4">Ajouter un ami</h2>
          <form onSubmit={chercher} className="flex gap-2 mb-4">
            <label htmlFor="recherche" className="sr-only">
              Chercher un joueur
            </label>
            <input
              id="recherche"
              type="text"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="e-mail ou pseudo"
              minLength={2}
              maxLength={60}
              // Voir Chat.tsx : sans min-w-0 le champ ne rétrécit pas et le
              // bouton « chercher » sort de l'écran sur un petit téléphone.
              className="flex-1 min-w-0 bg-noir-krystal rounded-lg px-3 py-2 text-sm outline-none placeholder:text-white/25"
            />
            <button type="submit" className="button-blue-d px-4 py-2 text-sm">
              chercher
            </button>
          </form>

          {message && <p className="text-red-l text-sm mb-3">{message}</p>}

          <ul className="flex flex-col gap-2">
            {resultats.map((joueur) => (
              <li
                key={joueur.id}
                className="bg-noir-krystal rounded-xl p-3 flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{nomDe(joueur)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => ajouter(joueur)}
                  className="text-xs text-bleu-l hover:underline shrink-0"
                  aria-label={`Ajouter ${nomDe(joueur)} à mes amis`}
                >
                  ajouter
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
