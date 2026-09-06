// Types partagés par l'écran de salon : StatsBar, Chat, ClipProgressBar,
// ResultsReveal et BettingPanel.
//
// Ce fichier a d'abord contenu des données simulées, écrites pour construire et
// relire l'interface du salon avant que le contrat WebSocket soit figé. Les
// données ont disparu quand le temps réel a été branché — Room alimente
// maintenant chaque composant depuis le serveur. Les formes, elles, sont
// restées : elles décrivent ce que les composants attendent en props, et
// servent toujours de contrat entre eux et la page.

// --- Chat ---

export interface ChatMessage {
  id: string;
  type: "user" | "system" | "bot";
  author: string;
  content: string;
  timestamp: number;
  // true si le message a été masqué par la modération IA — dans ce cas
  // `content` est ignoré et un texte d'avertissement est affiché à la place.
  moderated?: boolean;
  // Sources citées par l'assistant. C'est ce qui le distingue des faux joueurs,
  // qui affirment sans jamais rien produire.
  sources?: Array<{ title?: string; url: string }>;
}

// --- Bandeau de statistiques ---

export interface SessionStats {
  clipIndex: number;      // combien de clips ont déjà été vus/joués
  totalClips: number;     // nombre total de clips dans la compilation
  correctAnswers: number; // bonnes réponses du joueur sur la session
  pot: number;            // pot commun accumulé par tous les joueurs
  balance: number;        // solde de crédits du joueur
  playerCount: number;    // joueurs actuellement présents dans le salon
}

// --- Résultats clip par clip ---

// Les verdicts possibles rendus sur un clip à la révélation.
export type ClipVerdict = "FAUX" | "VRAI" | "TROMPEUR" | "HORS_CONTEXTE";

export interface ClipResult {
  id: string;
  verdict: ClipVerdict;
  title: string;        // description courte du clip
  explanation: string;  // explication sourcée affichée à la révélation
  source: string;       // source citée (ex: « AFP Factuel »)
  // D'où vient l'explication : le RAG, ou la clé éditoriale quand le corpus ne
  // couvre pas le clip. L'étiquette affichée en dépend.
  explanationSource?: 'rag' | 'editorial';
  userVoted: boolean;   // true si le joueur a voté sur ce clip précis
  // Ce que l'IA aurait répondu SANS connaître la clé et sans son article
  // source. Purement informatif : le score n'en dépend jamais. Quand elle se
  // trompe, on l'affiche tel quel — c'est la limite d'une IA face au
  // fact-checking, et la montrer vaut mieux que la masquer.
  aiGuess?: "VRAI" | "FAUX" | "INCERTAIN";
  aiGuessWhy?: string;
}

// --- Classement de fin de manche ---

export interface LeaderboardEntry {
  userId: string;
  username: string;
  correctCount: number;  // nombre de bonnes réponses sur la session
  creditsChange: number; // gain/perte de crédits (positif ou négatif)
}

// --- Paris ---

export interface BetOption {
  id: string;
  label: string;
}
