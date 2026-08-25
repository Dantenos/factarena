import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { CreatePredictionDto } from './dto/create-prediction.dto';
import { PredictionsService } from './predictions.service';

@Controller('predictions')
@UseGuards(JwtAuthGuard)
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Post()
  create(@Body() body: CreatePredictionDto, @Request() req: { user: { userId: string } }) { return this.predictionsService.create(body, req.user.userId); }

  @Get('round/:roundId')
  findByRound(@Param('roundId', CuidParamPipe) roundId: string, @Request() req: { user: { userId: string } }) { return this.predictionsService.findByRound(roundId, req.user.userId); }

  @Get('round/:roundId/stats')
  findRoundStats(@Param('roundId', CuidParamPipe) roundId: string) { return this.predictionsService.findRoundStats(roundId); }
}
