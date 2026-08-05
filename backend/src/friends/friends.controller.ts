import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FriendsService } from './friends.service';

class AddFriendDto {
  @IsString()
  @IsNotEmpty()
  friendId!: string;
}

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  list(@Request() req: { user: { userId: string } }) {
    return this.friendsService.list(req.user.userId);
  }

  @Post()
  add(@Request() req: { user: { userId: string } }, @Body() body: AddFriendDto) {
    return this.friendsService.add(req.user.userId, body.friendId);
  }

  @Delete(':friendId')
  remove(@Request() req: { user: { userId: string } }, @Param('friendId') friendId: string) {
    return this.friendsService.remove(req.user.userId, friendId);
  }
}
