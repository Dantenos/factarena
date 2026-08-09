import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@Request() req: { user: { userId: string } }) {
    return this.usersService.findById(req.user.userId);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', {
    storage: diskStorage({
      destination: (_req: unknown, _file: unknown, cb: (error: Error | null, destination: string) => void) => {
        const directory = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads', 'avatars');
        mkdirSync(directory, { recursive: true });
        cb(null, directory);
      },
      filename: (_req: unknown, file: { mimetype: string }, cb: (error: Error | null, filename: string) => void) => {
        const extension = file.mimetype === 'image/png' ? 'png'
          : file.mimetype === 'image/gif' ? 'gif'
          : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
        cb(null, `${randomUUID()}-${Date.now()}.${extension}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req: unknown, file: { mimetype: string }, cb: (error: Error | null, acceptFile: boolean) => void) => {
      cb(null, ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimetype));
    },
  }))
  uploadAvatar(
    @Request() req: { user: { userId: string } },
    @UploadedFile() file?: { filename: string },
  ) {
    if (!file) throw new BadRequestException('A valid image avatar is required');
    return this.usersService.setAvatar(req.user.userId, file.filename);
  }

  @Get('avatars/:filename')
  avatar(@Param('filename') filename: string): StreamableFile {
    return this.usersService.getAvatar(filename);
  }

  @Patch('me')
  updateProfile(
    @Request() req: { user: { userId: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @Patch('me/password')
  changePassword(
    @Request() req: { user: { userId: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(req.user.userId, dto);
  }

  @Get(':id')
  getById(@Param('id', CuidParamPipe) id: string) {
    return this.usersService.findById(id);
  }
}
