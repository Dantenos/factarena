import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiService } from './ai.service';
import { ClaimVerdictRequestDto } from './dto/claim-verdict-request.dto';
import { LlmRequestDto } from './dto/llm-request.dto';
import { ModerationRequestDto } from './dto/moderation-request.dto';
import { RagRequestDto } from './dto/rag-request.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('health')
  health() {
    return this.aiService.health();
  }

  @Post('rag')
  @Roles('ADMIN', 'SEED', 'USER')
  askRag(@Body() dto: RagRequestDto) {
    return this.aiService.askRag(dto.question, dto.limit ?? 4);
  }

  @Post('llm')
  @Roles('ADMIN', 'SEED', 'USER')
  chat(@Body() dto: LlmRequestDto) {
    return this.aiService.chat(dto.prompt, dto.messages);
  }

  @Post('moderation')
  @Roles('ADMIN', 'SEED', 'USER')
  moderate(@Body() dto: ModerationRequestDto) {
    return this.aiService.moderate(dto.message, dto.history);
  }

  @Post('claims/:claimId/verdict')
  @Roles('ADMIN', 'SEED', 'USER')
  generateClaimVerdict(@Param('claimId') claimId: string, @Body() dto: ClaimVerdictRequestDto) {
    return this.aiService.generateClaimVerdict(claimId, dto.question, dto.limit ?? 4);
  }

  @Get('claims/:claimId/verdict')
  @Roles('ADMIN', 'SEED', 'USER')
  getClaimVerdict(@Param('claimId') claimId: string) {
    return this.aiService.getClaimVerdict(claimId);
  }
}
