import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { RoundsModule } from './rounds/rounds.module';
import { PredictionsModule } from './predictions/predictions.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    RoomsModule,
    RoundsModule,
    PredictionsModule,
    LedgerModule,
  ],
})
export class AppModule {}
