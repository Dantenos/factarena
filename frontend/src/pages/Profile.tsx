// Page Profil. La maquette affichait des libellés sans valeurs : on garde la
// grille et on la remplit avec /stats/me et /stats/leaderboard, qui existent
// déjà côté back (backend/src/stats/).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/** Profil réduit renvoyé par le back à l'intérieur des statistiques. */
interface ProfilJoueur {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
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

export default function Profile() {
  const { utilisateur } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [podium, setPodium] = useState<LigneClassement[]>([]);

  useEffect(() => {
    // Pas de console.error dans les catch : une statistique indisponible n'est
    // pas une erreur de l'application, et le sujet exige une console vierge.
    api<Stats>('/stats/me').then(setStats).catch(() => setStats(null));
    api<LigneClassement[]>('/stats/leaderboard')
      // Le back renvoie tout le monde, classé. On n'affiche que le podium.
      .then((liste) => setPodium(liste.slice(0, 3)))
      .catch(() => setPodium([]));
  }, []);

  const nomDe = (profil?: ProfilJoueur | null, secours?: string) =>
    profil?.displayName || profil?.email?.split('@')[0] || secours || 'joueur';
  const pseudo = nomDe(stats?.user, utilisateur?.displayName || utilisateur?.email?.split('@')[0]);

  // Hauteur des marches : la première est la plus haute. On garde les
  // positions de la maquette, seul le contenu change.
  const marches = [
    'col-start-1 col-end-1 row-start-2 row-span-4',
    'col-start-2 col-end-2 row-start-3 row-span-3',
    'col-start-3 col-end-3 row-start-4 row-span-2',
  ];

  return (
    <section className="grid grid-cols-5 p-8 bg-noir-krystal w-full min-h-full">
      <div className="grid grid-rows-3 col-span-2 col-start-1 gap-4 p-8 bg-gris-krystal text-white rounded-xl">
        <div className="row-start-1 bg-noir-krystal rounded-xl p-4 flex items-center gap-4">
          {utilisateur?.avatarUrl ? (
            <img src={utilisateur.avatarUrl} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
          ) : (
            // Pas d'avatar : une initiale plutôt qu'une image cassée.
            <span className="w-14 h-14 rounded-full bg-grisclair-krystal flex items-center justify-center text-xl font-semibold shrink-0">
              {pseudo.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-semibold truncate">{pseudo}</p>
            <p className="text-white/40 text-sm">
              {stats ? `${stats.virtualBalance} crédits` : '—'}
            </p>
          </div>
        </div>

        <div className="row-start-2 bg-noir-krystal rounded-xl p-4">
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

        <div className="row-start-3 bg-noir-krystal rounded-xl p-4">
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

      <div className="grid grid-rows-3 col-span-1 justify-center items-center">
        <Link to="/play" className="row-start-2 button-blue-d px-15 py-3 text-[30px]">
          Jouer
        </Link>
      </div>

      <div className="col-span-2 col-start-4">
        <h1 className="bg-grisclair-krystal text-[20px] px-8 py-2 w-[46%] text-white font-semibold rounded-xl">
          Top players
        </h1>
        <div className="grid grid-cols-3 grid-rows-5 p-8 gap-2 bg-gris-krystal h-[92%] rounded-xl">
          {marches.map((position, index) => {
            const joueur = podium[index];
            return (
              <div
                key={position}
                className={`${position} bg-noir-krystal rounded-xl text-white flex flex-col items-center justify-end p-3 gap-1`}
              >
                {joueur ? (
                  <>
                    <span className="text-white/40 text-xs">#{joueur.rank}</span>
                    <span className="font-semibold text-sm text-center break-words">
                      {nomDe(joueur.user)}
                    </span>
                    <span className={joueur.netGain >= 0 ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'}>
                      {joueur.netGain >= 0 ? '+' : ''}{joueur.netGain} cr
                    </span>
                  </>
                ) : (
                  // Tant que personne n'a joué, on le dit au lieu de laisser une
                  // marche vide qui ressemble à un affichage cassé.
                  <span className="text-white/25 text-xs text-center">place à prendre</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
