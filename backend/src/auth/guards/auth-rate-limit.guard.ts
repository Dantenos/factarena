import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { RateLimitService } from '../../common/rate-limit.service';

@Injectable()
export class AuthRateLimitGuard {
  constructor(private readonly rateLimit: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const endpoint = context.getHandler().name;
    const policy = this.policyFor(endpoint);
    const ip = request.ip || request.socket.remoteAddress || 'unknown';

    this.rateLimit.consume(`auth:${endpoint}:${ip}`, policy.maxRequests, policy.windowMs);
    return true;
  }

  private policyFor(endpoint: string): { maxRequests: number; windowMs: number } {
    switch (endpoint) {
      case 'register':
        return { maxRequests: 5, windowMs: 60 * 60_000 };
      case 'authenticateWith42Callback':
        return { maxRequests: 10, windowMs: 15 * 60_000 };
      case 'login':
      default:
        return { maxRequests: 10, windowMs: 15 * 60_000 };
    }
  }
}
