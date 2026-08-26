import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Faux joueurs qui animent le chat pendant une manche.
 *
 * POURQUOI DES BOTS QUI TROMPENT : le jeu porte sur la désinformation. Un chat
 * où tout le monde raisonne juste serait un contresens — dans la vraie vie,
 * l'information circule au milieu d'avis péremptoires et faux. Deux bots
 * affirment donc l'inverse de la bonne réponse, et un troisième meuble sans
 * rien dire. Le joueur doit s'en tenir à son propre jugement plutôt que suivre
 * le groupe : c'est le cœur du sujet, rendu jouable.
 *
 * ⚠️ ILS RESSEMBLENT À DES JOUEURS, JAMAIS À L'ASSISTANT. Pseudos ordinaires,
 * aucune mention de « bot », aucune source citée. La distinction est capitale :
 * l'assistant @bot répond en citant ses sources et doit rester digne de
 * confiance — c'est un module noté. Si un évaluateur confondait les deux, il
 * verrait « leur IA raconte n'importe quoi » au lieu de « le chat est un
 * environnement de désinformation ».
 *
 * Ces messages sont ÉPHÉMÈRES : diffusés en direct, jamais enregistrés en base
 * et jamais soumis à la modération. Ce ne sont pas des messages d'utilisateurs,
 * ils ne doivent donc pas polluer l'historique du salon.
 */
@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  // Les minuteries en cours, par salon : permet de tout annuler si la manche
  // se termine plus tôt que prévu (verrouillage manuel, salon vidé).
  private readonly minuteries = new Map<string, NodeJS.Timeout[]>();

  constructor(private readonly prisma: PrismaService) {}

  /** Deux trompeurs, un bavard. Pseudos volontairement quelconques. */
  private static readonly TROMPEURS = ['mreynaud', 'lchen'];
  private static readonly BAVARD = 'adiallo';

  /** Formules affirmatives : elles doivent sonner sûres d'elles. */
  private static readonly CERTITUDES = [
    "franchement celle-là c'est {r} à 100%, je l'ai déjà vue passer",
    "{r} évidemment, y a même pas débat",
    "mon frère bosse dans le milieu, c'est {r} sans hésiter",
    "j'ai vu un article dessus la semaine dernière, c'est {r}",
    "clairement {r}, la qualité de l'image trahit tout",
  ];

  /** Le bavard : du bruit, aucune information exploitable. */
  private static readonly MEUBLAGE = [
    'mouais',
    'chelou ce truc',
    "j'hésite grave là",
    'bon bah on verra bien',
    'ça sent le piège',
    'perso je passe mon tour',
  ];

  private static piocher<T>(liste: T[]): T {
    return liste[Math.floor(Math.random() * liste.length)];
  }

  /**
   * Anime le chat d'un salon pendant la manche.
   *
   * `emettre` est fourni par la gateway : le service ne connaît pas Socket.IO,
   * il se contente de dire quoi envoyer et quand.
   */
  async animer(
    roomId: string,
    roundId: string,
    emettre: (message: { author: string; content: string }) => void,
  ): Promise<void> {
    this.arreter(roomId);

    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: {
        locksAt: true,
        roundClaims: {
          orderBy: { orderIndex: 'asc' },
          select: { claim: { select: { truthLabel: true } } },
        },
      },
    });
    if (!round || round.roundClaims.length === 0) return;

    const restant = round.locksAt.getTime() - Date.now();
    if (restant <= 0) return;

    const minuteries: NodeJS.Timeout[] = [];
    round.roundClaims.forEach(({ claim }, index) => {
      // Les bots réagissent au fil de la manche, répartis sur sa durée.
      const base = (restant / round.roundClaims.length) * index;

      BotsService.TROMPEURS.forEach((auteur, rang) => {
        // Ils se trompent souvent, pas toujours : un bot qui aurait TOUJOURS
        // tort deviendrait un indicateur fiable par inversion.
        const ment = Math.random() < 0.75;
        const reponse = ment
          ? (claim.truthLabel === 'TRUE' ? 'fake' : 'vrai')
          : (claim.truthLabel === 'TRUE' ? 'vrai' : 'fake');
        const texte = BotsService.piocher(BotsService.CERTITUDES).replace('{r}', reponse);
        minuteries.push(
          setTimeout(() => emettre({ author: auteur, content: texte }),
            Math.max(1000, base + 2000 + rang * 3500 + Math.random() * 2000)),
        );
      });

      if (Math.random() < 0.6) {
        minuteries.push(
          setTimeout(() => emettre({ author: BotsService.BAVARD, content: BotsService.piocher(BotsService.MEUBLAGE) }),
            Math.max(1500, base + 6000 + Math.random() * 3000)),
        );
      }
    });

    this.minuteries.set(roomId, minuteries);
    this.logger.log(`Bots activés sur ${roomId} (${minuteries.length} messages programmés)`);
  }

  /** Annule les messages en attente d'un salon. */
  arreter(roomId: string): void {
    const existantes = this.minuteries.get(roomId);
    if (!existantes) return;
    existantes.forEach(clearTimeout);
    this.minuteries.delete(roomId);
  }
}
