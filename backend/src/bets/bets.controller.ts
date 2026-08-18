import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { BetsService } from './bets.service';

@Controller('bets')
@UseGuards(JwtAuthGuard)
export class BetsController {
  constructor(private readonly bets: BetsService) {}
  @Post() create(@Body() body: { roundId: string; stake: number }, @Request() req: { user: { userId: string } }) { return this.bets.create(body, req.user.userId); }
  @Get('round/:roundId') findByRound(@Param('roundId', CuidParamPipe) roundId: string, @Request() req: { user: { userId: string } }) { return this.bets.findByRound(roundId, req.user.userId); }
  @Get('round/:roundId/stats') stats(@Param('roundId', CuidParamPipe) roundId: string) { return this.bets.findRoundStats(roundId); }
}
