// Fil de discussion du salon, thème sombre cohérent avec la DA du site.
// Gère l'affichage des messages système, utilisateur, et modérés par l'IA
// (contenu masqué). Chaque auteur reçoit une couleur distincte, dérivée
// automatiquement de son nom (pas de configuration manuelle nécessaire).
// L'envoi de message est local pour l'instant (onSendMessage optionnel) —
// le vrai flux temps réel arrivera avec l'intégration WebSocket.
import { useState } from "react";
import { ChatMessage } from "../mocks/gameData";

interface ChatProps {
  messages: ChatMessage[];
  roomLabel?: string;
  onSendMessage?: (content: string) => void;
}

// Palette cyclique utilisée pour distinguer visuellement les auteurs.
const AUTHOR_COLORS = ["text-blue-400", "text-emerald-400", "text-amber-400", "text-pink-400", "text-purple-400"];

// Associe une couleur stable à un nom d'auteur : on additionne les codes
// caractères du nom puis on prend le modulo par le nombre de couleurs
// disponibles. "Stable" veut dire que le même auteur aura toujours la même
// couleur d'un rendu à l'autre (contrairement à un choix aléatoire), sans
// avoir besoin de stocker une correspondance nom -> couleur quelque part.
function getAuthorColor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) hash += author.charCodeAt(i);
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length];
}

export default function Chat({ messages, roomLabel = "Chat du salon", onSendMessage }: ChatProps) {
  // Contenu en cours de saisie dans le champ input (pas encore envoyé).
  const [draft, setDraft] = useState("");

  // Envoie le message tapé au parent (via onSendMessage) et vide le champ.
  // Ignore les messages vides ou uniquement composés d'espaces.
  function handleSend() {
    if (!draft.trim()) return;
    onSendMessage?.(draft.trim());
    setDraft("");
  }

  return (
    <div className="flex flex-col h-full bg-gris-krystal rounded-xl p-4">
      {/* En-tête : nom du salon + badge de modération IA */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold">{roomLabel}</h2>
        <span className="text-xs text-emerald-400 border border-emerald-400 rounded-full px-2 py-0.5">
          modération IA active
        </span>
      </div>

      {/* Liste des messages : rendu différent selon le type */}
      <ul className="flex-1 overflow-y-auto space-y-1.5 text-sm">
        {messages.map((msg) => (
          <li key={msg.id}>
            {msg.type === "system" ? (
              // Message système (ex: "manche lancée") : gris, en italique, sans auteur
              <span className="text-white/40 italic">{msg.content}</span>
            ) : msg.moderated ? (
              // Message masqué par la modération IA : le vrai contenu n'est
              // jamais affiché, seulement un avertissement générique
              <span className="text-white/30 italic">⚠ message masqué par la modération IA</span>
            ) : (
              // Message utilisateur normal : auteur coloré + contenu
              <>
                <span className={`font-semibold ${getAuthorColor(msg.author)}`}>{msg.author}</span>{" "}
                <span className="text-white/80">{msg.content}</span>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Champ de saisie + bouton d'envoi */}
      <div className="flex gap-2 mt-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ecris un message..."
          className="flex-1 bg-noir-krystal text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/30"
        />
        <button onClick={handleSend} className="button-blue-d px-4 py-2 text-sm">
          envoyer
        </button>
      </div>
    </div>
  );
}