import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { RoomsService } from '../rooms/rooms.service';
import { CreateRoundDto } from './dto/create-round.dto';
import { RoundsService } from './rounds.service';

@Controller('rounds')
@UseGuards(JwtAuthGuard)
export class RoundsController {
  constructor(
    private readonly roundsService: RoundsService,
    private readonly roomsService: RoomsService,
  ) {}

  @Post()
  create(@Body() body: CreateRoundDto, @Request() req: { user: { userId: string } }) { return this.roundsService.create(body, req.user.userId); }

  @Get('room/:roomId')
  findByRoom(@Param('roomId', CuidParamPipe) roomId: string) { return this.roundsService.findByRoom(roomId); }

  @Get(':id/history')
  history(@Param('id', CuidParamPipe) id: string) { return this.roomsService.getRoundHistory(id); }

  @Get(':id')
  findOne(@Param('id', CuidParamPipe) id: string) { return this.roundsService.findOne(id); }

  @Post(':id/lock')
  lock(@Param('id', CuidParamPipe) id: string, @Request() req: { user: { userId: string } }) { return this.roundsService.lock(id, req.user.userId); }

  @Post(':id/reveal')
  reveal(@Param('id', CuidParamPipe) id: string, @Request() req: { user: { userId: string } }) { return this.roundsService.reveal(id, req.user.userId); }
}
