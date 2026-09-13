import { useState } from "react";
import { ChatMessage } from "../mocks/gameData";

interface ChatProps {
  messages: ChatMessage[];
  roomLabel?: string;
  onSendMessage?: (content: string) => void;
}

const MAX_MESSAGE = 1000;

const AUTHOR_COLORS = ["text-blue-400", "text-emerald-400", "text-amber-400", "text-pink-400", "text-purple-400"];

function getAuthorColor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) hash += author.charCodeAt(i);
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length];
}

export default function Chat({ messages, roomLabel = "Chat du salon", onSendMessage }: ChatProps) {
  const [draft, setDraft] = useState("");

  function handleSend() {
    const contenu = draft.trim();
    if (!contenu || contenu.length > MAX_MESSAGE) return;
    onSendMessage?.(contenu);
    setDraft("");
  }

  return (
    <div className="flex flex-col h-full bg-gris-krystal rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold">{roomLabel}</h2>
        <span className="text-xs text-emerald-400 border border-emerald-400 rounded-full px-2 py-0.5">
          modération IA active
        </span>
      </div>

      <ul className="flex-1 overflow-y-auto space-y-1.5 text-sm">
        {messages.map((msg) => (
          <li key={msg.id}>
            {msg.type === "system" ? (
              <span className="text-white/40 italic">{msg.content}</span>
            ) : msg.moderated ? (
              <span className="text-white/30 italic">⚠ message masqué par la modération IA</span>
            ) : msg.type === "bot" ? (
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
              <>
                <span className={`font-semibold ${getAuthorColor(msg.author)}`}>{msg.author}</span>{" "}
                <span className="text-white/80">{msg.content}</span>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-2 mt-3">
        <input
          id="chat-message"
          name="message"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          maxLength={MAX_MESSAGE}
          placeholder="Écris un message… ou @bot pour interroger l'IA"
          className="flex-1 min-w-0 bg-noir-krystal text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/30"
        />
        <button onClick={handleSend} className="button-blue-d px-4 py-2 text-sm">
          envoyer
        </button>
      </div>
    </div>
  );
}
