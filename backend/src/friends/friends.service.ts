import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoomPresenceService } from '../rooms/room-presence.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const userSelect = { id: true, email: true, displayName: true, avatarUrl: true, status: true } as const;

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService, private readonly roomPresence: RoomPresenceService, @Inject(forwardRef(() => RealtimeGateway)) private readonly realtimeGateway: RealtimeGateway) {}

  async list(userId: string) {
    const rows = await this.prisma.friend.findMany({ where: { userId, status: 'ACCEPTED' }, include: { friend: { select: userSelect } }, orderBy: { createdAt: 'desc' } });
    return rows.map(({ friend }) => friend);
  }

  async presence(userId: string) {
    const friends = await this.list(userId);
    return Promise.all(friends.map(async (friend) => ({ ...friend, currentRoomId: await this.roomPresence.getCurrentRoomId(friend.id) })));
  }

  async pending(userId: string) {
    const [received, sent] = await Promise.all([
      this.prisma.friend.findMany({ where: { friendId: userId, status: 'PENDING' }, include: { user: { select: userSelect } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.friend.findMany({ where: { userId, status: 'PENDING' }, include: { friend: { select: userSelect } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { received: received.map(({ id, user }) => ({ ...user, id })), sent: sent.map(({ id, friend }) => ({ ...friend, id })) };
  }

  async add(userId: string, friendId: string) {
    if (userId === friendId) throw new BadRequestException('Vous ne pouvez pas vous ajouter vous-même comme ami');
    const friendUser = await this.prisma.user.findUnique({ where: { id: friendId }, select: userSelect });
    if (!friendUser) throw new NotFoundException(`Utilisateur ${friendId} introuvable`);
    const existing = await this.prisma.friend.findUnique({ where: { userId_friendId: { userId, friendId } } });
    if (existing?.status === 'ACCEPTED') return { ...friendUser, alreadyFriends: true };
    if (existing?.status === 'PENDING') return { ...friendUser, requestPending: true };
    const reverse = await this.prisma.friend.findUnique({ where: { userId_friendId: { userId: friendId, friendId: userId } } });
    if (reverse?.status === 'PENDING') return { ...friendUser, requestPending: true };
    try {
      const request = await this.prisma.friend.create({ data: { userId, friendId, status: 'PENDING' } });
      this.realtimeGateway.notifyFriendUpdate(friendId, { type: 'request_received', requestId: request.id });
      return { ...friendUser, requestPending: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { ...friendUser, requestPending: true };
      throw error;
    }
  }

  async accept(userId: string, requestId: string) {
    const request = await this.prisma.friend.findFirst({ where: { id: requestId, friendId: userId, status: 'PENDING' } });
    if (!request) throw new NotFoundException('Invitation introuvable');
    await this.prisma.$transaction(async (tx) => {
      await tx.friend.update({ where: { id: request.id }, data: { status: 'ACCEPTED' } });
      await tx.friend.upsert({ where: { userId_friendId: { userId, friendId: request.userId } }, update: { status: 'ACCEPTED' }, create: { userId, friendId: request.userId, status: 'ACCEPTED' } });
    });
    this.realtimeGateway.notifyFriendUpdate(request.userId, { type: 'request_accepted', requestId });
    this.realtimeGateway.notifyFriendUpdate(userId, { type: 'request_accepted', requestId });
    return { success: true };
  }

  async decline(userId: string, requestId: string) {
    const request = await this.prisma.friend.findFirst({ where: { id: requestId, friendId: userId, status: 'PENDING' }, select: { userId: true } });
    const deleted = await this.prisma.friend.deleteMany({ where: { id: requestId, friendId: userId, status: 'PENDING' } });
    if (deleted.count === 0) throw new NotFoundException('Invitation introuvable');
    this.realtimeGateway.notifyFriendUpdate(userId, { type: 'request_declined', requestId });
    if (request) this.realtimeGateway.notifyFriendUpdate(request.userId, { type: 'request_declined', requestId });
    return { success: true };
  }

  async remove(userId: string, friendId: string) {
    const deleted = await this.prisma.friend.deleteMany({ where: { OR: [{ userId, friendId }, { userId: friendId, friendId: userId }] } });
    if (deleted.count === 0) throw new NotFoundException('Relation d’amitié introuvable');
    this.realtimeGateway.notifyFriendUpdate(userId, { type: 'friend_removed', friendId });
    this.realtimeGateway.notifyFriendUpdate(friendId, { type: 'friend_removed', friendId: userId });
    return { success: true };
  }
}
