import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';

@Injectable()
export class ClaimsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.claim.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new NotFoundException(`Claim ${id} not found`);
    }
    return claim;
  }

  async findByRound(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      include: { roundClaims: { include: { claim: true } } },
    });
    if (!round) {
      throw new NotFoundException(`Round ${roundId} not found`);
    }
    return round.roundClaims.map((roundClaim) => ({
      ...roundClaim.claim,
      orderIndex: roundClaim.orderIndex,
    }));
  }

  async create(dto: CreateClaimDto, creatorId: string) {
    return this.prisma.claim.create({
      data: {
        ...dto,
      },
    });
  }

  async update(id: string, dto: UpdateClaimDto) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new NotFoundException(`Claim ${id} not found`);
    }
    return this.prisma.claim.update({
      where: { id },
      data: {
        ...dto,
      },
    });
  }

  async remove(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new NotFoundException(`Claim ${id} not found`);
    }
    await this.prisma.roundClaim.deleteMany({ where: { claimId: id } });
    return this.prisma.claim.delete({ where: { id } });
  }
}
