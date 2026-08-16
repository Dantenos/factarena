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
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { StreamableFile } from '@nestjs/common';

type AvatarFormat = 'png' | 'jpg' | 'gif' | 'webp';
type AvatarInfo = { format: AvatarFormat; width: number; height: number };

const MAX_AVATAR_WIDTH = 2048;
const MAX_AVATAR_HEIGHT = 2048;
const MAX_AVATAR_PIXELS = 4_000_000;
const TEMP_FILE_MAX_AGE_MS = 60 * 60_000;

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
    if (!this.isAvatarFilename(filename)) throw new BadRequestException('Invalid avatar file');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    if (!user) throw new NotFoundException('User not found');

    const avatarUrl = `/api/users/avatars/${filename}`;
    const previous = user.avatarUrl?.match(/^\/api\/users\/avatars\/([a-zA-Z0-9._-]+)$/)?.[1];
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl }, select: { id: true } });
    if (previous) {
      const previousPath = join(this.avatarDirectory(), previous);
      if (existsSync(previousPath)) await this.removeFile(previousPath);
    }
    return this.findById(userId);
  }

  async setAvatarFromUpload(userId: string, temporaryPath: string) {
    let finalPath: string | undefined;
    try {
      const avatar = await this.inspectAvatar(temporaryPath);
      const filename = `${randomUUID()}.${avatar.format}`;
      finalPath = join(this.avatarDirectory(), filename);
      await rename(temporaryPath, finalPath);
      return await this.setAvatar(userId, filename);
    } catch (error) {
      await this.removeFile(temporaryPath);
      if (finalPath) await this.removeFile(finalPath);
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw error;
    }
  }

  async cleanupOrphanedAvatars() {
    if (!existsSync(this.avatarDirectory())) return { removed: 0 };
    const users = await this.prisma.user.findMany({
      select: { avatarUrl: true },
    });
    const referenced = new Set(
      users
        .map(({ avatarUrl }) => avatarUrl?.match(/^\/api\/users\/avatars\/([a-zA-Z0-9_-]+\.(?:png|jpe?g|gif|webp))$/i)?.[1])
        .filter((filename): filename is string => Boolean(filename)),
    );
    let removed = 0;
    for (const filename of readdirSync(this.avatarDirectory())) {
      const filePath = join(this.avatarDirectory(), filename);
      if (filename.endsWith('.upload')) {
        if (Date.now() - statSync(filePath).mtimeMs > TEMP_FILE_MAX_AGE_MS) {
          await this.removeFile(filePath);
          removed += 1;
        }
        continue;
      }
      if (!this.isAvatarFilename(filename) || referenced.has(filename)) continue;
      await this.removeFile(filePath);
      removed += 1;
    }
    return { removed };
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

  private async inspectAvatar(filePath: string): Promise<AvatarInfo> {
    const bytes = await readFile(filePath);
    const avatar = this.detectAvatar(bytes);
    if (!avatar) throw new BadRequestException('The uploaded file is not a supported image');
    if (avatar.width < 1 || avatar.height < 1 || avatar.width > MAX_AVATAR_WIDTH || avatar.height > MAX_AVATAR_HEIGHT || avatar.width * avatar.height > MAX_AVATAR_PIXELS) {
      throw new BadRequestException('Avatar dimensions are too large');
    }
    return avatar;
  }

  private detectAvatar(bytes: Buffer): AvatarInfo | null {
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
      return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (bytes.length >= 10 && (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a')) {
      return { format: 'gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
      return this.detectWebp(bytes);
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return this.detectJpeg(bytes);
    }
    return null;
  }

  private detectWebp(bytes: Buffer): AvatarInfo | null {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { format: 'webp', width, height };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { format: 'webp', width: bytes.readUInt16LE(26), height: bytes.readUInt16LE(28) };
    }
    if (chunk === 'VP8L' && bytes.length >= 26 && bytes[21] === 0x2f) {
      const width = 1 + bytes[22] + ((bytes[23] & 0x3f) << 8);
      const height = 1 + ((bytes[23] >> 6) & 0x03) + (bytes[24] << 2) + ((bytes[25] & 0x0f) << 10);
      return { format: 'webp', width, height };
    }
    return null;
  }

  private detectJpeg(bytes: Buffer): AvatarInfo | null {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) return null;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xc3 || marker >= 0xc5 && marker <= 0xc7 || marker >= 0xc9 && marker <= 0xcb || marker >= 0xcd && marker <= 0xcf;
      if (isStartOfFrame && length >= 7) {
        return { format: 'jpg', height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
    return null;
  }

  private isAvatarFilename(filename: string): boolean {
    return /^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp)$/i.test(filename);
  }

  private async removeFile(filePath: string) {
    try { await unlink(filePath); } catch { /* already removed */ }
  }
}
