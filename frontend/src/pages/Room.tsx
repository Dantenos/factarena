// Page Salon — branchée sur le back (WebSocket + API), plus sur les mocks.
//
// Les composants d'affichage (VideoPlayer, Chat, StatsBar, ClipProgressBar,
// ResultsReveal) sont conservés tels quels : on ne fait que leur fournir de
// vraies données. Le fichier mocks/gameData.ts n'est plus utilisé ici, on ne
// garde que ses TYPES, qui décrivent correctement ce que le back renvoie.
//
// ⚠️ ÉCART À CONNAÎTRE entre la doc et l'implémentation : nos documents
// décrivent une fenêtre de vote PAR CLIP, pilotée par le serveur. Le back
// implémente en réalité UNE fenêtre pour toute la manche (opensAt -> locksAt),
// avec des votes par clip envoyables à tout moment tant qu'elle est ouverte.
// On suit donc le comportement réel : le joueur avance dans les clips à son
// rythme, et tous ses votes doivent tomber avant le verrouillage. À trancher
// en équipe si on veut vraiment une fenêtre par clip.
import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import VideoPlayer from '../components/VideoPlayer';
import Chat from '../components/Chat';
import StatsBar from '../components/StatsBar';
import ResultsReveal from '../components/ResultsReveal';
import { useSocket } from '../hooks/useSocket';
import { api, solde } from '../api/client';
import type { ChatMessage, ClipResult, ClipVerdict } from '../mocks/gameData';

/** Un clip de la manche, tel que le back le renvoie (verdict masqué avant révélation). */
interface ClipEnJeu {
  claim: {
    id: string;
    text: string;
    mediaRef: string | null;
    category: string | null;
    sourceUrl: string | null;
  };
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const { connecte, etat, emettre, ecouter } = useSocket(roomId ?? null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [balance, setBalance] = useState(0);
  const [indexClip, setIndexClip] = useState(0);
  // Vote du joueur par claim : sert à griser les boutons déjà utilisés.
  const [mesVotes, setMesVotes] = useState<Record<string, boolean>>({});
  const [resultats, setResultats] = useState<ClipResult[] | null>(null);
  const [bonnesReponses, setBonnesReponses] = useState(0);

  const round = etat?.round as { id?: string; status?: string; roundClaims?: ClipEnJeu[] } | null;
  const clips = round?.roundClaims ?? [];
  const clipCourant = clips[indexClip]?.claim ?? null;
  const manchOuverte = round?.status === 'OPEN';

  // Solde de crédits : il ne transite pas par le WebSocket, on le lit via l'API
  // et on le rafraîchit à chaque révélation (les gains viennent d'être versés).
  const rafraichirSolde = useCallback(() => {
    solde()
      .then((r) => setBalance(r.virtualBalance))
      .catch(() => { /* solde indisponible : on laisse la valeur précédente */ });
  }, []);
  useEffect(rafraichirSolde, [rafraichirSolde]);

  // Abonnements aux événements temps réel.
  useEffect(() => {
    if (!connecte) return;
    const arret = [
      // L'historique ne peut être chargé qu'APRÈS avoir rejoint le salon : le
      // back exige d'en être membre, et la présence n'est établie que par
      // room:join. Le charger au montage produisait un 403 visible dans la
      // console — donc une erreur sous notre domaine, éliminatoire.
      ecouter('room:joined', () => {
        api<Array<{ id: string; content: string; createdAt: string; user?: { email?: string } }>>(
          `/chat/room/${roomId}`,
        )
          .then((liste) =>
            setMessages(
              liste.map((m) => ({
                id: m.id,
                type: 'user' as const,
                author: m.user?.email?.split('@')[0] ?? 'joueur',
                content: m.content,
                timestamp: new Date(m.createdAt).getTime(),
              })),
            ),
          )
          .catch(() => { /* salon sans historique : on démarre vide */ });
      }),
      // ⚠️ Le back n'émet PAS le message à plat : il renvoie
      // { action, moderation, message: { content, user } }. Lire m.content
      // directement donnait des messages vides avec un auteur « joueur ».
      ecouter('chat:message', (d: {
        action?: string;
        message?: { id: string; content: string; createdAt: string; user?: { email?: string } };
      }) => {
        const m = d?.message;
        if (!m) return;
        setMessages((prec) => [
          ...prec,
          {
            id: m.id,
            type: 'user',
            author: m.user?.email?.split('@')[0] ?? 'joueur',
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
            // La modération a masqué le message : le composant Chat affiche
            // alors un avertissement à la place du contenu.
            moderated: d.action === 'delete',
          },
        ]);
      }),
      // Réponses du bot : on les affiche comme un message de type "bot" pour
      // que le Chat les distingue visuellement des joueurs.
      ecouter('ai:token', (d: { text: string }) => {
        setMessages((prec) => {
          const dernier = prec[prec.length - 1];
          // Le flux arrive mot par mot : on complète le dernier message du bot
          // au lieu d'en créer un par jeton.
          if (dernier?.type === 'bot' && dernier.id === 'bot-en-cours') {
            return [...prec.slice(0, -1), { ...dernier, content: dernier.content + d.text }];
          }
          return [...prec, { id: 'bot-en-cours', type: 'bot', author: 'FactBot', content: d.text, timestamp: Date.now() }];
        });
      }),
      ecouter('ai:done', () => {
        // Le message du bot est terminé : on lui donne un identifiant définitif
        // pour que le prochain n'y soit pas concaténé.
        setMessages((prec) =>
          prec.map((m) => (m.id === 'bot-en-cours' ? { ...m, id: `bot-${Date.now()}` } : m)),
        );
      }),
      // Révélation : le back publie les verdicts, on peut enfin les afficher.
      ecouter('round:revealed', (d: { verdicts?: unknown[] }) => {
        void d;
        rafraichirSolde();
      }),
      ecouter('round:verdicts', (liste: Array<{ claimId: string; truthLabel: string; text?: string; verdictText?: string; sourceUrl?: string }>) => {
        const resultatsClips: ClipResult[] = liste.map((v) => {
          // Le back renvoie un truthLabel binaire (TRUE/FALSE). Les verdicts
          // nuancés (TROMPEUR, HORS_CONTEXTE) n'existent pas encore côté base :
          // on retombe donc sur VRAI/FAUX. À faire évoluer si la colonne est
          // ajoutée (voir docs/CLAIMS.md).
          const verdict: ClipVerdict = v.truthLabel === 'TRUE' ? 'VRAI' : 'FAUX';
          return {
            id: v.claimId,
            verdict,
            title: v.text ?? '',
            explanation: v.verdictText ?? "Explication en cours de génération.",
            source: v.sourceUrl ?? '',
          };
        });
        setResultats(resultatsClips);
        setBonnesReponses(
          resultatsClips.filter((r) => {
            const vote = mesVotes[r.id];
            return vote !== undefined && vote === (r.verdict === 'FAUX');
          }).length,
        );
      }),
    ];
    return () => arret.forEach((stop) => stop());
  }, [connecte, ecouter, mesVotes, rafraichirSolde]);

  function voter(estFake: boolean) {
    if (!clipCourant || !round?.id || !roomId) return;
    emettre('clip-vote:submit', { roomId, roundId: round.id, claimId: clipCourant.id, isFake: estFake });
    setMesVotes((prec) => ({ ...prec, [clipCourant.id]: estFake }));
    // On enchaîne sur le clip suivant : c'est la progression côté client
    // évoquée en tête de fichier.
    if (indexClip < clips.length - 1) setIndexClip((i) => i + 1);
  }

  function envoyerMessage(contenu: string) {
    if (!roomId) return;
    emettre('chat:send', { roomId, content: contenu });
  }

  // Lancement d'une manche. Sans ce bouton, aucune partie ne pouvait démarrer
  // depuis l'interface : il fallait appeler l'API à la main. Le serveur tire
  // lui-même les clips, on ne lui envoie que leur nombre et la durée.
  const [lancement, setLancement] = useState(false);
  const [erreurManche, setErreurManche] = useState<string | null>(null);
  async function lancerManche() {
    if (!roomId) return;
    setLancement(true);
    setErreurManche(null);
    try {
      await api('/rounds', {
        method: 'POST',
        body: { roomId, claimCount: 6, durationSeconds: 180 },
      });
      // Pas besoin de recharger : le serveur diffuse le nouvel état par
      // WebSocket, la page se met à jour toute seule.
      setIndexClip(0);
      setMesVotes({});
      setResultats(null);
    } catch (e) {
      // Cas courants : on n'est pas l'hôte du salon, ou une manche est déjà
      // en cours. On l'affiche au lieu de laisser le bouton sans effet.
      setErreurManche(e instanceof Error ? e.message : 'Lancement impossible');
    } finally {
      setLancement(false);
    }
  }

  if (!roomId) {
    return (
      <section className="bg-noir-krystal w-full min-h-full p-6 text-white">
        <p>Salon introuvable. <Link to="/play" className="text-bleu-l underline">Retour à la liste</Link></p>
      </section>
    );
  }

  const dejaVote = clipCourant ? mesVotes[clipCourant.id] !== undefined : false;

  return (
    <section className="bg-noir-krystal w-full min-h-full p-6 space-y-4">
      <StatsBar
        stats={{
          clipIndex: Math.min(indexClip + 1, clips.length),
          totalClips: clips.length,
          correctAnswers: bonnesReponses,
          pot: etat?.pot ?? 0,
          balance,
        }}
      />

      {/* État de la connexion : un joueur doit comprendre pourquoi rien ne
          bouge si le réseau est coupé, plutôt que de voir une page figée. */}
      {!connecte && (
        <p className="text-amber-400 text-sm">Connexion au salon en cours...</p>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-gris-krystal rounded-xl p-3 space-y-3">
          <div className="relative">
            <span className="absolute top-2 left-2 z-10 text-xs text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> LIVE
            </span>
            {clipCourant?.mediaRef ? (
              <VideoPlayer src={clipCourant.mediaRef} />
            ) : (
              // Beaucoup de claims n'ont pas encore de vidéo associée : on
              // affiche alors l'affirmation, ce qui reste parfaitement jouable.
              <div className="aspect-video bg-noir-krystal rounded flex items-center justify-center p-8">
                <p className="text-white text-lg text-center">
                  {clipCourant?.text ?? 'En attente du lancement de la manche...'}
                </p>
              </div>
            )}
          </div>

          {clipCourant && (
            <p className="text-white text-sm">{clipCourant.text}</p>
          )}

          {/* Aucune manche en cours : on propose de la lancer. */}
          {!round && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={lancerManche}
                disabled={lancement || !connecte}
                className="button-blue-d px-4 py-3 disabled:opacity-40"
              >
                {lancement ? 'Lancement...' : 'Lancer une manche (6 clips)'}
              </button>
              {erreurManche && (
                <p role="alert" className="text-red-l text-sm">{erreurManche}</p>
              )}
            </div>
          )}

          {/* Vote good/fake : le cœur du jeu. Désactivé hors fenêtre ouverte ou
              si le joueur a déjà tranché ce clip. */}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!manchOuverte || dejaVote || !clipCourant}
              onClick={() => voter(false)}
              className="flex-1 button-blue-l px-4 py-3 disabled:opacity-40"
            >
              Good news
            </button>
            <button
              type="button"
              disabled={!manchOuverte || dejaVote || !clipCourant}
              onClick={() => voter(true)}
              className="flex-1 button-red-l px-4 py-3 disabled:opacity-40"
            >
              Fake news
            </button>
          </div>
          {dejaVote && (
            <p className="text-gray-400 text-sm">Vote enregistré pour ce clip.</p>
          )}
        </div>

        <div className="col-span-1">
          <Chat
            messages={messages}
            roomLabel={etat?.room?.name ? `Chat — ${etat.room.name}` : 'Chat du salon'}
            onSendMessage={envoyerMessage}
          />
        </div>
      </div>

      {/* Résultats : affichés seulement après la révélation, plus en permanence. */}
      {resultats && (
        <ResultsReveal
          correctCount={bonnesReponses}
          totalClips={clips.length}
          clipResults={resultats}
          leaderboard={[]}
        />
      )}
    </section>
  );
}
