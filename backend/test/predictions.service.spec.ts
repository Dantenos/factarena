import { ForbiddenException } from '@nestjs/common';
import { PredictionsService } from '../src/predictions/predictions.service';

describe('PredictionsService access control', () => {
  it('requires an active room presence for REST predictions', async () => {
    const prisma = {
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback({
        round: { findUnique: jest.fn().mockResolvedValue({ roomId: 'room-1', roundClaims: [{}, {}] }) },
      })),
    };
    const ledger = { debitForBet: jest.fn() };
    const presence = { isMember: jest.fn().mockResolvedValue(false) };
    const service = new PredictionsService(prisma as never, ledger as never, presence as never);

    await expect(service.create({ roundId: 'round-1', predictedFakeCount: 1, stake: 10 }, 'user-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(ledger.debitForBet).not.toHaveBeenCalled();
  });
});
