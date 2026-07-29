import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';
import { RealtimeGateway } from './realtime.gateway';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
    private readonly realtimeGateway: RealtimeGateway,
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
        where: { status: { in: ['COUNTDOWN', 'OPEN', 'LOCKED', 'REVEALED'] as any } },
        select: { id: true, roomId: true, status: true, opensAt: true, locksAt: true },
        orderBy: { locksAt: 'asc' },
      });

      for (const candidate of rounds) {
        if (String(candidate.status) === 'COUNTDOWN') {
          if (candidate.opensAt > new Date()) continue;
          const opened = await this.roundsService.openIfDue(candidate.id);
          if (!opened) continue;
          await this.realtimeGateway.publishRoundState(candidate.roomId, 'round:open', candidate.id);
          if (opened.locksAt > new Date()) continue;
        }

        if (candidate.status === 'OPEN') {
          if (candidate.locksAt > new Date()) continue;
          const locked = await this.roundsService.lockIfDue(candidate.id);
          if (!locked) continue;
          await this.realtimeGateway.publishRoundState(candidate.roomId, 'round:locked', candidate.id);
        }

        if (candidate.status === 'REVEALED') {
          await this.finish(candidate.id, candidate.roomId);
          continue;
        }

        // LOCKED rounds are resolved by the server, including rounds manually
        // locked by the legacy REST/WebSocket endpoint.
        const revealed = await this.roundsService.revealAndSettle(candidate.id);
        await this.realtimeGateway.publishRoundState(candidate.roomId, 'round:revealed', candidate.id);
        if (revealed) await this.finish(candidate.id, candidate.roomId);
      }
    } catch (error) {
      this.logger.error(`Game loop tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async finish(roundId: string, roomId: string) {
    const finished = await this.roundsService.finish(roundId);
    if (finished) await this.realtimeGateway.publishRoundState(roomId, 'round:finished', roundId);
  }
}
