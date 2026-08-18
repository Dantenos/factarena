import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('leaderboard')
  leaderboard() {
    return this.statsService.getLeaderboard();
  }

  @Get('round-history')
  roundHistory() {
    return this.statsService.getRoundHistory();
  }

  @Get('me')
  myStats(@Request() req: { user: { userId: string } }) {
    return this.statsService.getUserStats(req.user.userId);
  }

  @Get('me/round-history')
  myRoundHistory(@Request() req: { user: { userId: string } }) {
    return this.statsService.getUserRoundHistory(req.user.userId);
  }

  @Get('users/:userId')
  userStats(@Param('userId', CuidParamPipe) userId: string) {
    return this.statsService.getUserStats(userId);
  }

  @Get('users/:userId/round-history')
  userRoundHistory(@Param('userId', CuidParamPipe) userId: string) {
    return this.statsService.getUserRoundHistory(userId);
  }
}
