import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PredictionsModule } from '../predictions/predictions.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RoundsModule } from '../rounds/rounds.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, LedgerModule, PredictionsModule, RoomsModule, RoundsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
