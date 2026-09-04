import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
          select: { id: true, email: true, displayName: true, avatarUrl: true, status: true, createdAt: true, updatedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return friendships.map((entry: { friend: { id: string; email: string; displayName: string | null; avatarUrl: string | null; status: string; createdAt: Date; updatedAt: Date } }) => entry.friend);
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
      throw new BadRequestException('Vous ne pouvez pas vous ajouter vous-même comme ami');
    }

    const friendUser = await this.prisma.user.findUnique({ where: { id: friendId } });
    if (!friendUser) {
      throw new NotFoundException(`Utilisateur ${friendId} introuvable`);
    }

    const existingFriendship = await this.prisma.friend.findUnique({
      where: { userId_friendId: { userId, friendId } },
    });
    if (existingFriendship) {
      // Ajouter une relation déjà existante est un cas métier normal (double
      // clic, recherche conservée ouverte, ou deux onglets). On le traite
      // comme une opération idempotente plutôt que comme une erreur HTTP 409 :
      // le navigateur n'affiche ainsi pas une erreur console pour une action
      // attendue, tout en permettant au frontend d'informer l'utilisateur.
      return { ...friendUser, alreadyFriends: true };
    }

    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.friend.create({ data: { userId, friendId } });
        await tx.friend.create({ data: { userId: friendId, friendId: userId } });
      });
    } catch (error) {
      // Deux clics rapides ou deux onglets peuvent franchir le contrôle
      // précédent avant que la première transaction ne soit validée. La
      // contrainte unique Prisma devient alors, elle aussi, un simple cas
      // "déjà ami", pas une erreur affichée au navigateur.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { ...friendUser, alreadyFriends: true };
      }
      throw error;
    }

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
      throw new NotFoundException('Relation d’amitié introuvable');
    }

    return { success: true };
  }
}
