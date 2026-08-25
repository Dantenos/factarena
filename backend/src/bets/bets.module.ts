import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RoomPresenceModule } from '../rooms/room-presence.module';
import { BetsController } from './bets.controller';
import { BetsService } from './bets.service';

@Module({ imports: [PrismaModule, LedgerModule, RoomPresenceModule], controllers: [BetsController], providers: [BetsService], exports: [BetsService] })
export class BetsModule {}
