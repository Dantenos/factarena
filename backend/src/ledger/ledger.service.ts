import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
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

  async debitForBet(tx: Prisma.TransactionClient, userId: string, stake: number) {
    const updated = await tx.user.updateMany({ where: { id: userId, virtualBalance: { gte: stake } }, data: { virtualBalance: { decrement: stake } } });
    if (updated.count !== 1) throw new BadRequestException('Insufficient virtual credits');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { virtualBalance: true } });
    return tx.transaction.create({ data: { userId, type: TransactionType.BET, amount: -stake, balanceAfter: user.virtualBalance } });
  }

  async creditPayout(tx: Prisma.TransactionClient, userId: string, amount: number) {
    const user = await tx.user.update({ where: { id: userId }, data: { virtualBalance: { increment: amount } }, select: { virtualBalance: true } });
    return tx.transaction.create({ data: { userId, type: TransactionType.PAYOUT, amount, balanceAfter: user.virtualBalance } });
  }
}
