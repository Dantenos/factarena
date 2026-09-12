import { Injectable, NotFoundException } from '@nestjs/common';
import { PredictionResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type UserSummary = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
  experience: number;
  level: number;
};

type PredictionForStats = {
  stake: number;
  payout: number | null;
  result: PredictionResult | null;
};

type BetForLeaderboard = PredictionForStats & {
  createdAt: Date;
  round: { revealedAt: Date | null; createdAt: Date };
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
      where: { role: { not: 'BOT' } },
      select: {
        ...this.userSelect(),
        virtualBalance: true,
        experience: true,
        level: true,
        achievements: { select: { achievementKey: true, unlockedAt: true }, orderBy: { unlockedAt: 'asc' } },
        bets: {
          where: { result: { not: null } },
          select: {
            stake: true,
            payout: true,
            result: true,
            createdAt: true,
            round: { select: { revealedAt: true, createdAt: true } },
          },
        },
      },
    });

    return users
      .map((user) => {
        const { bets, virtualBalance, ...profile } = user;
        return {
          rank: 0,
          user: profile,
          virtualBalance,
          experience: user.experience,
          level: user.level,
          ...this.computeStats(bets),
          scoreReachedAt: this.scoreReachedAt(profile.createdAt, bets),
        };
      })
      .sort((left, right) =>
        right.netGain - left.netGain ||
        left.scoreReachedAt.getTime() - right.scoreReachedAt.getTime() ||
          left.user.id.localeCompare(right.user.id),
      )
      .map(({ scoreReachedAt: _scoreReachedAt, ...entry }, index) => ({ ...entry, rank: index + 1 }));
  }

  async getUserStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...this.userSelect(),
        virtualBalance: true,
        experience: true,
        level: true,
        achievements: { select: { achievementKey: true, unlockedAt: true }, orderBy: { unlockedAt: 'asc' } },
        bets: {
          where: { result: { not: null } },
          select: { stake: true, payout: true, result: true },
        },
      },
    });

    if (!user) throw new NotFoundException(`Utilisateur ${userId} introuvable`);

    const { bets, virtualBalance, ...profile } = user;
    return {
      user: profile,
      virtualBalance,
      experience: user.experience,
      level: user.level,
      ...this.computeStats(bets),
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
    if (!user) throw new NotFoundException(`Utilisateur ${userId} introuvable`);

    return this.prisma.bet.findMany({
      where: { userId, result: { not: null } },
      orderBy: [{ round: { revealedAt: 'desc' } }, { createdAt: 'desc' }],
      select: {
        id: true,
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

  private computeStats(bets: PredictionForStats[]): ComputedStats {
    const roundsPlayed = bets.length;
    const victories = bets.filter((bet) => bet.result === 'WIN').length;
    const defeats = bets.filter((bet) => bet.result === 'LOSS').length;
    const totalStake = bets.reduce((total, bet) => total + bet.stake, 0);
    const totalPayout = bets.reduce((total, bet) => total + (bet.payout ?? 0), 0);
    const netGain = totalPayout - totalStake;
    const winRate = roundsPlayed > 0 ? Number((victories / roundsPlayed).toFixed(4)) : 0;

    return { roundsPlayed, victories, defeats, totalStake, totalPayout, netGain, winRate };
  }

  private scoreReachedAt(createdAt: Date, bets: BetForLeaderboard[]): Date {
    const netGain = this.computeStats(bets).netGain;
    let runningScore = 0;
    let reachedAt = createdAt;
    const orderedBets = [...bets].sort((left, right) => {
      const leftDate = left.round.revealedAt ?? left.round.createdAt;
      const rightDate = right.round.revealedAt ?? right.round.createdAt;
      return leftDate.getTime() - rightDate.getTime() || left.createdAt.getTime() - right.createdAt.getTime();
    });

    for (const bet of orderedBets) {
      runningScore += (bet.payout ?? 0) - bet.stake;
      if (runningScore === netGain) {
        reachedAt = bet.round.revealedAt ?? bet.round.createdAt;
        break;
      }
    }
    return reachedAt;
  }

  private userSelect(): Record<keyof UserSummary, true> {
    return {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      status: true,
      createdAt: true,
      experience: true,
      level: true,
    };
  }

  private roundHistorySelect(): Prisma.RoundSelect {
    return {
      id: true,
      status: true,
      opensAt: true,
      locksAt: true,
      revealedAt: true,
      createdAt: true,
      updatedAt: true,
      room: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      bets: {
        select: {
          id: true,
          userId: true,
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
