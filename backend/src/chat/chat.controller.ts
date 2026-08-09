import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CUID_PATTERN, CuidParamPipe } from '../common/pipes/cuid-param.pipe';
import { ChatService } from './chat.service';

class SendChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @Matches(CUID_PATTERN)
  roomId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('room/:roomId')
  getRoomMessages(@Param('roomId', CuidParamPipe) roomId: string, @Request() req: { user: { userId: string } }) {
    return this.chatService.findByRoom(roomId, req.user.userId);
  }

  @Post('send')
  sendMessage(@Request() req: { user: { userId: string } }, @Body() body: SendChatMessageDto) {
    return this.chatService.sendMessage(req.user.userId, body.roomId, body.content);
  }
}
