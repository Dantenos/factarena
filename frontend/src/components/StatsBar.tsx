import { SessionStats } from "../mocks/gameData";

interface StatsBarProps {
  stats: SessionStats;
}

export default function StatsBar({ stats }: StatsBarProps) {
  const items = [
    { label: "Clip", value: `${stats.clipIndex}/${stats.totalClips}` },
    { label: "Tes bonnes réponses", value: stats.correctAnswers },
    { label: "Pot", value: stats.pot },
    { label: "Solde", value: stats.balance },
    { label: "Joueurs", value: `${stats.playerCount}/5` },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 bg-gris-krystal rounded-xl p-4">
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <p className="text-xs text-white/50 uppercase tracking-wide">{item.label}</p>
          <p className="text-xl font-bold text-white">{item.value}</p>
        </div>
      ))}
    </div>
  );
}