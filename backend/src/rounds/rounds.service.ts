import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class RoundsService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  /**
   * Ensures that a round is addressed through its owning room.
   *
   * WebSocket payloads contain both identifiers, so this check must happen
   * before any operation that broadcasts state to a room. Returning the same
   * error for an unknown round and a round from another room avoids exposing
   * cross-room information through the gateway.
   */
  async assertBelongsToRoom(roundId: string, roomId: string): Promise<void> {
    const round = await this.prisma.round.findFirst({
      where: { id: roundId, roomId },
      select: { id: true },
    });

    if (!round) {
      throw new NotFoundException(`Round ${roundId} not found in room ${roomId}`);
    }
  }

  async create(data: { roomId: string; claimIds: string[]; durationSeconds: number }, createdById: string) {
    const distinctClaimIds = [...new Set(data.claimIds)];
    if (distinctClaimIds.length === 0) throw new BadRequestException('A round must contain at least one claim');
    if (distinctClaimIds.length !== data.claimIds.length) throw new BadRequestException('A claim may appear only once in a round');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const room = await tx.room.findUnique({ where: { id: data.roomId } });
      if (!room) throw new NotFoundException(`Room ${data.roomId} not found`);
      if (room.createdBy !== createdById) throw new ForbiddenException('Only the room host may create rounds');
      if (room.status === 'FINISHED') throw new BadRequestException('Cannot add rounds to a finished room');
      const activeRound = await tx.round.findFirst({ where: { roomId: data.roomId, status: { in: ['COUNTDOWN', 'OPEN', 'LOCKED'] as any } } });
      if (activeRound) throw new ConflictException('This room already has an active round');
      const claims = await tx.claim.findMany({ where: { id: { in: distinctClaimIds } }, select: { id: true } });
      if (claims.length !== distinctClaimIds.length) throw new BadRequestException('One or more claims do not exist');
      const opensAt = new Date(Date.now() + 3_000);
      const locksAt = new Date(opensAt.getTime() + data.durationSeconds * 1000);
      const round = await tx.round.create({ data: { roomId: data.roomId, status: 'COUNTDOWN' as any, opensAt, locksAt } });
      await tx.roundClaim.createMany({ data: distinctClaimIds.map((claimId, orderIndex) => ({ roundId: round.id, claimId, orderIndex })) });
      await tx.room.update({ where: { id: data.roomId }, data: { status: 'IN_PROGRESS' } });
      return tx.round.findUniqueOrThrow({
        where: { id: round.id },
        select: {
          id: true, roomId: true, status: true, opensAt: true, locksAt: true, revealedAt: true, createdAt: true, updatedAt: true,
          roundClaims: { include: { claim: { select: { id: true, text: true, mediaRef: true, videoEndS: true, category: true, sourceUrl: true } } } },
        },
      });
    });
  }

  async findByRoom(roomId: string) {
    return this.prisma.round.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, roomId: true, status: true, opensAt: true, locksAt: true, revealedAt: true, createdAt: true, updatedAt: true },
    });
  }

  async findOne(id: string) {
    const round = await this.prisma.round.findUnique({
      where: { id },
      include: { roundClaims: { include: { claim: { select: { id: true, text: true, mediaRef: true, videoEndS: true, category: true, sourceUrl: true } } } }, bets: { select: { id: true, userId: true, stake: true, payout: true, result: true, createdAt: true } }, clipVotes: { select: { id: true, userId: true, claimId: true, isFake: true, createdAt: true } } },
    });
    if (!round) throw new NotFoundException(`Round ${id} not found`);
    const { bets, clipVotes: _clipVotes, ...safeRound } = round;
    const revealed = round.status === 'REVEALED' || String(round.status) === 'FINISHED';
    return revealed ? { ...safeRound, bets } : safeRound;
  }

  async lock(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, select: { room: { select: { createdBy: true, status: true } } } });
    if (!round) throw new NotFoundException(`Round ${id} not found`);
    if (round.room.createdBy !== userId) throw new ForbiddenException('Only the room host may lock a round');
    if (round.room.status === 'FINISHED') throw new BadRequestException('Cannot modify a finished room');
    const locked = await this.lockIfDueOrOpen(id, true);
    if (!locked) throw new BadRequestException('Only an open round can be locked');
    return locked;
  }

  async reveal(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { room: true } });
    if (!round) throw new NotFoundException(`Round ${id} not found`);
    if (round.room.createdBy !== userId) throw new ForbiddenException('Only the room host may reveal a round');
    if (round.room.status === 'FINISHED') throw new BadRequestException('Cannot modify a finished room');
    return this.revealAndSettle(id);
  }

  /** Atomically transitions an expired OPEN round to LOCKED. */
  async openIfDue(id: string) {
    const claimed = await this.prisma.round.updateMany({
      where: { id, status: 'COUNTDOWN' as any, opensAt: { lte: new Date() }, room: { status: { not: 'FINISHED' } } },
      data: { status: 'OPEN' },
    });
    return claimed.count === 1 ? this.findOne(id) : null;
  }

  /** Atomically transitions an expired OPEN round to LOCKED. */
  async lockIfDue(id: string) {
    return this.lockIfDueOrOpen(id, true);
  }

  private async lockIfDueOrOpen(id: string, dueOnly: boolean) {
    const now = new Date();
    const claimed = await this.prisma.round.updateMany({
      where: {
        id,
        status: 'OPEN',
        room: { status: { not: 'FINISHED' } },
        ...(dueOnly ? { locksAt: { lte: now } } : {}),
      },
      data: { status: 'LOCKED' },
    });
    return claimed.count === 1 ? this.findOne(id) : null;
  }

  /** Resolves a locked round without requiring a connected host. */
  async revealAndSettle(id: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const round = await tx.round.findUnique({ where: { id }, include: { room: true, roundClaims: { select: { id: true } }, bets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, clipVotes: { include: { claim: { select: { truthLabel: true } } } } } });
      if (!round) throw new NotFoundException(`Round ${id} not found`);
      if (round.room?.status === 'FINISHED') throw new BadRequestException('Cannot reveal a round in a finished room');
      if (round.status !== 'LOCKED') throw new BadRequestException('Only a locked round can be revealed');
      if (Array.isArray(round.roundClaims) && round.roundClaims.length === 0) throw new BadRequestException('Cannot reveal a round without claims');
      const claimed = await tx.round.updateMany({ where: { id, status: 'LOCKED', room: { status: { not: 'FINISHED' } } }, data: { status: 'REVEALED', revealedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('Round has already been resolved');
      if (round.bets.length === 0) return tx.round.findUniqueOrThrow({ where: { id } });
      const scores = round.bets.map((bet) => ({ bet, correct: round.clipVotes.filter((vote) => vote.userId === bet.userId && ((vote.isFake && vote.claim.truthLabel === 'FALSE') || (!vote.isFake && vote.claim.truthLabel === 'TRUE'))).length }));
      const bestScore = Math.max(...scores.map(({ correct }) => correct));
      const winners = scores.filter(({ correct }) => correct === bestScore).map(({ bet }) => bet);
      const pot = round.bets.reduce((total: number, bet: { stake: number }) => total + bet.stake, 0);
      const basePayout = Math.floor(pot / winners.length);
      const remainder = pot % winners.length;
      for (const bet of round.bets) {
        const winnerIndex = winners.findIndex((winner: { id: string }) => winner.id === bet.id);
        const payout = winnerIndex === -1 ? 0 : basePayout + (winnerIndex < remainder ? 1 : 0);
        await tx.bet.update({ where: { id: bet.id }, data: { result: winnerIndex === -1 ? 'LOSS' : 'WIN', payout } });
        if (payout > 0) await this.ledger.creditPayout(tx, bet.userId, payout, `payout:${bet.id}`);
      }
      return tx.round.findUniqueOrThrow({ where: { id }, include: { bets: true, clipVotes: true } });
    });
  }

  /** Marks a revealed round as finished and reopens its room for the next one. */
  async finish(id: string) {
    const finished = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.round.updateMany({ where: { id, status: 'REVEALED' }, data: { status: 'FINISHED' as any } });
      if (updated.count !== 1) return null;
      const round = await tx.round.findUniqueOrThrow({ where: { id }, select: { roomId: true } });
      await tx.room.updateMany({ where: { id: round.roomId, status: 'IN_PROGRESS' }, data: { status: 'WAITING' } });
      return tx.round.findUniqueOrThrow({ where: { id }, include: { bets: true, clipVotes: true } });
    });
    return finished;
  }
}
