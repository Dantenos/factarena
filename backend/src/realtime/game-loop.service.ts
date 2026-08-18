import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';
import { RealtimeGateway } from './realtime.gateway';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly aiService: AiService,
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
        where: { status: { in: ['COUNTDOWN', 'OPEN', 'LOCKED', 'REVEALED'] as any }, room: { status: { not: 'FINISHED' } } },
        select: { id: true, roomId: true, status: true, opensAt: true, locksAt: true },
        orderBy: { locksAt: 'asc' },
      });

      for (const candidate of rounds) {
        let status = String(candidate.status);
        if (status === 'COUNTDOWN') {
          if (candidate.opensAt > new Date()) continue;
          const opened = await this.roundsService.openIfDue(candidate.id);
          if (!opened) continue;
          status = 'OPEN';
          await this.realtimeGateway.publishRoundState(candidate.roomId, 'round:open', candidate.id);
          if (opened.locksAt > new Date()) continue;
        }

        if (status === 'OPEN') {
          if (candidate.locksAt > new Date()) continue;
          const locked = await this.roundsService.lockIfDue(candidate.id);
          if (!locked) continue;
          status = 'LOCKED';
          await this.realtimeGateway.publishRoundState(candidate.roomId, 'round:locked', candidate.id);
        }

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

  private async finish(roundId: string, roomId: string) {
    const finished = await this.roundsService.finish(roundId);
    if (finished) await this.realtimeGateway.publishRoundState(roomId, 'round:finished', roundId);
  }

  private async publishVerdicts(roundId: string, roomId: string) {
    const verdicts = await this.aiService.generateRoundVerdicts(roundId);
    if (verdicts.length > 0) {
      await this.realtimeGateway.publishRoundVerdicts(roomId, roundId, verdicts);
    }
  }
}
