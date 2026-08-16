import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { virtualBalance: true } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getHistory(userId: string) {
    return this.prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async debitForBet(tx: Prisma.TransactionClient, userId: string, stake: number, referenceId?: string) {
    this.assertPositiveAmount(stake);
    if (referenceId) {
      const existing = await tx.transaction.findUnique({ where: { referenceId } });
      if (existing) {
        this.assertSameOperation(existing, userId, 'BET', -stake);
        return existing;
      }
    }
    const updated = await tx.user.updateMany({ where: { id: userId, virtualBalance: { gte: stake } }, data: { virtualBalance: { decrement: stake } } });
    if (updated.count !== 1) throw new BadRequestException('Insufficient virtual credits');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { virtualBalance: true } });
    return tx.transaction.create({ data: { userId, type: 'BET', amount: -stake, balanceAfter: user.virtualBalance, referenceId } });
  }

  async creditPayout(tx: Prisma.TransactionClient, userId: string, amount: number, referenceId?: string) {
    this.assertPositiveAmount(amount);
    if (referenceId) {
      const existing = await tx.transaction.findUnique({ where: { referenceId } });
      if (existing) {
        this.assertSameOperation(existing, userId, 'PAYOUT', amount);
        return existing;
      }
    }
    const user = await tx.user.update({ where: { id: userId }, data: { virtualBalance: { increment: amount } }, select: { virtualBalance: true } });
    return tx.transaction.create({ data: { userId, type: 'PAYOUT', amount, balanceAfter: user.virtualBalance, referenceId } });
  }

  async refundBet(tx: Prisma.TransactionClient, userId: string, amount: number, referenceId: string) {
    this.assertPositiveAmount(amount);
    if (!referenceId?.trim()) throw new BadRequestException('A refund reference is required');
    const existing = await tx.transaction.findUnique({ where: { referenceId } });
    if (existing) {
      this.assertSameOperation(existing, userId, 'REFUND', amount);
      return existing;
    }

    const user = await tx.user.update({ where: { id: userId }, data: { virtualBalance: { increment: amount } }, select: { virtualBalance: true } });
    return tx.transaction.create({ data: { userId, type: 'REFUND', amount, balanceAfter: user.virtualBalance, referenceId } });
  }

  private assertPositiveAmount(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException('Ledger amount must be a positive integer');
    }
  }

  private assertSameOperation(
    existing: { userId: string; type: string; amount: number },
    userId: string,
    type: string,
    amount: number,
  ) {
    if (existing.userId !== userId || existing.type !== type || existing.amount !== amount) {
      throw new ConflictException('Ledger reference is already used by another operation');
    }
  }
}
