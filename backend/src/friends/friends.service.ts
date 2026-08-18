import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RoomPresenceService } from '../rooms/room-presence.service';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomPresence: RoomPresenceService,
  ) {}

  async list(userId: string) {
    const friendships = await this.prisma.friend.findMany({
      where: { userId },
      include: {
        friend: {
          select: { id: true, email: true, avatarUrl: true, status: true, createdAt: true, updatedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return friendships.map((entry: { friend: { id: string; email: string; avatarUrl: string | null; status: string; createdAt: Date; updatedAt: Date } }) => entry.friend);
  }

  async presence(userId: string) {
    const friends = await this.list(userId);
    return Promise.all(friends.map(async (friend) => ({
      ...friend,
      currentRoomId: await this.roomPresence.getCurrentRoomId(friend.id),
    })));
  }

  async add(userId: string, friendId: string) {
    if (userId === friendId) {
      throw new BadRequestException('Cannot add yourself as a friend');
    }

    const friendUser = await this.prisma.user.findUnique({ where: { id: friendId } });
    if (!friendUser) {
      throw new NotFoundException(`User ${friendId} not found`);
    }

    const existingFriendship = await this.prisma.friend.findUnique({
      where: { userId_friendId: { userId, friendId } },
    });
    if (existingFriendship) {
      throw new ConflictException('Already friends');
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.friend.create({ data: { userId, friendId } });
      await tx.friend.create({ data: { userId: friendId, friendId: userId } });
    });

    return friendUser;
  }

  async remove(userId: string, friendId: string) {
    const deleted = await this.prisma.friend.deleteMany({
      where: {
        OR: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ],
      },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('Friend relationship not found');
    }

    return { success: true };
  }
}
