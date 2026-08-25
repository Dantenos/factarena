import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomPresenceModule } from '../rooms/room-presence.module';
import { ClipVotesController } from './clip-votes.controller';
import { ClipVotesService } from './clip-votes.service';

@Module({ imports: [PrismaModule, RoomPresenceModule], controllers: [ClipVotesController], providers: [ClipVotesService], exports: [ClipVotesService] })
export class ClipVotesModule {}
