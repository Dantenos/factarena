import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// STRUCTURE VIDE (volontaire à ce stade). L'inscription / connexion par email +
// mot de passe hashé (Argon2/bcrypt), les JWT et l'OAuth 42 seront implémentés
// ici. On pose seulement le squelette pour que le Back Core sache où coder.
@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
