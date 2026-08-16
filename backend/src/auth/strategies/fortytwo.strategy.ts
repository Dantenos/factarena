import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-42';
import { AuthService } from '../auth.service';
import {
  getFortyTwoCallbackUrl,
  getFortyTwoClientId,
  getFortyTwoClientSecret,
} from '../../common/env';

@Injectable()
export class FortyTwoStrategy extends PassportStrategy(Strategy, '42') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: getFortyTwoClientId(),
      clientSecret: getFortyTwoClientSecret(),
      callbackURL: getFortyTwoCallbackUrl(),
      scope: ['public'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
  ): Promise<any> {
    const providerId = typeof profile?.id === 'string' ? profile.id.trim() : '';
    const email = profile?.emails?.[0]?.value;
    if (!providerId) {
      throw new Error('42 OAuth profile did not return a valid provider id');
    }
    const displayName = profile?.displayName || profile?.username || (email ? email.split('@')[0] : undefined);
    const avatarUrl = profile?.photos?.[0]?.value || null;

    return this.authService.findOrCreateOAuthUser({
      provider: '42',
      providerId,
      email,
      displayName,
      avatarUrl,
    });
  }
}
