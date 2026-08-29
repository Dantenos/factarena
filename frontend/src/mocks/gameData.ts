// Données mockées pour la page Room, en attendant l'intégration WebSocket
// avec le Back Core. Regroupe tous les types et données utilisés par
// StatsBar, Chat, ClipProgressBar et ResultsReveal.

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
}

export const mockChatMessages: ChatMessage[] = [
  { id: "1", type: "system", author: "système", content: "manche lancée — 8 clips, vote good/fake sur chacun", timestamp: Date.now() },
  { id: "2", type: "user", author: "lchen", content: "go go le clip 1 c'est de l'arma 3 à 100%", timestamp: Date.now() },
  { id: "3", type: "user", author: "mreynaud", content: "nan mais le 3 a l'air vrai pour une fois", timestamp: Date.now() },
  { id: "4", type: "user", author: "tkowalski", content: "", timestamp: Date.now(), moderated: true },
  { id: "5", type: "user", author: "adiallo", content: "le 5 s'est pas chargé chez vous aussi ?", timestamp: Date.now() },
  { id: "6", type: "user", author: "lchen", content: "", timestamp: Date.now(), moderated: true },
  { id: "7", type: "system", author: "système", content: "manche terminée — 0/8 bonnes réponses", timestamp: Date.now() },
];

// --- Vidéo ---

export const mockVideoUrl = "/test-video.mp4";

// --- Stats bar (bandeau du haut) ---

export interface SessionStats {
  clipIndex: number;      // combien de clips ont déjà été vus/joués
  totalClips: number;     // nombre total de clips dans la compilation
  correctAnswers: number; // bonnes réponses du joueur sur la session
  pot: number;            // pot commun accumulé par tous les joueurs
  balance: number;        // solde de crédits du joueur
}

export const mockSessionStats: SessionStats = {
  clipIndex: 8,
  totalClips: 8,
  correctAnswers: 0,
  pot: 520,
  balance: 880,
};

// --- Résultats clip par clip ---

// Les 4 verdicts possibles rendus par le fact-checking IA (RAG) sur un clip.
export type ClipVerdict = "FAUX" | "VRAI" | "TROMPEUR" | "HORS_CONTEXTE";

export interface ClipResult {
  id: string;
  verdict: ClipVerdict;
  title: string;        // description courte du clip ("Combat aérien nocturne...")
  explanation: string;  // explication du bot IA (RAG) sur pourquoi ce verdict
  source: string;       // source citée par le RAG (ex: "AFP Factuel")
  userVoted: boolean;    // true si le joueur a voté sur ce clip précis
  // Ce que l'IA aurait répondu SANS connaître la clé et sans son article
  // source. Purement informatif : le score n'en dépend jamais. Quand elle se
  // trompe, on l'affiche tel quel — c'est la limite d'une IA face au
  // fact-checking, et la montrer vaut mieux que la masquer.
  aiGuess?: "VRAI" | "FAUX" | "INCERTAIN";
  aiGuessWhy?: string;
}

export const mockClipResults: ClipResult[] = [
  { id: "1", verdict: "FAUX", title: "« Combat aérien nocturne » — séquence virale", explanation: "Images du jeu Arma 3 — interface et moteur reconnaissables.", source: "AFP Factuel", userVoted: false },
  { id: "2", verdict: "FAUX", title: "« Un aigle emporte un bébé dans un parc »", explanation: "Canular en images de synthèse revendiqué par des étudiants (2012).", source: "Centre NAD", userVoted: false },
  { id: "3", verdict: "VRAI", title: "Discours officiel cité mot pour mot d'un rapport", explanation: "Citation exacte et bien contextualisée — un vrai, les plus durs à voir.", source: "Vie-publique", userVoted: false },
  { id: "4", verdict: "FAUX", title: "« Chanteuse au sommet de dirigeants du Sahel »", explanation: "Vidéo générée par IA — lèvres désync, artefacts sur les mains.", source: "AFP Factuel", userVoted: false },
  { id: "5", verdict: "HORS_CONTEXTE", title: "(vidéo morte — jugée via article archivé)", explanation: "Archive authentique mais mal datée/située (Afrique du Sud, 1998).", source: "AFP Factuel", userVoted: false },
  { id: "6", verdict: "VRAI", title: "Chiffre du chômage cité tel quel d'un communiqué", explanation: "Donnée exacte, reprise fidèlement de la source officielle.", source: "Vie-publique", userVoted: false },
  { id: "7", verdict: "TROMPEUR", title: "Citation authentique coupée avant la nuance", explanation: "Mots réellement prononcés mais l'extrait s'arrête trop tôt.", source: "franceinfo", userVoted: false },
  { id: "8", verdict: "FAUX", title: "« Footage de guerre » = images de jeu vidéo", explanation: "Autre cheapfake : rendu de jeu présenté comme réel.", source: "Reuters", userVoted: false },
];

// --- Classement ---

export interface LeaderboardEntry {
  userId: string;
  username: string;
  correctCount: number;  // nombre de bonnes réponses sur la session
  creditsChange: number; // gain/perte de crédits (positif ou négatif)
}

export const mockLeaderboard: LeaderboardEntry[] = [
  { userId: "u1", username: "tkowalski", correctCount: 6, creditsChange: 420 },
  { userId: "u2", username: "lchen", correctCount: 5, creditsChange: -100 },
  { userId: "u3", username: "mreynaud", correctCount: 4, creditsChange: -100 },
  { userId: "u4", username: "adiallo", correctCount: 4, creditsChange: -120 },
  { userId: "u5", username: "toi", correctCount: 0, creditsChange: -120 },
];

// --- Paris ---
// Pas encore intégré dans Room (la maquette actuelle montre l'écran de
// résultats, pas l'écran de vote) — conservé pour BettingPanel en attendant.

export interface BetOption {
  id: string;
  label: string;
}

export const mockBetOptions: BetOption[] = [
  { id: "0", label: "0 fake news" },
  { id: "1", label: "1 fake news" },
  { id: "2", label: "2 fake news" },
  { id: "3", label: "3 fake news" },
];