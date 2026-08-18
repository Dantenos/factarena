import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LedgerService } from './ledger.service';

@Controller('ledger')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get('balance')
  balance(@Request() req: { user: { userId: string } }) { return this.ledgerService.getBalance(req.user.userId); }

  @Get('transactions')
  transactions(@Request() req: { user: { userId: string } }) { return this.ledgerService.getHistory(req.user.userId); }
}
