// Page Profil. La maquette affichait des libellés sans valeurs : on garde la
// grille et on la remplit avec /stats/me et /stats/leaderboard, qui existent
// déjà côté back (backend/src/stats/).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, chercherJoueurs, envoyerAvatar, modifierProfil, reclamerRattrapage } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/** Profil réduit renvoyé par le back à l'intérieur des statistiques. */
interface ProfilJoueur {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/** Retour de /stats/me — voir StatsService.computeStats côté back. */
interface Stats {
  user: ProfilJoueur;
  virtualBalance: number;
  roundsPlayed: number;
  victories: number;
  defeats: number;
  totalStake: number;
  totalPayout: number;
  netGain: number;
  winRate: number;
}

/** Une ligne de /stats/leaderboard, déjà triée et numérotée par le back. */
interface LigneClassement extends Stats {
  rank: number;
}

/**
 * Une manche jouée, telle que /stats/me/round-history la renvoie : une mise,
 * et la manche à laquelle elle se rattache avec les mises de tous les joueurs.
 * C'est de là que sortent les adversaires — le back ne les liste pas à part.
 */
interface MancheJouee {
  id: string;
  stake: number;
  payout: number | null;
  result: 'WIN' | 'LOSS' | null;
  createdAt: string;
  round: {
    id: string;
    revealedAt: string | null;
    createdAt: string;
    room: { id: string; name: string } | null;
    bets: { userId: string; result: 'WIN' | 'LOSS' | null; user: ProfilJoueur }[];
  };
}

// Même valeur que LedgerService.SEUIL_RATTRAPAGE côté serveur, qui tranche
// vraiment : ici on ne fait qu'éviter d'afficher un bouton voué au refus.
const SEUIL_RATTRAPAGE = 50;

export default function Profile() {
  const { userId } = useParams<{ userId: string }>();
  const { utilisateur, rafraichir } = useAuth();
  const profilId = userId ?? utilisateur?.id;
  const estMonProfil = !userId || userId === utilisateur?.id;
  const [stats, setStats] = useState<Stats | null>(null);
  const [podium, setPodium] = useState<LigneClassement[]>([]);
  const [historique, setHistorique] = useState<MancheJouee[]>([]);
  // Édition du pseudo : fermée par défaut, pour que la page reste une fiche
  // qu'on lit plutôt qu'un formulaire.
  const [edition, setEdition] = useState(false);
  const [nouveauPseudo, setNouveauPseudo] = useState('');
  const [messageProfil, setMessageProfil] = useState<string | null>(null);
  const [rattrapageEnCours, setRattrapageEnCours] = useState(false);

  // On ne peut plus miser sous ce seuil : c'est la plus petite mise proposée
  // dans le salon, et le back applique la même règle.
  async function rattraper() {
    setRattrapageEnCours(true);
    setMessageProfil(null);
    try {
      const r = await reclamerRattrapage();
      setStats((prec) => (prec ? { ...prec, virtualBalance: r.virtualBalance } : prec));
    } catch (e) {
      setMessageProfil(e instanceof Error ? e.message : 'Rattrapage impossible');
    } finally {
      setRattrapageEnCours(false);
    }
  }

  useEffect(() => {
    if (!profilId) return;
    // Pas de console.error dans les catch : une statistique indisponible n'est
    // pas une erreur de l'application, et le sujet exige une console vierge.
    const cheminProfil = userId ? `/stats/users/${userId}` : '/stats/me';
    const cheminHistorique = userId ? `/stats/users/${userId}/round-history` : '/stats/me/round-history';
    api<Stats>(cheminProfil).then(setStats).catch(() => setStats(null));
    api<LigneClassement[]>('/stats/leaderboard')
      // Le back renvoie tout le monde, classé. On n'affiche que le podium.
      .then((liste) => setPodium(liste.slice(0, 3)))
      .catch(() => setPodium([]));
    // Le module « statistiques » du sujet demande l'historique des parties, pas
    // seulement les totaux : dates, résultats et adversaires.
    api<MancheJouee[]>(cheminHistorique)
      .then(setHistorique)
      .catch(() => setHistorique([]));
  }, [profilId, userId]);

  useEffect(() => {
    if (!profilId) return;
    const mettreAJourHistorique = () => {
      const chemin = userId ? `/stats/users/${userId}/round-history` : '/stats/me/round-history';
      api<MancheJouee[]>(chemin).then(setHistorique).catch(() => undefined);
    };
    window.addEventListener('factarena:history-update', mettreAJourHistorique);
    return () => window.removeEventListener('factarena:history-update', mettreAJourHistorique);
  }, [profilId, userId]);

  useEffect(() => {
    const mettreAJourSolde = (event: Event) => {
      const soldeMisAJour = (event as CustomEvent<{ userId?: string; virtualBalance?: number }>).detail;
      if (soldeMisAJour?.userId !== profilId || typeof soldeMisAJour.virtualBalance !== 'number') return;
      setStats((precedent) => precedent
        ? { ...precedent, virtualBalance: soldeMisAJour.virtualBalance }
        : precedent);
    };
    window.addEventListener('factarena:balance-update', mettreAJourSolde);
    return () => window.removeEventListener('factarena:balance-update', mettreAJourSolde);
  }, [profilId]);

  useEffect(() => {
    const mettreAJourProfil = (event: Event) => {
      const profilMisAJour = (event as CustomEvent<{ id?: string; displayName?: string | null; avatarUrl?: string | null }>).detail;
      if (!profilMisAJour?.id) return;
      setStats((precedent) => precedent && precedent.user.id === profilMisAJour.id
        ? { ...precedent, user: { ...precedent.user, displayName: profilMisAJour.displayName ?? precedent.user.displayName, avatarUrl: profilMisAJour.avatarUrl ?? precedent.user.avatarUrl } }
        : precedent);
      setPodium((precedent) => precedent.map((ligne) => ligne.user.id === profilMisAJour.id
        ? { ...ligne, user: { ...ligne.user, displayName: profilMisAJour.displayName ?? ligne.user.displayName } }
        : ligne));
    };
    window.addEventListener('factarena:profile-update', mettreAJourProfil);
    return () => window.removeEventListener('factarena:profile-update', mettreAJourProfil);
  }, []);

  useEffect(() => {
    const mettreAJourClassement = (event: Event) => {
      const classement = (event as CustomEvent<LigneClassement[]>).detail;
      if (!Array.isArray(classement)) return;
      setPodium(classement.slice(0, 3));
      setStats((precedent) => {
        if (!precedent) return precedent;
        const ligne = classement.find((entree) => entree.user.id === precedent.user.id);
        return ligne ? { ...precedent, ...ligne } : precedent;
      });
    };
    window.addEventListener('factarena:leaderboard-update', mettreAJourClassement);
    return () => window.removeEventListener('factarena:leaderboard-update', mettreAJourClassement);
  }, []);

  const nomDe = (profil?: ProfilJoueur | null, secours?: string) =>
    profil?.displayName || profil?.email?.split('@')[0]?.slice(0, 30) || secours || 'joueur';
  const pseudo = nomDe(
    stats?.user,
    estMonProfil ? utilisateur?.displayName || utilisateur?.email?.split('@')[0]?.slice(0, 30) : undefined,
  );

  // Le back borne déjà le pseudo, on applique la même règle ici : la
  // validation est double, formulaire et serveur.
  async function enregistrerPseudo(event: React.FormEvent) {
    event.preventDefault();
    setMessageProfil(null);
    const valeur = nouveauPseudo.trim();
    if (valeur.length < 2 || valeur.length > 30) {
      setMessageProfil('Le pseudo doit faire entre 2 et 30 caractères.');
      return;
    }
    try {
      // Vérification préalable pour éviter une requête PATCH vouée à renvoyer
      // 400 et donc affichée comme erreur par le navigateur. Le back conserve
      // sa contrainte unique pour gérer les courses entre deux requêtes.
      const joueursCorrespondants = await chercherJoueurs(valeur);
      const pseudoDejaUtilise = joueursCorrespondants.some((joueur) =>
        joueur.displayName?.toLocaleLowerCase() === valeur.toLocaleLowerCase(),
      );
      if (pseudoDejaUtilise) {
        setMessageProfil('Pseudo déjà utilisé par un autre joueur.');
        return;
      }
      await modifierProfil({ displayName: valeur });
      // La fiche utilise stats.user en priorité pour afficher le pseudo.
      // Mettre aussi cette copie locale à jour évite d'attendre un rechargement
      // de /stats/me pour voir le nouveau pseudo sur la page Profil.
      setStats((precedent) => precedent
        ? { ...precedent, user: { ...precedent.user, displayName: valeur } }
        : precedent);
      setPodium((precedent) => precedent.map((ligne) => (
        ligne.user.id === utilisateur?.id
          ? { ...ligne, user: { ...ligne.user, displayName: valeur } }
          : ligne
      )));
      await rafraichir();
      setEdition(false);
    } catch (e) {
      setMessageProfil(e instanceof Error ? e.message : 'Modification impossible');
    }
  }

  async function choisirAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const fichier = event.target.files?.[0];
    if (!fichier) return;
    setMessageProfil(null);
    try {
      if (!['image/png', 'image/jpeg'].includes(fichier.type)) {
        setMessageProfil('Format accepté : PNG ou JPEG/JPG.');
        return;
      }
      if (fichier.size > 5 * 1024 * 1024) {
        setMessageProfil('Le fichier avatar ne doit pas dépasser 5 Mo.');
        return;
      }
      const url = URL.createObjectURL(fichier);
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('Image invalide.'));
        image.src = url;
      }).finally(() => URL.revokeObjectURL(url));
      if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 2048 || dimensions.height > 2048 || dimensions.width * dimensions.height > 4_000_000) {
        setMessageProfil('Les dimensions de l’avatar ne doivent pas dépasser 2048 × 2048 pixels.');
        return;
      }
      await envoyerAvatar(fichier);
      await rafraichir();
    } catch (e) {
      setMessageProfil(e instanceof Error ? e.message : 'Envoi impossible');
    } finally {
      // On vide le champ, sinon resélectionner le même fichier ne déclenche
      // aucun événement.
      event.target.value = '';
    }
  }

  // Hauteur des marches : la première est la plus haute. On garde les
  // positions de la maquette, seul le contenu change.
  const marches = [
    'col-start-1 col-end-1 row-start-2 row-span-4',
    'col-start-2 col-end-2 row-start-3 row-span-3',
    'col-start-3 col-end-3 row-start-4 row-span-2',
  ];

  return (
    <section className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-0 p-4 sm:p-8 bg-noir-krystal w-full min-h-full">
      {/* min-w-0 sur les trois cartes : un item de grille a min-width:auto et
          refuse de descendre sous la largeur intrinsèque de son contenu. Sans
          ça la fiche débordait de la colonne sur un écran de 320 px. */}
      <div className="grid gap-4 p-4 sm:p-8 lg:grid-rows-3 lg:col-span-2 lg:col-start-1 bg-gris-krystal text-white rounded-xl">
        <div className="min-w-0 lg:row-start-1 bg-noir-krystal rounded-xl p-4 flex items-center gap-4">
          {stats?.user.avatarUrl ? (
            <img src={stats.user.avatarUrl} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
          ) : (
            // Pas d'avatar : une initiale plutôt qu'une image cassée.
            <span className="w-14 h-14 rounded-full bg-grisclair-krystal flex items-center justify-center text-xl font-semibold shrink-0">
              {pseudo.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {estMonProfil && edition ? (
              <form onSubmit={enregistrerPseudo} className="flex gap-2 items-center">
                <label htmlFor="pseudo" className="sr-only">Nouveau pseudo</label>
                <input
                  id="pseudo"
                  type="text"
                  value={nouveauPseudo}
                  onChange={(e) => setNouveauPseudo(e.target.value)}
                  minLength={2}
                  maxLength={30}
                  required
                  className="bg-grisclair-krystal rounded-lg px-2 py-1 text-sm outline-none min-w-0 flex-1"
                />
                <button type="submit" className="text-xs text-bleu-l hover:underline shrink-0">ok</button>
                <button
                  type="button"
                  onClick={() => { setEdition(false); setMessageProfil(null); }}
                  className="text-xs text-white/30 hover:text-white shrink-0"
                >
                  annuler
                </button>
              </form>
            ) : (
              /* La troncature ne porte que sur le pseudo. Quand elle englobait
                 aussi le bouton, un pseudo un peu long le rejetait au-delà de
                 la coupure : invisible, et surtout impossible à cliquer. */
              <p className="font-semibold flex items-center gap-2 min-w-0">
                <span className="truncate">{pseudo}</span>
                {estMonProfil && (
                  <button
                    type="button"
                    onClick={() => { setNouveauPseudo(pseudo); setEdition(true); }}
                    className="text-xs text-white/30 hover:text-white font-normal shrink-0"
                  >
                    modifier
                  </button>
                )}
              </p>
            )}
            <p className="text-white/40 text-sm">
              {stats ? `${stats.virtualBalance} crédits` : '—'}
            </p>
            {/* Sous la mise minimale, le compte était enfermé : plus rien à
                engager, donc plus aucun gain possible, et rien pour remonter. */}
            {estMonProfil && stats && stats.virtualBalance < SEUIL_RATTRAPAGE && (
              <button
                type="button"
                onClick={rattraper}
                disabled={rattrapageEnCours}
                className="button-blue-l px-3 py-1 text-xs mt-1 disabled:opacity-50"
              >
                {rattrapageEnCours ? '...' : 'Réclamer 250 crédits'}
              </button>
            )}
            {/* L'envoi part dès la sélection du fichier : un bouton « envoyer »
                séparé n'apporterait rien pour un seul champ. */}
            {estMonProfil && (
              <label className="text-xs text-white/30 hover:text-white cursor-pointer">
                changer d'avatar (5 Mo max, PNG, JPEG/JPG, 2048 × 2048 max)
                <input id="avatar" name="avatar" type="file" accept="image/png,image/jpeg" className="hidden" onChange={choisirAvatar} />
              </label>
            )}
            {messageProfil && <p className="text-red-l text-xs mt-1">{messageProfil}</p>}
          </div>
        </div>

        <div className="min-w-0 lg:row-start-2 bg-noir-krystal rounded-xl p-4">
          <p className="text-white/50 text-sm">Taux de réussite</p>
          <p className="text-3xl font-semibold">
            {stats ? `${Math.round(stats.winRate * 100)} %` : '—'}
            {stats && stats.roundsPlayed > 0 && (
              <span className="text-white/40 text-base">
                {' '}· {stats.victories} gagnées, {stats.defeats} perdues
              </span>
            )}
          </p>
        </div>

        <div className="min-w-0 lg:row-start-3 bg-noir-krystal rounded-xl p-4">
          <p className="text-white/50 text-sm">Manches jouées</p>
          <p className="text-3xl font-semibold">
            {stats ? stats.roundsPlayed : '—'}
            {stats && stats.roundsPlayed > 0 && (
              <span className={`text-base ${stats.netGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {' '}· {stats.netGain >= 0 ? '+' : ''}{stats.netGain} cr
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="lg:col-span-3 lg:col-start-3 lg:pl-6">
        <h1 className="bg-grisclair-krystal text-[20px] px-8 py-2 w-full lg:w-[46%] text-white font-semibold rounded-xl">
          Top players
        </h1>
        <div className="grid grid-cols-3 grid-rows-5 p-4 sm:p-8 gap-2 bg-gris-krystal min-h-[320px] lg:h-[92%] rounded-xl">
          {marches.map((position, index) => {
            const joueur = podium[index];
            return (
              <div
                key={position}
                className={`${position} min-w-0 max-w-full overflow-hidden bg-noir-krystal rounded-xl text-white flex flex-col items-center justify-end p-3 gap-1`}
              >
                {joueur ? (
                  <>
                    <span className="text-white/40 text-xs">#{joueur.rank}</span>
                    <span className="min-w-0 max-w-full font-semibold text-sm text-center break-all">
                      {nomDe(joueur.user)}
                    </span>
                    <span className={joueur.netGain >= 0 ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'}>
                      {joueur.netGain >= 0 ? '+' : ''}{joueur.netGain} cr
                    </span>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Historique des parties. Il occupe toute la largeur sous les trois
          colonnes : une manche a trop d'informations (date, salon, adversaires)
          pour tenir dans une colonne du haut. */}
      <div className="lg:col-span-5 mt-6">
        <h1 className="bg-grisclair-krystal text-[20px] px-8 py-2 w-full lg:w-[18%] text-white font-semibold rounded-xl">
          Historique
        </h1>
        <div className="bg-gris-krystal rounded-xl p-4 sm:p-6 mt-2">
          {historique.length === 0 ? (
            <p className="text-white/30 text-sm">
              Aucune manche terminée pour l'instant.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {historique.map((manche) => {
                // Les adversaires sortent des mises de la manche : le back
                // renvoie tout le monde, il faut juste s'en retirer.
                const adversaires = manche.round.bets
                  .filter((b) => b.user?.id !== stats?.user.id)
                  .map((b) => nomDe(b.user));
                const gagne = manche.result === 'WIN';
                // Ce que la manche a rapporté ou coûté : le gain net, pas le
                // versement brut, sinon une victoire à 100 crédits pour 100
                // misés s'afficherait comme un gain.
                const net = (manche.payout ?? 0) - manche.stake;
                const date = new Date(manche.round.revealedAt ?? manche.round.createdAt);
                return (
                  <li
                    key={manche.id}
                    className="bg-noir-krystal rounded-xl p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-white"
                  >
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                        gagne ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'
                      }`}
                    >
                      {gagne ? 'gagnée' : 'perdue'}
                    </span>
                    <span className="text-sm text-white/50 shrink-0">
                      {date.toLocaleDateString('fr-FR')} à {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-sm truncate min-w-0 flex-1">
                      {manche.round.room?.name ?? 'salon supprimé'}
                      {adversaires.length > 0 && (
                        <span className="text-white/40"> · contre {adversaires.join(', ')}</span>
                      )}
                    </span>
                    <span className="text-sm text-white/40 shrink-0">mise {manche.stake}</span>
                    <span
                      className={`text-sm font-semibold shrink-0 ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {net >= 0 ? '+' : ''}{net} cr
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
