// Fil de discussion du salon. Quatre rendus distincts : message système,
// message masqué par la modération, message de l'assistant, message de joueur.
//
// L'assistant est volontairement démarqué — liseré, badge, sources cliquables.
// Les trois faux joueurs mentent délibérément ; lui cite ce sur quoi il
// s'appuie. Rien à l'écran ne disait la différence, et on pouvait suivre un
// menteur en croyant lire l'IA.
import { useState } from "react";
import { ChatMessage } from "../mocks/gameData";

interface ChatProps {
  messages: ChatMessage[];
  roomLabel?: string;
  onSendMessage?: (content: string) => void;
}

// Longueur maximale d'un message, alignée sur la limite du serveur. Le sujet
// exige que toute saisie soit validée des deux côtés : sans borne ici, un
// message trop long partait et se faisait refuser sans que rien ne l'indique.
const MAX_MESSAGE = 1000;

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
    const contenu = draft.trim();
    // Même borne que le gateway (realtime.gateway.ts) : au-delà il rejette le
    // message, et le joueur n'en verrait rien. On teste ici aussi plutôt que de
    // se reposer sur le seul maxLength, qui ne couvre pas un collage tronqué
    // suivi d'un envoi programmatique.
    if (!contenu || contenu.length > MAX_MESSAGE) return;
    onSendMessage?.(contenu);
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
            ) : msg.type === "bot" ? (
              // L'assistant, à ne pas confondre avec les autres joueurs : eux
              // affirment ce qu'ils veulent, lui cite ce sur quoi il s'appuie.
              // D'où le liseré, le badge, et les sources sous la réponse.
              <div className="border-l-2 border-emerald-400/60 pl-2 py-0.5">
                <span className="font-semibold text-emerald-400">{msg.author}</span>
                <span className="ml-1 text-[10px] text-emerald-400/70 border border-emerald-400/40 rounded-full px-1.5">
                  assistant
                </span>{" "}
                <span className="text-white/80">{msg.content}</span>
                {msg.sources && msg.sources.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {msg.sources.map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-emerald-400/70 hover:text-emerald-400 underline break-all"
                        >
                          {source.title?.trim() || source.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
          id="chat-message"
          name="message"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          // L'assistant ne se déclenche que sur le préfixe @bot (ou /ask), et
          // rien ne l'indiquait : on pouvait lui écrire sans jamais obtenir de
          // réponse, en croyant qu'il était cassé. Le placeholder le dit.
          maxLength={MAX_MESSAGE}
          placeholder="Écris un message… ou @bot pour interroger l'IA"
          // min-w-0 : un champ texte a une largeur intrinsèque d'environ 220 px
          // que flex-1 seul ne fait pas céder. Sur un écran de 320 px, le bouton
          // « envoyer » se retrouvait poussé hors de l'écran.
          className="flex-1 min-w-0 bg-noir-krystal text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/30"
        />
        <button onClick={handleSend} className="button-blue-d px-4 py-2 text-sm">
          envoyer
        </button>
      </div>
    </div>
  );
}
