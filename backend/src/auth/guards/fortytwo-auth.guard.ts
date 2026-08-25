import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isFortyTwoEnabled } from '../../common/env';

/**
 * OAuth is optional in local installations. This guard turns a missing or
 * invalid OAuth configuration into an explicit 503 instead of Passport's
 * opaque "Unknown authentication strategy" error.
 */
@Injectable()
export class FortyTwoAuthGuard extends AuthGuard('42') {
  canActivate(context: ExecutionContext) {
    if (!isFortyTwoEnabled()) {
      throw new ServiceUnavailableException('42 OAuth is not configured');
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(error: unknown, user: TUser, info: unknown): TUser {
    if (error || !user) {
      throw new UnauthorizedException('42 OAuth authentication failed');
    }
    return user;
  }
}
