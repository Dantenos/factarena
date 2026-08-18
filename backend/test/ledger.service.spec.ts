import { BadRequestException } from '@nestjs/common';
import { LedgerService } from '../src/ledger/ledger.service';

describe('LedgerService', () => {
  it('rejects non-positive amounts', async () => {
    const service = new LedgerService({} as never);

    await expect(service.creditPayout({} as never, 'user-1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.debitForBet({} as never, 'user-1', -1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not apply an already recorded payout twice', async () => {
    const existing = { id: 'tx-1', userId: 'user-1', type: 'PAYOUT', amount: 20, referenceId: 'payout:p1' };
    const tx = {
      transaction: { findUnique: jest.fn().mockResolvedValue(existing), create: jest.fn() },
      user: { update: jest.fn() },
    };
    const service = new LedgerService({} as never);

    await expect(service.creditPayout(tx as never, 'user-1', 20, 'payout:p1')).resolves.toBe(existing);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('does not apply an already recorded refund twice', async () => {
    const existing = { id: 'tx-2', userId: 'user-1', type: 'REFUND', amount: 30, referenceId: 'refund:p1' };
    const tx = {
      transaction: { findUnique: jest.fn().mockResolvedValue(existing), create: jest.fn() },
      user: { update: jest.fn() },
    };
    const service = new LedgerService({} as never);

    await expect(service.refundBet(tx as never, 'user-1', 30, 'refund:p1')).resolves.toBe(existing);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
