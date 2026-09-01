// Panneau de paris. Permet à l'utilisateur de choisir combien de "fake news"
// il pense avoir repérées dans la vidéo. Version simple : liste de boutons,
// sans état local ni logique de confirmation pour l'instant (à ajouter :
// optimistic UI + désactivation automatique une fois le temps de vote
// écoulé).
//
// Ce composant n'est PAS rendu par Room : le jeu a évolué vers un vote
// good/fake clip par clip, avec une mise unique par manche posée au lancement.
// Le pari sur un nombre de fake news n'a plus de place dans cette boucle. On le
// garde parce que la mécanique reste envisageable en variante, mais il faut
// savoir qu'il ne s'affiche nulle part aujourd'hui.
//
// Props :
// - options     : liste des choix de pari possibles
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