import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  StreamableFile,
  BadRequestException,
  NotFoundException,
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
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Request() req: { user: { userId: string } }) {
    try {
      return await this.usersService.findById(req.user.userId);
    } catch (error) {
      // A validly signed JWT can outlive the account it identifies. Return a
      // successful empty response so session cleanup does not create a browser
      // console error for an expected stale-session case.
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('avatar', {
    storage: diskStorage({
      destination: (_req: unknown, _file: unknown, cb: (error: Error | null, destination: string) => void) => {
        const directory = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads', 'avatars');
        mkdirSync(directory, { recursive: true });
        cb(null, directory);
      },
      filename: (_req: unknown, _file: { mimetype: string }, cb: (error: Error | null, filename: string) => void) => {
        cb(null, `${randomUUID()}.upload`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req: unknown, file: { mimetype: string }, cb: (error: Error | null, acceptFile: boolean) => void) => {
      cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype));
    },
  }))
  uploadAvatar(
    @Request() req: { user: { userId: string } },
    @UploadedFile() file?: { path: string },
  ) {
    if (!file) throw new BadRequestException('Une image d’avatar valide est obligatoire');
    return this.usersService.setAvatarFromUpload(req.user.userId, file.path);
  }

  // Avatars are intentionally public so browsers can load them through an
  // <img src="..."> without sending a bearer token. Filenames are generated
  // with randomUUID() on upload and validated in UsersService before reading.
  @Get('avatars/:filename')
  avatar(@Param('filename') filename: string): StreamableFile {
    return this.usersService.getAvatar(filename);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @Request() req: { user: { userId: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Request() req: { user: { userId: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(req.user.userId, dto);
  }

  /**
   * Recherche de joueurs pour le module amis.
   *
   * Déclarée AVANT @Get(':id') : Nest teste les routes dans l'ordre, et
   * « /users?recherche=... » serait sinon capté par la route paramétrée.
   *
   * La validation est double, comme partout : longueur minimale ici, et
   * plafond de résultats côté service.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  rechercher(
    @Request() req: { user: { userId: string } },
    @Query('recherche') recherche?: string,
  ) {
    if (!recherche || recherche.trim().length < 2) {
      throw new BadRequestException('La recherche doit faire au moins deux caractères');
    }
    if (recherche.length > 60) {
      throw new BadRequestException('Recherche trop longue');
    }
    return this.usersService.rechercher(req.user.userId, recherche);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getById(@Param('id', CuidParamPipe) id: string) {
    return this.usersService.findById(id);
  }
}
