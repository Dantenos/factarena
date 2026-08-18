// Barre de progression segmentée façon Instagram Stories : un segment par
// clip de la compilation. Le segment du clip courant se remplit
// progressivement sur sa durée ; les segments des clips déjà vus restent
// pleins ; ceux des clips à venir restent vides.
//
// Props :
// - totalClips        : nombre total de clips dans la compilation
// - currentClipIndex  : index (0-based) du clip actuellement affiché
// - clipDuration       : durée d'affichage du clip courant, en secondes
// - onClipComplete    : callback déclenché quand le segment courant finit de
//                        se remplir → le parent (Room) doit alors incrémenter
//                        currentClipIndex pour passer au clip suivant
import { useEffect, useState } from "react";

interface ClipProgressBarProps {
  totalClips: number;
  currentClipIndex: number;
  clipDuration: number;
  onClipComplete?: () => void;
}

export default function ClipProgressBar({
  totalClips,
  currentClipIndex,
  clipDuration,
  onClipComplete,
}: ClipProgressBarProps) {
  // Temps écoulé sur le clip courant, en secondes.
  const [elapsed, setElapsed] = useState(0);

  // Remet le chrono à zéro à chaque fois qu'on passe à un nouveau clip
  // (currentClipIndex change, généralement piloté par le parent Room).
  useEffect(() => {
    setElapsed(0);
  }, [currentClipIndex]);

  // Fait avancer `elapsed` toutes les 100ms (plus fin qu'un tick par
  // seconde, pour un remplissage visuellement fluide plutôt que par à-coups).
  // Déclenche onClipComplete une fois la durée du clip atteinte.
  useEffect(() => {
    if (elapsed >= clipDuration) {
      onClipComplete?.();
      return;
    }
    const interval = setInterval(() => {
      setElapsed((prev) => Math.min(prev + 0.1, clipDuration));
    }, 100);
    return () => clearInterval(interval);
  }, [elapsed, clipDuration, onClipComplete]);

  // Pourcentage de remplissage du segment courant (0 à 100).
  const currentProgress = clipDuration > 0 ? (elapsed / clipDuration) * 100 : 0;

  return (
    <div
      className="flex gap-1 w-full"
      role="progressbar"
      aria-valuenow={currentClipIndex + 1}
      aria-valuemax={totalClips}
      aria-label={`Clip ${currentClipIndex + 1} sur ${totalClips}`}
    >
      {/* Un segment par clip. Pour chaque segment on détermine son état :
          - clip déjà passé (i < currentClipIndex)   -> plein (100%)
          - clip courant (i === currentClipIndex)     -> se remplit progressivement
          - clip pas encore atteint (i > currentClipIndex) -> vide (0%) */}
      {Array.from({ length: totalClips }).map((_, i) => (
        <div key={i} className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full bg-bleu-krystal"
            style={{
              width: i < currentClipIndex ? "100%" : i === currentClipIndex ? `${currentProgress}%` : "0%",
              // Transition fluide uniquement sur le segment courant, pour ne
              // pas animer inutilement les segments déjà pleins ou vides.
              transition: i === currentClipIndex ? "width 100ms linear" : "none",
            }}
          />
        </div>
      ))}
    </div>
  );
}