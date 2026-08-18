import { Module } from '@nestjs/common';
import { BetsModule } from '../bets/bets.module';

@Module({
  imports: [BetsModule],
  controllers: [],
  providers: [],
  exports: [BetsModule],
})
export class PredictionsModule {}
