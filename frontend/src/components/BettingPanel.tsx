// Panneau de paris. Permet à l'utilisateur de choisir combien de "fake news"
// il pense avoir repérées dans la vidéo. Version simple : liste de boutons,
// sans état local ni logique de confirmation pour l'instant (à ajouter :
// optimistic UI + désactivation automatique une fois le temps de vote
// écoulé). Pas encore intégré dans Room.tsx — la maquette actuelle couvre
// l'écran de résultats (après vote), pas l'écran de vote en cours.
//
// Props :
// - options     : liste des choix de pari possibles (mock pour l'instant,
//                 cf mocks/gameData.ts)
// - onBetPlaced : callback appelé quand l'utilisateur clique sur une option,
//                 renvoie l'id de l'option choisie
import { BetOption } from "../mocks/gameData";

interface BettingPanelProps {
  options: BetOption[];
  onBetPlaced?: (optionId: string) => void;
}

export default function BettingPanel({ options, onBetPlaced }: BettingPanelProps) {
  return (
    <div className="betting-panel">
      {options.map((opt) => (
        <button key={opt.id} onClick={() => onBetPlaced?.(opt.id)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}