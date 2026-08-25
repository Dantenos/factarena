import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { RateLimitService } from '../common/rate-limit.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [HttpModule, PrismaModule],
  controllers: [AiController],
  providers: [AiService, RateLimitService],
  exports: [AiService, RateLimitService],
})
export class AiModule {}
