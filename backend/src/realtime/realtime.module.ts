import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PredictionsModule } from '../predictions/predictions.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RoundsModule } from '../rounds/rounds.module';
import { ChatModule } from '../chat/chat.module';
import { AiModule } from '../ai/ai.module';
import { RealtimeGateway } from './realtime.gateway';
import { GameLoopService } from './game-loop.service';

@Module({
  imports: [AuthModule, LedgerModule, PredictionsModule, RoomsModule, RoundsModule, ChatModule, AiModule],
  providers: [RealtimeGateway, GameLoopService],
})
export class RealtimeModule {}
