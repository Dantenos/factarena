import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

type AuthUser = {
  id: string;
  email: string;
  avatarUrl: string | null;
  displayName: string | null;
  status: string;
  role: string;
  experience: number;
  level: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      // Une inscription répétée est un cas métier attendu. On renvoie une
      // réponse normale avec un indicateur explicite afin que le navigateur
      // n'affiche pas un 409 dans la console pour un message déjà géré par le
      // formulaire.
      return { alreadyExists: true, message: 'Adresse e-mail déjà utilisée' };
    }

    const existingPseudo = await this.prisma.user.findUnique({
      where: { displayName: dto.displayName },
    });
    if (existingPseudo) {
      return { pseudoAlreadyExists: true, message: 'Pseudo déjà utilisé par un autre joueur.' };
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    let user: AuthUser;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'USER',
          displayName: dto.displayName,
        },
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
        if (Array.isArray(target) ? target.includes('displayName') : target === 'displayName') {
          return { pseudoAlreadyExists: true, message: 'Pseudo déjà utilisé par un autre joueur.' };
        }
        return { alreadyExists: true, message: 'Adresse e-mail déjà utilisée' };
      }
      throw error;
    }

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    if ((email.split('@')[0] ?? '').length > 64) {
      throw new BadRequestException('L’adresse e-mail doit être valide.');
    }
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    return this.buildAuthResponse(user);
  }

  async findOrCreateOAuthUser(params: {
    provider: string;
    providerId: string;
    email: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  }) {
    const provider = params.provider?.trim();
    const providerId = params.providerId?.trim();
    const email = params.email?.trim().toLowerCase();

    if (provider !== '42' || provider.length > 32 || !providerId || providerId.length > 255) {
      throw new BadRequestException('Identité du fournisseur OAuth invalide');
    }
    if (!email) {
      throw new UnauthorizedException('Le fournisseur OAuth n\'a pas retourné d\'adresse e-mail');
    }

    const providerUser = await this.prisma.user.findUnique({
      where: {
        oauthProvider_oauthProviderId: {
          oauthProvider: provider,
          oauthProviderId: providerId,
        },
      },
    });

    if (providerUser) {
      return this.buildAuthResponse(providerUser);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Un compte existe déjà pour cette adresse e-mail; veuillez lier votre compte OAuth après vous être authentifié');
    }

    let user: AuthUser;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          displayName: params.displayName,
          avatarUrl: params.avatarUrl,
          oauthProvider: provider,
          oauthProviderId: providerId,
          role: 'USER',
        },
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Un compte OAuth existe déjà pour cette identité');
      }
      throw error;
    }

    return this.buildAuthResponse(user);
  }

  private buildAuthResponse(user: AuthUser) {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        // Les comptes créés par e-mail peuvent ne pas encore avoir de pseudo.
        // On fournit alors un pseudo d’affichage borné à 30 caractères, sans
        // modifier le pseudo personnalisé déjà enregistré.
        displayName: user.displayName || user.email.split('@')[0].slice(0, 30),
        avatarUrl: user.avatarUrl,
        status: user.status,
        role: user.role,
        experience: user.experience,
        level: user.level,
      },
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
