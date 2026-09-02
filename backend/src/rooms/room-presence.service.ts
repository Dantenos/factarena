import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PRESENCE_TTL_MS = 45_000;

type PresenceEntry = {
  socketId: string;
  userId: string;
  roomId: string;
  lastSeenAt: Date;
};

/**
 * Presence is persisted so a second backend instance sees the same members.
 * Entries expire automatically; this also handles a process killed without a
 * WebSocket disconnect event.
 */
@Injectable()
export class RoomPresenceService {
  constructor(private readonly prisma: PrismaService) {}

  private activeSince() {
    return new Date(Date.now() - PRESENCE_TTL_MS);
  }

  async join(socketId: string, userId: string, roomId: string) {
    const previous = await this.prisma.roomPresence.findUnique({ where: { socketId } });
    await this.prisma.roomPresence.upsert({
      where: { socketId },
      update: { userId, roomId, lastSeenAt: new Date() },
      create: { socketId, userId, roomId },
    });

    const alreadyPresent = await this.prisma.roomPresence.count({
      where: { roomId, userId, lastSeenAt: { gt: this.activeSince() }, socketId: { not: socketId } },
    });

    return {
      previousRoomId: previous?.roomId,
      joinedRoom: alreadyPresent === 0,
    };
  }

  async touch(socketId: string) {
    await this.prisma.roomPresence.updateMany({
      where: { socketId },
      data: { lastSeenAt: new Date() },
    });
  }

  async leave(socketId: string) {
    const current = await this.prisma.roomPresence.findUnique({ where: { socketId } });
    if (!current) return null;

    // deleteMany, pas delete : prune() peut avoir effacé la ligne juste après
    // le findUnique, et delete() lèverait alors P2025.
    await this.prisma.roomPresence.deleteMany({ where: { socketId } });
    const remaining = await this.prisma.roomPresence.count({
      where: { roomId: current.roomId, userId: current.userId, lastSeenAt: { gt: this.activeSince() } },
    });

    return { ...current, leftRoom: remaining === 0 };
  }

  async getMemberIds(roomId: string) {
    await this.prune();
    const entries = await this.prisma.roomPresence.findMany({
      where: { roomId, lastSeenAt: { gt: this.activeSince() } },
      distinct: ['userId'],
      select: { userId: true },
    });
    return entries.map((entry) => entry.userId);
  }

  async getCurrentRoomId(userId: string) {
    await this.prune();
    const entry = await this.prisma.roomPresence.findFirst({
      where: { userId, lastSeenAt: { gt: this.activeSince() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { roomId: true },
    });
    return entry?.roomId ?? null;
  }

  async isMember(userId: string, roomId: string) {
    const entry = await this.prisma.roomPresence.findFirst({
      where: { userId, roomId, lastSeenAt: { gt: this.activeSince() } },
      select: { socketId: true },
    });
    return Boolean(entry);
  }

  private async prune() {
    const stale = await this.prisma.roomPresence.findMany({
      where: { lastSeenAt: { lte: this.activeSince() } },
      distinct: ['userId'],
      select: { userId: true },
    });
    if (stale.length === 0) return;

    await this.prisma.roomPresence.deleteMany({ where: { lastSeenAt: { lte: this.activeSince() } } });
    const stillActive = await this.prisma.roomPresence.findMany({
      where: { userId: { in: stale.map((entry) => entry.userId) }, lastSeenAt: { gt: this.activeSince() } },
      distinct: ['userId'],
      select: { userId: true },
    });
    const activeIds = new Set(stillActive.map((entry) => entry.userId));
    const offlineIds = stale.map((entry) => entry.userId).filter((id) => !activeIds.has(id));
    if (offlineIds.length > 0) {
      await this.prisma.user.updateMany({ where: { id: { in: offlineIds } }, data: { status: 'OFFLINE' } });
    }
  }
}
