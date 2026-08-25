import { Module } from '@nestjs/common';
import { RoundsController } from './rounds.controller';
import { RoundsService } from './rounds.service';
import { LedgerModule } from '../ledger/ledger.module';
import { RoomsModule } from '../rooms/rooms.module';

@Module({
  imports: [LedgerModule, RoomsModule],
  controllers: [RoundsController],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
