import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async sendMessage(userId: string, roomId: string, content: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`Room ${roomId} not found`);

    return this.prisma.message.create({
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
