import { forwardRef, Module } from '@nestjs/common';
import { PredictionsModule } from '../predictions/predictions.module';
import { ChatModule } from '../chat/chat.module';
import { RoomsController } from './rooms.controller';
import { RoomPresenceService } from './room-presence.service';
import { RoomsService } from './rooms.service';

@Module({
  imports: [forwardRef(() => PredictionsModule), forwardRef(() => ChatModule)],
  controllers: [RoomsController],
  providers: [RoomsService, RoomPresenceService],
  exports: [RoomsService, RoomPresenceService],
})
export class RoomsModule {}
