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