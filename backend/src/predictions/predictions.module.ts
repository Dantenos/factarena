import { forwardRef, Module } from '@nestjs/common';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { LedgerModule } from '../ledger/ledger.module';
import { RoomsModule } from '../rooms/rooms.module';

@Module({
  imports: [LedgerModule, forwardRef(() => RoomsModule)],
  controllers: [PredictionsController],
  providers: [PredictionsService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
