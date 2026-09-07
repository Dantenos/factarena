// Écran de révélation des résultats en fin de compilation : bannière de score
// global, détail clip par clip avec verdict et explication sourcée, et
// classement des joueurs (« course à la précision »). Tout est alimenté par le
// résultat que le serveur envoie à la révélation.
import { ClipResult, ClipVerdict, LeaderboardEntry } from "../mocks/gameData";

interface ResultsRevealProps {
  correctCount: number;
  totalClips: number;
  clipResults: ClipResult[];
  leaderboard: LeaderboardEntry[];
}

// Associe à chaque verdict possible un label affiché et une couleur de badge.
// Centralisé ici plutôt que dans un switch/if répété, pour n'avoir qu'un
// seul endroit à modifier si un verdict change de libellé ou de couleur.
const VERDICT_STYLES: Record<ClipVerdict, { label: string; className: string }> = {
  FAUX: { label: "FAUX", className: "bg-red-500" },
  VRAI: { label: "VRAI", className: "bg-emerald-500" },
  TROMPEUR: { label: "TROMPEUR", className: "bg-amber-500" },
  HORS_CONTEXTE: { label: "HORS CONTEXTE", className: "bg-purple-500" },
};

export default function ResultsReveal({ correctCount, totalClips, clipResults, leaderboard }: ResultsRevealProps) {
  // Détermine si le score du joueur est "bon" (au moins la moitié des clips
  // correctement évalués), pour choisir la couleur/le message de la bannière.
  const isGoodScore = correctCount >= totalClips / 2;

  return (
    <div className="space-y-4">
      {/* Bannière de score global : verte si bon score, rouge sinon */}
      <div
        className={`rounded-xl p-4 text-center font-semibold ${
          isGoodScore ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
        }`}
      >
        Tu as trouvé {correctCount}/{totalClips}
        {isGoodScore ? " — bien joué !" : " — pas le meilleur cette fois"}
      </div>

      {/* Détail clip par clip, avec verdict IA et explication sourcée */}
      <div className="bg-gris-krystal rounded-xl p-4">
        <h3 className="text-white font-semibold">Clip par clip</h3>
        {/* Trois lignes se suivent et se ressemblaient : le verdict, l'IA qui
            l'explique, l'IA qui devine. On dit une fois laquelle décide du
            score, plutôt que de le répéter sur chaque clip. */}
        <p className="text-white/40 text-xs mb-3">
          Le badge coloré est le verdict du fact-checkeur — lui seul décide de ton score.
          Les lignes en dessous sont l'IA.
        </p>
        <ul className="space-y-3">
          {clipResults.map((clip) => {
            const verdict = VERDICT_STYLES[clip.verdict];
            return (
              <li key={clip.id} className="border-b border-white/10 pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`${verdict.className} text-white text-xs font-bold px-2 py-0.5 rounded`}>
                    {verdict.label}
                  </span>
                  <span className="text-white/90 text-sm">« {clip.title} »</span>
                </div>

                {/* La réponse du joueur, à côté du verdict : c'est ce que le
                    titre de la section promettait sans jamais le montrer. */}
                <p className="text-xs mt-1 ml-1">
                  {clip.userVote ? (
                    <>
                      <span className="text-white/40">Ta réponse ▸ </span>
                      <span
                        className={
                          clip.userVote === clip.verdict
                            ? 'text-emerald-400 font-semibold'
                            : 'text-red-400 font-semibold'
                        }
                      >
                        {clip.userVote} {clip.userVote === clip.verdict ? '✓' : '✗'}
                      </span>
                    </>
                  ) : (
                    <span className="text-white/40">Tu n'as pas voté sur ce clip.</span>
                  )}
                </p>
                <p className="text-white/50 text-xs mt-1 ml-1">
                  {clip.explanationSource === 'editorial' ? 'Vérification' : 'IA-RAG'} ▸{' '}
                  <span className="text-white/70">{clip.explanation}</span> — {clip.source}
                </p>

                {/* Second avis : ce que l'IA aurait répondu si elle avait joué,
                    privée de la clé ET de son article source. On le distingue
                    nettement du verdict officiel, qui seul décide du score.
                    Afficher ses erreurs est volontaire : mesurée sur un
                    échantillon, elle ne voit juste qu'une fois sur quatre. */}
                {clip.aiGuess && (
                  <p className="text-xs mt-1 ml-1">
                    <span className="text-white/40">Si l'IA avait joué ▸ </span>
                    <span
                      className={
                        clip.aiGuess === 'INCERTAIN'
                          ? 'text-white/60 font-semibold'
                          : clip.aiGuess === clip.verdict
                            ? 'text-emerald-400 font-semibold'
                            : 'text-red-400 font-semibold'
                      }
                    >
                      {clip.aiGuess}
                      {clip.aiGuess !== 'INCERTAIN' &&
                        (clip.aiGuess === clip.verdict ? ' ✓' : ' ✗ elle s\'est trompée')}
                    </span>
                    {clip.aiGuessWhy && (
                      <span className="text-white/40"> — {clip.aiGuessWhy}</span>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Classement des joueurs de la session */}
      <div className="bg-gris-krystal rounded-xl p-4">
        <h3 className="text-white font-semibold mb-3">Course à la précision — le pot va au plus juste</h3>
        <ul className="space-y-1.5">
          {leaderboard.map((entry) => (
            <li key={entry.userId} className="flex justify-between text-sm">
              <span className="text-white/80">
                {entry.username} · {entry.correctCount}/{totalClips} bons
              </span>
              {/* Vert pour un gain, rouge pour une perte de crédits */}
              <span className={entry.creditsChange >= 0 ? "text-emerald-400" : "text-red-400"}>
                {entry.creditsChange >= 0 ? "+" : ""}
                {entry.creditsChange} cr
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}