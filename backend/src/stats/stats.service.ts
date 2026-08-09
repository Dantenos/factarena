import { Injectable, NotFoundException } from '@nestjs/common';
import { PredictionResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type UserSummary = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
};

type PredictionForStats = {
  stake: number;
  payout: number | null;
  result: PredictionResult | null;
};

type ComputedStats = {
  roundsPlayed: number;
  victories: number;
  defeats: number;
  totalStake: number;
  totalPayout: number;
  netGain: number;
  winRate: number;
};

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLeaderboard() {
    const users = await this.prisma.user.findMany({
      select: {
        ...this.userSelect(),
        virtualBalance: true,
        predictions: {
          where: { result: { not: null } },
          select: { stake: true, payout: true, result: true },
        },
      },
    });

    return users
      .map((user) => {
        const { predictions, virtualBalance, ...profile } = user;
        return {
          rank: 0,
          user: profile,
          virtualBalance,
          ...this.computeStats(predictions),
        };
      })
      .sort((left, right) =>
        right.netGain - left.netGain ||
        right.victories - left.victories ||
        right.winRate - left.winRate ||
        right.totalPayout - left.totalPayout ||
        left.user.email.localeCompare(right.user.email),
      )
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  async getUserStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...this.userSelect(),
        virtualBalance: true,
        predictions: {
          where: { result: { not: null } },
          select: { stake: true, payout: true, result: true },
        },
      },
    });

    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const { predictions, virtualBalance, ...profile } = user;
    return {
      user: profile,
      virtualBalance,
      ...this.computeStats(predictions),
    };
  }

  async getRoundHistory() {
    return this.prisma.round.findMany({
      where: { status: { in: ['REVEALED', 'FINISHED'] as any } },
      orderBy: [{ revealedAt: 'desc' }, { createdAt: 'desc' }],
      select: this.roundHistorySelect(),
    });
  }

  async getUserRoundHistory(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    return this.prisma.prediction.findMany({
      where: { userId, result: { not: null } },
      orderBy: [{ round: { revealedAt: 'desc' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        predictedFakeCount: true,
        stake: true,
        payout: true,
        result: true,
        createdAt: true,
        round: {
          select: this.roundHistorySelect(),
        },
      },
    });
  }

  private computeStats(predictions: PredictionForStats[]): ComputedStats {
    const roundsPlayed = predictions.length;
    const victories = predictions.filter((prediction) => prediction.result === 'WIN').length;
    const defeats = predictions.filter((prediction) => prediction.result === 'LOSS').length;
    const totalStake = predictions.reduce((total, prediction) => total + prediction.stake, 0);
    const totalPayout = predictions.reduce((total, prediction) => total + (prediction.payout ?? 0), 0);
    const netGain = totalPayout - totalStake;
    const winRate = roundsPlayed > 0 ? Number((victories / roundsPlayed).toFixed(4)) : 0;

    return { roundsPlayed, victories, defeats, totalStake, totalPayout, netGain, winRate };
  }

  private userSelect(): Record<keyof UserSummary, true> {
    return {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      status: true,
    };
  }

  private roundHistorySelect(): Prisma.RoundSelect {
    return {
      id: true,
      status: true,
      opensAt: true,
      locksAt: true,
      revealedAt: true,
      trueFakeCount: true,
      createdAt: true,
      updatedAt: true,
      room: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      predictions: {
        select: {
          id: true,
          userId: true,
          predictedFakeCount: true,
          stake: true,
          payout: true,
          result: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              avatarUrl: true,
              status: true,
            },
          },
        },
        orderBy: [{ result: 'desc' }, { payout: 'desc' }, { createdAt: 'asc' }],
      },
    };
  }
}
