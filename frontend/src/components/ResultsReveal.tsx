import { useState } from "react";
import { ACHIEVEMENTS, ClipResult, ClipVerdict, LeaderboardEntry } from "../mocks/gameData";

interface ResultsRevealProps {
  correctCount: number;
  totalClips: number;
  clipResults: ClipResult[];
  leaderboard: LeaderboardEntry[];
  isWinner: boolean;
}

const VERDICT_STYLES: Record<ClipVerdict, { label: string; className: string }> = {
  FAUX: { label: "FAKE", className: "text-red-400" },
  VRAI: { label: "FACT", className: "text-emerald-400" },
  TROMPEUR: { label: "TROMPEUR", className: "text-amber-400" },
  HORS_CONTEXTE: { label: "HORS CONTEXTE", className: "text-purple-400" },
};

function libelleVote(vote?: ClipVerdict): string {
  if (vote === 'VRAI') return 'Fact';
  if (vote === 'FAUX') return 'Fake';
  return "Pas de réponse";
}

function libelleAvisIa(avis?: ClipResult['aiGuess']): string {
  if (avis === 'VRAI') return 'Fact';
  if (avis === 'FAUX') return 'Fake';
  if (avis === 'INCERTAIN') return 'Incertain';
  return "Pas d'avis";
}

export default function ResultsReveal({ correctCount, totalClips, clipResults, leaderboard, isWinner }: ResultsRevealProps) {
  const meilleurScore = leaderboard.length > 0
    ? Math.max(...leaderboard.map((entry) => entry.correctCount))
    : -1;
  const [detailsOuverts, setDetailsOuverts] = useState<Record<string, boolean>>({});
  const succesDebloques = leaderboard.flatMap((entry) => entry.achievementsUnlocked.map((key) => ({
    username: entry.username,
    name: ACHIEVEMENTS.find((succes) => succes.key === key)?.name ?? key,
  })));

  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl p-4 text-center font-semibold ${
          isWinner ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
        }`}
      >
        Tu as {correctCount}/{totalClips} bonne(s) réponse(s).
      </div>

      <div className="bg-gris-krystal rounded-xl p-4">
        <div className="text-center">
          <h3 className="text-white font-semibold">Clip par clip</h3>
          <p className="text-white/40 text-xs mt-1 mb-3">
            Seul le verdict du fact-checker affiché devant le titre de la vidéo fait foi.
          </p>
        </div>
        <ul className="space-y-3">
          {clipResults.map((clip) => {
            const verdict = VERDICT_STYLES[clip.verdict];
            const reponseCorrecte = clip.userVote === clip.verdict;
            const detailsOuvertsPourCeClip = detailsOuverts[clip.id] === true;
            return (
              <li key={clip.id} className="rounded-lg border border-white/10 bg-noir-krystal/40 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
                  <span className={`text-xs font-bold tracking-wide ${verdict.className}`}>
                    {verdict.label}
                  </span>
                  <p className="text-white font-medium">« {clip.title} »</p>
                </div>

                <div className="mx-4 mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-white">
                  <p>
                    <span className="inline-flex rounded-full border border-slate-300 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-200">
                      Ta réponse
                    </span>
                  </p>
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span>{libelleVote(clip.userVote)}{clip.userVote ? ' :' : ''}</span>
                    {clip.userVote && (
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold text-white ${reponseCorrecte ? 'bg-emerald-500' : 'bg-red-500'}`}>
                        {reponseCorrecte ? "Tu as bon, bravo à toi !" : "Tu as faux, dommage !"}
                      </span>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  aria-expanded={detailsOuvertsPourCeClip}
                  aria-label={detailsOuvertsPourCeClip ? "Masquer les détails de l'IA-RAG" : "Afficher les détails de l'IA-RAG"}
                  onClick={() => setDetailsOuverts((ouverts) => ({
                    ...ouverts,
                    [clip.id]: !ouverts[clip.id],
                  }))}
                  className="mx-4 flex w-[calc(100%-2rem)] items-center justify-start gap-2 py-2 text-white/80 hover:text-white"
                >
                  <span className="text-sm font-semibold">Réponse IA</span>
                  <span
                    aria-hidden="true"
                    className={`h-3 w-3 border-r-2 border-b-2 border-white/80 transition-transform ${
                      detailsOuvertsPourCeClip ? '-rotate-[135deg] translate-y-1' : 'rotate-45 -translate-y-1'
                    }`}
                  />
                </button>

                {detailsOuvertsPourCeClip && (
                  <div className="mx-4 mb-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-white/60">Verdict de l'IA-RAG</p>
                      <span className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] text-white/80">
                        {libelleAvisIa(clip.aiGuess)}
                      </span>
                    </div>
                    {clip.aiGuessWhy && (
                      <p className="mt-2 text-sm text-white/70">{clip.aiGuessWhy}</p>
                    )}
                    <p className="mt-2 text-sm text-white/70">
                      <span className="font-semibold text-white/50">{clip.explanationSource === 'editorial' ? 'Vérification' : 'IA-RAG'} :</span>{' '}
                      {clip.explanation}
                    </p>
                    <p className="mt-2 break-words text-xs text-white/50">
                      <span className="font-semibold text-white/70">Source(s) :</span> {clip.source}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {succesDebloques.length > 0 && (
        <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-amber-100">
          <h3 className="font-semibold text-center">Succès débloqués</h3>
          <ul className="mt-2 space-y-1 text-center text-sm">
            {succesDebloques.map((succes, index) => (
              <li key={`${succes.username}-${succes.name}-${index}`}>
                {succes.username} a débloqué le succès : « {succes.name} »
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-gris-krystal rounded-xl p-4 border border-white/10">
        <h3 className="text-white font-semibold text-center mb-4">Classement des joueurs et gains :</h3>
        <ul className="space-y-2">
          {['1er', '2e', '3e', '4e', '5e'].map((position, index) => {
            const entry = leaderboard[index];
            const estGagnant = entry !== undefined && entry.correctCount === meilleurScore;
            const podiumStyle = estGagnant
              ? 'bg-amber-400/10 border-amber-300/20'
              : 'bg-white/[0.03] border-white/5';
            const positionStyle = estGagnant ? 'text-amber-300' : 'text-white/60';
            return (
              <li key={position} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${podiumStyle}`}>
                <span className={`w-10 shrink-0 font-semibold ${positionStyle}`}>
                  {position}
                </span>
                <span className="flex-1 min-w-0 truncate text-white/90">{entry?.username ?? '—'}</span>
                {entry && (
                  <>
                    <span className={`shrink-0 font-semibold ${entry.creditsChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {entry.creditsChange >= 0 ? "+" : ""}{entry.creditsChange} crédits
                    </span>
                    <span className="shrink-0 font-semibold text-amber-300">
                      +{entry.experienceGained} XP
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
