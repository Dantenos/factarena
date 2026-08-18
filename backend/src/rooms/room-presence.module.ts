import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomPresenceService } from './room-presence.service';

@Module({ imports: [PrismaModule], providers: [RoomPresenceService], exports: [RoomPresenceService] })
export class RoomPresenceModule {}
