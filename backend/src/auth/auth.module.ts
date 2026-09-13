import { Global, Module, Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FortyTwoStrategy } from './strategies/fortytwo.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { FortyTwoAuthGuard } from './guards/fortytwo-auth.guard';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { RateLimitService } from '../common/rate-limit.service';
import { getJwtSecret, isFortyTwoEnabled } from '../common/env';

const authProviders: Provider[] = [
  AuthService,
  JwtAuthGuard,
  RolesGuard,
  FortyTwoAuthGuard,
  AuthRateLimitGuard,
  RateLimitService,
];
if (isFortyTwoEnabled()) {
  authProviders.push(FortyTwoStrategy);
}

@Global()
@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ session: false }),
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: authProviders,
  exports: [JwtModule, JwtAuthGuard, RolesGuard, FortyTwoAuthGuard, AuthRateLimitGuard],
})
export class AuthModule {}
