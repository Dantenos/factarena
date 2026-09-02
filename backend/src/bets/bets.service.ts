import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomPresenceService } from '../rooms/room-presence.service';

@Injectable()
export class BetsService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService, private readonly presence: RoomPresenceService) {}

  async create(data: { roundId: string; stake: number }, userId: string) {
    if (!Number.isSafeInteger(data.stake) || data.stake <= 0) throw new BadRequestException('Stake must be a positive integer');
    // Voir clip-votes.service.ts : isMember() réclame une connexion du pool, on
    // ne l'appelle donc jamais depuis l'intérieur d'une transaction.
    const round = await this.prisma.round.findUnique({ where: { id: data.roundId } });
    if (!round) throw new NotFoundException(`Round ${data.roundId} not found`);
    if (!(await this.presence.isMember(userId, round.roomId))) throw new ForbiddenException('Join the room before placing a bet');
    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const open = await tx.round.updateMany({ where: { id: data.roundId, status: 'OPEN', locksAt: { gt: new Date() }, room: { status: { not: 'FINISHED' } } }, data: { updatedAt: new Date() } });
        if (open.count !== 1) throw new BadRequestException('Betting is closed for this round');
        await this.ledger.debitForBet(tx, userId, data.stake);
        return tx.bet.create({ data: { roundId: data.roundId, userId, stake: data.stake } });
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A bet already exists for this round');
      throw error;
    }
  }

  async findByRound(roundId: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { status: true } });
    if (!round) throw new NotFoundException(`Round ${roundId} not found`);
    return this.prisma.bet.findMany({ where: round.status === 'REVEALED' || round.status === 'FINISHED' ? { roundId } : { roundId, userId }, select: { id: true, userId: true, roundId: true, stake: true, payout: true, result: true, createdAt: true } });
  }

  async findRoundStats(roundId: string) {
    const bets = await this.prisma.bet.findMany({ where: { roundId }, select: { stake: true } });
    return { pot: bets.reduce((sum, bet) => sum + bet.stake, 0), betCount: bets.length };
  }
}
