import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { name: string }, createdBy: string) {
    return this.prisma.room.create({ data: { name: data.name, createdBy, status: 'WAITING' } });
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
      include: { host: { select: { id: true, email: true, avatarUrl: true, status: true } }, rounds: { orderBy: { createdAt: 'desc' } } },
    });
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    return room;
  }

  async assertHost(id: string, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id }, select: { createdBy: true } });
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    if (room.createdBy !== userId) throw new ForbiddenException('Only the room host may perform this action');
  }
}
