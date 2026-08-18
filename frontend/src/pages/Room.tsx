// Page Salon — compilation de clips à évaluer (jeu de prédiction/fact-checking).
// Layout : bandeau de stats en haut, vidéo + progression des clips à gauche,
// chat à droite, résultats détaillés en dessous une fois la compilation
// terminée. Toutes les données sont mockées pour l'instant
// (cf mocks/gameData.ts) — l'intégration WebSocket réelle avec le Back Core
// reste à faire.
import { useState } from "react";
import VideoPlayer from "../components/VideoPlayer";
import Chat from "../components/Chat";
import ClipProgressBar from "../components/ClipProgressBar";
import StatsBar from "../components/StatsBar";
import ResultsReveal from "../components/ResultsReveal";
import {
  mockVideoUrl,
  mockChatMessages,
  mockSessionStats,
  mockClipResults,
  mockLeaderboard,
} from "../mocks/gameData";

export default function Room() {
  // Index du clip actuellement affiché dans la compilation. Piloté en
  // théorie par ClipProgressBar via onClipComplete (qui devrait
  // l'incrémenter à chaque fin de segment) — pour l'instant fixé à la
  // valeur de fin de compilation (mockSessionStats.clipIndex = 8) pour
  // pouvoir tester directement l'affichage des résultats sans attendre.
  const [currentClipIndex] = useState(mockSessionStats.clipIndex);

  return (
    <section className="bg-noir-krystal w-full min-h-full p-6 space-y-4">
      <StatsBar stats={mockSessionStats} />

      <div className="grid grid-cols-3 gap-4">
        {/* Colonne vidéo (2/3 de la largeur) : lecteur + barre de progression */}
        <div className="col-span-2 bg-gris-krystal rounded-xl p-3 space-y-2">
          <div className="relative">
            {/* Overlays cosmétiques "LIVE" et source, positionnés par-dessus
                le lecteur. Codés en dur ici plutôt que dans VideoPlayer,
                car spécifiques à ce contexte (à déplacer en props si un
                autre écran réutilise le lecteur avec un besoin similaire). */}
            <span className="absolute top-2 left-2 z-10 text-xs text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> LIVE
            </span>
            <VideoPlayer src={mockVideoUrl} />
          </div>
          <ClipProgressBar
            totalClips={mockSessionStats.totalClips}
            currentClipIndex={currentClipIndex}
            clipDuration={8}
          />
        </div>

        {/* Colonne chat (1/3 de la largeur) */}
        <div className="col-span-1">
          <Chat messages={mockChatMessages} roomLabel="Chat du salon #A7" />
        </div>
      </div>

      {/* Résultats détaillés — affichés une fois la compilation terminée.
          Pour l'instant toujours visible (données mockées en état "fini"),
          deviendra conditionnel une fois le vrai state de session branché. */}
      <ResultsReveal
        correctCount={mockSessionStats.correctAnswers}
        totalClips={mockSessionStats.totalClips}
        clipResults={mockClipResults}
        leaderboard={mockLeaderboard}
      />
    </section>
  );
}