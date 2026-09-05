// Page Salon — branchée sur le back, plus sur les mocks. On ne garde de
// mocks/gameData.ts que ses types.
//
// Écart avec la doc : elle décrit une fenêtre de vote par clip, le back en
// implémente une seule pour toute la manche (opensAt -> locksAt). On suit le
// comportement réel — le joueur avance à son rythme, ses votes doivent juste
// tomber avant le verrouillage. À trancher en équipe.
import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import VideoPlayer from '../components/VideoPlayer';
import Chat from '../components/Chat';
import StatsBar from '../components/StatsBar';
import ResultsReveal from '../components/ResultsReveal';
import { useSocket } from '../hooks/useSocket';
import { api, solde } from '../api/client';
import type { ChatMessage, ClipResult, ClipVerdict, LeaderboardEntry } from '../mocks/gameData';

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

// Longueur d'une manche. Assez long pour que le classement départage vraiment
// les joueurs plutôt que de récompenser un coup de chance. La constante sert
// aussi au libellé du bouton, qui annonçait un chiffre différent de celui
// réellement demandé au serveur.
const CLIPS_PAR_MANCHE = 5;

// Trois paliers plutôt qu'un champ libre : rien à valider, et le joueur choisit
// en un clic pendant que la fenêtre de vote tourne.
const MISES = [50, 100, 250];

/**
 * Marques d'un renvoi aux passages récupérés. Elles décident si l'on affiche les
 * citations sous la réponse.
 *
 * La recherche vectorielle rend toujours ses six plus proches voisins, même
 * quand aucun n'a de rapport : sur « c'est quoi un orage ? » elle remonte des
 * articles sur les ovnis. Afficher ces sources sous une réponse de culture
 * générale laisserait croire qu'elles l'étayent.
 *
 * Un seuil de distance ne trancherait pas — mesuré sur ce corpus, « comment
 * cuire des pâtes » sort à 0,32 et « vidéo sortie de son contexte », pourtant
 * couvert, à 0,31. On se fie donc à ce que le modèle a réellement fait : s'il
 * n'a renvoyé à aucun passage, il a répondu de lui-même, et on ne cite rien.
 */
const RENVOI_AUX_PASSAGES =
  /\[\d+\]|d'apr[èe]s les passages|selon les passages|les passages (fournis|indiquent|montrent|abordent)/i;

/**
 * Mot d'accueil de l'assistant, replacé en tête à chaque fois que la liste des
 * messages est reconstruite. Rien à l'écran ne disait qu'il existe, ni qu'il est
 * fiable contrairement aux trois faux joueurs qui, eux, mentent volontiers.
 */
function accueilBot(): ChatMessage {
  return {
    id: 'accueil-bot',
    type: 'bot',
    author: 'FactBot',
    content:
      "Je suis l'assistant du salon. Écris « @bot » suivi de ta question et je réponds "
      + "en citant mes sources — les autres joueurs, eux, disent ce qu'ils veulent. "
      + "Je ne dis jamais si un clip en cours est vrai ou faux, mais je peux t'éclairer "
      + 'sur le sujet et sur la façon de le vérifier.',
    timestamp: Date.now(),
  };
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const { connecte, etat, erreur: erreurConnexion, emettre, ecouter } = useSocket(roomId ?? null);

  const [messages, setMessages] = useState<ChatMessage[]>([accueilBot()]);
  const [balance, setBalance] = useState(0);
  const [aMise, setAMise] = useState(false);
  const [indexClip, setIndexClip] = useState(0);
  // Vote du joueur par claim : sert à griser les boutons déjà utilisés.
  const [mesVotes, setMesVotes] = useState<Record<string, boolean>>({});
  const [resultats, setResultats] = useState<ClipResult[] | null>(null);
  const [bonnesReponses, setBonnesReponses] = useState(0);
  // Classement de la manche, calculé par le serveur et transmis avec les verdicts.
  const [classement, setClassement] = useState<LeaderboardEntry[]>([]);

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

  // L'état diffusé ne donne que le pot global. Pour savoir si CE joueur a
  // déjà misé sur la manche en cours, on demande ses propres mises.
  const idManche = (etat?.round as { id?: string } | null)?.id;
  useEffect(() => {
    if (!idManche) { setAMise(false); return; }
    api<unknown[]>(`/bets/round/${idManche}`)
      .then((liste) => setAMise(liste.length > 0))
      .catch(() => setAMise(false));
  }, [idManche]);

  function miser(montant: number) {
    if (!roomId || !idManche || aMise || montant > balance) return;
    emettre('bet:place', { roomId, roundId: idManche, stake: montant });
  }

  // Abonnements aux événements temps réel.
  useEffect(() => {
    if (!connecte) return;
    const arret = [
      // L'historique n'est lisible qu'après room:join — le back exige d'être
      // membre. Le charger au montage donnait un 403 en console.
      ecouter('room:joined', () => {
        api<Array<{ id: string; content: string; createdAt: string; user?: { email?: string } }>>(
          `/chat/room/${roomId}`,
        )
          .then((liste) =>
            setMessages([
              accueilBot(),
              ...liste.map((m) => ({
                id: m.id,
                type: 'user' as const,
                author: m.user?.email?.split('@')[0] ?? 'joueur',
                content: m.content,
                timestamp: new Date(m.createdAt).getTime(),
              })),
            ]),
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
      // Modération : seul l'auteur du message reçoit cet événement. On l'affiche
      // comme une ligne système, sans reprendre le contenu bloqué.
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
      ecouter('ai:sources', (liste: Array<{ title?: string; url: string }>) => {
        const sources = Array.isArray(liste) ? liste.filter((s) => s?.url) : [];
        setMessages((prec) => [
          ...prec,
          { id: 'bot-en-cours', type: 'bot', author: 'FactBot', content: '', timestamp: Date.now(), sources },
        ]);
      }),
      ecouter('ai:done', () => {
        // Le message du bot est terminé : on lui donne un identifiant définitif
        // pour que le prochain n'y soit pas concaténé.
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
      // Le serveur confirme la mise en diffusant bet:updated. On relit nos
      // propres mises plutôt que de faire confiance à l'émission : elle peut
      // être refusée, et l'événement concerne aussi les autres joueurs.
      ecouter('bet:updated', () => {
        if (!idManche) return;
        api<unknown[]>(`/bets/round/${idManche}`)
          .then((liste) => { setAMise(liste.length > 0); rafraichirSolde(); })
          .catch(() => { /* sans réponse, on laisse l'état inchangé */ });
      }),
      // Révélation : le back publie les verdicts, on peut enfin les afficher.
      ecouter('round:revealed', (d: { verdicts?: unknown[] }) => {
        void d;
        rafraichirSolde();
      }),
      // Le back n'envoie pas un tableau nu mais une enveloppe
      // { roundId, verdicts, classement } (voir publishRoundVerdicts dans la
      // gateway). Attendre un tableau faisait échouer le .map, et rien ne
      // s'affichait en fin de manche.
      ecouter('round:verdicts', (charge: {
        roundId?: string; verdicts?: unknown[]; classement?: LeaderboardEntry[];
      } | unknown[]) => {
        const liste = (Array.isArray(charge) ? charge : charge?.verdicts ?? []) as Array<{
          claimId: string; truthLabel: string; text?: string; verdictText?: string; sourceUrl?: string;
          explanationSource?: 'rag' | 'editorial';
        }>;
        if (!Array.isArray(charge)) setClassement(charge?.classement ?? []);
        const resultatsClips: ClipResult[] = liste.map((v) => {
          // Le back renvoie un truthLabel binaire (TRUE/FALSE). Les verdicts
          // nuancés (TROMPEUR, HORS_CONTEXTE) n'existent pas encore côté base :
          // on retombe donc sur VRAI/FAUX. À faire évoluer si la colonne est
          // ajoutée (voir docs/CLAIMS.md).
          const verdict: ClipVerdict = v.truthLabel === 'TRUE' ? 'VRAI' : 'FAUX';

          // Le back accole le second avis au verdict après une ligne vide
          // (ai.service.ts). On sépare, sinon le joueur confond les deux.
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
            userVoted: mesVotes[v.claimId] !== undefined,
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

  // Le classement de fin de manche contient un nom figé au moment de la
  // révélation. On le corrige aussi lorsqu'un joueur renomme son compte.
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

  // Clips signalés par le joueur, pour changer le libellé du bouton. On ne
  // vide pas cet état entre les manches : un clip déjà signalé le reste.
  const [signales, setSignales] = useState<Record<string, true>>({});
  function signalerClip() {
    if (!clipCourant || !roomId || signales[clipCourant.id]) return;
    emettre('clip:report', { roomId, roundId: round?.id, claimId: clipCourant.id });
    // Retour immédiat sans attendre le serveur : le signalement n'est pas
    // critique, et un bouton qui ne réagit pas donne l'impression d'un bug.
    setSignales((prec) => ({ ...prec, [clipCourant.id]: true }));
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
      const resultat = await api<{ alreadyActive?: boolean }>('/rounds', {
        method: 'POST',
        body: { roomId, claimCount: CLIPS_PAR_MANCHE, durationSeconds: 300 },
      });
      if (resultat.alreadyActive) {
        setErreurManche('Une manche est déjà en cours.');
        return;
      }
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
    <section className="bg-noir-krystal w-full min-h-full p-4 sm:p-6 space-y-4">
      <StatsBar
        stats={{
          clipIndex: Math.min(indexClip + 1, clips.length),
          totalClips: clips.length || CLIPS_PAR_MANCHE,
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
      {erreurConnexion && (
        <p role="alert" className="text-red-l text-sm">{erreurConnexion}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-gris-krystal rounded-xl p-3 space-y-3">
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
                {lancement ? 'Lancement...' : `Lancer une manche (${CLIPS_PAR_MANCHE} clips)`}
              </button>
              {erreurManche && (
                <p role="alert" className="text-red-l text-sm">{erreurManche}</p>
              )}
            </div>
          )}

          {/* Mise de la manche. Le serveur acceptait « bet:place » depuis le
              début, mais rien ne l'émettait : le pot restait donc à zéro et les
              crédits ne servaient à rien. Une seule mise par manche, posée
              pendant que la fenêtre est ouverte. */}
          {round && manchOuverte && !aMise && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/50 text-sm">Ta mise :</span>
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
          {round && aMise && (
            <p className="text-emerald-400/80 text-sm">
              Mise enregistrée — pot commun : {etat?.pot ?? 0} crédits.
            </p>
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

          {/* Navigation entre clips. Jusqu'ici on n'avançait qu'en votant, ce
              qui empêchait de revenir sur un clip et rendait impossible de
              parcourir la compilation pour la trier. */}
          <div className="flex gap-3 items-center text-sm">
            <button
              type="button"
              onClick={() => setIndexClip((i) => Math.max(0, i - 1))}
              disabled={indexClip === 0}
              className="text-gray-400 hover:text-white disabled:text-gray-700"
            >
              ← précédent
            </button>
            <span className="text-gray-600">
              {clips.length > 0 ? `${indexClip + 1} / ${clips.length}` : '—'}
            </span>
            <button
              type="button"
              onClick={() => setIndexClip((i) => Math.min(clips.length - 1, i + 1))}
              disabled={indexClip >= clips.length - 1}
              className="text-gray-400 hover:text-white disabled:text-gray-700"
            >
              suivant →
            </button>
          </div>

          {/* Tous les clips votés, manche encore ouverte : sans ce message on
              croit l'application bloquée, alors qu'on attend simplement la fin
              du chronomètre pour la révélation. */}
          {manchOuverte && clips.length > 0 && Object.keys(mesVotes).length >= clips.length && (
            <p className="text-emerald-400/80 text-sm">
              Tu as voté sur tous les clips — la révélation arrive à la fin du temps imparti.
            </p>
          )}

          {/* Signalement : le corpus est constitué automatiquement, et quelques
              vidéos ne correspondent pas à leur affirmation. Le joueur est le
              mieux placé pour le voir. Volontairement discret — ce n'est pas
              une action de jeu, et il ne faut pas la confondre avec un vote. */}
          {clipCourant && (
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
            roomLabel={etat?.room?.name ? `Chat — ${etat.room.name}` : 'Chat du salon'}
            onSendMessage={envoyerMessage}
          />
        </div>
      </div>

      {/* Résultats : affichés seulement après la révélation, plus en permanence. */}
      {/* Le total vient des résultats reçus, pas des clips en mémoire : une
          fois la manche finie le serveur ne renvoie plus de manche active,
          clips retombe à zéro et le score s'affichait « 3/0 ». */}
      {resultats && (
        <ResultsReveal
          correctCount={bonnesReponses}
          totalClips={resultats.length}
          clipResults={resultats}
          leaderboard={classement}
        />
      )}
    </section>
  );
}
