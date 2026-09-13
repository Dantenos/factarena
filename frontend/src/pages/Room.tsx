import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import VideoPlayer from '../components/VideoPlayer';
import Chat from '../components/Chat';
import StatsBar from '../components/StatsBar';
import ResultsReveal from '../components/ResultsReveal';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { api, solde } from '../api/client';
import type { ChatMessage, ClipResult, ClipVerdict, LeaderboardEntry } from '../mocks/gameData';

interface ClipEnJeu {
  claim: {
    id: string;
    text: string;
    mediaRef: string | null;
    category: string | null;
    sourceUrl: string | null;
  };
}

const CLIPS_PAR_MANCHE = 5;

const MISES = [50, 100, 250];

const RENVOI_AUX_PASSAGES = /\[\d+\]/;

function accueilBot(): ChatMessage {
  return {
    id: 'accueil-bot',
    type: 'bot',
    author: 'FactBot',
    content:
      "Je suis l’assistant du salon. Écris « @bot » suivi de ta question et je réponds "
      + "en citant mes sources. Les autres joueurs, eux, disent ce qu’ils veulent. "
      + "Je ne dis jamais si un clip en cours est vrai ou faux, mais je peux t'éclairer "
      + 'sur le sujet et sur la façon de le vérifier.',
    timestamp: Date.now(),
  };
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const { utilisateur } = useAuth();
  const { connecte, etat, erreur: erreurConnexion, emettre, demander, ecouter } = useSocket(roomId ?? null);

  const [messages, setMessages] = useState<ChatMessage[]>([accueilBot()]);
  const [balance, setBalance] = useState(0);
  const [mise, setMise] = useState<number | null>(null);
  const [lancement, setLancement] = useState(false);
  const [erreurManche, setErreurManche] = useState<string | null>(null);
  const [signales, setSignales] = useState<Record<string, true>>({});
  const [hoteParti, setHoteParti] = useState(false);
  const [mesVotes, setMesVotes] = useState<Record<string, boolean>>({});
  const [resultats, setResultats] = useState<ClipResult[] | null>(null);
  const [bonnesReponses, setBonnesReponses] = useState(0);
  const [classement, setClassement] = useState<LeaderboardEntry[]>([]);
  const sourcesEnAttente = useRef<Array<{ title?: string; url: string }>>([]);

  const round = etat?.round as { id?: string; status?: string; currentClipIndex?: number; roundClaims?: ClipEnJeu[] } | null;
  const clips = round?.roundClaims ?? [];
  const indexClip = round?.currentClipIndex ?? 0;
  const clipCourant = clips[indexClip]?.claim ?? null;
  const manchOuverte = round?.status === 'OPEN';
  const manchePreparee = round?.status === 'COUNTDOWN';
  const partieLancee = etat?.room?.status === 'IN_PROGRESS' && manchOuverte;
  const nombreJoueurs = etat?.members?.length ?? 0;
  const estHote = etat?.room?.createdBy === utilisateur?.id;
  const cleClips = clips.map((clip) => clip.claim.id).join(',');
  const meilleurScore = classement.length > 0
    ? Math.max(...classement.map((entree) => entree.correctCount))
    : -1;
  const joueurGagnant = classement.some((entree) =>
    entree.userId === utilisateur?.id && entree.correctCount === meilleurScore,
  );

  const rafraichirSolde = useCallback(() => {
    solde()
      .then((r) => setBalance(r.virtualBalance))
      .catch(() => { });
  }, []);
  useEffect(rafraichirSolde, [rafraichirSolde]);

  const idManche = (etat?.round as { id?: string } | null)?.id;
  useEffect(() => {
    if (!idManche) { setMise(null); return; }
    api<Array<{ stake?: number }>>(`/bets/round/${idManche}`)
      .then((liste) => {
        const montant = liste[0]?.stake;
        setMise(typeof montant === 'number' ? montant : null);
      })
      .catch(() => setMise(null));
  }, [idManche]);

  useEffect(() => {
    if (!idManche || !cleClips) return;
    let annule = false;
    setMesVotes({});
    api<Array<{ claimId: string; userId?: string; isFake: boolean }>>(`/clip-votes/round/${idManche}`)
      .then((votes) => {
        if (annule) return;
        const votesDuJoueur = votes.filter((vote) => !vote.userId || vote.userId === utilisateur?.id);
        const votesRestaures = Object.fromEntries(votesDuJoueur.map((vote) => [vote.claimId, vote.isFake]));
        setMesVotes(votesRestaures);
      })
      .catch(() => { });
    return () => { annule = true; };
  }, [cleClips, idManche, utilisateur?.id]);

  const preparationDemandee = useRef(false);
  useEffect(() => {
    if (!connecte || !estHote || etat?.room?.status !== 'WAITING' || round || preparationDemandee.current) return;
    preparationDemandee.current = true;
    demander('round:prepare', { roomId, claimCount: CLIPS_PAR_MANCHE })
      .catch((e) => setErreurManche(e instanceof Error ? e.message : 'Préparation impossible'));
  }, [connecte, demander, estHote, etat?.room?.status, roomId, round]);

  function miser(montant: number) {
    if (!roomId || !idManche || mise !== null || montant > balance) return;
    emettre('bet:place', { roomId, roundId: idManche, stake: montant });
  }

  useEffect(() => {
    if (!connecte) return;
    const arret = [
      ecouter('room:joined', () => {
        api<Array<{ id: string; content: string; createdAt: string; user?: { displayName?: string | null } }>>(
          `/chat/room/${roomId}`,
        )
          .then((liste) =>
            setMessages([
              accueilBot(),
              ...liste.map((m) => ({
                id: m.id,
                type: 'user' as const,
                author: m.user?.displayName || 'joueur',
                content: m.content,
                timestamp: new Date(m.createdAt).getTime(),
              })),
            ]),
          )
          .catch(() => { });
      }),
      ecouter('chat:message', (d: {
        action?: string;
        message?: { id: string; content: string; createdAt: string; user?: { displayName?: string | null } };
      }) => {
        const m = d?.message;
        if (!m) return;
        setMessages((prec) => [
          ...prec,
          {
            id: m.id,
            type: 'user',
            author: m.user?.displayName || 'joueur',
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
            moderated: d.action === 'delete',
          },
        ]);
      }),
      ecouter('chat:moderated', (d: { reason?: string }) => {
        setMessages((prec) => [
          ...prec,
          {
            id: `mod-${Date.now()}`,
            type: 'system',
            author: 'modération',
            content: d?.reason ?? 'Message bloqué par la modération.',
            timestamp: Date.now(),
          },
        ]);
      }),
      ecouter('room:host_left', () => {
        setHoteParti(true);
      }),
      ecouter('ai:token', (d: { text: string }) => {
        setMessages((prec) => {
          const dernier = prec[prec.length - 1];
          if (dernier?.type === 'bot' && dernier.id === 'bot-en-cours') {
            return [...prec.slice(0, -1), { ...dernier, content: dernier.content + d.text }];
          }
          return [...prec, {
            id: 'bot-en-cours', type: 'bot', author: 'FactBot', content: d.text,
            timestamp: Date.now(), sources: sourcesEnAttente.current,
          }];
        });
      }),
      ecouter('ai:sources', (liste: Array<{ title?: string; url: string }>) => {
        sourcesEnAttente.current = Array.isArray(liste) ? liste.filter((s) => s?.url) : [];
      }),
      ecouter('ai:done', () => {
        sourcesEnAttente.current = [];
        setMessages((prec) =>
          prec.map((m) =>
            m.id === 'bot-en-cours'
              ? {
                  ...m,
                  id: `bot-${Date.now()}`,
                  sources: RENVOI_AUX_PASSAGES.test(m.content) ? m.sources : undefined,
                }
              : m,
          ),
        );
      }),
      ecouter('ai:error', (d: { message?: string }) => {
        const texte = d?.message?.trim() || "L'assistant n'a pas pu répondre.";
        sourcesEnAttente.current = [];
        setMessages((prec) => {
          const enCours = prec.some((m) => m.id === 'bot-en-cours');
          if (enCours) {
            return prec.map((m) =>
              m.id === 'bot-en-cours'
                ? { ...m, id: `bot-${Date.now()}`, content: texte, sources: undefined }
                : m,
            );
          }
          return [...prec, { id: `bot-${Date.now()}`, type: 'bot', author: 'FactBot', content: texte, timestamp: Date.now() }];
        });
      }),
      ecouter('bet:updated', () => {
        if (!idManche) return;
        api<unknown[]>(`/bets/round/${idManche}`)
          .then((liste) => {
            const montant = (liste[0] as { stake?: number } | undefined)?.stake;
            setMise(typeof montant === 'number' ? montant : null);
            rafraichirSolde();
          })
          .catch(() => { });
      }),
      ecouter('round:revealed', (d: { verdicts?: unknown[] }) => {
        void d;
        rafraichirSolde();
      }),
      ecouter('round:verdicts', (charge: {
        roundId?: string; verdicts?: unknown[]; classement?: LeaderboardEntry[];
      } | unknown[]) => {
        const liste = (Array.isArray(charge) ? charge : charge?.verdicts ?? []) as Array<{
          claimId: string; truthLabel: string; text?: string; verdictText?: string; sourceUrl?: string;
          explanationSource?: 'rag' | 'editorial';
        }>;
        if (!Array.isArray(charge)) setClassement(charge?.classement ?? []);
        const resultatsClips: ClipResult[] = liste.map((v) => {
          const verdict: ClipVerdict = v.truthLabel === 'TRUE' ? 'VRAI' : 'FAUX';

          const brut = v.verdictText ?? '';
          const [explication, apres] = brut.split(/\n\s*\n\s*Second avis de l'IA[^:]*:\s*/);
          let aiGuess: ClipResult['aiGuess'];
          let aiGuessWhy: string | undefined;
          if (apres) {
            const m = apres.match(/^(VRAI|FAUX|INCERTAIN)\b\.?\s*(.*)$/s);
            if (m) {
              aiGuess = m[1] as ClipResult['aiGuess'];
              aiGuessWhy = m[2]?.trim() || undefined;
            }
          }

          return {
            id: v.claimId,
            verdict,
            title: v.text ?? '',
            explanation: explication?.trim() || "Explication en cours de génération.",
            source: v.sourceUrl ?? '',
            explanationSource: v.explanationSource,
            userVote: mesVotes[v.claimId] === undefined
              ? undefined
              : mesVotes[v.claimId] ? 'FAUX' : 'VRAI',
            aiGuess,
            aiGuessWhy,
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
  }, [connecte, ecouter, mesVotes, rafraichirSolde, idManche, roomId]);

  useEffect(() => ecouter('profile:update', (profilMisAJour: {
    id?: string;
    displayName?: string | null;
  }) => {
    if (!profilMisAJour?.id || !profilMisAJour.displayName) return;
    setClassement((precedent) => precedent.map((entree) => entree.userId === profilMisAJour.id
      ? { ...entree, username: profilMisAJour.displayName as string }
      : entree));
  }), [ecouter]);

  useEffect(() => {
    const mettreAJourSolde = (event: Event) => {
      const soldeMisAJour = (event as CustomEvent<{ userId?: string; virtualBalance?: number }>).detail;
      if (soldeMisAJour?.userId !== undefined && typeof soldeMisAJour.virtualBalance === 'number') {
        setBalance(soldeMisAJour.virtualBalance);
      }
    };
    window.addEventListener('factarena:balance-update', mettreAJourSolde);
    return () => window.removeEventListener('factarena:balance-update', mettreAJourSolde);
  }, []);

  function voter(estFake: boolean) {
    if (!clipCourant || !round?.id || !roomId) return;
    setErreurManche(null);
    demander('clip-vote:submit', { roomId, roundId: round.id, claimId: clipCourant.id, isFake: estFake })
      .then(() => setMesVotes((prec) => ({ ...prec, [clipCourant.id]: estFake })))
      .catch((e) => setErreurManche(e instanceof Error ? e.message : 'Vote impossible'));
  }

  function envoyerMessage(contenu: string) {
    if (!roomId) return;
    emettre('chat:send', { roomId, content: contenu });
  }

  function signalerClip() {
    if (!clipCourant || !roomId || signales[clipCourant.id]) return;
    emettre('clip:report', { roomId, roundId: round?.id, claimId: clipCourant.id });
    setSignales((prec) => ({ ...prec, [clipCourant.id]: true }));
  }

  async function lancerManche() {
    if (!roomId || !round?.id) return;
    setLancement(true);
    setErreurManche(null);
    try {
      await demander('round:start', { roomId, roundId: round.id });
      setMesVotes({});
      setResultats(null);
    } catch (e) {
      setErreurManche(e instanceof Error ? e.message : 'Lancement impossible');
    } finally {
      setLancement(false);
    }
  }

  async function passerAuClipSuivant() {
    if (!roomId || !round?.id) return;
    setErreurManche(null);
    try {
      await demander('round:next', { roomId, roundId: round.id });
    } catch (e) {
      setErreurManche(e instanceof Error ? e.message : 'Impossible de passer au clip suivant');
    }
  }

  async function voirVerdict() {
    if (!roomId || !round?.id) return;
    setErreurManche(null);
    try {
      await demander('round:reveal', { roomId, roundId: round.id });
    } catch (e) {
      setErreurManche(e instanceof Error ? e.message : 'Impossible d’afficher le verdict');
    }
  }

  async function quitterPartie() {
    if (roomId) {
      try {
        await demander('room:leave', { roomId });
      } catch {
      }
    }
    window.location.assign('/play');
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
    <section className="bg-noir-krystal w-full min-h-full p-4 sm:p-6 space-y-4">
      <StatsBar
        stats={{
          clipIndex: Math.min(indexClip + 1, clips.length),
          totalClips: clips.length || CLIPS_PAR_MANCHE,
          correctAnswers: bonnesReponses,
          pot: etat?.pot ?? 0,
          balance,
          playerCount: Math.min(etat?.members?.length ?? 0, 5),
        }}
      />

      {hoteParti && (
        <p role="alert" className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-base font-semibold text-amber-200">
          L’hôte a quitté la partie. Veuillez quitter la partie.
        </p>
      )}

      {!connecte && (
        <p className="text-amber-400 text-sm">Connexion au salon en cours...</p>
      )}
      {erreurConnexion && (
        <p role="alert" className="text-red-l text-sm">{erreurConnexion}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-gris-krystal rounded-xl p-3 space-y-3">
          <div className="relative">
            {partieLancee && clipCourant?.mediaRef ? (
              <VideoPlayer src={clipCourant.mediaRef} />
            ) : (
              <div className="aspect-video bg-noir-krystal rounded flex items-center justify-center p-8">
                <p className="text-white text-lg text-center">
                  {partieLancee
                    ? (clipCourant?.text ?? 'En attente du clip...')
                    : resultats
                      ? 'La partie est terminée !'
                      : 'En attente du lancement de la manche...'}
                </p>
              </div>
            )}
          </div>

          {partieLancee && clipCourant && (
            <p className="text-white text-sm">{clipCourant.text}</p>
          )}

          {!round && (
            <div className="flex flex-col gap-2">
              <p className="text-white/50 text-sm">{estHote ? 'Préparation de la manche...' : 'En attente de la préparation de la manche par l’hôte.'}</p>
            </div>
          )}

          {manchePreparee && (
            <div className="flex flex-col gap-2">
              {estHote ? (
                <button
                  type="button"
                  onClick={lancerManche}
                  disabled={lancement || !connecte || nombreJoueurs < 2}
                  className="button-blue-d px-4 py-3 disabled:opacity-40"
                >
                  {lancement ? 'Lancement...' : `Lancer la partie (${clips.length} clips)`}
                </button>
              ) : (
                <p className="text-white/50 text-sm">En attente du lancement par l’hôte.</p>
              )}
              {estHote && connecte && nombreJoueurs < 2 && (
                <p className="text-white/50 text-sm">Il faut au moins 2 joueurs présents pour lancer une partie.</p>
              )}
            </div>
          )}

          {round && manchePreparee && mise === null && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/50 text-sm">Fais ta mise pour que l’hôte puisse lancer la partie :</span>
              {MISES.map((montant) => (
                <button
                  key={montant}
                  type="button"
                  onClick={() => miser(montant)}
                  disabled={montant > balance}
                  className="button-blue-l px-4 py-2 text-sm disabled:opacity-40"
                  title={montant > balance ? 'Solde insuffisant' : undefined}
                >
                  {montant} cr
                </button>
              ))}
              <span className="text-white/30 text-xs">solde {balance}</span>
            </div>
          )}
          {round && manchePreparee && mise !== null && (
            <p className="text-emerald-400/80 text-sm">
              Mise enregistrée : {mise}.
            </p>
          )}

          {manchePreparee && mise === null && (
            <p className="text-amber-300/80 text-sm">Tu dois miser avant le lancement de la partie.</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              disabled={!partieLancee || dejaVote || !clipCourant}
              onClick={() => voter(false)}
              className="flex-1 button-green-l px-4 py-3 disabled:opacity-40"
            >
              FACT
            </button>
            <button
              type="button"
              disabled={!partieLancee || dejaVote || !clipCourant}
              onClick={() => voter(true)}
              className="flex-1 button-red-l px-4 py-3 disabled:opacity-40"
            >
              FAKE
            </button>
          </div>
          {dejaVote && (
            <p className="text-gray-400 text-sm">Vote définitif enregistré pour ce clip. En attente de l’hôte.</p>
          )}

          {partieLancee && !dejaVote && <p className="text-amber-300/80 text-sm">Vote Fact ou Fake pour continuer.</p>}

          {partieLancee && estHote && dejaVote && indexClip < clips.length - 1 && (
            <button type="button" onClick={passerAuClipSuivant} className="button-blue-d w-full px-4 py-3">
              Vidéo suivante
            </button>
          )}
          {partieLancee && estHote && indexClip >= clips.length - 1 && dejaVote && (
            <button type="button" onClick={voirVerdict} className="button-blue-d w-full px-4 py-3">
              Voir le verdict
            </button>
          )}
          {partieLancee && !estHote && dejaVote && (
            <p className="text-white/50 text-sm">En attente de l’hôte pour passer à la suite.</p>
          )}
          {estHote && erreurManche && <p role="alert" className="text-red-l text-sm">{erreurManche}</p>}

          {partieLancee && clipCourant && (
            <button
              type="button"
              onClick={signalerClip}
              disabled={!!signales[clipCourant.id]}
              className="text-xs text-gray-500 hover:text-gray-300 underline disabled:no-underline disabled:text-gray-600"
            >
              {signales[clipCourant.id]
                ? 'Clip signalé, merci'
                : 'Cette vidéo ne correspond pas à l’affirmation ?'}
            </button>
          )}
        </div>

        <div className="h-[60vh] lg:h-auto lg:col-span-1">
          <Chat
            messages={messages}
            roomLabel={etat?.room?.name ? `Chat : ${etat.room.name}` : 'Chat du salon'}
            onSendMessage={envoyerMessage}
          />
        </div>
      </div>

      {resultats && (
        <ResultsReveal
          correctCount={bonnesReponses}
          totalClips={resultats.length}
          clipResults={resultats}
          leaderboard={classement}
          isWinner={joueurGagnant}
        />
      )}
      {resultats && (
        <button
          type="button"
          onClick={quitterPartie}
          className="text-base sm:text-lg button-red-d px-3 sm:px-5 py-1"
        >
          Quitter la partie
        </button>
      )}
    </section>
  );
}
