import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';
import { RealtimeGateway } from './realtime.gateway';
import { BotsService } from './bots.service';
import { AiService } from '../ai/ai.service';

/**
 * Server-authoritative round clock.
 *
 * It deliberately scans PostgreSQL instead of relying on a browser timer. This
 * keeps rounds progressing when no client is connected and makes the deadline
 * survive gateway reconnects or multiple browser tabs.
 */
@Injectable()
export class GameLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameLoopService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  // Dernière vérification « tout le monde a voté », par manche. Le tick est à
  // 250 ms : sans ce frein, la question coûterait douze requêtes par seconde.
  private readonly dernierControle = new Map<string, number>();
  private static readonly CONTROLE_VOTES_MS = 2_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly aiService: AiService,
    private readonly botsService: BotsService,
  ) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 250);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const rounds = await this.prisma.round.findMany({
        where: { status: 'REVEALED' as any, room: { status: 'IN_PROGRESS' } },
        select: { id: true, roomId: true, status: true, opensAt: true, locksAt: true },
        orderBy: { locksAt: 'asc' },
      });

      for (const candidate of rounds) {
        const status = String(candidate.status);

        if (status === 'REVEALED') {
          await this.publishVerdicts(candidate.id, candidate.roomId);
          await this.finish(candidate.id, candidate.roomId);
          continue;
        }

        // LOCKED rounds are resolved by the server, including rounds manually
        // locked by the legacy REST/WebSocket endpoint.
        if (status !== 'LOCKED') continue;
        const revealed = await this.roundsService.revealAndSettle(candidate.id);
        await this.realtimeGateway.publishRoundState(candidate.roomId, 'round:revealed', candidate.id);
        if (revealed) {
          await this.publishVerdicts(candidate.id, candidate.roomId);
          await this.finish(candidate.id, candidate.roomId);
        }
      }
    } catch (error) {
      this.logger.error(`Game loop tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Applique le frein avant d'interroger la base. */
  private async verrouillerSiToutLeMondeAVote(roundId: string) {
    const maintenant = Date.now();
    const precedent = this.dernierControle.get(roundId) ?? 0;
    if (maintenant - precedent < GameLoopService.CONTROLE_VOTES_MS) return null;
    this.dernierControle.set(roundId, maintenant);
    return this.roundsService.lockIfEveryoneVoted(roundId);
  }

  private async finish(roundId: string, roomId: string) {
    const finished = await this.roundsService.finish(roundId);
    if (finished) await this.realtimeGateway.publishRoundState(roomId, 'round:finished', roundId);
  }

  private async publishVerdicts(roundId: string, roomId: string) {
    const verdicts = await this.aiService.generateRoundVerdicts(roundId);
    // Le classement part avec les verdicts : c'est le même écran de fin de
    // manche côté joueur, deux événements séparés obligeraient le front à les
    // recoller et à gérer l'ordre d'arrivée.
    const classement = await this.roundsService.classement(roundId);
    if (verdicts.length > 0) {
      await this.realtimeGateway.publishRoundVerdicts(roomId, roundId, verdicts, classement);
    }
  }
}
