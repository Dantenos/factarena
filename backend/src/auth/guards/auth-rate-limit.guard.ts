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

    if (endpoint === 'register') {
      // Le compteur unique par IP bloquait toutes les fenêtres Chrome d'une
      // même machine dès qu'une personne testait plusieurs fois une adresse.
      // On garde un plafond IP global anti-abus, mais on ajoute un compteur par
      // e-mail pour que les utilisateurs légitimes ne se bloquent pas entre eux.
      this.rateLimit.consume(`auth:register:ip:${ip}`, 50, policy.windowMs);
      const email = typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
      if (email) {
        this.rateLimit.consume(`auth:register:email:${email}`, policy.maxRequests, policy.windowMs);
      }
    } else {
      this.rateLimit.consume(`auth:${endpoint}:${ip}`, policy.maxRequests, policy.windowMs);
    }
    return true;
  }

  private policyFor(endpoint: string): { maxRequests: number; windowMs: number } {
    switch (endpoint) {
      case 'register':
        return { maxRequests: 10, windowMs: 60 * 60_000 };
      case 'authenticateWith42Callback':
        return { maxRequests: 10, windowMs: 15 * 60_000 };
      case 'login':
      default:
        return { maxRequests: 10, windowMs: 15 * 60_000 };
    }
  }
}
