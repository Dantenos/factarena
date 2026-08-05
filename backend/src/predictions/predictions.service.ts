import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

type PredictionDatum = { stake: number; predictedFakeCount: number };

type PredictionDistributionEntry = { count: number; stake: number };

export type RoundPredictionStats = {
  pot: number;
  predictionCount: number;
  distribution: Record<string, PredictionDistributionEntry>;
  odds: Record<string, number>;
};

@Injectable()
export class PredictionsService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  async create(data: { roundId: string; predictedFakeCount: number; stake: number }, userId: string) {
    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const round = await tx.round.findUnique({ where: { id: data.roundId }, include: { roundClaims: true } });
        if (!round) throw new NotFoundException(`Round ${data.roundId} not found`);
        const now = new Date();
        const openRound = await tx.round.updateMany({
          where: { id: data.roundId, status: 'OPEN', locksAt: { gt: now } },
          // This conditional update takes the round row lock. It prevents a
          // prediction transaction that started before the deadline from
          // committing after the game loop has locked the round.
          data: { updatedAt: now },
        });
        if (openRound.count !== 1) throw new BadRequestException('Predictions are closed for this round');
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

  async findRoundStats(roundId: string) {
    const predictions = await this.prisma.prediction.findMany({ where: { roundId }, select: { stake: true, predictedFakeCount: true } });
    return this.calculateRoundStats(predictions);
  }

  calculateRoundStats(predictions: PredictionDatum[]): RoundPredictionStats {
    const pot = predictions.reduce((total, prediction) => total + prediction.stake, 0);
    const distribution = predictions.reduce<Record<string, PredictionDistributionEntry>>((acc, prediction) => {
      const key = String(prediction.predictedFakeCount);
      const current = acc[key] || { count: 0, stake: 0 };
      current.count += 1;
      current.stake += prediction.stake;
      acc[key] = current;
      return acc;
    }, {});

    const odds = Object.entries(distribution).reduce<Record<string, number>>((acc, [key, aggregation]) => {
      acc[key] = aggregation.stake > 0 ? Number((pot / aggregation.stake).toFixed(2)) : 0;
      return acc;
    }, {});

    return { pot, predictionCount: predictions.length, distribution, odds };
  }
}
