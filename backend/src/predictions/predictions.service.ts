import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PredictionsService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  async create(data: { roundId: string; predictedFakeCount: number; stake: number }, userId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const round = await tx.round.findUnique({ where: { id: data.roundId }, include: { roundClaims: true } });
        if (!round) throw new NotFoundException(`Round ${data.roundId} not found`);
        if (round.status !== 'OPEN' || round.locksAt <= new Date()) throw new BadRequestException('Predictions are closed for this round');
        if (data.predictedFakeCount > round.roundClaims.length) throw new BadRequestException('Predicted fake count exceeds the number of claims');
        await this.ledger.debitForBet(tx, userId, data.stake);
        return tx.prediction.create({ data: { roundId: data.roundId, userId, predictedFakeCount: data.predictedFakeCount, stake: data.stake } });
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A prediction already exists for this round');
      throw error;
    }
  }

  async findByRound(roundId: string) {
    return this.prisma.prediction.findMany({ where: { roundId }, select: { id: true, userId: true, predictedFakeCount: true, stake: true, payout: true, result: true, createdAt: true } });
  }
}
