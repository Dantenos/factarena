import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';

@Controller('claims')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get()
  getAll() {
    return this.claimsService.findAll();
  }

  @Get('round/:roundId')
  getByRound(@Param('roundId') roundId: string) {
    return this.claimsService.findByRound(roundId);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.claimsService.findById(id);
  }

  @Post()
  @Roles('ADMIN', 'SEED')
  create(@Body() dto: CreateClaimDto, @Request() req: { user: { userId: string } }) {
    return this.claimsService.create(dto, req.user.userId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SEED')
  update(@Param('id') id: string, @Body() dto: UpdateClaimDto) {
    return this.claimsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SEED')
  remove(@Param('id') id: string) {
    return this.claimsService.remove(id);
  }
}
