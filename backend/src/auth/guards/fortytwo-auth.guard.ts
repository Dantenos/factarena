import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isFortyTwoEnabled } from '../../common/env';

@Injectable()
export class FortyTwoAuthGuard extends AuthGuard('42') {
  canActivate(context: ExecutionContext) {
    if (!isFortyTwoEnabled()) {
      throw new ServiceUnavailableException('OAuth 42 n’est pas configuré');
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(error: unknown, user: TUser, info: unknown): TUser {
    if (error || !user) {
      throw new UnauthorizedException('L’authentification OAuth 42 a échoué');
    }
    return user;
  }
}
