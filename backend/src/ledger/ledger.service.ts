import { BadRequestException, ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class LedgerService {
  // Rattrapage décidé par l'équipe. Le seuil est la plus petite mise proposée
  // par l'interface, pas zéro : rester coincé à trente crédits est la même
  // impasse qu'en avoir aucun, puisqu'on ne peut déjà plus rien engager.
  static readonly SEUIL_RATTRAPAGE = 50;
  static readonly MONTANT_RATTRAPAGE = 200;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway)) private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async getBalance(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { virtualBalance: true } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
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
    if (updated.count !== 1) throw new BadRequestException('Crédits virtuels insuffisants');
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
    if (!referenceId?.trim()) throw new BadRequestException('Une référence de remboursement est obligatoire');
    const existing = await tx.transaction.findUnique({ where: { referenceId } });
    if (existing) {
      this.assertSameOperation(existing, userId, 'REFUND', amount);
      return existing;
    }

    const user = await tx.user.update({ where: { id: userId }, data: { virtualBalance: { increment: amount } }, select: { virtualBalance: true } });
    return tx.transaction.create({ data: { userId, type: 'REFUND', amount, balanceAfter: user.virtualBalance, referenceId } });
  }

  /**
   * Recrédite un joueur qui n'a plus de quoi miser.
   *
   * Sans ça, tomber sous la mise minimale enfermait le compte : plus rien à
   * engager, donc plus aucun gain possible, et rien pour remonter. Le joueur
   * pouvait encore voter, mais ne jouait plus jamais pour le pot.
   *
   * Il se réclame et n'est pas automatique : le joueur voit ce qui lui arrive,
   * et l'écriture BONUS en garde la trace.
   */
  async reclamerRattrapage(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { virtualBalance: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.virtualBalance >= LedgerService.SEUIL_RATTRAPAGE) {
      throw new BadRequestException('Le rattrapage est réservé aux joueurs qui ne peuvent plus miser');
    }

    const misAJour = await this.prisma.user.update({
      where: { id: userId },
      data: { virtualBalance: { increment: LedgerService.MONTANT_RATTRAPAGE } },
      select: { virtualBalance: true },
    });
    await this.prisma.transaction.create({
      data: {
        userId,
        type: 'BONUS',
        amount: LedgerService.MONTANT_RATTRAPAGE,
        balanceAfter: misAJour.virtualBalance,
      },
    });
    await this.realtimeGateway.broadcastBalanceUpdate(userId);
    return { virtualBalance: misAJour.virtualBalance, credite: LedgerService.MONTANT_RATTRAPAGE };
  }

  private assertPositiveAmount(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException('Le montant du ledger doit être un entier positif');
    }
  }

  private assertSameOperation(
    existing: { userId: string; type: string; amount: number },
    userId: string,
    type: string,
    amount: number,
  ) {
    if (existing.userId !== userId || existing.type !== type || existing.amount !== amount) {
      throw new ConflictException('La référence du ledger est déjà utilisée par une autre opération');
    }
  }
}
