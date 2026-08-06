import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async sendMessage(userId: string, roomId: string, content: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`Room ${roomId} not found`);

    const history = await this.prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { content: true },
    });

    const moderation = await this.aiService.moderate(content, history.map((entry) => entry.content));
    const moderationData = moderation.data ?? {};

    if (moderationData.decision === 'delete') {
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
      action: moderationData.decision === 'warn' ? 'warn' : 'allow',
      moderation: moderationData,
      message,
    };
  }

  async findByRoom(roomId: string) {
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
}
