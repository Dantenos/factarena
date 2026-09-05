import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomsModule } from '../rooms/rooms.module';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [PrismaModule, RoomsModule, forwardRef(() => RealtimeModule)],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
