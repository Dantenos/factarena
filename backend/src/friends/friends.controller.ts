import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsNotEmpty, Matches } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CUID_PATTERN, CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { FriendsService } from './friends.service';

class AddFriendDto {
  @IsNotEmpty()
  @Matches(CUID_PATTERN)
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

  @Get('presence')
  presence(@Request() req: { user: { userId: string } }) {
    return this.friendsService.presence(req.user.userId);
  }

  @Post()
  add(@Request() req: { user: { userId: string } }, @Body() body: AddFriendDto) {
    return this.friendsService.add(req.user.userId, body.friendId);
  }

  @Delete(':friendId')
  remove(@Request() req: { user: { userId: string } }, @Param('friendId', CuidParamPipe) friendId: string) {
    return this.friendsService.remove(req.user.userId, friendId);
  }
}
