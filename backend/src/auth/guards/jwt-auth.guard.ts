import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../common/env';

@Injectable()
export class JwtAuthGuard implements CanActivate {
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
      const secret = getJwtSecret();
      const payload = jwt.verify(token, secret) as { sub?: string; email?: string; role?: string };

      (request as Request & { user: { userId?: string; email?: string; role?: string } }).user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      } as any;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
