import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoomPresenceService } from '../rooms/room-presence.service';

@Injectable()
export class ClipVotesService {
  constructor(private readonly prisma: PrismaService, private readonly presence: RoomPresenceService) {}

  async create(data: { roundId: string; claimId: string; isFake: boolean }, userId: string) {
    if (typeof data.isFake !== 'boolean') throw new BadRequestException('isFake must be boolean');
    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const round = await tx.round.findUnique({ where: { id: data.roundId }, include: { roundClaims: { where: { claimId: data.claimId }, select: { claimId: true } } } });
        if (!round) throw new NotFoundException(`Round ${data.roundId} not found`);
        if (round.roundClaims.length !== 1) throw new BadRequestException('The clip is not part of this round');
        if (!(await this.presence.isMember(userId, round.roomId))) throw new ForbiddenException('Join the room before voting');
        const open = await tx.round.updateMany({ where: { id: data.roundId, status: 'OPEN', locksAt: { gt: new Date() }, room: { status: { not: 'FINISHED' } } }, data: { updatedAt: new Date() } });
        if (open.count !== 1) throw new BadRequestException('Voting is closed for this round');
        return tx.clipVote.create({ data: { roundId: data.roundId, claimId: data.claimId, userId, isFake: data.isFake } });
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A vote already exists for this clip');
      throw error;
    }
  }

  async findByRound(roundId: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { status: true } });
    if (!round) throw new NotFoundException(`Round ${roundId} not found`);
    return this.prisma.clipVote.findMany({ where: { roundId, ...(round.status === 'REVEALED' || round.status === 'FINISHED' ? {} : { userId }) }, select: { id: true, userId: true, roundId: true, claimId: true, isFake: true, createdAt: true } });
  }
}
