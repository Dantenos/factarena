import { forwardRef, Module } from '@nestjs/common';
import { BetsModule } from '../bets/bets.module';
import { RoomPresenceModule } from './room-presence.module';
import { ChatModule } from '../chat/chat.module';
import { RoomsController } from './rooms.controller';
import { RoomPresenceService } from './room-presence.service';
import { RoomsService } from './rooms.service';

@Module({
  imports: [forwardRef(() => BetsModule), forwardRef(() => ChatModule), RoomPresenceModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService, RoomPresenceModule],
})
export class RoomsModule {}
