import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@Body() body: CreateRoomDto, @Request() req: { user: { userId: string } }) { return this.roomsService.create(body, req.user.userId); }

  @Get()
  findAll() { return this.roomsService.findAll(); }

  @Get(':id/state')
  state(@Param('id', CuidParamPipe) id: string) { return this.roomsService.getState(id); }

  @Get(':id/members')
  members(@Param('id', CuidParamPipe) id: string) { return this.roomsService.getMembers(id); }

  @Get(':id/history')
  history(@Param('id', CuidParamPipe) id: string) { return this.roomsService.getHistory(id); }

  @Get(':id')
  findOne(@Param('id', CuidParamPipe) id: string) { return this.roomsService.findOne(id); }
}
