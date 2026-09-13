export interface ChatMessage {
  id: string;
  type: "user" | "system" | "bot";
  author: string;
  content: string;
  timestamp: number;
  moderated?: boolean;
  sources?: Array<{ title?: string; url: string }>;
}

export interface SessionStats {
  clipIndex: number;
  totalClips: number;
  correctAnswers: number;
  pot: number;
  balance: number;
  playerCount: number;
}

export type ClipVerdict = "FAUX" | "VRAI" | "TROMPEUR" | "HORS_CONTEXTE";

export interface ClipResult {
  id: string;
  verdict: ClipVerdict;
  title: string;
  explanation: string;
  source: string;
  explanationSource?: 'rag' | 'editorial';
  userVote?: ClipVerdict;
  aiGuess?: "VRAI" | "FAUX" | "INCERTAIN";
  aiGuessWhy?: string;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  correctCount: number;
  creditsChange: number;
  experienceGained: number;
  achievementsUnlocked: string[];
}

export type AchievementKey = 'FIRST_WIN' | 'CREDITS_100' | 'PERFECT_GAME' | 'BET_250_WIN' | 'TEN_WINS';

export const ACHIEVEMENTS: Array<{ key: AchievementKey; name: string; description: string }> = [
  { key: 'FIRST_WIN', name: 'Dans le petit bain', description: 'Gagner une partie.' },
  { key: 'CREDITS_100', name: 'Début de la richesse', description: 'Gagner 100 crédits pendant une partie.' },
  { key: 'PERFECT_GAME', name: 'Pro de la fakenews', description: 'Avoir 5 bonnes réponses sur 5 au cours d’une partie.' },
  { key: 'BET_250_WIN', name: 'Même pas peur', description: 'Gagner une partie en ayant misé 250 crédits.' },
  { key: 'TEN_WINS', name: 'Imbattable', description: 'Gagner 10 parties.' },
];

export interface BetOption {
  id: string;
  label: string;
}
