import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { ClipVotesService } from './clip-votes.service';

@Controller('clip-votes')
@UseGuards(JwtAuthGuard)
export class ClipVotesController {
  constructor(private readonly votes: ClipVotesService) {}
  @Post() vote(@Body() body: { roundId: string; claimId: string; isFake: boolean }, @Request() req: { user: { userId: string } }) { return this.votes.create(body, req.user.userId); }
  @Get('round/:roundId') findByRound(@Param('roundId', CuidParamPipe) roundId: string, @Request() req: { user: { userId: string } }) { return this.votes.findByRound(roundId, req.user.userId); }
}
