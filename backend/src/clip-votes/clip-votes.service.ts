import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoomPresenceService } from '../rooms/room-presence.service';

@Injectable()
export class ClipVotesService {
  constructor(private readonly prisma: PrismaService, private readonly presence: RoomPresenceService) {}

  async create(data: { roundId: string; claimId: string; isFake: boolean }, userId: string) {
    if (typeof data.isFake !== 'boolean') throw new BadRequestException('Le champ isFake doit être booléen');
    // Vérifications hors transaction. isMember() passe par une AUTRE instance
    // Prisma : appelée à l'intérieur, elle réclamait une seconde connexion du
    // pool alors que la transaction en tenait déjà une. Quand plusieurs joueurs
    // votaient en même temps, toutes les connexions étaient prises par des
    // transactions qui en attendaient une de plus, et les votes échouaient en
    // « Unable to start a transaction in the given time ».
    const round = await this.prisma.round.findUnique({
      where: { id: data.roundId },
      include: { roundClaims: { where: { claimId: data.claimId }, select: { claimId: true, orderIndex: true } } },
    });
    if (!round) throw new NotFoundException(`La manche ${data.roundId} est introuvable`);
    if (round.status !== 'OPEN') throw new BadRequestException('Les votes ne sont pas ouverts');
    if (round.roundClaims.length !== 1) throw new BadRequestException('Le clip ne fait pas partie de cette manche');
    if (round.roundClaims[0].orderIndex !== round.currentClipIndex) throw new BadRequestException('Ce clip n’est pas le clip courant');
    if (!(await this.presence.isMember(userId, round.roomId))) throw new ForbiddenException('Rejoignez le salon avant de voter');
    const existingVote = await this.prisma.clipVote.findUnique({
      where: { userId_roundId_claimId: { userId, roundId: data.roundId, claimId: data.claimId } },
    });
    if (existingVote) return { ...existingVote, alreadyVoted: true };
    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const open = await tx.round.updateMany({ where: { id: data.roundId, status: 'OPEN', locksAt: { gt: new Date() }, room: { status: { not: 'FINISHED' } } }, data: { updatedAt: new Date() } });
        if (open.count !== 1) throw new BadRequestException('Les votes sont clos pour cette manche');
        return tx.clipVote.create({ data: { roundId: data.roundId, claimId: data.claimId, userId, isFake: data.isFake } });
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        const vote = await this.prisma.clipVote.findUnique({
          where: { userId_roundId_claimId: { userId, roundId: data.roundId, claimId: data.claimId } },
        });
        if (vote) return { ...vote, alreadyVoted: true };
      }
      throw error;
    }
  }

  async findByRound(roundId: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { status: true } });
    if (!round) throw new NotFoundException(`La manche ${roundId} est introuvable`);
    return this.prisma.clipVote.findMany({ where: { roundId, ...(round.status === 'REVEALED' || round.status === 'FINISHED' ? {} : { userId }) }, select: { id: true, userId: true, roundId: true, claimId: true, isFake: true, createdAt: true } });
  }
}
