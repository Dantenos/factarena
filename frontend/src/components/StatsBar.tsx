// Bandeau de statistiques affiché en haut de la page Room : progression dans
// la compilation, bonnes réponses du joueur, pot commun, solde de crédits.
// Purement visuel — tout vient du parent, qui tient l'état réel de la manche
// reçu par WebSocket.
import { SessionStats } from "../mocks/gameData";

interface StatsBarProps {
  stats: SessionStats;
}

export default function StatsBar({ stats }: StatsBarProps) {
  // Tableau plutôt que 4 blocs JSX répétés : plus facile à maintenir si on
  // doit ajouter/retirer une statistique plus tard.
  const items = [
    { label: "Clip", value: `${stats.clipIndex}/${stats.totalClips}` },
    { label: "Tes bonnes réponses", value: stats.correctAnswers },
    { label: "Pot", value: stats.pot },
    { label: "Solde", value: stats.balance },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-gris-krystal rounded-xl p-4">
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <p className="text-xs text-white/50 uppercase tracking-wide">{item.label}</p>
          <p className="text-xl font-bold text-white">{item.value}</p>
        </div>
      ))}
    </div>
  );
}