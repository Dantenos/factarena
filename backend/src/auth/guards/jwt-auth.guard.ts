import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

type JwtPayload = {
  sub?: unknown;
  email?: unknown;
  role?: unknown;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing bearer token');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        (payload.email !== undefined && typeof payload.email !== 'string') ||
        (payload.role !== undefined && typeof payload.role !== 'string')
      ) {
        throw new UnauthorizedException('Invalid token payload');
      }

      (request as Request & { user: { userId: string; email?: string; role?: string } }).user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role ?? 'USER',
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
