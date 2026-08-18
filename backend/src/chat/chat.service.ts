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
    if (!room) throw new NotFoundException(`Room ${roomId} not found`);
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
          select: { id: true, email: true, avatarUrl: true, status: true },
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
          select: { id: true, email: true, avatarUrl: true, status: true },
        },
      },
    });
  }

  async *streamBot(userId: string, roomId: string, prompt: string) {
    await this.assertMember(userId, roomId);
    const active = await this.prisma.round.findFirst({ where: { roomId, status: { in: ['COUNTDOWN', 'OPEN', 'LOCKED'] } }, select: { id: true } });
    if (active) throw new ForbiddenException('The bot cannot comment on clips from the current round');
    yield* this.aiService.streamChat(prompt, userId);
  }

  private async assertMember(userId: string, roomId: string): Promise<void> {
    const isMember = await this.roomPresence.isMember(userId, roomId);
    if (!isMember) {
      throw new ForbiddenException('Join the room before accessing its chat');
    }
  }
}
