import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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

  @Get(':id')
  findOne(@Param('id') id: string) { return this.roomsService.findOne(id); }
}
