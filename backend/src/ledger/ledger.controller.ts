import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
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

  // Réservé au joueur qui ne peut plus miser : le service refuse au-dessus du
  // seuil, on ne peut donc pas s'en servir pour se recharger à volonté.
  @Post('rattrapage')
  rattrapage(@Request() req: { user: { userId: string } }) { return this.ledgerService.reclamerRattrapage(req.user.userId); }
}
