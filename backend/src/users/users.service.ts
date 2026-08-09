import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { createReadStream, existsSync, unlink } from 'node:fs';
import { join, resolve } from 'node:path';
import { StreamableFile } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updateData: { displayName?: string; avatarUrl?: string } = {};

    if (dto.displayName !== undefined) {
      updateData.displayName = dto.displayName;
    }
    if (dto.avatarUrl !== undefined) {
      updateData.avatarUrl = dto.avatarUrl;
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No profile fields provided');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.passwordHash) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Current password is required');
      }

      const currentMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!currentMatches) {
        throw new UnauthorizedException('Current password is invalid');
      }
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { success: true };
  }

  async setAvatar(userId: string, filename: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    if (!user) throw new NotFoundException('User not found');

    const avatarUrl = `/api/users/avatars/${filename}`;
    const previous = user.avatarUrl?.match(/^\/api\/users\/avatars\/([a-zA-Z0-9._-]+)$/)?.[1];
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl }, select: { id: true } });
    if (previous) {
      const previousPath = join(this.avatarDirectory(), previous);
      if (existsSync(previousPath)) unlink(previousPath, () => undefined);
    }
    return this.findById(userId);
  }

  getAvatar(filename: string) {
    if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp)$/i.test(filename)) {
      throw new NotFoundException('Avatar not found');
    }
    const filePath = join(this.avatarDirectory(), filename);
    if (!existsSync(filePath)) throw new NotFoundException('Avatar not found');
    return new StreamableFile(createReadStream(filePath));
  }

  avatarDirectory() {
    return resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads', 'avatars'));
  }
}
