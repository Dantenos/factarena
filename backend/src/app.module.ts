import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';

// Module racine : il assemble les modules de fonctionnalités.
// Vos futurs modules (users, rooms, rounds, predictions, stats...) s'ajoutent
// dans ce tableau `imports`.
@Module({
  imports: [PrismaModule, HealthModule, AuthModule],
})
export class AppModule {}
