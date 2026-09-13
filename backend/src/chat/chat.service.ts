import { ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { RoomPresenceService } from '../rooms/room-presence.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    @Inject(forwardRef(() => RoomPresenceService))
    private readonly roomPresence: RoomPresenceService,
  ) {}

  async sendMessage(userId: string, roomId: string, content: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`Salon ${roomId} introuvable`);
    await this.assertMember(userId, roomId);

    const history = await this.prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true },
    });

    const moderation = await this.aiService.moderate(content, history.map((entry) => entry.content));
    const moderationData = moderation.data ?? {};

    const action = moderationData.action;

    if (action === 'delete') {
      return {
        action: 'delete',
        moderation,
      };
    }

    const message = await this.prisma.message.create({
      data: {
        roomId,
        userId,
        content,
      },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, avatarUrl: true, status: true },
        },
      },
    });

    return {
      action: action === 'warn' ? 'warn' : 'allow',
      moderation: moderationData,
      message,
    };
  }

  async findByRoom(roomId: string, userId?: string) {
    if (userId) await this.assertMember(userId, roomId);
    return this.prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, avatarUrl: true, status: true },
        },
      },
    });
  }

  async *streamBot(userId: string, roomId: string, prompt: string) {
    await this.assertMember(userId, roomId);

    const active = await this.prisma.round.findFirst({
      where: { roomId, status: { in: ['COUNTDOWN', 'OPEN', 'LOCKED'] } },
      select: { roundClaims: { select: { claim: { select: { text: true, sourceUrl: true } } } } },
    });
    const liveClaims = active?.roundClaims.map((rc) => rc.claim.text) ?? [];

    const exclureUrls = (active?.roundClaims ?? [])
      .map((rc) => rc.claim.sourceUrl)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    yield* this.aiService.streamRag(prompt, userId, { claims: liveClaims, exclureUrls });
  }

  private async assertMember(userId: string, roomId: string): Promise<void> {
    const isMember = await this.roomPresence.isMember(userId, roomId);
    if (!isMember) {
      throw new ForbiddenException('Rejoignez le salon avant d’accéder à son chat');
    }
  }
}
