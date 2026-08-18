import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Reflector } from '@nestjs/core';

@Module({
  imports: [PrismaModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, RolesGuard],
  exports: [ClaimsService],
})
export class ClaimsModule {}
