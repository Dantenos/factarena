import { ForbiddenException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Bet, ClipVote, Round, RoundClaim, Claim } from '@prisma/client';
import { ChatService } from '../chat/chat.service';
import { BetsService } from '../bets/bets.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomPresenceService } from './room-presence.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

type RoundWithDetails = Round & {
  roundClaims: Array<RoundClaim & { claim: Claim }>;
  bets: Bet[];
  clipVotes: ClipVote[];
};

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly betsService: BetsService,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly roomPresence: RoomPresenceService,
    @Inject(forwardRef(() => RealtimeGateway)) private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async create(data: { name: string }, createdBy: string) {
    const room = await this.prisma.room.create({ data: { name: data.name, createdBy, status: 'WAITING' } });
    this.realtimeGateway.broadcastRoomListUpdate();
    return room;
  }

  async findAll() {
    return this.prisma.room.findMany({
      orderBy: { createdAt: 'desc' },
      include: { host: { select: { id: true, email: true, avatarUrl: true, status: true } }, _count: { select: { rounds: true } } },
    });
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        host: { select: { id: true, email: true, avatarUrl: true, status: true } },
        rounds: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, roomId: true, status: true, opensAt: true, locksAt: true, revealedAt: true, createdAt: true, updatedAt: true },
        },
      },
    });
    if (!room) throw new NotFoundException(`Salon ${id} introuvable`);
    return room;
  }

  async getState(id: string, requestedRoundId?: string) {
    const room = await this.findOne(id);
    const activeRound = room.rounds.find((candidate: { status: string }) => ['COUNTDOWN', 'OPEN', 'LOCKED', 'REVEALED'].includes(candidate.status));
    const roundId = requestedRoundId || activeRound?.id;
    const round = roundId ? await this.findRoundForRoom(id, roundId) : null;
    const bets = round?.bets || [];

    return {
      room: { id: room.id, name: room.name, status: room.status, createdBy: room.createdBy },
      members: await this.getMembers(id),
      round: round ? this.sanitizeRound(round) : null,
      pot: bets.reduce((sum, bet) => sum + bet.stake, 0),
      betCount: bets.length,
      serverTime: new Date().toISOString(),
    };
  }

  async getMembers(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id }, select: { createdBy: true } });
    if (!room) throw new NotFoundException(`Salon ${id} introuvable`);

    const memberIds = await this.roomPresence.getMemberIds(id);
    if (memberIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, email: true, displayName: true, avatarUrl: true, status: true, createdAt: true, updatedAt: true },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
    });

    return users.map((user) => ({
      ...user,
      isHost: user.id === room.createdBy,
    }));
  }

  async getHistory(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        host: { select: { id: true, email: true, displayName: true, avatarUrl: true, status: true } },
        rounds: {
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          include: this.roundHistoryInclude(),
        },
      },
    });

    if (!room) throw new NotFoundException(`Salon ${id} introuvable`);

    return {
      ...room,
      rounds: room.rounds.map((round) => this.sanitizeRound(round)),
      messages: await this.chatService.findByRoom(id),
    };
  }

  async getRoundHistory(id: string) {
    const round = await this.findRoundForHistory(id);
    if (!round) throw new NotFoundException(`La manche ${id} est introuvable`);
    return this.sanitizeRound(round);
  }

  async assertHost(id: string, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id }, select: { createdBy: true } });
    if (!room) throw new NotFoundException(`Salon ${id} introuvable`);
    if (room.createdBy !== userId) throw new ForbiddenException('Seul l’hôte du salon peut effectuer cette action');
  }

  private async findRoundForHistory(id: string) {
    return this.prisma.round.findUnique({
      where: { id },
      include: this.roundHistoryInclude(),
    });
  }

  /** Returns the round only when it belongs to the requested room. */
  private async findRoundForRoom(roomId: string, roundId: string) {
    return this.prisma.round.findFirst({
      where: { id: roundId, roomId },
      include: this.roundHistoryInclude(),
    });
  }

  private roundHistoryInclude() {
    return {
      room: {
        select: {
          id: true,
          name: true,
          status: true,
          createdBy: true,
        },
      },
      roundClaims: {
        orderBy: { orderIndex: 'asc' as const },
        include: {
          claim: true,
        },
      },
      bets: {
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        include: {
          user: {
            select: { id: true, email: true, displayName: true, avatarUrl: true, status: true },
          },
        },
      },
      clipVotes: true,
    };
  }

  private sanitizeRound(round: RoundWithDetails) {
    const isRevealed = ['REVEALED', 'FINISHED'].includes(String(round.status));
    const { roundClaims, bets, clipVotes: _clipVotes, ...safeRound } = round;
    return {
      ...safeRound,
      ...(isRevealed ? { bets } : {}),
      roundClaims: roundClaims.map((roundClaim) => {
        const { claim } = roundClaim;
        const { truthLabel, ...safeClaim } = claim;
        return {
          id: roundClaim.id,
          roundId: roundClaim.roundId,
          claimId: roundClaim.claimId,
          orderIndex: roundClaim.orderIndex,
          claim: isRevealed ? claim : safeClaim,
        };
      }),
    };
  }
}
