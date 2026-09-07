import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
      select: this.publicClaimSelect(),
    });
  }

  async findById(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id }, select: this.publicClaimSelect() });
    if (!claim) {
      throw new NotFoundException(`Affirmation ${id} introuvable`);
    }
    return claim;
  }

  async findByRound(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      include: { roundClaims: { include: { claim: true }, orderBy: { orderIndex: 'asc' } } },
    });
    if (!round) {
      throw new NotFoundException(`La manche ${roundId} est introuvable`);
    }
    const revealed = round.status === 'REVEALED' || round.status === 'FINISHED';
    return round.roundClaims.map((roundClaim) => ({
      ...(revealed ? roundClaim.claim : this.hideTruthLabel(roundClaim.claim)),
      orderIndex: roundClaim.orderIndex,
    }));
  }

  async create(dto: CreateClaimDto, creatorId: string) {
    return this.prisma.claim.create({
      data: {
        ...dto,
        createdBy: creatorId,
      },
    });
  }

  async update(id: string, dto: UpdateClaimDto) {
    const claim = await this.prisma.claim.findUnique({ where: { id }, include: { roundClaims: true } });
    if (!claim) {
      throw new NotFoundException(`Affirmation ${id} introuvable`);
    }
    if (claim.roundClaims.length > 0) {
      throw new ConflictException('Une affirmation utilisée dans une manche ne peut pas être modifiée');
    }
    return this.prisma.claim.update({
      where: { id },
      data: {
        ...dto,
      },
    });
  }

  async remove(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id }, include: { roundClaims: true } });
    if (!claim) {
      throw new NotFoundException(`Affirmation ${id} introuvable`);
    }
    if (claim.roundClaims.length > 0) {
      throw new ConflictException('Une affirmation utilisée dans une manche ne peut pas être supprimée');
    }
    return this.prisma.claim.delete({ where: { id } });
  }

  private publicClaimSelect() {
    return {
      id: true,
      text: true,
      mediaRef: true,
      videoEndS: true,
      category: true,
      sourceUrl: true,
      createdAt: true,
    } as const;
  }

  private hideTruthLabel<T extends { truthLabel: unknown }>(claim: T) {
    const { truthLabel: _truthLabel, ...safeClaim } = claim;
    return safeClaim;
  }
}
