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
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    let user: AuthUser;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'USER',
        },
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
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
      throw new BadRequestException('OAuth provider identity is invalid');
    }
    if (!email) {
      throw new UnauthorizedException('OAuth provider did not return an email');
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
      throw new ConflictException('An account already exists for this email; link OAuth after authenticating first');
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
        throw new ConflictException('An OAuth account with this identity already exists');
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
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        role: user.role,
      },
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
