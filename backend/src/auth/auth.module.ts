import { Module, Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FortyTwoStrategy } from './strategies/fortytwo.strategy';
import { getJwtSecret, isFortyTwoEnabled } from '../common/env';

const authProviders: Provider[] = [AuthService];
if (isFortyTwoEnabled()) {
  authProviders.push(FortyTwoStrategy);
}

// Module d'authentification : il expose les routes /api/auth/* et fournit les
// services nécessaires pour stocker les utilisateurs, hasher les mots de passe
// et signer des JWT.
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
  exports: [JwtModule],
})
export class AuthModule {}
