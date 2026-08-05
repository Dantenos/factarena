import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePredictionDto } from './dto/create-prediction.dto';
import { PredictionsService } from './predictions.service';

@Controller('predictions')
@UseGuards(JwtAuthGuard)
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Post()
  create(@Body() body: CreatePredictionDto, @Request() req: { user: { userId: string } }) { return this.predictionsService.create(body, req.user.userId); }

  @Get('round/:roundId')
  findByRound(@Param('roundId') roundId: string) { return this.predictionsService.findByRound(roundId); }

  @Get('round/:roundId/stats')
  findRoundStats(@Param('roundId') roundId: string) { return this.predictionsService.findRoundStats(roundId); }
}
