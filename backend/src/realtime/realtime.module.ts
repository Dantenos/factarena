import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { BetsModule } from '../bets/bets.module';
import { ClipVotesModule } from '../clip-votes/clip-votes.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RoundsModule } from '../rounds/rounds.module';
import { ChatModule } from '../chat/chat.module';
import { AiModule } from '../ai/ai.module';
import { RealtimeGateway } from './realtime.gateway';
import { GameLoopService } from './game-loop.service';
import { BotsService } from './bots.service';

@Module({
  imports: [AuthModule, LedgerModule, BetsModule, ClipVotesModule, RoomsModule, RoundsModule, ChatModule, AiModule],
  providers: [RealtimeGateway, GameLoopService, BotsService],
})
export class RealtimeModule {}
