import { forwardRef, Module } from '@nestjs/common';
import { RoundsController } from './rounds.controller';
import { RoundsService } from './rounds.service';
import { LedgerModule } from '../ledger/ledger.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RoomPresenceModule } from '../rooms/room-presence.module';

@Module({
  imports: [forwardRef(() => LedgerModule), forwardRef(() => RoomsModule), RoomPresenceModule],
  controllers: [RoundsController],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
