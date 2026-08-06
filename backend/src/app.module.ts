import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { RoundsModule } from './rounds/rounds.module';
import { PredictionsModule } from './predictions/predictions.module';
import { LedgerModule } from './ledger/ledger.module';
import { UsersModule } from './users/users.module';
import { FriendsModule } from './friends/friends.module';
import { ChatModule } from './chat/chat.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ClaimsModule } from './claims/claims.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    RoomsModule,
    RoundsModule,
    PredictionsModule,
    LedgerModule,
    UsersModule,
    FriendsModule,
    ChatModule,
    RealtimeModule,
    ClaimsModule,
    AiModule,
  ],
})
export class AppModule {}
