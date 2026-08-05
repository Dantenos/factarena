import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

class SendChatMessageDto {
  @IsString()
  @IsNotEmpty()
  roomId!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('room/:roomId')
  getRoomMessages(@Param('roomId') roomId: string) {
    return this.chatService.findByRoom(roomId);
  }

  @Post('send')
  sendMessage(@Request() req: { user: { userId: string } }, @Body() body: SendChatMessageDto) {
    return this.chatService.sendMessage(req.user.userId, body.roomId, body.content);
  }
}
