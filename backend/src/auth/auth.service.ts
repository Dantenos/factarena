import {
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
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: 'USER',
      },
    });

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
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
    if (!params.email) {
      throw new UnauthorizedException('OAuth provider did not return an email');
    }

    const providerUser = await this.prisma.user.findUnique({
      where: {
        oauthProvider_oauthProviderId: {
          oauthProvider: params.provider,
          oauthProviderId: params.providerId,
        },
      },
    });

    if (providerUser) {
      return this.buildAuthResponse(providerUser);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: params.email },
    });

    if (existingUser) {
      const updatedUser = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          oauthProvider: params.provider,
          oauthProviderId: params.providerId,
          displayName: params.displayName ?? existingUser.displayName,
          avatarUrl: params.avatarUrl ?? existingUser.avatarUrl,
        },
      });
      return this.buildAuthResponse(updatedUser);
    }

    const user = await this.prisma.user.create({
      data: {
        email: params.email,
        displayName: params.displayName,
        avatarUrl: params.avatarUrl,
        oauthProvider: params.provider,
        oauthProviderId: params.providerId,
        role: 'USER',
      },
    });

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
}
